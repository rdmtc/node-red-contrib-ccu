/**
 * openccu-lite metadata provider (roadmap B-17).
 *
 * openccu-lite is a Homematic CCU firmware without ReGaHSS: nothing listens on
 * 8181/8183, there is no HM-Script interpreter and there are no ReGa ids. What
 * it has instead is occulited's metadata API - a small JSON store of names and
 * enums served under `/api/meta/v1/` - plus a Server-Sent-Events change stream.
 *
 * This module is the counterpart of the `getRega*()` methods in
 * ccu-connection.js: it fills the very same maps (`channelNames`,
 * `channelRooms`, `channelFunctions`) and the same `rooms` / `functions` name
 * arrays, so nothing downstream (message.js, channelfilter.js, the editor
 * endpoints) can tell the two apart. Everything ReGa-only - system variables,
 * programs, `exec()` - has no replacement and stays empty.
 *
 * The snapshot and the change stream are occulite-client's live copy
 * (`box.meta`), shared with the lite-rpc client where the connection has one
 * (MetaProvider). The detection - one unauthenticated GET of the version
 * answer, telling "not openccu-lite" from "not now" (a 502 while the system
 * starts) - stays on node:http / node:https here, with the connection's TLS
 * choice and the certificate pinned at pairing.
 *
 * @see https://github.com/hobbyquaker/openccu-lite `docs/meta-api.md`
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

const API_PATH = '/api/meta/v1';

/** Where occulited keeps the box's own read-only token (role `user`). */
const LOCAL_TOKEN_FILE = '/usr/local/etc/occulite/local-token';

const NOOP = () => {};
const SILENT = {trace: NOOP, debug: NOOP, info: NOOP, warn: NOOP, error: NOOP};

/**
 * `<interface>.<address>` -> `<address>`. node-red-contrib-ccu keys everything
 * by the bare address, interface names never contain a dot.
 * @param {string} ref
 * @returns {string}
 */
function refToAddress(ref) {
    const index = ref.indexOf('.');
    return index === -1 ? ref : ref.slice(index + 1);
}

/**
 * `<interface>.<address>` -> `<interface>`.
 * @param {string} ref
 * @returns {string}
 */
function refToIface(ref) {
    const index = ref.indexOf('.');
    return index === -1 ? '' : ref.slice(0, index);
}

/**
 * Flatten an enum tree into a path -> {name, depth, order} map.
 * `room/eg/wohnzimmer` and `room/eg` both end up in it, which is what makes a
 * channel in a leaf room a member of its parent room as well.
 * @param {string} enumId
 * @param {Array} tree
 * @returns {Map<string, {name: string, depth: number, order: number}>}
 */
function flattenEnum(enumId, tree) {
    const map = new Map();
    let order = 0;
    const walk = (nodes, prefix, depth) => {
        if (!Array.isArray(nodes)) {
            return;
        }

        for (const node of nodes) {
            if (!node || typeof node.id !== 'string') {
                continue;
            }

            const path = prefix + '/' + node.id;
            map.set(path, {name: typeof node.name === 'string' && node.name ? node.name : node.id, depth, order});
            order += 1;
            walk(node.children, path, depth + 1);
        }
    };

    walk(tree, enumId, 1);
    return map;
}

/**
 * The names of the nodes an object belongs to, most specific first, ancestors
 * included, duplicates by name removed.
 * @param {Map} flat
 * @param {Array<string>} paths
 * @param {string} enumId
 * @returns {Array<string>}
 */
function memberNames(flat, paths, enumId) {
    const found = new Map();
    for (const path of paths) {
        if (typeof path !== 'string' || !path.startsWith(enumId + '/')) {
            continue;
        }

        let current = path;
        while (current.includes('/')) {
            const node = flat.get(current);
            if (node && !found.has(current)) {
                found.set(current, node);
            }

            current = current.slice(0, current.lastIndexOf('/'));
        }
    }

    const sorted = [...found.values()].sort((a, b) => b.depth - a.depth || a.order - b.order);
    const names = [];
    for (const node of sorted) {
        if (!names.includes(node.name)) {
            names.push(node.name);
        }
    }

    return names;
}

