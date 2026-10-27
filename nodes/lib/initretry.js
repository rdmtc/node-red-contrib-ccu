/*
 * Retrying a failed rpc init, separate from the ping/re-init liveness.
 *
 * An interface process that does not answer yet (a box still booting, an
 * addon started before the interfaces, a daemon restart) used to leave the
 * interface without events: rpcCheckInit only runs with cached devices and
 * then waits pingTimeout (600 s for HmIP-RF). Now a failed init schedules its
 * own retry (task 12) until it succeeds or the node is closed: every 3 s for
 * the first 90 s after the interface was first missed (the start, or the
 * moment a connected process went away), then every 15 s (task 17 - the
 * 1/2/4/8/15 s steps of before hit hmipserver's ready moment, ~50-55 s after
 * an openccu-lite boot, only at their 61 s tick). When one interface appears
 * the others that are waiting are tried at once (poke): rfd and hmipserver
 * come up close together.
 *
 * While the process is unreachable the interface is "waiting": one line, then
 * debug. Before the interface was ever connected, a refused connection is
 * info - the process is still starting (openccu-lite's early start starts
 * Node-RED before rfd and hmipserver) - and every other transport error, or a
 * refusal after it had been connected, is a warning. A fault answer (the
 * process is up and refuses the init) stays an error, logged once per
 * distinct fault.
 */

const RETRY_INTERVAL = 3000;
const RETRY_WINDOW = 90000;
const RETRY_MAX_DELAY = 15000;

/**
 * The delay before the next attempt (task 17).
 * @param {number} elapsed milliseconds since the interface was first missed
 * @returns {number} milliseconds: 3 s within the first 90 s, then 15 s
 */
function retryDelay(elapsed) {
    return elapsed < RETRY_WINDOW ? RETRY_INTERVAL : RETRY_MAX_DELAY;
}

/** @param {number} ms @returns {string} seconds with one decimal, e.g. "54.0 s" */
function seconds(ms) {
    return (Math.max(0, ms) / 1000).toFixed(1) + ' s';
}

/**
 * Whether the error is a fault answer of the interface process (it is up)
 * rather than a transport error (refused, reset, timeout).
 * @param {*} error
 * @returns {boolean}
 */
function isFault(error) {
    return Boolean(error) && typeof error === 'object' && error.faultCode !== undefined;
}

/**
 * Whether nothing listens on the port (yet): the process is not started.
 * @param {*} error
 * @returns {boolean}
 */
function isRefused(error) {
    return Boolean(error) && (error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(error.message || '')));
}

/**
 * A short reason for the log line, e.g. "connect ECONNREFUSED".
 * @param {*} error
 * @returns {string}
 */
function describeError(error) {
    if (!error) {
        return 'unknown error';
    }

    if (isFault(error)) {
        return 'fault ' + error.faultCode + (error.faultString ? ' ' + error.faultString : '');
    }

    if (error.code) {
        return (error.syscall ? error.syscall + ' ' : 'connect ') + error.code;
    }

    // task 5 (#27): the CCU's web server answers a 401 (authentication on, the
    // credentials missing or wrong) with an HTML page, and the XML-RPC client
    // reports only the parser's complaint about it - say what that means
    if (/^Unknown XML-RPC tag '(HTML|HEAD|META|BODY|TITLE|!DOCTYPE)/i.test(String(error.message || ''))) {
        return (
            'the CCU answered a web page instead of XML-RPC (' +
            error.message +
            ') - authentication is on and the credentials are missing or wrong, or this is not an RPC port'
        );
    }

    return error.message || String(error);
}

class InitRetry {
    /**
     * @param {object} options
     * @param {string} options.iface interface name for the log lines
     * @param {function(): Promise} options.attempt one init attempt
     * @param {object} options.logger {debug, info, warn, error}
     * @param {function(string)} options.onState 'waiting' | 'failed' | 'connected'
     * @param {object} [options.timers] {setTimeout, clearTimeout}, for tests
     * @param {function(): number} [options.now] the clock, for tests
     * @param {number} [options.startedAt] when the program (the connection node) started, for the log line
     */
    constructor({iface, attempt, logger, onState, timers, now, startedAt}) {
        this.iface = iface;
        this.attempt = attempt;
        this.logger = logger;
        this.onState = onState || (() => {});
        this.timers = timers || {setTimeout, clearTimeout};
        this.now = now || Date.now;
        this.startedAt = startedAt === undefined ? this.now() : startedAt;
        this.timer = null;
        this.running = false;
        this.stopped = false;
        this.everConnected = false;
        this.reset();
    }

