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
 * Deliberately built on node:http / node:https rather than global fetch: the
 * connection node already offers "ignore invalid TLS certificates", which fetch
 * cannot express per request without pulling in undici, and a Node stream is
 * the natural shape for SSE. No new dependency either way.
 *
 * @see https://github.com/hobbyquaker/openccu-lite `docs/meta-api.md`
 */

const fs = require('fs');
const http = require('http');
const https = require('https');

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

/**
 * One HTTP request against the metadata API.
 * @param {object} options
 * @returns {Promise<{status: number, headers: object, res: object, body: Promise<string>}>}
 */
function request(options) {
    const {host, port, tls, insecure, path, token, timeout = 10000, idleTimeout, accept = 'application/json'} = options;
    return new Promise((resolve, reject) => {
        const headers = {accept, 'user-agent': 'node-red-contrib-ccu'};
        if (token) {
            headers.authorization = 'Bearer ' + token;
        }

        const lib = tls ? https : http;
        const requestOptions = {
            host,
            port,
            path,
            method: 'GET',
            headers,
            ...(tls ? {rejectUnauthorized: !insecure} : {}),
        };
        if (timeout > 0) {
            // as an option, not request.setTimeout(): only this form arms the
            // timer before the socket is connected, so an unreachable box does
            // not hang for the OS' connect timeout
            requestOptions.timeout = timeout;
        }

        const request_ = lib.request(requestOptions, (res) => {
            resolve({status: res.statusCode, headers: res.headers, res, request: request_});
        });

        request_.on('timeout', () => {
            request_.destroy(new Error('timeout'));
        });

        if (idleTimeout !== undefined) {
            // the event stream may legitimately stay silent between heartbeats,
            // so the connect timeout above must not keep applying to it
            request_.on('socket', (socket) => {
                if (socket.connecting) {
                    socket.once('connect', () => socket.setTimeout(idleTimeout));
                } else {
                    socket.setTimeout(idleTimeout);
                }
            });
        }
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

/**
 * Feature detection: `GET /api/meta/v1/version` answers on openccu-lite and
 * needs no credential; a CCU / RaspberryMatic / OpenCCU answers 404 or HTML.
 * Never rejects - a box that is simply unreachable is not openccu-lite either.
 * @param {object} options host, port, tls, insecure, timeout, logger
 * @returns {Promise<object|null>} the version document, or null
 */
async function detect(options) {
    const {logger = SILENT} = options;
    try {
        const {status, res} = await request({
            ...options,
            path: API_PATH + '/version',
            token: undefined,
            timeout: options.timeout || 5000,
        });
        const body = await readBody(res);
        if (status !== 200) {
            logger.debug('meta api detection: status ' + status);
            return null;
        }

        const info = JSON.parse(body);
        if (!info || info.api !== 'meta' || typeof info.version !== 'number') {
            return null;
        }

        return info;
    } catch (error) {
        logger.debug('meta api detection: ' + error.message);
        return null;
    }
}

/**
 * Loads the metadata snapshot and follows the change stream. Public surface
 * mirrors what ccu-connection.js needs: start(), stop() and two callbacks.
 */
class MetaProvider {
    /**
     * @param {object} options
     */
    constructor(options = {}) {
        this.host = options.host;
        this.port = options.port || (options.tls ? 443 : 80);
        this.tls = Boolean(options.tls);
        this.insecure = Boolean(options.insecure);
        this.token = options.token || '';
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
        this.streamTimeout = options.streamTimeout === undefined ? 95000 : options.streamTimeout;

        this.document = null;
        this.revision = 0;
        this.stopped = true;
        this.connected = false;
        this.retry = 0;
        this.unauthorizedLogged = false;
        this.stream = null;
        this.retryTimeout = null;
        this.emitTimeout = null;
        this.cycles = 0;
        this.missedProbes = 0;
    }

    /**
     * Snapshot, then the event stream. Errors are retried, never thrown.
     */
    start() {
        this.stopped = false;
        this.retry = 0;
        this._cycle();
    }

    /**
     * Stops the stream and every pending timer.
     */
    stop() {
        this.stopped = true;
        clearTimeout(this.retryTimeout);
        clearTimeout(this.emitTimeout);
        this.retryTimeout = null;
        this.emitTimeout = null;
        if (this.stream) {
            this.stream.destroy();
            this.stream = null;
        }

        this._setConnected(false);
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

    /**
     * Schedule the next attempt with a bounded exponential backoff.
     */
    _scheduleRetry() {
        if (this.stopped || this.retryTimeout) {
            return;
        }

        const delay = Math.min(this.retryMin * 2 ** this.retry, this.retryMax);
        this.retry += 1;
        this.logger.debug('meta api retry in ' + delay + ' ms');
        this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null;
            this._cycle();
        }, delay);
    }

    /**
     * One full attempt: snapshot, then follow the stream.
     */
    async _cycle() {
        if (this.stopped) {
            return;
        }

        // the version probe again on every reconnect, as at startup: it needs no
        // credential, and it is how a box that is no longer an openccu-lite is
        // noticed without a Node-RED restart
        if (this.cycles > 0) {
            const info = await detect({
                host: this.host,
                port: this.port,
                tls: this.tls,
                insecure: this.insecure,
                logger: this.logger,
            });
            if (info) {
                this.missedProbes = 0;
            } else {
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
            }
        }

        this.cycles += 1;
        const ok = await this._loadSnapshot();
        if (!ok) {
            this._setConnected(false);
            this._scheduleRetry();
            return;
        }

        this.retry = 0;
        this._openStream();
    }

    /**
     * `GET /snapshot`. A 401/403 degrades to "no names": logged once, retried
     * on the next cycle, never fatal.
     * @returns {Promise<boolean>}
     */
    async _loadSnapshot() {
        try {
            const {status, res} = await request({
                host: this.host,
                port: this.port,
                tls: this.tls,
                insecure: this.insecure,
                path: API_PATH + '/snapshot',
                token: this.token,
                timeout: this.requestTimeout,
            });
            const body = await readBody(res);
            if (status === 401 || status === 403) {
                if (!this.unauthorizedLogged) {
                    this.unauthorizedLogged = true;
                    this.logger.error(
                        'openccu-lite metadata api rejected the credential (' +
                            status +
                            '). Running without names - configure a token created on the box (Users page) in the ccu-connection node.',
                    );
                }

                return false;
            }

            if (status !== 200) {
                this.logger.warn('meta api snapshot: status ' + status);
                return false;
            }

            const document = JSON.parse(body);
            this.unauthorizedLogged = false;
            this._applyDocument(document);
            this._setConnected(true);
            return true;
        } catch (error) {
            this.logger.warn('meta api snapshot: ' + error.message);
            return false;
        }
    }

    /**
     * @param {object} document
     */
    _applyDocument(document) {
        this.document = document;
        this.revision = Number(document.revision) || 0;
        this._emit();
    }

    /**
     * Rebuild the derived maps and hand them to the connection node.
     */
    _emit() {
        clearTimeout(this.emitTimeout);
        this.emitTimeout = null;
        const names = buildNames(this.document);
        names.revision = this.revision;
        this.onNames(names);
    }

    /**
     * Coalesce a burst of events into one update.
     */
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

    /**
     * Follow `GET /events/sse?since=<revision>`.
     */
    _openStream() {
        if (this.stopped) {
            return;
        }

        request({
            host: this.host,
            port: this.port,
            tls: this.tls,
            insecure: this.insecure,
            path: API_PATH + '/events/sse?since=' + this.revision,
            token: this.token,
            accept: 'text/event-stream',
            timeout: this.requestTimeout,
            idleTimeout: this.streamTimeout,
        })
            .then(({status, res}) => {
                if (this.stopped) {
                    res.destroy();
                    return;
                }

                if (status !== 200) {
                    res.resume();
                    this.logger.warn('meta api event stream: status ' + status);
                    this._setConnected(false);
                    this._scheduleRetry();
                    return;
                }

                this.logger.debug('openccu-lite metadata event stream open (revision ' + this.revision + ')');
                this.stream = res;

                let buffer = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    buffer += chunk;
                    let index = buffer.indexOf('\n\n');
                    while (index !== -1) {
                        const frame = buffer.slice(0, index);
                        buffer = buffer.slice(index + 2);
                        this._onFrame(frame);
                        index = buffer.indexOf('\n\n');
                    }

                    if (buffer.length > 1_000_000) {
                        buffer = '';
                    }
                });
                const done = () => {
                    if (this.stream === res) {
                        this.stream = null;
                        this._scheduleRetry();
                    }
                };

                res.on('end', done);
                res.on('close', done);
                res.on('error', (error) => {
                    this.logger.debug('meta api event stream: ' + error.message);
                    done();
                });
            })
            .catch((error) => {
                this.logger.warn('meta api event stream: ' + error.message);
                this._setConnected(false);
                this._scheduleRetry();
            });
    }

    /**
     * One SSE frame. Comments (the 30 s heartbeat) carry no data line.
     * @param {string} frame
     */
    _onFrame(frame) {
        const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
        if (!data) {
            return;
        }

        let event;
        try {
            event = JSON.parse(data);
        } catch {
            this.logger.debug('meta api event stream: unparsable frame');
            return;
        }

        this._onEvent(event);
    }

    /**
     * Apply one change event. Object changes are applied in place; anything
     * that can rewrite member paths (enum and node events, an import, a gap in
     * the revisions, an explicit resync) re-reads the snapshot.
     * @param {object} event
     */
    _onEvent(event) {
        if (!event || typeof event !== 'object') {
            return;
        }

        const revision = Number(event.revision) || 0;
        const gap = revision > 0 && this.revision > 0 && revision > this.revision + 1;

        if (event.kind === 'resync' || event.kind === 'import' || gap) {
            this.logger.debug('meta api resnapshot (' + (gap ? 'revision gap' : event.kind) + ')');
            this._loadSnapshot().catch((error) => this.logger.warn('meta api snapshot: ' + error.message));
            return;
        }

        if (revision > this.revision) {
            this.revision = revision;
        }

        if (!this.document) {
            return;
        }

        switch (event.kind) {
            case 'object.updated': {
                if (typeof event.ref === 'string' && event.value) {
                    this.document.objects = this.document.objects || {};
                    this.document.objects[event.ref] = event.value;
                    this._scheduleEmit();
                }

                break;
            }

            case 'object.deleted': {
                if (typeof event.ref === 'string' && this.document.objects) {
                    delete this.document.objects[event.ref];
                    this._scheduleEmit();
                }

                break;
            }

            case 'enum.created':
            case 'enum.updated':
            case 'enum.deleted':
            case 'node.created':
            case 'node.updated':
            case 'node.deleted':
            case 'node.moved': {
                // rooms and functions changed shape - member paths may have been
                // rewritten in the same revision, so take a fresh snapshot
                this._loadSnapshot().catch((error) => this.logger.warn('meta api snapshot: ' + error.message));
                break;
            }

            default:
        }
    }
}

module.exports = {
    API_PATH,
    LOCAL_TOKEN_FILE,
    MetaProvider,
    buildNames,
    detect,
    flattenEnum,
    memberNames,
    readLocalToken,
    refToAddress,
    refToIface,
};
