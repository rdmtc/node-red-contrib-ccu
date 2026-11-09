const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
    MetaProvider,
    buildNames,
    detect,
    detectOutcome,
    flattenEnum,
    memberNames,
    readLocalToken,
    refToAddress,
    refToIface,
} = require('../../nodes/lib/metaprovider.js');

/* The conformance corpus from openccu-lite's fixtures/store - the very
   documents the metadata api serves (B-17). */
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'openccu-lite', name)));

const HOUSE = fixture('valid-house.json');
const EMPTY = fixture('valid-empty.json');
const DEEP = fixture('valid-depth-8.json');

test('refToAddress / refToIface split at the first dot', () => {
    assert.equal(refToAddress('BidCos-RF.JEQ0230153:1'), 'JEQ0230153:1');
    assert.equal(refToIface('BidCos-RF.JEQ0230153:1'), 'BidCos-RF');
    assert.equal(refToAddress('HmIP-RF.0001D3C99C7D4B'), '0001D3C99C7D4B');
    assert.equal(refToIface('CUxD.CUX2801001:1'), 'CUxD');
    // a ref without an interface is left alone rather than mangled
    assert.equal(refToAddress('JEQ0230153:1'), 'JEQ0230153:1');
    assert.equal(refToIface('JEQ0230153:1'), '');
});

test('flattenEnum keeps every level with its depth and tree order', () => {
    const flat = flattenEnum('room', HOUSE.enums.room.tree);
    assert.deepEqual([...flat.keys()], ['room/eg', 'room/eg/wohnzimmer', 'room/eg/kueche', 'room/og', 'room/og/bad']);
    assert.equal(flat.get('room/eg/wohnzimmer').name, 'Wohnzimmer');
    assert.equal(flat.get('room/eg/wohnzimmer').depth, 2);
    assert.equal(flat.get('room/eg').depth, 1);
});

test('memberNames returns the node and its ancestors, most specific first', () => {
    const flat = flattenEnum('room', HOUSE.enums.room.tree);
    assert.deepEqual(memberNames(flat, ['room/eg/wohnzimmer', 'function/licht'], 'room'), [
        'Wohnzimmer',
        'Erdgeschoss',
    ]);
    // an unknown path contributes nothing
    assert.deepEqual(memberNames(flat, ['room/nope/nope'], 'room'), []);
    assert.deepEqual(memberNames(flat, [], 'room'), []);
});

test('buildNames produces the ReGa shape from the house fixture', () => {
    const names = buildNames(HOUSE);

    // names by address, devices and channels alike, no interface prefix
    assert.deepEqual(names.channelNames, {
        JEQ0230153: 'Thermostat Bad',
        'JEQ0230153:1': 'Thermostat Bad:1',
        '000A1B2C3D4E5F:4': 'Deckenlampe',
        '0011223344AABB:1': 'Küchenlicht',
    });

    // rooms and functions stay arrays of names, as ccu.channelRooms always was
    assert.deepEqual(names.channelRooms['JEQ0230153:1'], ['Bad', 'Obergeschoss']);
    assert.deepEqual(names.channelFunctions['JEQ0230153:1'], ['Heizung']);
    assert.deepEqual(names.channelRooms['000A1B2C3D4E5F:4'], ['Wohnzimmer', 'Erdgeschoss']);
    assert.deepEqual(names.channelFunctions['000A1B2C3D4E5F:4'], ['Licht']);
    // a device without enums has no entry at all (like a ReGa channel in no room)
    assert.equal(names.channelRooms.JEQ0230153, undefined);

    // the flat lists the editor's room/function pickers use, in tree order
    assert.deepEqual(names.rooms, ['Erdgeschoss', 'Wohnzimmer', 'Küche', 'Obergeschoss', 'Bad']);
    assert.deepEqual(names.functions, ['Licht', 'Heizung']);

    // the interface a ref belongs to survives for diagnostics
    assert.equal(names.ifaces['JEQ0230153:1'], 'BidCos-RF');
    assert.equal(names.ifaces['000A1B2C3D4E5F:4'], 'HmIP-RF');
});

