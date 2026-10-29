/* The callback dispatch of node-red-contrib-ccu up to 4.7.2 - subscribe(), unsubscribe(),
   callCallback() and callCallbacks() of ccu-connection.js with their per-datapoint whitelists and
   blacklists - kept here as the reference the indexed dispatch (nodes/lib/subscriptions.js) is
   tested against and the benchmark measures before/after with. Only the connection's own
   bookkeeping is reproduced; the callback gets the message itself instead of a clone. */

class LegacyDispatch {
    constructor(logger) {
        this.logger = logger || {trace() {}};
        this.callbacks = {};
        this.idCallback = 0;
        this.callbackBlacklists = {};
        this.callbackWhitelists = {};
        this.values = {};
        this.cachedValuesReceived = true;
    }

    subscribe(filter, callback) {
        filter = filter || {};
        const id = this.idCallback;
        this.idCallback += 1;
        this.callbacks[id] = {filter, callback};

        if (filter.cache && this.cachedValuesReceived) {
            Object.keys(this.values).forEach((dp) => {
                const message = {...this.values[dp]};
                message.cache = true;
                message.change = false;
                if (!this.callbackBlacklists[message.datapointName]) {
                    this.callbackBlacklists[message.datapointName] = new Set();
                }

                if (!this.callbackWhitelists[message.datapointName]) {
                    this.callbackWhitelists[message.datapointName] = new Set();
                }

                this.callCallback(message, id);
            });
        }

        return id;
    }

    unsubscribe(id) {
        if (this.callbacks[id]) {
            delete this.callbacks[id];
            Object.keys(this.callbackBlacklists).forEach((dp) => {
                this.callbackBlacklists[dp].delete(id);
            });
            Object.keys(this.callbackWhitelists).forEach((dp) => {
                this.callbackWhitelists[dp].delete(id);
            });
            return true;
        }

        return false;
    }

    callCallback(message, id) {
        const {filter, callback} = this.callbacks[id];

        let match = true;
        let matchCache;
        let matchChange;
        let matchStable;

        if (filter && filter.uncertain === false && message.uncertain) {
            return false;
        }

        if (filter) {
            const arrayAttr = Object.keys(filter);

            for (let i = 0, {length} = arrayAttr; match && i < length; i++) {
                const attr = arrayAttr[i];

                if (attr === 'cache') {
                    if (!filter.cache && message.cache) {
                        return false;
                    }

                    matchCache = true;
                    continue;
                }

                if (attr === 'change') {
                    if (filter.change && !message.change && !(filter.cache && message.cache)) {
                        return false;
                    }

                    matchChange = true;
                    continue;
                }

                if (attr === 'stable') {
                    if (filter.stable && !message.stable) {
                        return false;
                    }

                    matchStable = true;
                    continue;
                }

                if (attr === 'uncertain') {
                    continue;
                }

                if (this.callbackWhitelists[message.datapointName].has(id)) {
                    if (matchCache && matchChange && matchStable) {
                        break;
                    }

                    continue;
                }

                if (filter[attr] === '') {
                    continue;
                }

                if (attr === 'channelIndex' && typeof filter[attr] !== 'undefined') {
                    filter[attr] = Number.parseInt(filter[attr], 10);
                }

                if (Array.isArray(message[attr])) {
                    if (filter[attr] instanceof RegExp) {
                        match = false;
                        message[attr].forEach((item) => {
                            if (filter[attr].test(item)) {
                                match = true;
                            }
                        });
                    } else if (!message[attr].includes(filter[attr])) {
                        match = false;
                    }
                } else if (filter[attr] instanceof RegExp) {
                    if (!filter[attr].test(message[attr])) {
                        match = false;
                    }
                } else if (filter[attr] !== message[attr]) {
                    match = false;
                }
            }
        }

        if (match) {
            callback(message);
            this.callbackWhitelists[message.datapointName].add(id);
        } else {
            this.callbackBlacklists[message.datapointName].add(id);
        }

        return match;
    }

    callCallbacks(message) {
        if (!this.callbackBlacklists[message.datapointName]) {
            this.callbackBlacklists[message.datapointName] = new Set();
        }

        if (!this.callbackWhitelists[message.datapointName]) {
            this.callbackWhitelists[message.datapointName] = new Set();
        }

        Object.keys(this.callbacks).forEach((key) => {
            if (this.callbackBlacklists[message.datapointName].has(key)) {
                return;
            }

            this.callCallback(message, key);
        });
    }

    /** the number of ids held in the per-datapoint sets - what the memory grew with */
    entries() {
        let count = 0;
        for (const dp of Object.keys(this.callbackBlacklists)) {
            count += this.callbackBlacklists[dp].size;
        }

        for (const dp of Object.keys(this.callbackWhitelists)) {
            count += this.callbackWhitelists[dp].size;
        }

        return count;
    }
}

module.exports = {LegacyDispatch};
