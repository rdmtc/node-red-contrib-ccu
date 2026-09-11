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

test('the provider loads the snapshot and follows the event stream', async (t) => {
    const box = await fakeBox();
    const names = [];
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        emitDelay: 10,
        onNames: (n) => names.push(n),
        onStatus: (s) => status.push(s),
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => names.length > 0 && status.includes(true));
    assert.equal(names[0].channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
    assert.equal(names[0].revision, 12);

    // a rename on the box: one object.updated event, no new snapshot needed
    const before = box.snapshots;
    box.send({
        revision: 13,
        kind: 'object.updated',
        ref: 'HmIP-RF.000A1B2C3D4E5F:4',
        value: {name: 'Deckenlampe neu', enums: ['room/eg/kueche', 'function/licht']},
    });
    await waitFor(() => names.length > 1);
    const latest = names.at(-1);
    assert.equal(latest.channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe neu');
    assert.deepEqual(latest.channelRooms['000A1B2C3D4E5F:4'], ['Küche', 'Erdgeschoss']);
    assert.equal(latest.revision, 13);
    assert.equal(box.snapshots, before, 'an object event must not trigger a snapshot');

    // a deletion drops the name
    box.send({revision: 14, kind: 'object.deleted', ref: 'HmIP-RF.000A1B2C3D4E5F:4'});
    await waitFor(() => names.at(-1).channelNames['000A1B2C3D4E5F:4'] === undefined);
});

test('a node event, an import and a revision gap re-read the snapshot', async (t) => {
    const box = await fakeBox();
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        emitDelay: 10,
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => names.length > 0);
    assert.equal(box.snapshots, 1);

    // a room was renamed on the box - member paths may have been rewritten
    box.document.enums.room.tree[0].name = 'Parterre';
    box.document.revision = 13;
    box.send({revision: 13, kind: 'node.updated', enum: 'room', path: 'room/eg', value: {id: 'eg', name: 'Parterre'}});
    await waitFor(() => names.at(-1).rooms.includes('Parterre'));
    assert.equal(box.snapshots, 2);
    assert.deepEqual(names.at(-1).channelRooms['000A1B2C3D4E5F:4'], ['Wohnzimmer', 'Parterre']);

    // an import: the whole store was replaced
    box.document = structuredClone(EMPTY);
    box.document.revision = 20;
    box.send({revision: 20, kind: 'import', objects: 0, enums: 2});
    await waitFor(() => Object.keys(names.at(-1).channelNames).length === 0);
    assert.equal(box.snapshots, 3);

    // a gap in the revisions (events were missed)
    box.document = structuredClone(HOUSE);
    box.document.revision = 40;
    box.send({revision: 40, kind: 'object.updated', ref: 'HmIP-RF.X:1', value: {name: 'X'}});
    await waitFor(() => box.snapshots === 4);
    assert.equal(names.at(-1).channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
});

test('a rejected credential degrades to no names, logs once and retries', async (t) => {
    const box = await fakeBox({token: 'olt_right'});
    const errors = [];
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_wrong',
        retryMin: 50,
        retryMax: 50,
        emitDelay: 10,
        logger: {
            trace() {},
            debug() {},
            info() {},
            warn() {},
            error: (message) => errors.push(message),
        },
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => errors.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(names.length, 0, 'no names without a credential');
    assert.equal(errors.length, 1, 'the 401 is logged once, not on every retry');
    assert.match(errors[0], /rejected the credential \(401\)/);
    assert.ok(provider.retry > 1, 'it keeps retrying');

    // the administrator fixes the token: the next retry picks the names up
    provider.token = 'olt_right';
    await waitFor(() => names.length > 0, 5000);
    assert.equal(names[0].channelNames['000A1B2C3D4E5F:4'], 'Deckenlampe');
});

test('a broken stream is re-established and keeps delivering', async (t) => {
    const box = await fakeBox();
    const names = [];
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        retryMin: 50,
        retryMax: 50,
        emitDelay: 10,
        onNames: (n) => names.push(n),
        onStatus: (s) => status.push(s),
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => status.at(-1) === true && box.clients.size > 0);

    // the box restarts its web server / a proxy drops the connection
    for (const client of box.clients) {
        client.end();
    }

    await waitFor(() => box.streams > 1, 5000);
    await waitFor(() => box.clients.size > 0, 5000);

    box.send({revision: 13, kind: 'object.updated', ref: 'HmIP-RF.NEW:1', value: {name: 'Nach dem Reconnect'}});
    await waitFor(() => names.at(-1).channelNames['NEW:1'] === 'Nach dem Reconnect', 5000);
    // it asked to be caught up from where it left off
    assert.equal(box.lastSince, 'since=12');

    provider.stop();
    assert.equal(provider.stopped, true);
    assert.equal(provider.stream, null);
});

test('a box that answers its event stream late is not given up on', async (t) => {
    // occulited flushes the SSE header only with the first event; a client that
    // applies its request timeout to the open stream tears it down every time
    const box = await fakeBox({sseHeaderDelay: 600});
    const names = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        requestTimeout: 300,
        streamTimeout: 5000,
        retryMin: 50,
        retryMax: 50,
        emitDelay: 10,
        onNames: (n) => names.push(n),
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => names.length > 0);
    await waitFor(() => box.clients.size > 0, 3000);
    assert.equal(box.streams, 1, 'the stream must not have been retried');

    box.send({revision: 13, kind: 'object.updated', ref: 'HmIP-RF.LATE:1', value: {name: 'Spät'}});
    await waitFor(() => names.at(-1).channelNames['LATE:1'] === 'Spät');
});

test('the box going away marks the connection as down', async (t) => {
    const box = await fakeBox();
    const status = [];
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        requestTimeout: 500,
        retryMin: 50,
        retryMax: 50,
        emitDelay: 10,
        onStatus: (s) => status.push(s),
    });
    t.after(() => provider.stop());

    provider.start();
    await waitFor(() => status.at(-1) === true);
    await box.close();
    await waitFor(() => status.at(-1) === false, 5000);
});

test('a box that stops answering as openccu-lite hands back to detection', async (t) => {
    const box = await fakeBox();
    let gone = 0;
    const provider = new MetaProvider({
        host: '127.0.0.1',
        port: box.port,
        token: 'olt_test',
        requestTimeout: 500,
        retryMin: 30,
        retryMax: 30,
        goneAfter: 2,
        emitDelay: 10,
        onGone: () => {
            gone += 1;
        },
    });
    t.after(async () => {
        provider.stop();
        await box.close();
    });

    provider.start();
    await waitFor(() => provider.revision > 0);

    // the box answers 404 everywhere from now on
    box.gone = true;
    for (const client of box.clients) {
        client.end();
    }

    await waitFor(() => gone === 1, 5000);
    assert.equal(provider.stopped, true, 'it stops itself instead of hammering the box');
});