test('buildNames on an empty store and on garbage', () => {
    const names = buildNames(EMPTY);
    assert.deepEqual(names.channelNames, {});
    assert.deepEqual(names.rooms, []);
    assert.deepEqual(names.functions, []);

    for (const input of [null, undefined, 42, {}, {objects: null, enums: null}]) {
        const result = buildNames(input);
        assert.deepEqual(result.channelNames, {});
        assert.deepEqual(result.rooms, []);
    }
});

test('buildNames walks a tree of the maximum depth', () => {
    const names = buildNames(DEEP);
    assert.deepEqual(names.rooms, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

    const deep = buildNames({
        ...DEEP,
        objects: {'HmIP-RF.ABC:1': {name: 'Tief', enums: ['room/a/b/c/d/e/f/g/h']}},
    });
    assert.deepEqual(deep.channelRooms['ABC:1'], ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']);
});

test('buildNames deduplicates repeated names', () => {
    const names = buildNames({
        format: 1,
        revision: 3,
        objects: {'HmIP-RF.ABC:1': {name: 'Lampe', enums: ['room/eg/bad', 'room/og/bad']}},
        enums: {
            room: {
                name: {en: 'Rooms'},
                tree: [
                    {id: 'eg', name: 'Erdgeschoss', children: [{id: 'bad', name: 'Bad'}]},
                    {id: 'og', name: 'Obergeschoss', children: [{id: 'bad', name: 'Bad'}]},
                ],
            },
        },
    });
    assert.deepEqual(names.rooms, ['Erdgeschoss', 'Bad', 'Obergeschoss']);
    assert.deepEqual(names.channelRooms['ABC:1'], ['Bad', 'Erdgeschoss', 'Obergeschoss']);
});

test('readLocalToken reads the first line, or nothing at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-meta-'));
    const file = path.join(dir, 'local-token');
    fs.writeFileSync(file, 'olt_0123456789abcdef0123456789abcdef\n');
    assert.equal(readLocalToken(file), 'olt_0123456789abcdef0123456789abcdef');
    assert.equal(readLocalToken(path.join(dir, 'nope')), '');
});

/* ---------------------------------------------------------------------------
   A fake /api/meta/v1 server: detection, the 401 path, and one event round trip
   --------------------------------------------------------------------------- */

function fakeBox(options = {}) {
    const state = {
        document: structuredClone(options.document || HOUSE),
        requireToken: options.requireToken !== false,
        token: options.token || 'olt_test',
        snapshots: 0,
        streams: 0,
        gone: false,
        clients: new Set(),
    };

    const server = http.createServer((request_, res) => {
        const [pathname, query] = request_.url.split('?');
        const authorized = !state.requireToken || request_.headers.authorization === 'Bearer ' + state.token;

        if (state.gone) {
            // the box is not an openccu-lite any more (restored backup, firmware swap)
            res.writeHead(404, {'content-type': 'text/html'}).end('<html>404</html>');
            return;
        }

        if (pathname === '/api/meta/v1/version') {
            // no authentication, by design - this is the feature detection
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(
                JSON.stringify({
                    api: 'meta',
                    version: 1,
                    format: 1,
                    revision: state.document.revision,
                    implementation: 'fake occulited',
                }),
            );
            return;
        }

        if (!authorized) {
            res.writeHead(401, {'content-type': 'application/json'});
            res.end(JSON.stringify({error: 'unauthenticated', message: 'no'}));
            return;
        }

        if (pathname === '/api/meta/v1/snapshot') {
            state.snapshots += 1;
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(state.document));
            return;
        }

        if (pathname === '/api/meta/v1/events/sse') {
            state.streams += 1;
            state.lastSince = query;
            request_.on('close', () => state.clients.delete(res));
            // occulited (Go) does not flush the SSE response header until it has
            // something to write, so a client sees nothing until the first event
            // or heartbeat - sseHeaderDelay reproduces that
            setTimeout(() => {
                if (request_.destroyed) {
                    return;
                }

                res.writeHead(200, {'content-type': 'text/event-stream'});
                res.write(': hello\n\n');
                state.clients.add(res);
            }, options.sseHeaderDelay || 0);
            return;
        }

        res.writeHead(404).end('not found');
    });

    state.send = (event) => {
        for (const client of state.clients) {
            client.write('data: ' + JSON.stringify(event) + '\n\n');
        }
    };

    state.close = () =>
        new Promise((resolve) => {
            for (const client of state.clients) {
                client.end();
            }

            server.close(resolve);
        });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            state.port = server.address().port;
            state.server = server;
            resolve(state);
        });
    });
}