/**
 * Derive everything ccu-connection.js needs from a metadata document (the body
 * of `GET /api/meta/v1/snapshot`, which is also the file format on the box).
 * Pure - this is what the fixture corpus is run against.
 * @param {object} document
 * @returns {{channelNames: object, channelRooms: object, channelFunctions: object, rooms: Array, functions: Array, ifaces: object}}
 */
function buildNames(document) {
    const result = {
        channelNames: {},
        channelRooms: {},
        channelFunctions: {},
        rooms: [],
        functions: [],
        ifaces: {},
    };

    if (!document || typeof document !== 'object') {
        return result;
    }

    const enums = document.enums && typeof document.enums === 'object' ? document.enums : {};
    const flatRooms = flattenEnum('room', enums.room && enums.room.tree);
    const flatFunctions = flattenEnum('function', enums.function && enums.function.tree);

    const listNames = (flat) => {
        const names = [];
        for (const node of [...flat.values()].sort((a, b) => a.order - b.order)) {
            if (!names.includes(node.name)) {
                names.push(node.name);
            }
        }

        return names;
    };

    result.rooms = listNames(flatRooms);
    result.functions = listNames(flatFunctions);

    const objects = document.objects && typeof document.objects === 'object' ? document.objects : {};
    for (const ref of Object.keys(objects)) {
        const object = objects[ref];
        if (!object || typeof object !== 'object') {
            continue;
        }

        const address = refToAddress(ref);
        const iface = refToIface(ref);
        if (iface) {
            result.ifaces[address] = iface;
        }

        if (typeof object.name === 'string' && object.name) {
            result.channelNames[address] = object.name;
        }

        const paths = Array.isArray(object.enums) ? object.enums : [];
        const rooms = memberNames(flatRooms, paths, 'room');
        if (rooms.length > 0) {
            result.channelRooms[address] = rooms;
        }

        const functions = memberNames(flatFunctions, paths, 'function');
        if (functions.length > 0) {
            result.channelFunctions[address] = functions;
        }
    }

    return result;
}

/**
 * Read the box's local token. Present only when Node-RED runs on an
 * openccu-lite box (RedMatic); off the box the user configures a token.
 * @param {string} [file]
 * @returns {string} the token, or '' when there is none
 */
function readLocalToken(file = LOCAL_TOKEN_FILE) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const [first] = content.split('\n');
        return first.trim();
    } catch {
        return '';
    }
}

/** a fingerprint as its bare lower-case hex, for comparing */
const bareFingerprint = (fingerprint) => String(fingerprint).replace(/:/g, '').toLowerCase();

/**
 * A TLS connection that accepts exactly the certificate pinned at pairing (the system's own,
 * usually self-signed): the socket goes to the request only after the handshake and the check, so
 * nothing - the token least of all - is written to another server.
 * @param {string} host
 * @param {number} port
 * @param {string} fingerprint256 colon-separated SHA-256, as pairing returns it
 * @param {number} [timeout] for the connection and the handshake, ms (0: none)
 * @returns {function(object, Function): undefined} for the request's createConnection
 */
function pinnedConnection(host, port, fingerprint256, timeout) {
    const pin = bareFingerprint(fingerprint256);
    const name = String(host).replace(/^\[|\]$/g, '');
    return (_options, oncreate) => {
        const socket = tls.connect({
            host: name,
            port,
            servername: net.isIP(name) ? undefined : name,
            rejectUnauthorized: false,
        });
        if (timeout > 0) {
            // the request's own timeout starts only once it has the socket, after the handshake
            socket.setTimeout(timeout, () => socket.destroy(new Error('timeout')));
        }

        socket.once('secureConnect', () => {
            socket.setTimeout(0);
            const seen = socket.getPeerCertificate().fingerprint256;
            if (bareFingerprint(seen) !== pin) {
                socket.destroy();
                oncreate(new Error('the system presents another certificate than the one pinned at pairing'));
                return;
            }

            oncreate(null, socket);
        });
        socket.once('error', (error) => oncreate(error));
        return undefined;
    };
}

