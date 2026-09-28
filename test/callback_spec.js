/* B-32: a callback call whose first parameter is not one of our own init ids -
   no parameters, a non-string, an id of an unknown interface - is answered and
   logged at debug, never thrown on. The RPC servers dispatch from an event
   emitter, so an exception in a handler used to end the whole Node-RED process
   (seen with a bare `system.listMethods` against the BIN-RPC callback port).
   Both callback servers are exercised: binrpc (BidCos-RF) and xmlrpc (HmIP-RF). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const BIN_PORT = 2067;
const XML_PORT = 2068;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-callback-paramsets.json');

function removeCache() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

const flow = [
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'callback',
        host: HOST,
        regaEnabled: false,
        bcrfEnabled: true,
        bcrfBinRpc: true,
        iprfEnabled: true,
        virtEnabled: false,
        bcwiEnabled: false,
        cuxdEnabled: false,
        regaPoll: false,
        regaInterval: '30',
        rpcPingTimeout: '60',
        rpcInitAddress: HOST,
        rpcServerHost: HOST,
        rpcBinPort: String(BIN_PORT),
        rpcXmlPort: String(XML_PORT),
    },
];

/** a fake interface process that accepts init and remembers the id */
function fakeServer(protocol, port) {
    const rpc = protocol === 'binrpc' ? binrpc : xmlrpc;
    const server = rpc.createServer({host: HOST, port});
    const ids = [];
    server.on('init', (err, params, callback) => {
        if (params[1]) {
            ids.push(params[1]);
        }

        callback(null, '');
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('ping', (err, params, callback) => callback(null, true));
    return {ids, close: () => server.close()};
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (predicate()) {
            return true;
        }

        await wait(50);
    }

    return Boolean(predicate());
}

function load(nodes, flowJson) {
    return new Promise((resolve) => helper.load(nodes, flowJson, resolve));
}

/** the node's log lines at error and warn level */
function problems(id) {
    const {ERROR, WARN} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && (l.level === ERROR || l.level === WARN))
        .map((l) => l.msg);
}

/** one call against a callback server, resolved with the answer (a fault rejects) */
function call(client, method, params) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no answer to ' + method)), 3000);
        client.methodCall(method, params, (err, res) => {
            clearTimeout(timer);
            if (err) {
                reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
            } else {
                resolve(res);
            }
        });
    });
}

/* the calls every handler must survive; `unknownId` is an id that is not ours */
const badCalls = (unknownId) => [
    ['system.listMethods', []],
    ['system.listMethods', [42]],
    ['system.listMethods', [unknownId]],
    ['system.listMethods', ['nr_ABCDEF_NoSuchInterface']],
    ['listDevices', []],
    ['listDevices', [unknownId]],
    ['event', []],
    ['event', [42]],
    ['event', [unknownId, 'ABC0000001:1', 'STATE', true]],
    ['event', ['nr_ABCDEF_HmIP-RF']],
    ['newDevices', []],
    ['newDevices', ['nr_ABCDEF_HmIP-RF', 'not a list']],
    ['newDevices', [unknownId, [{ADDRESS: 'X'}]]],
    ['deleteDevices', []],
    ['deleteDevices', ['nr_ABCDEF_HmIP-RF', 7]],
    ['updateDevice', []],
    ['replaceDevice', [false]],
    ['readdedDevice', [1, 2]],
    ['setReadyConfig', []],
    ['system.multicall', []],
    ['system.multicall', [7]],
    [
        'system.multicall',
        [
            [
                {methodName: 'event', params: 5},
                {methodName: 'event', params: []},
                {methodName: 'system.listMethods', params: []},
                {methodName: 'listDevices', params: [unknownId]},
                {methodName: 'system.multicall', params: [[]]},
                {methodName: 'noSuchMethod', params: []},
                false,
            ],
        ],
    ],
];