const waitFor = async (predicate, timeout = 3000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        if (predicate()) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error('timeout waiting for condition');
};

test('detect() recognises openccu-lite and nothing else', async (t) => {
    const box = await fakeBox();
    t.after(() => box.close());

    const info = await detect({host: '127.0.0.1', port: box.port});
    assert.equal(info.api, 'meta');
    assert.equal(info.version, 1);
    assert.equal(info.implementation, 'fake occulited');

    // a CCU: html on / and 404 on the api path
    const ccu = http.createServer((request_, res) => {
        res.writeHead(404, {'content-type': 'text/html'}).end('<html>404</html>');
    });
    await new Promise((resolve) => ccu.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => ccu.close(resolve)));
    assert.equal(await detect({host: '127.0.0.1', port: ccu.address().port}), null);

    // something that answers 200 but is not the metadata api
    const other = http.createServer((request_, res) => {
        res.writeHead(200, {'content-type': 'application/json'}).end('{"api":"something-else"}');
    });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => other.close(resolve)));
    assert.equal(await detect({host: '127.0.0.1', port: other.address().port}), null);

    // nothing listening at all
    assert.equal(await detect({host: '127.0.0.1', port: 1, timeout: 1000}), null);
});

test('detectOutcome() tells "no" from "not now" (B-28)', async (t) => {
    const box = await fakeBox();
    t.after(() => box.close());
    const yes = await detectOutcome({host: '127.0.0.1', port: box.port});
    assert.equal(yes.info.api, 'meta');
    assert.equal(yes.inconclusive, false);

    // a CCU's 404 is a conclusive no
    const ccu = http.createServer((request_, res) => {
        res.writeHead(404, {'content-type': 'text/html'}).end('<html>404</html>');
    });
    await new Promise((resolve) => ccu.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => ccu.close(resolve)));
    const no = await detectOutcome({host: '127.0.0.1', port: ccu.address().port});
    assert.deepEqual(no, {info: null, inconclusive: false, reason: 'status 404'});

    // a 200 that is not the api, or not even json: conclusive as well
    const other = http.createServer((request_, res) => {
        res.writeHead(200, {'content-type': 'text/html'}).end('<html>hello</html>');
    });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => other.close(resolve)));
    assert.deepEqual(await detectOutcome({host: '127.0.0.1', port: other.address().port}), {
        info: null,
        inconclusive: false,
        reason: 'not the metadata api',
    });

    // the web server is up, the api behind it is not (lighttpd while occulited starts)
    const gateway = http.createServer((request_, res) => {
        res.writeHead(503, {'content-type': 'text/html'}).end('<html>503</html>');
    });
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => gateway.close(resolve)));
    assert.deepEqual(await detectOutcome({host: '127.0.0.1', port: gateway.address().port}), {
        info: null,
        inconclusive: true,
        reason: 'status 503',
    });

    // a box that does not answer in time: inconclusive
    const busy = http.createServer(() => {});
    await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => busy.closeAllConnections() || busy.close(resolve)));
    const slow = await detectOutcome({host: '127.0.0.1', port: busy.address().port, timeout: 200});
    assert.equal(slow.info, null);
    assert.equal(slow.inconclusive, true);
    assert.equal(slow.reason, 'timeout');

    // nothing listening: inconclusive too (the web server of either kind is not up yet)
    const refused = await detectOutcome({host: '127.0.0.1', port: 1, timeout: 1000});
    assert.equal(refused.info, null);
    assert.equal(refused.inconclusive, true);
    // this WSL machine's mirrored networking lets a connect to a closed port hang instead of refusing it
    assert.match(refused.reason, /ECONNREFUSED|timeout/);

    // detect() keeps its old answer
    assert.equal(await detect({host: '127.0.0.1', port: 1, timeout: 1000}), null);
});

