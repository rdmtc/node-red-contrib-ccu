/*
 * Retrying a failed rpc init, separate from the ping/re-init liveness.
 *
 * An interface process that does not answer yet (a box still booting, an
 * addon started before the interfaces, a daemon restart) used to leave the
 * interface without events: rpcCheckInit only runs with cached devices and
 * then waits pingTimeout (600 s for HmIP-RF). Now a failed init schedules its
 * own retry, 2 s, 4 s, 8 s, 16 s and then every 30 s, until it succeeds or the
 * node is closed.
 *
 * While the process is unreachable the interface is "waiting": one warn line,
 * then debug. A fault answer (the process is up and refuses the init) stays an
 * error, logged once per distinct fault.
 */

const RETRY_DELAYS = [2000, 4000, 8000, 16000];
const RETRY_MAX_DELAY = 30000;

/**
 * The delay before the next attempt.
 * @param {number} failures failed attempts so far (1 after the first failure)
 * @returns {number} milliseconds
 */
function retryDelay(failures) {
    if (failures >= 1 && failures <= RETRY_DELAYS.length) {
        return RETRY_DELAYS[failures - 1];
    }

    return RETRY_MAX_DELAY;
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
     */
    constructor({iface, attempt, logger, onState, timers}) {
        this.iface = iface;
        this.attempt = attempt;
        this.logger = logger;
        this.onState = onState || (() => {});
        this.timers = timers || {setTimeout, clearTimeout};
        this.timer = null;
        this.stopped = false;
        this.reset();
    }

    reset() {
        this.failures = 0;
        this.warned = false;
        this.faults = new Set();
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

        this.failures += 1;
        const delay = retryDelay(this.failures);
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
                this.logger.warn(this.iface + ' not reachable yet (' + reason + '), retrying');
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

        return Promise.resolve()
            .then(() => this.attempt())
            .then(
                () => this.succeeded(),
                (error) => this.failed(error),
            );
    }

    /** an init attempt succeeded */
    succeeded() {
        if (this.stopped) {
            return;
        }

        this.clear();
        if (this.failures > 0) {
            this.logger.info(this.iface + ' connected after ' + (this.failures + 1) + ' attempts');
        }

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

module.exports = {InitRetry, retryDelay, isFault, describeError, RETRY_DELAYS, RETRY_MAX_DELAY};
