/*
 * task 14: the interfaces of an openccu-lite system through its lite-rpc, with occulite-client,
 * instead of XML-RPC/BIN-RPC clients and callback servers of our own.
 *
 * One client per connection node: the requests go to /api/rpc/v1 with the credential, the events
 * come from the stream the client opens (resumed after a break, re-read after a restart of the
 * system), and `callbackEvents` turns them into the very calls a callback server would make -
 * event, system.multicall, newDevices, deleteDevices, updateDevice, replaceDevice, readdedDevice
 * with the same argument lists - so the connection's rpcMethods table feeds from it unchanged.
 * No init, no ping, no callback ports for these interfaces. CUxD and CCU-Jack are not carried by
 * lite-rpc and keep their own clients.
 *
 * The credential: the openccu-lite token of the connection node, else the addon's own token the
 * system mints for RedMatic from its manifest (/run/occulite/addon-tokens/redmatic.api). The local
 * token (meta:read alone) is no credential for lite-rpc.
 *
 * occulite-client is ESM; it is loaded here, lazily, so a CCU user never loads it and a Node too
 * old for require(esm) gets a message instead of a crash (B-32's lesson).
 */

const fs = require('fs');

const LITE_INTERFACES = ['BidCos-RF', 'BidCos-Wired', 'HmIP-RF', 'VirtualDevices'];
const ADDON_TOKEN_FILE = '/run/occulite/addon-tokens/redmatic.api';

/** the stream's events as the callback server's methods, see callbackEvents() */
const CALLBACK_METHODS = [
    'event',
    'system.multicall',
    'newDevices',
    'deleteDevices',
    'updateDevice',
    'replaceDevice',
    'readdedDevice',
];

let modules = null;

/**
 * occulite-client, loaded once. Throws with a readable message where it cannot be loaded.
 * @returns {{OccuLite: Function, callbackEvents: Function, nodeTransport: Function}}
 */
function load() {
    if (!modules) {
        try {
            const {OccuLite} = require('occulite-client');
            const {callbackEvents} = require('occulite-client/callbacks');
            const {nodeTransport} = require('occulite-client/node');
            modules = {OccuLite, callbackEvents, nodeTransport};
        } catch (error) {
            throw new Error(
                'occulite-client cannot be loaded (' +
                    (error.message || error) +
                    '): lite-rpc needs Node.js 20.19, 22.12 or newer; the direct connection is used instead',
            );
        }
    }

    return modules;
}

/**
 * The addon's own token on an openccu-lite system (RedMatic's, minted from its manifest), or
 * undefined where there is none.
 * @param {string} [file] the token file, for tests
 * @returns {string|undefined}
 */
function readAddonToken(file = module.exports.ADDON_TOKEN_FILE) {
    try {
        const token = fs.readFileSync(file, 'utf8').trim();
        return token === '' ? undefined : token;
    } catch {
        return undefined;
    }
}

/**
 * Whether an error of the client is an RPC fault of the interface process (the process answered).
 * @param {*} error
 * @returns {boolean}
 */
function isFault(error) {
    return Boolean(error) && error.kind === 'rpc-fault' && error.faultCode !== undefined;
}

/**
 * The client's error as the connection reports it: a fault keeps its code and string, a refused
 * scope says which, everything else its kind.
 * @param {*} error
 * @returns {Error}
 */
function translateError(error) {
    if (isFault(error)) {
        const fault = new Error(error.faultString || error.message);
        fault.faultCode = error.faultCode;
        fault.faultString = error.faultString || error.message;
        return fault;
    }

    if (error && error.kind === 'forbidden') {
        const refused = new Error(
            'the openccu-lite token may not call this method' + (error.scope ? ' (needs ' + error.scope + ')' : ''),
        );
        refused.kind = 'forbidden';
        refused.scope = error.scope;
        return refused;
    }

    if (error && error.kind) {
        const translated = new Error(error.message || error.kind);
        translated.kind = error.kind;
        return translated;
    }

    return error instanceof Error ? error : new Error(String(error));
}