/* ---------------------------------------------------------------------------
   The provider on occulite-client's live copy - FakeBox stands in for the system
   --------------------------------------------------------------------------- */

const {FakeBox} = require('occulite-client/testing');

const SILENT_LOG = {trace() {}, debug() {}, info() {}, warn() {}, error() {}};

/** a FakeBox with the house fixture; `scopes` what its token may */
async function liteBox(options = {}) {
    const fake = new FakeBox({token: 'olt_test', interfaces: ['HmIP-RF'], meta: structuredClone(HOUSE), ...options});
    const url = await fake.start();
    return {fake, port: Number(new URL(url).port)};
}

/** an http server (on `port`, or a free one) that forwards to `target` while `state.mode` is 'forward' */
async function front(target, port = 0) {
    const state = {mode: 'forward', sockets: new Set()};
    const server = http.createServer((request_, res) => {
        if (state.mode === 'gone') {
            res.writeHead(404, {'content-type': 'text/html'}).end('<html>404</html>');
            return;
        }

        const upstream = http.request(
            target + request_.url,
            {method: request_.method, headers: request_.headers},
            (answer) => {
                res.writeHead(answer.statusCode, answer.headers);
                answer.pipe(res);
            },
        );
        upstream.on('error', () => res.destroy());
        res.on('close', () => upstream.destroy());
        request_.pipe(upstream);
    });
    server.on('connection', (socket) => {
        state.sockets.add(socket);
        socket.on('close', () => state.sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    state.port = server.address().port;
    state.server = server;
    state.drop = () => state.sockets.forEach((socket) => socket.destroy());
    state.close = () =>
        new Promise((resolve) => {
            state.drop();
            server.close(resolve);
        });
    return state;
}

test('a names client of its own: the snapshot, an object event in place, a deletion; no lite-rpc stream', async (t) => {
    // a token that could do everything: the names client still runs names-only
    const {fake, port} = await liteBox({scopes: ['*']});
    const names = [];
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        token: 'olt_test',
        emitDelay: 10,
        logger: SILENT_LOG,
        onNames: (n) => names.push(n),
        onStatus: (s) => status.push(s),
    });
    t.after(async () => {
        provider.stop();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => names.length > 0 && status.at(-1) === true && fake.metaStreamsOpen > 0);
    assert.equal(names[0].channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
    assert.equal(names[0].revision, 12);
    assert.equal(provider.revision, 12);
    assert.equal(fake.streamsOpened, 0, 'no lite-rpc stream for a names client');
    assert.match(provider.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    fake.metaEvent({
        revision: 13,
        kind: 'object.updated',
        ref: 'HmIP-RF.000A1B2C3D4E5F:4',
        value: {name: 'Deckenlampe neu', enums: ['room/eg/kueche', 'function/licht']},
    });
    await waitFor(() => names.at(-1).channelNames['000A1B2C3D4E5F:4'] === 'Deckenlampe neu');
    assert.deepEqual(names.at(-1).channelRooms['000A1B2C3D4E5F:4'], ['Küche', 'Erdgeschoss']);
    assert.equal(names.at(-1).revision, 13);

    fake.metaEvent({revision: 14, kind: 'object.deleted', ref: 'HmIP-RF.000A1B2C3D4E5F:4'});
    await waitFor(() => names.at(-1).channelNames['000A1B2C3D4E5F:4'] === undefined);

    provider.stop();
    assert.equal(provider.box, null);
    assert.equal(status.at(-1), false);
    // a second stop is harmless
    provider.stop();
});

test('a room renamed on the system: the names follow once the copy re-read the snapshot', async (t) => {
    const {fake, port} = await liteBox();
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        token: 'olt_test',
        emitDelay: 10,
        logger: SILENT_LOG,
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => names.length > 0 && fake.metaStreamsOpen > 0);
    const document = structuredClone(HOUSE);
    document.enums.room.tree[0].name = 'Parterre';
    document.revision = 13;
    fake.opts.meta = document;
    fake.metaEvent({
        revision: 13,
        kind: 'node.updated',
        enum: 'room',
        path: 'room/eg',
        value: {id: 'eg', name: 'Parterre'},
    });
    await waitFor(() => names.at(-1).rooms.includes('Parterre'), 3000);
    assert.deepEqual(names.at(-1).channelRooms['000A1B2C3D4E5F:4'], ['Wohnzimmer', 'Parterre']);

    // an import replaced the store: the copy reads the snapshot again, the names follow once it is in
    const empty = structuredClone(EMPTY);
    empty.revision = 20;
    fake.opts.meta = empty;
    fake.metaEvent({revision: 20, kind: 'import', objects: 0, enums: 2});
    await waitFor(() => Object.keys(names.at(-1).channelNames).length === 0 && names.at(-1).revision === 20, 5000);
});

test('a rejected credential: no names, the error logged once', async (t) => {
    const {fake, port} = await liteBox({token: 'olt_right'});
    const errors = [];
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        token: 'olt_wrong',
        retryMin: 20,
        retryMax: 20,
        goneAfter: 1000,
        logger: {...SILENT_LOG, error: (message) => errors.push(message)},
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => errors.length > 0);
    // the probes answer (the system is there), the client is opened again, refused again: one line
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(names.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /rejected the credential \(unauthenticated\)/);
});

test('a system that is not up at the start: the names client connects once it answers', async (t) => {
    const {fake, port: fakePort} = await liteBox();
    // a port nobody listens on yet
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));

    const names = [];
    const warnings = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        token: 'olt_test',
        retryMin: 50,
        retryMax: 50,
        goneAfter: 1000,
        requestTimeout: 1000,
        emitDelay: 10,
        logger: {...SILENT_LOG, warn: (message) => warnings.push(message)},
        onNames: (n) => names.push(n),
    });
    let proxy;
    t.after(async () => {
        provider.stop();
        await proxy.close();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => provider.connectFailed, 5000);
    assert.ok(warnings.some((line) => line.startsWith('meta api: ')));

    // the system comes up on the port the provider dials
    proxy = await front('http://127.0.0.1:' + fakePort, port);
    await waitFor(() => names.length > 0, 5000);
    assert.equal(names[0].channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
});