/**
 * One GET against the metadata API without a credential (the version answer of the detection).
 * @param {object} options host, port, tls, insecure, fingerprint256, path, timeout
 * @returns {Promise<{status: number, headers: object, res: object}>}
 */
function request(options) {
    const {host, port, tls: useTls, insecure, fingerprint256, path, timeout = 10000} = options;
    return new Promise((resolve, reject) => {
        const lib = useTls ? https : http;
        const requestOptions = {
            host,
            port,
            path,
            method: 'GET',
            headers: {accept: 'application/json', 'user-agent': 'node-red-contrib-ccu'},
            ...(useTls ? {rejectUnauthorized: !insecure} : {}),
        };
        if (useTls && fingerprint256) {
            requestOptions.createConnection = pinnedConnection(host, port, fingerprint256, timeout);
        }

        if (timeout > 0) {
            // as an option, not request.setTimeout(): only this form arms the
            // timer before the socket is connected, so an unreachable box does
            // not hang for the OS' connect timeout
            requestOptions.timeout = timeout;
        }

        const request_ = lib.request(requestOptions, (res) => {
            resolve({status: res.statusCode, headers: res.headers, res});
        });

        request_.on('timeout', () => {
            request_.destroy(new Error('timeout'));
        });
        request_.on('error', reject);
        request_.end();
    });
}

/**
 * Read a response body to a string (bounded - the snapshot of a big
 * installation is a few hundred kB).
 * @param {object} res
 * @returns {Promise<string>}
 */
function readBody(res) {
    return new Promise((resolve, reject) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            body += chunk;
        });
        res.on('end', () => resolve(body));
        res.on('error', reject);
    });
}

/** lighttpd answers these while the api behind it is not up yet - the box is starting, nothing is decided */
const INCONCLUSIVE_STATUS = new Set([502, 503, 504]);

/**
 * Feature detection with its outcome: `GET /api/meta/v1/version` answers on
 * openccu-lite and needs no credential; a CCU / RaspberryMatic / OpenCCU
 * answers 404 or HTML - that is a conclusive "no". A timeout, a refused
 * connection or a 502/503/504 decides nothing (B-28: a busy or still starting
 * box), so the caller can ask again instead of settling for the ReGa.
 * Never rejects.
 * @param {object} options host, port, tls, insecure, timeout, logger
 * @returns {Promise<{info: object|null, inconclusive: boolean, reason?: string}>}
 */
async function detectOutcome(options) {
    const {logger = SILENT} = options;
    let status;
    let body;
    try {
        const answer = await request({
            ...options,
            path: API_PATH + '/version',
            timeout: options.timeout || 5000,
        });
        status = answer.status;
        body = await readBody(answer.res);
    } catch (error) {
        logger.debug('meta api detection: ' + error.message);
        return {info: null, inconclusive: true, reason: error.message};
    }

    if (status !== 200) {
        logger.debug('meta api detection: status ' + status);
        return {info: null, inconclusive: INCONCLUSIVE_STATUS.has(status), reason: 'status ' + status};
    }

    let info = null;
    try {
        info = JSON.parse(body);
    } catch {
        info = null;
    }

    if (!info || info.api !== 'meta' || typeof info.version !== 'number') {
        return {info: null, inconclusive: false, reason: 'not the metadata api'};
    }

    return {info, inconclusive: false};
}

/**
 * Feature detection: the version document of an openccu-lite, or null for
 * anything else (a CCU, an unreachable box). See detectOutcome() for the
 * difference between "no" and "not now".
 * @param {object} options host, port, tls, insecure, timeout, logger
 * @returns {Promise<object|null>} the version document, or null
 */
async function detect(options) {
    return (await detectOutcome(options)).info;
}

/** an occulite-client error that a new attempt with the same credential does not fix */
const REFUSED = new Set(['unauthenticated', 'forbidden']);

/** the metadata change stream's path */
const META_STREAM = /\/api\/meta\/v1\/events\/sse(\?|$)/;

