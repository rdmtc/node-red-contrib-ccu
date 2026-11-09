/* Pairing with an openccu-lite system from the connection node's dialog.

   A Node-RED that runs elsewhere asks the system for a token instead of
   having one pasted: the dialog sends the address, the runtime finds out
   what answers there (occulite-client's probe - it follows the system's
   redirect to https), asks for access (occulite-client's pair) and shows
   the six-digit code the system's Status page shows too. An administrator
   approves it there; the dialog then gets the token and the fingerprint of
   the certificate the code was bound to, fills the credentials and the user
   deploys. The connection pins that certificate from then on.

   Node-RED on the system itself (RedMatic on openccu-lite) needs none of
   this: the connection configures itself from the addon's own token, so a
   pairing request for a local connection is refused.

   One request per id, held in memory: the dialog polls it, and its token is
   handed out once. A request nobody polls any more is withdrawn. */

const crypto = require('crypto');
const os = require('os');

/** what the connection asks for: devices up to pairing and deleting them, the names read */
const ACCESS = {devices: 'administer', names: 'read'};
const PURPOSE = {
    devices: 'Node-RED flows read and set datapoints; the rpc node may call any method of the interfaces',
    names: 'channel names, rooms and functions in the nodes and their messages',
};
const APP = 'node-red-contrib-ccu';

/** the system lets a request expire after five minutes; a little longer here, so its own answer comes first */
const PAIR_TIMEOUT_MS = 6 * 60 * 1000;
/** a request nobody polled for this long is withdrawn (the dialog was closed) */
const ABANDON_MS = 60 * 1000;
/** a settled request is kept this long for the dialog's last poll */
const KEEP_MS = 2 * 60 * 1000;

/** occulite-client's error codes and what the dialog says about them */
const MESSAGES = {
    rejected: 'The administrator rejected the request (or chose another code).',
    expired: 'Nobody approved the request within five minutes.',
    timeout: 'Nobody approved the request in time.',
    aborted: 'Pairing was cancelled.',
    'pairing-off': 'Pairing is switched off on the system ("Allow programs to ask for access" on its API tokens page).',
    'not-local':
        'The system accepts pairing requests only from its local networks - this Node-RED is outside them (see the firewall settings of the system).',
    limit: 'The system refuses more pairing requests from this address for now - wait ten minutes and try again.',
    certificate: 'The certificate of the system cannot be checked.',
};

/**
 * The address the probe starts from: the host as entered, with the scheme and port the dialog
 * names; without a port the probe goes to http and follows the system's redirect to https.
 * @param {object} options
 * @param {string} options.host
 * @param {boolean} [options.tls]
 * @param {string|number} [options.port]
 * @returns {string}
 */
function addressOf({host, tls, port}) {
    const name = String(host).trim();
    const bracketed = name.includes(':') && !name.startsWith('[') ? '[' + name + ']' : name;
    const portNumber = Number.parseInt(port, 10);
    if (portNumber > 0) {
        return (tls ? 'https' : 'http') + '://' + bracketed + ':' + portNumber;
    }

    return tls ? 'https://' + bracketed : bracketed;
}

/**
 * The connection node's settings for the system's URL: TLS and the port when it is not the default.
 * @param {string} url scheme and authority
 * @returns {{tls: boolean, port: string}}
 */
function settingsOf(url) {
    const parsed = new URL(url);
    return {tls: parsed.protocol === 'https:', port: parsed.port};
}

/**
 * The dialog's message for an error of occulite-client.
 * @param {*} error
 * @returns {{error: string, message: string}}
 */
function describeError(error) {
    const code = (error && error.name === 'OccuLiteError' && error.code) || (error && error.kind) || 'failed';
    const message = MESSAGES[code] || 'Pairing failed: ' + ((error && error.message) || String(error));
    return {error: code, message};
}

class Pairings {
    /**
     * @param {object} options
     * @param {function(): {pair: Function, probe: Function}} options.load occulite-client's pair and probe
     * @param {function(string): boolean} options.isLocal whether a host is the system Node-RED runs on
     * @param {string} [options.appVersion]
     * @param {string} [options.instance] what the system's Status page names this Node-RED by
     * @param {object} [options.logger] {info, warn}
     * @param {number} [options.pairTimeout]
     * @param {number} [options.abandonAfter]
     * @param {number} [options.keepFor]
     */
    constructor(options) {
        this.load = options.load;
        this.isLocal = options.isLocal;
        this.appVersion = options.appVersion;
        this.instance = options.instance || os.hostname();
        this.logger = options.logger || {info() {}, warn() {}};
        this.pairTimeout = options.pairTimeout || PAIR_TIMEOUT_MS;
        this.abandonAfter = options.abandonAfter || ABANDON_MS;
        this.keepFor = options.keepFor || KEEP_MS;
        this.requests = new Map();
    }