test('a system that stops answering as openccu-lite hands back to detection', async (t) => {
    const {fake, port: fakePort} = await liteBox();
    const proxy = await front('http://127.0.0.1:' + fakePort);
    let gone = 0;
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: proxy.port,
        token: 'olt_test',
        retryMin: 30,
        retryMax: 30,
        goneAfter: 2,
        emitDelay: 10,
        logger: SILENT_LOG,
        onStatus: (s) => status.push(s),
        onGone: () => {
            gone += 1;
        },
    });
    t.after(async () => {
        provider.stop();
        await proxy.close();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => status.at(-1) === true);
    // a restored backup: 404 everywhere, the change stream cut
    proxy.mode = 'gone';
    proxy.drop();
    await waitFor(() => gone === 1, 5000);
    assert.equal(status.at(-1), false);
    assert.equal(provider.stopped, true, 'it stops itself instead of hammering the box');
});

test('a change stream the system refuses: the names client is opened again once the system answers', async (t) => {
    const {fake, port: fakePort} = await liteBox();
    const proxy = await front('http://127.0.0.1:' + fakePort);
    let refuseStream = false;
    const forward = proxy.server.listeners('request')[0];
    proxy.server.removeAllListeners('request');
    proxy.server.on('request', (request_, res) => {
        if (refuseStream && request_.url.startsWith('/api/meta/v1/events/sse')) {
            res.writeHead(404, {'content-type': 'application/json'}).end('{"error":"not_found"}');
            return;
        }

        forward(request_, res);
    });
    const opened = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: proxy.port,
        token: 'olt_test',
        retryMin: 50,
        retryMax: 50,
        goneAfter: 1000,
        emitDelay: 10,
        logger: SILENT_LOG,
        createClient: (options) => {
            const {OccuLite} = require('../../nodes/lib/lite.js').load();
            opened.push(options);
            return new OccuLite(options);
        },
    });
    t.after(async () => {
        provider.stop();
        await proxy.close();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => provider.connected);
    refuseStream = true;
    proxy.drop();
    await waitFor(() => provider.streamRefused || opened.length > 1, 5000);
    refuseStream = false;
    await waitFor(() => opened.length > 1 && provider.connected, 5000);
});

