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
 * @returns {{OccuLite: Function, callbackEvents: Function, nodeTransport: Function, pair: Function, probe: Function}}
 */
function load() {
    if (!modules) {
        try {
            const {OccuLite} = require('occulite-client');
            const {callbackEvents} = require('occulite-client/callbacks');
            const {nodeTransport, pair, probe} = require('occulite-client/node');
            modules = {OccuLite, callbackEvents, nodeTransport, pair, probe};
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
    return kindOf(error) === 'rpc-fault' && error.faultCode !== undefined;
}

/**
 * The client's error kind: occulite-client's OccuLiteError carries it as `code` (rpc-fault,
 * forbidden, timeout ...); `kind` is ours, on an error translated before. A Node system error's
 * `code` (ECONNREFUSED ...) is not a kind.
 * @param {*} error
 * @returns {string|undefined}
 */
function kindOf(error) {
    if (!error) {
        return undefined;
    }

    if (error.kind) {
        return error.kind;
    }

    return error.name === 'OccuLiteError' && typeof error.code === 'string' ? error.code : undefined;
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

    const kind = kindOf(error);
    if (kind === 'forbidden') {
        const refused = new Error(
            'the openccu-lite token may not call this method' + (error.scope ? ' (needs ' + error.scope + ')' : ''),
        );
        refused.kind = 'forbidden';
        refused.scope = error.scope;
        return refused;
    }

    if (kind) {
        const translated = new Error(error.message || kind);
        translated.kind = kind;
        return translated;
    }

    return error instanceof Error ? error : new Error(String(error));
}

/**
 * B-41: cast.js marks a FLOAT as homematic-xmlrpc's `{explicitDouble: n}` (the XML-RPC client's
 * `<double>`). lite-rpc's JSON path does not know that marker and would hand the process a struct
 * where a double belongs - hs485d and hmipserver refuse it. Its own marker is `{double: n}`
 * (capability `json_double`); a system without it gets the plain number. Walks the whole
 * parameter list: the top level, structs and paramsets, a multicall's calls.
 * @param {*} value
 * @param {boolean} jsonDouble whether the system announces `json_double`
 * @returns {*} the value for lite-rpc
 */
function liteValue(value, jsonDouble) {
    if (Array.isArray(value)) {
        return value.map((item) => liteValue(item, jsonDouble));
    }

    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === 'explicitDouble') {
            const number = Number(value.explicitDouble);
            return jsonDouble ? {double: number} : number;
        }

        const out = {};
        keys.forEach((key) => {
            out[key] = liteValue(value[key], jsonDouble);
        });
        return out;
    }

    return value;
}

/**
 * The certificate trust for occulite-client's transport: the fingerprint pinned at pairing, else
 * any certificate where the node says so, else Node's own store.
 * @param {{fingerprint256?: string, insecure?: boolean}} options
 * @returns {object}
 */
function trustOf({fingerprint256, insecure}) {
    if (fingerprint256) {
        return {fingerprint256};
    }

    return insecure ? {insecure: true} : {};
}

class LiteConnection {
    /**
     * @param {object} options
     * @param {string} options.url the system, scheme and authority
     * @param {string} options.token the credential
     * @param {boolean} [options.insecure] accept any certificate
     * @param {string} [options.fingerprint256] accept exactly this certificate (pinned at pairing; wins over insecure)
     * @param {string[]} options.interfaces the interfaces to follow (the enabled ones lite-rpc carries)
     * @param {function(string): string} options.initId the init id the connection's callback table expects per interface
     * @param {function(string, *, Array, Function)} options.onCallback (method, err, params, answer): a callback server's call
     * @param {function(string, string)} options.onInterface (iface, state): up | down | restarted | added | removed
     * @param {function(string)} options.onStatus the client's state: connecting | ready | degraded | offline | closed
     * @param {function(Map)} [options.onValues] box.values once ready (the state store's picture)
     * @param {object} options.logger {debug, info, warn, error}
     * @param {number} [options.timeout] per request, ms
     * @param {Function} [options.createClient] for tests, in place of new OccuLite()
     * @param {boolean} [options.meta] the client keeps the live copy of the names too (one client for both)
     * @param {function(object)} [options.onBox] every client this connection opens, before it connects
     * @param {number} [options.retryMin] the first wait before a failed connect is tried again, ms
     * @param {number} [options.retryMax] the longest wait, ms
     */
    constructor(options) {
        this.options = options;
        this.interfaces = [...options.interfaces];
        this.logger = options.logger;
        this.box = null;
        this.server = null;
        this.closed = false;
        this.ready = false;
        this.retryTimeout = null;
        this.retryMin = options.retryMin === undefined ? 5000 : options.retryMin;
        this.retryMax = options.retryMax === undefined ? 60000 : options.retryMax;
    }

    /**
     * @param {string} iface
     * @returns {boolean} whether this interface goes through lite-rpc
     */
    has(iface) {
        return this.interfaces.includes(iface);
    }

    /**
     * Opens the client. Resolves once the first picture is loaded. occulite-client (0.4) does not
     * try a failed connect again (its streams only reconnect once connected), so a system that
     * did not answer (unreachable, timeout, still starting) gets a new client after a wait,
     * growing to a minute; a refused credential, or a system that is not openccu-lite, rejects.
     * @returns {Promise<void>}
     */
    start() {
        return new Promise((resolve, reject) => {
            let attempt = 0;
            const connect = () => {
                this.retryTimeout = null;
                this.open().then(resolve, (error) => {
                    if (this.closed) {
                        reject(error);
                        return;
                    }

                    const kind = kindOf(error);
                    if (kind === 'unauthenticated' || kind === 'forbidden' || kind === 'unsupported') {
                        reject(error);
                        return;
                    }

                    const delay = Math.min(this.retryMin * 2 ** attempt, this.retryMax);
                    attempt += 1;
                    this.logger[attempt === 1 ? 'warn' : 'debug'](
                        'lite-rpc: ' + (error.message || error) + ' - connecting again in ' + delay / 1000 + ' s',
                    );
                    this.retryTimeout = setTimeout(connect, delay);
                });
            };

            connect();
        });
    }

    /**
     * One client: the stream's events into the callback table, the first picture.
     * @returns {Promise<void>}
     */
    open() {
        if (this.box) {
            this.box.close();
        }

        const {OccuLite, callbackEvents, nodeTransport} = load();
        const debug = (message) => this.logger.debug('occulite-client: ' + message);
        const clientOptions = {
            url: this.options.url,
            auth: {token: this.options.token},
            transport: nodeTransport(trustOf(this.options)),
            interfaces: this.interfaces,
            values: true,
            meta: Boolean(this.options.meta),
            devices: true,
            timeout: this.options.timeout || 30000,
            log: {debug, info: debug, warn: debug, error: debug},
        };
        const box = this.options.createClient ? this.options.createClient(clientOptions) : new OccuLite(clientOptions);
        this.box = box;
        if (this.options.onBox) {
            this.options.onBox(box);
        }

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

        const jsonDouble = Boolean(this.box.capabilities && this.box.capabilities.json_double);
        return this.box.call(iface, method, liteValue(parameters || [], jsonDouble)).then(
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
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
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
    liteValue,
    trustOf,
    translateError,
    isFault,
    load,
};