class LiteConnection {
    /**
     * @param {object} options
     * @param {string} options.url the system, scheme and authority
     * @param {string} options.token the credential
     * @param {boolean} [options.insecure] accept any certificate
     * @param {string[]} options.interfaces the interfaces to follow (the enabled ones lite-rpc carries)
     * @param {function(string): string} options.initId the init id the connection's callback table expects per interface
     * @param {function(string, *, Array, Function)} options.onCallback (method, err, params, answer): a callback server's call
     * @param {function(string, string)} options.onInterface (iface, state): up | down | restarted | added | removed
     * @param {function(string)} options.onStatus the client's state: connecting | ready | degraded | offline | closed
     * @param {function(Map)} [options.onValues] box.values once ready (the state store's picture)
     * @param {object} options.logger {debug, info, warn, error}
     * @param {number} [options.timeout] per request, ms
     * @param {Function} [options.createClient] for tests, in place of new OccuLite()
     */
    constructor(options) {
        this.options = options;
        this.interfaces = [...options.interfaces];
        this.logger = options.logger;
        this.box = null;
        this.server = null;
        this.closed = false;
        this.ready = false;
    }

    /**
     * @param {string} iface
     * @returns {boolean} whether this interface goes through lite-rpc
     */
    has(iface) {
        return this.interfaces.includes(iface);
    }

    /**
     * Opens the client. Resolves once the first picture is loaded, rejects with the client's
     * reason (unauthenticated, forbidden, unreachable, timeout ...); the stream keeps trying by
     * itself afterwards.
     * @returns {Promise<void>}
     */
    start() {
        const {OccuLite, callbackEvents, nodeTransport} = load();
        const debug = (message) => this.logger.debug('occulite-client: ' + message);
        const clientOptions = {
            url: this.options.url,
            auth: {token: this.options.token},
            transport: nodeTransport(this.options.insecure ? {insecure: true} : {}),
            interfaces: this.interfaces,
            values: true,
            meta: false,
            devices: true,
            timeout: this.options.timeout || 30000,
            log: {debug, info: debug, warn: debug, error: debug},
        };
        const box = this.options.createClient ? this.options.createClient(clientOptions) : new OccuLite(clientOptions);
        this.box = box;
        box.on('status', (event) => {
            if (this.closed || this.box !== box) {
                return;
            }

            const state = event && event.state ? event.state : event;
            this.ready = state === 'ready';
            this.options.onStatus(state);
        });
        box.on('interface', (event) => {
            if (!this.closed && this.box === box) {
                this.options.onInterface(event.interface, event.state);
            }
        });
        box.on('resync', () => {
            if (!this.closed && this.box === box && this.options.onValues) {
                this.options.onValues(box.values);
            }
        });
        // the stream's events as a callback server's calls, into the connection's own table
        this.server = callbackEvents(box, {initId: this.options.initId});
        CALLBACK_METHODS.forEach((method) => {
            this.server.on(method, (err, parameters, callback) => {
                if (this.closed || this.box !== box) {
                    callback(null, '');
                    return;
                }

                this.options.onCallback(method, err, parameters, callback);
            });
        });

        return box.ready().then(() => {
            if (this.closed || this.box !== box) {
                return;
            }

            this.ready = true;
            if (this.options.onValues) {
                this.options.onValues(box.values);
            }
        });
    }

    /**
     * Any method of an interface process through lite-rpc; the credential's tier decides.
     * @param {string} iface
     * @param {string} method
     * @param {Array} parameters
     * @returns {Promise<*>}
     */
    call(iface, method, parameters) {
        if (!this.box) {
            return Promise.reject(new Error('lite-rpc client not started'));
        }

        return this.box.call(iface, method, parameters || []).then(
            (result) => (result === null || result === undefined ? '' : result),
            (error) => {
                throw translateError(error);
            },
        );
    }

    /**
     * Whether the system says this interface runs (the client's live list).
     * @param {string} iface
     * @returns {boolean|undefined} undefined while the list is not known
     */
    running(iface) {
        if (!this.box || !Array.isArray(this.box.interfaces)) {
            return undefined;
        }

        const entry = this.box.interfaces.find((info) => info.name === iface);
        return entry ? entry.running !== false : false;
    }

    /** Closes the stream; nothing is de-registered, because nothing was registered. */
    close() {
        this.closed = true;
        this.ready = false;
        if (this.box) {
            this.box.close();
            this.box = null;
        }
    }
}

module.exports = {
    LiteConnection,
    LITE_INTERFACES,
    ADDON_TOKEN_FILE,
    CALLBACK_METHODS,
    readAddonToken,
    translateError,
    isFault,
    load,
};