    /**
     * Starts a pairing. Throws (with `status`) on what is refused at once: no address, a local
     * connection, occulite-client not loadable.
     * @param {object} options
     * @param {string} options.host the address in the dialog
     * @param {boolean} [options.tls]
     * @param {string|number} [options.port] the openccu-lite port of the dialog
     * @returns {string} the request's id
     */
    start({host, tls, port}) {
        if (!host || !String(host).trim()) {
            throw Object.assign(new Error('Enter the address of the system first.'), {status: 400, code: 'host'});
        }

        if (this.isLocal(String(host).trim())) {
            throw Object.assign(
                new Error(
                    'Node-RED runs on the system itself: the connection configures itself, no pairing is needed.',
                ),
                {status: 409, code: 'local'},
            );
        }

        let modules;
        try {
            modules = this.load();
        } catch (error) {
            throw Object.assign(new Error(error.message), {status: 500, code: 'unavailable'});
        }

        const id = crypto.randomBytes(12).toString('hex');
        const request = {
            id,
            state: 'probing',
            controller: new AbortController(),
            polled: Date.now(),
            timer: null,
        };
        this.requests.set(id, request);
        this.watch(request);
        this.run(request, modules, addressOf({host, tls, port}));
        return id;
    }

    /**
     * The probe, then the pairing; the request's state follows.
     * @param {object} request
     * @param {{pair: Function, probe: Function}} modules
     * @param {string} address
     * @returns {Promise<void>}
     */
    async run(request, {pair, probe}, address) {
        const {signal} = request.controller;
        try {
            const found = await probe(address, {timeout: 5000, signal});
            if (found.kind !== 'openccu-lite') {
                const message =
                    found.kind === 'ccu'
                        ? 'This is not an openccu-lite system. A CCU pairs no programs - enter its credentials under Authentication instead.'
                        : found.reason === 'certificate'
                          ? MESSAGES.certificate
                          : 'The system does not answer' + (found.reason ? ' (' + found.reason + ').' : '.');
                this.settle(request, {
                    state: 'failed',
                    error: found.kind === 'ccu' ? 'not-openccu-lite' : 'unreachable',
                    message,
                });
                return;
            }

            const capabilities = (found.info && found.info.capabilities) || {};
            if (capabilities.pairing === false) {
                this.settle(request, {state: 'failed', error: 'pairing-off', message: MESSAGES['pairing-off']});
                return;
            }

            request.url = found.url;
            request.state = 'requesting';
            const paired = await pair({
                url: found.url,
                app: APP,
                appVersion: this.appVersion,
                instance: this.instance,
                access: ACCESS,
                purpose: PURPOSE,
                signal,
                timeout: this.pairTimeout,
                onCode: (code) => {
                    request.code = code;
                    request.state = 'waiting';
                    this.logger.info('pairing with ' + found.url + ': code ' + code + ', waiting for the approval');
                },
            });
            this.logger.info('paired with ' + found.url + ' as ' + paired.name);
            this.settle(request, {
                state: 'approved',
                token: paired.token,
                fingerprint256: paired.fingerprint256 || '',
                name: paired.name,
                scopes: paired.scopes,
                ...settingsOf(found.url),
            });
        } catch (error) {
            const {error: code, message} = describeError(error);
            if (code !== 'aborted') {
                this.logger.warn('pairing with ' + (request.url || address) + ' failed: ' + message);
            }

            this.settle(request, {state: code === 'aborted' ? 'cancelled' : 'failed', error: code, message});
        }
    }

    /**
     * Withdraws a request the dialog stopped polling.
     * @param {object} request
     */
    watch(request) {
        request.timer = setInterval(
            () => {
                if (Date.now() - request.polled > this.abandonAfter) {
                    this.cancel(request.id);
                }
            },
            Math.min(this.abandonAfter, 10000),
        );
        request.timer.unref();
    }

    /**
     * The outcome; the request stays for the dialog's last poll.
     * @param {object} request
     * @param {object} outcome
     */
    settle(request, outcome) {
        clearInterval(request.timer);
        Object.assign(request, outcome);
        request.timer = setTimeout(() => this.requests.delete(request.id), this.keepFor);
        request.timer.unref();
    }

    /**
     * The dialog's view of a request; the token is in it once.
     * @param {string} id
     * @returns {object|undefined}
     */
    get(id) {
        const request = this.requests.get(id);
        if (!request) {
            return undefined;
        }

        request.polled = Date.now();
        const view = {state: request.state};
        ['code', 'url', 'error', 'message', 'name', 'fingerprint256', 'tls', 'port', 'token'].forEach((key) => {
            if (request[key] !== undefined) {
                view[key] = request[key];
            }
        });
        if (request.state === 'approved' || request.state === 'failed' || request.state === 'cancelled') {
            clearTimeout(request.timer);
            this.requests.delete(request.id);
        }

        return view;
    }

    /**
     * Withdraws a request (the dialog was closed or its button pressed again).
     * @param {string} id
     * @returns {boolean} whether there was one
     */
    cancel(id) {
        const request = this.requests.get(id);
        if (!request) {
            return false;
        }

        clearInterval(request.timer);
        clearTimeout(request.timer);
        this.requests.delete(id);
        request.controller.abort();
        return true;
    }

    /** Withdraws every request (Node-RED stops). */
    close() {
        [...this.requests.keys()].forEach((id) => this.cancel(id));
    }
}

module.exports = {Pairings, addressOf, settingsOf, describeError, ACCESS, APP, MESSAGES};