/**
 * The transport of a names client of its own:
 * - the auth state it reads says no rpc scope, so occulite-client runs it names-only - the
 *   snapshot and the change stream, no lite-rpc stream of its own (the system allows a token
 *   three streams);
 * - the metadata change stream is watched: occulite-client (0.4) keeps a names-only client's state
 *   `ready` while that stream is down, so `onStream(open, status)` says when it opens and ends.
 * @param {object} transport occulite-client's Transport
 * @param {function(boolean, number=)} onStream
 * @returns {object}
 */
function namesTransport(transport, onStream) {
    return {
        request: (method, url, headers, body, signal) =>
            transport.request(method, url, headers, body, signal).then((response) => {
                if (response.status !== 200 || !/\/api\/auth\/v1\/state(\?|$)/.test(String(url))) {
                    return response;
                }

                let parsed;
                try {
                    parsed = JSON.parse(response.body);
                } catch {
                    return response;
                }

                const scopes = Array.isArray(parsed && parsed.scopes) ? parsed.scopes : [];
                const names = scopes.filter((scope) => scope !== '*' && !String(scope).startsWith('rpc:'));
                return {...response, body: JSON.stringify({...parsed, scopes: names})};
            }),
        stream: (url, headers, signal) => {
            const opening = transport.stream(url, headers, signal);
            if (!META_STREAM.test(String(url))) {
                return opening;
            }

            return opening.then(
                (answer) => {
                    if (answer.status !== 200) {
                        onStream(false, answer.status);
                        return answer;
                    }

                    onStream(true);
                    const {chunks} = answer;
                    return {
                        ...answer,
                        chunks: (async function* () {
                            try {
                                yield* chunks;
                            } finally {
                                onStream(false);
                            }
                        })(),
                    };
                },
                (error) => {
                    onStream(false);
                    throw error;
                },
            );
        },
    };
}

/**
 * The system's names, rooms and functions from occulite-client's live copy (`box.meta`): the
 * snapshot at connect, the change stream after it, a re-read where an event cannot be applied in
 * place. The copy is either the one of the connection's lite-rpc client (one client for names and
 * interfaces, `shared`: attach() hands it over) or one of its own, names-only, for a connection
 * whose credential reads names only (the system's local token, a token without rpc scopes) or
 * that reaches the interfaces another way.
 *
 * The surface is what ccu-connection.js needs: start(), stop(), onNames with the ReGa shape
 * (buildNames, the conformance corpus' function), onStatus, and onGone when the system stops
 * answering as openccu-lite - the version probe while the copy is not connected, as at startup.
 */
class MetaProvider {
    /**
     * @param {object} options
     * @param {string} options.host
     * @param {number} [options.port]
     * @param {boolean} [options.tls]
     * @param {boolean} [options.insecure]
     * @param {string} [options.fingerprint256] the certificate pinned at pairing
     * @param {string} [options.token] the credential of a client of its own
     * @param {boolean} [options.shared] the names come from the lite-rpc client's copy (attach())
     * @param {number} [options.attachTimeout] how long a shared provider waits for attach() before it opens a client of its own
     * @param {object} [options.logger]
     * @param {function(object)} [options.onNames]
     * @param {function(boolean)} [options.onStatus]
     * @param {Function} [options.onGone]
     * @param {Function} [options.createClient] for tests, in place of new OccuLite()
     */
    constructor(options = {}) {
        this.host = options.host;
        this.port = options.port || (options.tls ? 443 : 80);
        this.tls = Boolean(options.tls);
        this.insecure = Boolean(options.insecure);
        this.fingerprint256 = options.fingerprint256 || '';
        this.token = options.token || '';
        this.shared = Boolean(options.shared);
        this.logger = options.logger || SILENT;
        this.onNames = options.onNames || NOOP;
        this.onStatus = options.onStatus || NOOP;
        // called when the box stopped answering the version probe altogether -
        // it is not an openccu-lite any more (restored backup, firmware swap)
        this.onGone = options.onGone || NOOP;
        this.goneAfter = options.goneAfter === undefined ? 3 : options.goneAfter;
        this.requestTimeout = options.requestTimeout || 10000;
        this.retryMin = options.retryMin === undefined ? 5000 : options.retryMin;
        this.retryMax = options.retryMax === undefined ? 60000 : options.retryMax;
        this.emitDelay = options.emitDelay === undefined ? 100 : options.emitDelay;
        this.attachTimeout = options.attachTimeout === undefined ? 15000 : options.attachTimeout;
        this.createClient = options.createClient;

        this.box = null;
        this.owned = false;
        this.stopped = true;
        this.connected = false;
        this.connectFailed = false;
        this.streamRefused = false;
        this.refusedLogged = false;
        this.missedProbes = 0;
        this.probeRetry = 0;
        this.probeTimeout = null;
        this.emitTimeout = null;
        this.attachTimer = null;
        this.unsubscribe = [];
    }