test("shared: the lite-rpc client's copy is followed, its state is the copy's, it is not closed", async (t) => {
    const {fake, port} = await liteBox();
    const {OccuLite, nodeTransport} = require('../../nodes/lib/lite.js').load();
    const box = new OccuLite({
        url: 'http://127.0.0.1:' + port,
        auth: {token: 'olt_test'},
        transport: nodeTransport({}),
    });
    const names = [];
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        shared: true,
        emitDelay: 10,
        logger: SILENT_LOG,
        onNames: (n) => names.push(n),
        onStatus: (s) => status.push(s),
    });
    t.after(async () => {
        provider.stop();
        box.close();
        await fake.stop();
    });

    provider.start();
    assert.equal(provider.box, null, 'a shared provider waits for the client');
    provider.attach(box);
    await waitFor(() => names.length > 0 && status.at(-1) === true);
    assert.equal(names[0].channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
    assert.equal(fake.streamsOpened > 0, true, 'the lite-rpc client streams its events');

    provider.stop();
    assert.notEqual(box.status, 'closed', 'the lite-rpc connection closes its own client');
    // attach after stop is ignored
    provider.attach(box);
    assert.equal(provider.box, null);
});

test('shared, but no lite-rpc client comes: a names client of its own', async (t) => {
    const {fake, port} = await liteBox();
    const debug = [];
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port,
        token: 'olt_test',
        shared: true,
        attachTimeout: 50,
        emitDelay: 10,
        logger: {...SILENT_LOG, debug: (line) => debug.push(line)},
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await fake.stop();
    });

    provider.start();
    await waitFor(() => names.length > 0);
    assert.equal(provider.shared, false);
    assert.ok(debug.some((line) => /a names client of its own/.test(line)));
});

test('namesTransport: the auth state without rpc scopes, other answers untouched, the stream watched', async () => {
    const seen = [];
    const answers = {
        '/api/auth/v1/state': {
            status: 200,
            headers: {},
            body: JSON.stringify({authenticated: true, scopes: ['*', 'rpc:admin', 'meta:read']}),
        },
        '/api/auth/v1/state?x': {status: 200, headers: {}, body: 'not json'},
        '/api/auth/v1/state?y': {status: 200, headers: {}, body: JSON.stringify({authenticated: true})},
        '/api/meta/v1/version': {status: 200, headers: {}, body: '{"api":"meta"}'},
    };
    const inner = {
        request: async (method, url) => answers[new URL(url).pathname + new URL(url).search],
        stream: async (url) => {
            if (url.includes('fail')) {
                throw new Error('refused');
            }

            if (url.includes('denied')) {
                return {status: 403, chunks: (async function* () {})()};
            }

            return {
                status: 200,
                chunks: (async function* () {
                    yield new Uint8Array([1]);
                })(),
            };
        },
    };
    const {namesTransport} = require('../../nodes/lib/metaprovider.js');
    const transport = namesTransport(inner, (open, status) => seen.push([open, status]));
    const state = JSON.parse((await transport.request('GET', 'http://x/api/auth/v1/state')).body);
    assert.deepEqual(state.scopes, ['meta:read']);
    assert.equal((await transport.request('GET', 'http://x/api/auth/v1/state?x')).body, 'not json');
    assert.deepEqual(JSON.parse((await transport.request('GET', 'http://x/api/auth/v1/state?y')).body).scopes, []);
    assert.equal((await transport.request('GET', 'http://x/api/meta/v1/version')).body, '{"api":"meta"}');

    // another stream is not watched
    await transport.stream('http://x/api/rpc/v1/events', {});
    assert.deepEqual(seen, []);

    const open = await transport.stream('http://x/api/meta/v1/events/sse?since=1', {});
    assert.deepEqual(seen, [[true, undefined]]);
    for await (const chunk of open.chunks) {
        assert.equal(chunk[0], 1);
    }

    assert.deepEqual(seen.at(-1), [false, undefined]);
    await transport.stream('http://x/api/meta/v1/events/sse?denied', {});
    assert.deepEqual(seen.at(-1), [false, 403]);
    await assert.rejects(transport.stream('http://x/api/meta/v1/events/sse?fail', {}), /refused/);
    assert.deepEqual(seen.at(-1), [false, undefined]);
});

