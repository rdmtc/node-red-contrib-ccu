/*
 * The datapoint subscriptions of a connection and their dispatch.
 *
 * Until 4.7.2 every subscription was tested against every event, and the outcome was remembered
 * per datapoint in two Sets of subscription ids (a whitelist and a blacklist per datapoint name):
 * a subscription that did not match a datapoint landed in that datapoint's blacklist, so the
 * memory grew with datapoints x subscriptions (12,000 datapoints x 1,000 subscriptions was some
 * 300 MB of live heap on a CCU3), and a `cache: true` subscription walked every cached value at
 * subscribe time to fill them all at once. Worse, the replay added the id as a number while the
 * event path added it as a string, so an unsubscribe (by number) left the string entries behind:
 * every deploy grew the sets again.
 *
 * Now the subscriptions are indexed by one exact key: the most selective filter attribute given
 * as a plain non-empty string (`datapointName`, then `channel`, `device`, ...). An event looks up
 * the buckets of its own attribute values plus the small list of subscriptions without an exact
 * key (rooms, functions, regular expressions, ...) and tests only those candidates - with the
 * filter logic as it was. Memory is O(subscriptions): one entry per subscription, and unsubscribe
 * removes exactly that entry.
 */

/**
 * The filter attributes an event can be looked up by, most selective first. A subscription is
 * indexed by the first of these its filter names with a plain, non-empty string; the others
 * (and anything that is a RegExp, a number, an array or empty) go into the generic list.
 */
const INDEXED_ATTRIBUTES = [
    'datapointName',
    'channel',
    'device',
    'channelName',
    'deviceName',
    'datapoint',
    'channelType',
    'deviceType',
    'iface',
];

/**
 * The exact key a filter is indexed by.
 * @param {object} filter
 * @returns {{attr: string, value: string}|null} null for a subscription that goes into the generic list
 */
function keyOf(filter) {
    for (const attr of INDEXED_ATTRIBUTES) {
        const value = filter[attr];
        if (typeof value === 'string' && value !== '') {
            return {attr, value};
        }
    }

    return null;
}

/**
 * Whether a message passes a subscription's filter. This is the attribute loop of the old
 * callCallback(), unchanged in what it compares; only the per-datapoint whitelist shortcut is
 * gone (it skipped the comparison for a datapoint that had matched once).
 * @param {object} filter
 * @param {object} message
 * @param {number|string} [id] for the trace lines
 * @param {{trace: Function}} [logger]
 * @returns {boolean}
 */
function matches(filter, message, id, logger) {
    if (!filter) {
        return true;
    }

    // Checked before the attribute loop: only present in the filter when a node opted in, so
    // existing subscriptions keep receiving values the ReGa could not timestamp (#96)
    if (filter.uncertain === false && message.uncertain) {
        return false;
    }

    const attributes = Object.keys(filter);

    for (let i = 0, {length} = attributes; i < length; i++) {
        const attr = attributes[i];

        if (attr === 'cache') {
            // if filter.cache==false - Drop messages with msg.cache==true
            if (!filter.cache && message.cache) {
                return false;
            }

            continue;
        }

        if (attr === 'change') {
            // if filter.change==true - Drop messages with msg.change==false - except msg.cache==true && filter.cache==true
            if (filter.change && !message.change && !(filter.cache && message.cache)) {
                return false;
            }

            continue;
        }

        if (attr === 'stable') {
            // if filter.stable==true - Drop messages with msg.stable==false
            if (filter.stable && !message.stable) {
                return false;
            }

            continue;
        }

        if (attr === 'uncertain') {
            // already decided above, and not a value to compare
            continue;
        }

        if (filter[attr] === '') {
            // an empty value filters nothing
            continue;
        }

        if (attr === 'channelIndex' && typeof filter[attr] !== 'undefined') {
            filter[attr] = Number.parseInt(filter[attr], 10);
        }

        if (Array.isArray(message[attr])) {
            if (filter[attr] instanceof RegExp) {
                if (logger) {
                    logger.trace('cb test regex array', id, attr, filter[attr], message[attr]);
                }

                if (!message[attr].some((item) => filter[attr].test(item))) {
                    return false;
                }
            } else if (!message[attr].includes(filter[attr])) {
                if (logger) {
                    logger.trace('cb mismatch array', id, attr, filter[attr], message[attr]);
                }

                return false;
            }
        } else if (filter[attr] instanceof RegExp) {
            if (!filter[attr].test(message[attr])) {
                if (logger) {
                    logger.trace('cb mismatch regex', id, attr, filter[attr], message[attr]);
                }

                return false;
            }
        } else if (filter[attr] !== message[attr]) {
            if (logger) {
                logger.trace('cb mismatch misc ' + id + ' ' + attr + ' ' + filter[attr] + ' ' + message[attr]);
            }

            return false;
        }
    }

    return true;
}