    /** @returns {number} the revision of the copy */
    get revision() {
        return this.box ? this.box.meta.revision : 0;
    }

    /** @returns {string} the system's URL */
    get url() {
        const host =
            String(this.host).includes(':') && !String(this.host).startsWith('[') ? '[' + this.host + ']' : this.host;
        return (this.tls ? 'https' : 'http') + '://' + host + ':' + this.port;
    }

    /**
     * A client of its own now; a shared provider waits for attach() (and opens its own when the
     * lite-rpc client does not come).
     */
    start() {
        this.stopped = false;
        if (!this.shared) {
            this._own();
            return;
        }

        this.attachTimer = setTimeout(() => {
            this.attachTimer = null;
            if (!this.box && !this.stopped) {
                this.logger.debug('meta api: no lite-rpc client to share - a names client of its own');
                this.shared = false;
                this._own();
            }
        }, this.attachTimeout);
    }

    /**
     * The lite-rpc client whose copy the names come from (again, after it was replaced).
     * @param {object} box occulite-client's OccuLite
     */
    attach(box) {
        if (this.stopped) {
            return;
        }

        clearTimeout(this.attachTimer);
        this.attachTimer = null;
        this._follow(box, false);
    }

    /** Stops following; a client of its own is closed, a shared one is the lite-rpc connection's. */
    stop() {
        this.stopped = true;
        clearTimeout(this.attachTimer);
        clearTimeout(this.probeTimeout);
        clearTimeout(this.emitTimeout);
        this.attachTimer = null;
        this.probeTimeout = null;
        this.emitTimeout = null;
        this._release();
        this._setConnected(false);
    }

    /** A names-only client of its own. */
    _own() {
        const {OccuLite, nodeTransport} = require('./lite.js').load();
        const debug = (message) => this.logger.debug('occulite-client (names): ' + message);
        let box = null;
        // the change stream's state is the copy's (see namesTransport)
        const onStream = (open, status) => {
            if (this.box !== box || this.stopped) {
                return;
            }

            this.streamRefused = !open && [401, 403, 404].includes(status);
            this._status(open ? 'ready' : 'offline');
        };

        const clientOptions = {
            url: this.url,
            ...(this.token ? {auth: {token: this.token}} : {}),
            transport: namesTransport(nodeTransport(require('./lite.js').trustOf(this)), onStream),
            values: false,
            devices: false,
            meta: true,
            timeout: this.requestTimeout,
            log: {debug, info: debug, warn: debug, error: debug},
        };
        box = this.createClient ? this.createClient(clientOptions) : new OccuLite(clientOptions);
        this._follow(box, true);
    }