test('an IPv6 host gets its brackets in the URL', () => {
    assert.equal(new MetaProvider({host: 'fd00::1', tls: true}).url, 'https://[fd00::1]:443');
    assert.equal(new MetaProvider({host: '[fd00::1]', port: 8080}).url, 'http://[fd00::1]:8080');
    assert.equal(new MetaProvider({host: 'h'}).revision, 0);
});

/** a stand-in for occulite-client's client: its handlers, its ready() settled by the test */
function stubBox(document = HOUSE) {
    const handlers = {};
    let settle;
    const readyP = new Promise((resolve, reject) => {
        settle = {resolve, reject};
    });
    readyP.catch(() => {});
    return {
        handlers,
        settle,
        closed: false,
        meta: {doc: structuredClone(document), revision: document.revision},
        on(event, fn) {
            handlers[event] = fn;
            return () => delete handlers[event];
        },
        ready: () => readyP,
        close() {
            this.closed = true;
        },
    };
}

test('a client that was replaced or stopped is not listened to any more', async () => {
    const names = [];
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        shared: true,
        emitDelay: 5,
        logger: SILENT_LOG,
        onNames: (n) => names.push(n),
        onStatus: (s) => status.push(s),
    });
    provider.start();
    const first = stubBox();
    const second = stubBox(EMPTY);
    provider.attach(first);
    const firstHandlers = {...first.handlers};
    provider.attach(second);
    assert.equal(Object.keys(first.handlers).length, 0, 'the first client is let go');
    assert.equal(first.closed, false, 'a shared client is not closed by the provider');

    // the first client answers late: ignored
    first.settle.resolve();
    firstHandlers.status({state: 'offline'});
    firstHandlers.metaSettled({revision: 99, reread: false});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(names.length, 0);
    assert.deepEqual(status, []);

    second.settle.resolve();
    await waitFor(() => names.length === 1 && status.at(-1) === true);
    // two settled copies in a burst: one update
    second.handlers.metaSettled({revision: 1, reread: false});
    second.handlers.metaSettled({revision: 2, reread: true});
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(names.length, 2);

    // a state of the shared client: the copy's
    second.handlers.status({state: 'degraded'});
    assert.equal(status.at(-1), false);
    const secondHandlers = {...second.handlers};
    provider.stop();
    // after the stop: nothing reaches the connection
    secondHandlers.status({state: 'ready'});
    secondHandlers.metaSettled({revision: 3});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(names.length, 2);
});

test('a first connect that fails after the stop, or for a replaced client, is not reported', async () => {
    const warnings = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        shared: true,
        logger: {...SILENT_LOG, warn: (line) => warnings.push(line)},
    });
    provider.start();
    const first = stubBox();
    const second = stubBox();
    provider.attach(first);
    provider.attach(second);
    first.settle.reject(new Error('unreachable'));
    provider.stop();
    second.settle.reject(new Error('unreachable'));
    second.settle.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(warnings, []);
    assert.equal(provider.connectFailed, false);
});

test('the version probe: a stop or a connection while it runs ends it', async (t) => {
    // a system that answers the version probe after 150 ms
    const server = http.createServer((request_, res) => {
        setTimeout(() => {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify({api: 'meta', version: 1, format: 1, revision: 1}));
        }, 150);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const port = server.address().port;

    for (const end of ['stop', 'connect']) {
        let gone = 0;
        const provider = new MetaProvider({
            host: '127.0.0.1',
            port,
            goneAfter: 1,
            logger: SILENT_LOG,
            onGone: () => (gone += 1),
        });
        provider.stopped = false;
        const probing = provider._probe();
        if (end === 'stop') {
            provider.stop();
        } else {
            provider.connected = true;
        }

        await probing;
        assert.equal(provider.probeTimeout, null, end + ': no next probe');
        assert.equal(gone, 0);
        provider.stop();
    }
});
