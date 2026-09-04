/* Node status line showing the last known value and how old it is
   (B-5, issues #54 and #52).

   The data was always there - the connection keeps value, ts and lc for
   every datapoint and system variable - the nodes just never showed it,
   and the sysvar node only showed anything at all when "emit value on
   start" was enabled. The age is re-rendered on a timer so the line does
   not silently become stale between events. */

/** Node-RED status lines are narrow - keep them readable. */
const MAX_TEXT = 45;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How often the age is re-rendered, matched to the resolution shown. */
function refreshInterval(seconds) {
    if (seconds < MINUTE) {
        return 5000;
    }

    if (seconds < HOUR) {
        return 30000;
    }

    return 300000;
}

/**
 * Compact age of a timestamp, in the style Node-RED status lines use.
 * @param {number} ts epoch milliseconds
 * @param {number} now epoch milliseconds
 * @returns {string} e.g. '5s', '12m', '3h', '2d'
 */
function relativeTime(ts, now) {
    const seconds = Math.max(0, Math.round((now - ts) / 1000));
    if (seconds < MINUTE) {
        return seconds + 's';
    }

    if (seconds < HOUR) {
        return Math.floor(seconds / MINUTE) + 'm';
    }

    if (seconds < DAY) {
        return Math.floor(seconds / HOUR) + 'h';
    }

    return Math.floor(seconds / DAY) + 'd';
}

/**
 * The status text for a value with a timestamp.
 * @param {*} value
 * @param {number} [ts] epoch milliseconds; omitted renders the value alone
 * @param {number} now epoch milliseconds
 * @returns {string}
 */
function formatValueStatus(value, ts, now) {
    let text = String(value);
    if (text.length > MAX_TEXT) {
        text = text.slice(0, MAX_TEXT - 1) + '…';
    }

    if (!ts) {
        return text;
    }

    return text + ' (' + relativeTime(ts, now) + ')';
}

/**
 * Keeps a node's status line showing the last value and its age.
 *
 * @param {object} node the Node-RED node (needs .status())
 * @param {object} [options]
 * @param {Function} [options.now] clock, for tests
 * @returns {{set: Function, clear: Function, stop: Function}}
 */
function valueStatus(node, options) {
    const now = (options && options.now) || Date.now;
    let timer = null;
    let current = null;

    function render() {
        if (!current) {
            return;
        }

        node.status({
            fill: 'green',
            shape: 'ring',
            text: formatValueStatus(current.value, current.ts, now()),
        });
    }

    function schedule() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        if (!current || !current.ts) {
            return;
        }

        const interval = refreshInterval(Math.round((now() - current.ts) / 1000));
        timer = setInterval(() => {
            render();
            // the resolution coarsens as the value ages - re-arm accordingly
            schedule();
        }, interval);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    }

    return {
        /**
         * @param {*} value
         * @param {number} [ts] epoch milliseconds
         */
        set(value, ts) {
            current = {value, ts};
            render();
            schedule();
        },
        clear() {
            current = null;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
    };
}

module.exports = {valueStatus, formatValueStatus, relativeTime};