    /**
     * Follows a client's copy: its state, its change events, its first picture.
     * @param {object} box
     * @param {boolean} owned
     */
    _follow(box, owned) {
        this._release();
        this.box = box;
        this.owned = owned;
        this.connectFailed = false;
        this.streamRefused = false;
        this.unsubscribe = [
            box.on('status', (event) => {
                // a client of its own: the change stream says it (namesTransport); a shared one: its state
                if (this.box === box && !this.stopped && !owned) {
                    this._status(event.state);
                }
            }),
            // the copy is in step again: after a change applied in place, or once the snapshot read
            // again for a change it cannot apply in place is in
            box.on('metaSettled', () => {
                if (this.box === box && !this.stopped) {
                    this._scheduleEmit();
                }
            }),
        ];
        box.ready().then(
            () => {
                if (this.box !== box || this.stopped) {
                    return;
                }

                this.refusedLogged = false;
                if (!owned) {
                    this._status('ready');
                }

                this._emit();
            },
            (error) => {
                if (this.box !== box || this.stopped) {
                    return;
                }

                this.connectFailed = true;
                const {code} = error;
                if (REFUSED.has(code)) {
                    if (!this.refusedLogged) {
                        this.refusedLogged = true;
                        this.logger.error(
                            'openccu-lite metadata api rejected the credential (' +
                                code +
                                '). Running without names - pair the connection node with the system, or enter a token made on the system.',
                        );
                    }
                } else {
                    this.logger.warn('meta api: ' + error.message);
                }

                this._status('offline');
            },
        );
    }

    /** Lets go of the current client. */
    _release() {
        this.unsubscribe.forEach((off) => typeof off === 'function' && off());
        this.unsubscribe = [];
        if (this.box && this.owned) {
            this.box.close();
        }

        this.box = null;
        this.owned = false;
    }

    /**
     * The client's state: connected when ready; otherwise the version probe runs.
     * @param {string} state
     */
    _status(state) {
        if (state === 'ready') {
            this.missedProbes = 0;
            this.probeRetry = 0;
            clearTimeout(this.probeTimeout);
            this.probeTimeout = null;
            this._setConnected(true);
            return;
        }

        this._setConnected(false);
        if (state !== 'closed') {
            this._probeLater();
        }
    }

    /**
     * @param {boolean} connected
     */
    _setConnected(connected) {
        if (this.connected !== connected) {
            this.connected = connected;
            this.onStatus(connected);
        }
    }

    /** The next version probe, with a bounded exponential backoff. */
    _probeLater() {
        if (this.stopped || this.probeTimeout) {
            return;
        }

        const delay = Math.min(this.retryMin * 2 ** this.probeRetry, this.retryMax);
        this.probeRetry += 1;
        this.probeTimeout = setTimeout(() => {
            this.probeTimeout = null;
            this._probe();
        }, delay);
    }

    /**
     * The version probe while the copy is not connected: needs no credential, and it is how a box
     * that is no longer an openccu-lite is noticed without a Node-RED restart. A client of its own
     * whose first connect failed is opened again once the system answers.
     * @returns {Promise<void>}
     */
    async _probe() {
        const info = await detect({
            host: this.host,
            port: this.port,
            tls: this.tls,
            insecure: this.insecure,
            fingerprint256: this.fingerprint256,
            logger: this.logger,
        });
        if (this.stopped || this.connected) {
            return;
        }

        if (!info) {
            this.missedProbes += 1;
            if (this.missedProbes >= this.goneAfter) {
                this.logger.warn(
                    'the box stopped answering the openccu-lite metadata api (' +
                        this.missedProbes +
                        ' probes) - falling back to detection from scratch',
                );
                this.stop();
                this.onGone();
                return;
            }
        } else {
            this.missedProbes = 0;
            if (this.owned && (this.connectFailed || this.streamRefused)) {
                this.logger.debug('meta api: the system answers - connecting the names client again');
                this._own();
            }
        }

        this._probeLater();
    }

    /** Coalesce a burst of events into one update. */
    _scheduleEmit() {
        if (this.emitTimeout) {
            return;
        }

        this.emitTimeout = setTimeout(() => {
            this.emitTimeout = null;
            if (!this.stopped) {
                this._emit();
            }
        }, this.emitDelay);
    }

    /** Derive the maps from the copy and hand them to the connection node. */
    _emit() {
        const names = buildNames(this.box.meta.doc);
        names.revision = this.box.meta.revision;
        this.onNames(names);
    }
}

module.exports = {
    API_PATH,
    LOCAL_TOKEN_FILE,
    MetaProvider,
    namesTransport,
    buildNames,
    detect,
    detectOutcome,
    flattenEnum,
    memberNames,
    pinnedConnection,
    readLocalToken,
    refToAddress,
    refToIface,
};