describe('callback calls with an unknown interface id (B-32)', function () {
    this.timeout(30000);
    let servers = [];
    let clients = [];
    let nc;

    before(async () => {
        removeCache();
        await new Promise((resolve) => helper.startServer(resolve));
        servers = [fakeServer('binrpc', 2001), fakeServer('http', 2010)];
        await load([nodeConnection], flow);
        nc = helper.getNode('nc');
        // fetched paramset descriptions would be saved into the repository's paramsets.json (the
        // test helper has no userDir) - a scratch file instead, removed with the cache
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus['BidCos-RF'] && nc.ifaceStatus['HmIP-RF'], 5000)).should.be.true();
        clients = [
            binrpc.createClient({host: HOST, port: BIN_PORT, reconnectTimeout: 0}),
            xmlrpc.createClient({host: HOST, port: XML_PORT, path: '/'}),
        ];
    });

    after(async () => {
        for (const client of clients) {
            if (typeof client.close === 'function') {
                client.close();
            }
        }

        await helper.unload();
        await Promise.all(servers.map((s) => s.close()));
        await new Promise((resolve) => helper.stopServer(resolve));
        removeCache();
    });

    it('the node registered with both fake processes', () => {
        servers[0].ids.length.should.be.above(0);
        servers[1].ids.length.should.be.above(0);
        servers[0].ids[0].should.match(/^nr_[\dA-Za-z]{6}_BidCos-RF$/);
        servers[1].ids[0].should.match(/^nr_[\dA-Za-z]{6}_HmIP-RF$/);
    });

    for (const [index, protocol] of ['binrpc', 'xmlrpc'].entries()) {
        it(`every method answers on the ${protocol} server, nothing is thrown or logged as an error`, async () => {
            const client = clients[index];
            const unknownId = 'nr_ZZZZZZ_' + (protocol === 'binrpc' ? 'HmIP-RF' : 'BidCos-RF') + 'X';
            const statusBefore = {...nc.ifaceStatus};

            for (const [method, params] of badCalls(unknownId)) {
                const res = await call(client, method, params);
                if (method === 'system.listMethods') {
                    res.should.be.an.Array();
                    res.should.containEql('event');
                    res.should.containEql('listDevices');
                } else if (method === 'listDevices') {
                    res.should.deepEqual([]);
                } else if (method === 'system.multicall') {
                    res.should.be.an.Array();
                    if (Array.isArray(params[0])) {
                        // one answer per call, so the daemon can match them
                        res.length.should.equal(params[0].length);
                    }
                } else {
                    res.should.equal('');
                }
            }

            problems('nc').should.deepEqual([]);
            nc.ifaceStatus.should.deepEqual(statusBefore);
            should(nc.lastEvent.null).be.undefined();
            should(nc.rxCounters.null).be.undefined();
            Object.keys(nc.metadata.devices).should.not.containEql('null');
        });
    }

    it('a device without a TYPE is skipped, the rest of the list is kept, the answer arrives', async () => {
        const id = servers[1].ids[0];
        const res = await call(clients[1], 'newDevices', [
            id,
            [{ADDRESS: 'B32TEST0001'}, {ADDRESS: 'B32TEST0002', TYPE: 'HmIP-B32', VERSION: 1, PARAMSETS: ['MASTER']}],
        ]);
        res.should.equal('');
        should(nc.metadata.devices['HmIP-RF'].B32TEST0001).be.undefined();
        nc.metadata.devices['HmIP-RF'].B32TEST0002.TYPE.should.equal('HmIP-B32');
        problems('nc')
            .filter((m) => m.includes('malformed'))
            .length.should.equal(1);
    });

    it('a throw inside a handler is answered and logged, not thrown on', async () => {
        const original = nc.listDevices;
        nc.listDevices = () => {
            throw new Error('B-32 test throw');
        };

        try {
            const res = await call(clients[0], 'listDevices', [servers[0].ids[0]]);
            res.should.deepEqual([]);
        } finally {
            nc.listDevices = original;
        }

        problems('nc')
            .filter((m) => m.includes('B-32 test throw'))
            .length.should.equal(1);
    });

    it('listDevices lists the virtual remote control (HmIP-RCV-1) in the reduced HmIP shape (task 13)', () => {
        nc.metadata.devices['HmIP-RF'] = {
            'HmIP-RCV-1': {
                ADDRESS: 'HmIP-RCV-1',
                TYPE: 'HmIP-RCV-50',
                VERSION: 1,
                FIRMWARE: '3.89.9',
                FLAGS: 1,
                INTERFACE: '',
                PARAMSETS: ['MASTER'],
                CHILDREN: ['HmIP-RCV-1:0', 'HmIP-RCV-1:1'],
                RX_MODE: 1,
                UPDATABLE: 0,
            },
            'HmIP-RCV-1:1': {
                ADDRESS: 'HmIP-RCV-1:1',
                TYPE: 'KEY_TRANSCEIVER',
                PARENT: 'HmIP-RCV-1',
                PARENT_TYPE: 'HmIP-RCV-50',
                VERSION: 1,
                INDEX: 1,
                PARAMSETS: ['MASTER', 'VALUES'],
                OPERATIONS: 7,
            },
            '0000DEADBEEF01': {
                ADDRESS: '0000DEADBEEF01',
                TYPE: 'HmIP-BSM',
                VERSION: 1,
                FIRMWARE: '2.0.0',
                PARAMSETS: ['MASTER'],
            },
        };
        const answer = nc.listDevices('HmIP-RF');
        answer.map((d) => d.ADDRESS).should.deepEqual(['HmIP-RCV-1', 'HmIP-RCV-1:1', '0000DEADBEEF01']);
        answer[0].should.deepEqual({
            ADDRESS: 'HmIP-RCV-1',
            VERSION: 1,
            CHILDREN: ['HmIP-RCV-1:0', 'HmIP-RCV-1:1'],
            FIRMWARE: '3.89.9',
            FLAGS: 1,
            PARAMSETS: ['MASTER'],
            RX_MODE: 1,
            TYPE: 'HmIP-RCV-50',
        });
        // the reduced shape: no OPERATIONS, no UPDATABLE, empty strings dropped, VERSION kept
        should(answer[1].OPERATIONS).be.undefined();
        answer[1].VERSION.should.equal(1);
        answer[1].PARENT_TYPE.should.equal('HmIP-RCV-50');
        delete nc.metadata.devices['HmIP-RF'];
    });

    it('our own id still works after all that: the event is published and the counters move', async () => {
        const id = servers[0].ids[0];
        const before = nc.rxCounters['BidCos-RF'] || 0;
        const res = await call(clients[0], 'event', [id, 'BidCoS-RF:0', 'PONG', 'x']);
        res.should.equal('');
        (await call(clients[0], 'event', [id, 'B32TEST0002:1', 'STATE', true])).should.equal('');
        nc.rxCounters['BidCos-RF'].should.equal(before + 1);
        nc.lastEvent['BidCos-RF'].should.be.above(0);
        (await call(clients[1], 'system.listMethods', [servers[1].ids[0]])).should.containEql('system.multicall');
        nc.ifaceStatus['HmIP-RF'].should.be.true();
    });
});