    reset() {
        this.failures = 0;
        this.warned = false;
        this.faults = new Set();
        // task 17: when the process was first missed - the 90 s of 3 s steps count from here
        this.missedAt = null;
    }

    /** true while a retry is scheduled */
    get pending() {
        return this.timer !== null;
    }

    /**
     * An init attempt failed: log it and schedule the next one.
     * @param {*} error
     */
    failed(error) {
        if (this.stopped) {
            return;
        }

        if (this.failures === 0) {
            this.missedAt = this.now();
        }

        this.failures += 1;
        const delay = retryDelay(this.now() - this.missedAt);
        const seconds = delay / 1000;
        const reason = describeError(error);
        if (isFault(error)) {
            if (this.faults.has(reason)) {
                this.logger.debug(
                    'init ' + this.iface + ' failed again: ' + reason + ', retrying in ' + seconds + ' s',
                );
            } else {
                this.faults.add(reason);
                this.logger.error('init ' + this.iface + ' failed: ' + reason + ', retrying in ' + seconds + ' s');
            }

            this.onState('failed');
        } else {
            if (this.warned) {
                this.logger.debug(
                    this.iface + ' still not reachable (' + reason + '), next attempt in ' + seconds + ' s',
                );
            } else {
                this.warned = true;
                if (!this.everConnected && isRefused(error)) {
                    this.logger.info(
                        this.iface +
                            ' not listening yet (' +
                            reason +
                            '), waiting for it - retrying in ' +
                            seconds +
                            ' s',
                    );
                } else {
                    this.logger.warn(this.iface + ' not reachable yet (' + reason + '), retrying');
                }
            }

            this.onState('waiting');
        }

        this.clear();
        this.timer = this.timers.setTimeout(() => {
            this.timer = null;
            this.run();
        }, delay);
    }

    /** one attempt now */
    run() {
        if (this.stopped) {
            return Promise.resolve();
        }

        this.running = true;
        return Promise.resolve()
            .then(() => this.attempt())
            .then(
                () => {
                    this.running = false;
                    this.succeeded();
                },
                (error) => {
                    this.running = false;
                    this.failed(error);
                },
            );
    }

    /**
     * task 17: another interface just appeared - try this one now instead of at its timer
     * (rfd and hmipserver come up close together). Nothing while an attempt is running or
     * none is scheduled.
     * @returns {boolean} whether an attempt was started
     */
    poke() {
        if (this.stopped || this.running || this.timer === null) {
            return false;
        }

        this.clear();
        this.logger.debug(this.iface + ': another interface appeared, trying now');
        this.run();
        return true;
    }

    /** an init attempt succeeded */
    succeeded() {
        if (this.stopped) {
            return;
        }

        this.clear();
        if (this.failures > 0) {
            // task 17: one line with the time, so a log shows how close the start got to the process's ready moment
            const since = this.everConnected
                ? seconds(this.now() - this.missedAt) + ' after it went missing'
                : seconds(this.now() - this.startedAt) + ' after the start';
            this.logger.info(this.iface + ' connected after ' + (this.failures + 1) + ' attempts, ' + since);
        }

        this.everConnected = true;
        this.reset();
        this.onState('connected');
    }

    clear() {
        if (this.timer !== null) {
            this.timers.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /** no more attempts (node closed or redeployed, interface disabled) */
    stop() {
        this.stopped = true;
        this.clear();
    }
}

module.exports = {
    InitRetry,
    retryDelay,
    isFault,
    isRefused,
    describeError,
    RETRY_INTERVAL,
    RETRY_WINDOW,
    RETRY_MAX_DELAY,
};