class SubscriptionIndex {
    constructor() {
        /** @type {Map<number, {filter: object, callback: Function, key: {attr: string, value: string}|null}>} */
        this.subscriptions = new Map();
        /** @type {Map<string, Map<string, Set<number>>>} attribute -> value -> ids */
        this.buckets = new Map();
        /** @type {Set<number>} the subscriptions without an exact key */
        this.generic = new Set();
        this.nextId = 0;
    }

    get size() {
        return this.subscriptions.size;
    }

    /**
     * @param {object} filter
     * @param {Function} callback
     * @returns {number} the subscription id
     */
    add(filter, callback) {
        const id = this.nextId;
        this.nextId += 1;
        const key = keyOf(filter);
        this.subscriptions.set(id, {filter, callback, key});

        if (key) {
            let byValue = this.buckets.get(key.attr);
            if (!byValue) {
                byValue = new Map();
                this.buckets.set(key.attr, byValue);
            }

            let ids = byValue.get(key.value);
            if (!ids) {
                ids = new Set();
                byValue.set(key.value, ids);
            }

            ids.add(id);
        } else {
            this.generic.add(id);
        }

        return id;
    }

    /**
     * @param {number|string} id
     * @returns {boolean} whether the subscription existed
     */
    remove(id) {
        const subscription = this.subscriptions.get(Number(id));
        if (!subscription) {
            return false;
        }

        id = Number(id);
        this.subscriptions.delete(id);
        const {key} = subscription;
        if (key) {
            const byValue = this.buckets.get(key.attr);
            const ids = byValue && byValue.get(key.value);
            if (ids) {
                ids.delete(id);
                if (ids.size === 0) {
                    byValue.delete(key.value);
                    if (byValue.size === 0) {
                        this.buckets.delete(key.attr);
                    }
                }
            }
        } else {
            this.generic.delete(id);
        }

        return true;
    }

    /**
     * @param {number|string} id
     * @returns {{filter: object, callback: Function, key: object|null}|undefined}
     */
    get(id) {
        return this.subscriptions.get(Number(id));
    }

    /**
     * The ids whose filter can match the message - those indexed by one of the message's own
     * attribute values, and the generic ones - in subscription order, as every subscription was
     * called in before.
     * @param {object} message
     * @returns {number[]}
     */
    candidates(message) {
        const ids = [];
        for (const [attr, byValue] of this.buckets) {
            const value = message[attr];
            if (typeof value === 'string') {
                const bucket = byValue.get(value);
                if (bucket) {
                    for (const id of bucket) {
                        ids.push(id);
                    }
                }
            }
        }

        for (const id of this.generic) {
            ids.push(id);
        }

        if (ids.length > 1) {
            ids.sort((a, b) => a - b);
        }

        return ids;
    }

    /**
     * The number of index entries - what the memory grows with. Equals size: one entry per
     * subscription, in a bucket or in the generic list.
     * @returns {number}
     */
    entries() {
        let count = this.generic.size;
        for (const byValue of this.buckets.values()) {
            for (const ids of byValue.values()) {
                count += ids.size;
            }
        }

        return count;
    }

    /**
     * For a `cache: true` subscription: the cached values it has to be replayed with. A filter that
     * names the datapoint exactly (`datapointName`, or `iface` + `channel` + `datapoint`) is one
     * lookup; any other walks the values, testing the exact key before the full filter.
     * @param {object} filter
     * @param {object} values datapointName -> cached message
     * @returns {object[]} the cached messages that can match, in the values' order
     */
    static replayCandidates(filter, values) {
        const key = keyOf(filter);
        let datapointName;
        if (key && key.attr === 'datapointName') {
            datapointName = key.value;
        } else if (
            typeof filter.iface === 'string' &&
            filter.iface !== '' &&
            typeof filter.channel === 'string' &&
            filter.channel !== '' &&
            typeof filter.datapoint === 'string' &&
            filter.datapoint !== ''
        ) {
            datapointName = filter.iface + '.' + filter.channel + '.' + filter.datapoint;
        }

        if (datapointName !== undefined) {
            const value = values[datapointName];
            return value ? [value] : [];
        }

        const result = [];
        for (const name of Object.keys(values)) {
            const value = values[name];
            if (!key || value[key.attr] === key.value) {
                result.push(value);
            }
        }

        return result;
    }
}

module.exports = {SubscriptionIndex, keyOf, matches, INDEXED_ATTRIBUTES};
