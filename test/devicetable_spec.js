/* task 9 (#146, #181, old B-11): the device table and the re-init watchdog.
   - a device the process reports with a changed TYPE/VERSION/FIRMWARE
     replaces the cached entry, leaves the old type list and gets its
     paramset description fetched again (at start through listDevices and
     at runtime through newDevices);
   - "re-read device data": POST /ccu/:id/reread asks every connected
     interface for its list again and answers a summary;
   - the channel picker's answer carries X-CCU-Loading while the connection
     is still initialising, so the editor asks again instead of emptying
     the picker;
   - an interface without devices in the cache is pinged too, and
     re-initialised after the ping timeout once it has ever delivered an
     event (a PONG counts).
   A fake hmipserver stands in. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'HmIP-RF';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
// the connection saves fetched paramset descriptions into <userDir>/paramsets.json, which in the
// test helper is the repository's vendored file - point it at a scratch file, removed per test
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-devicetable-paramsets.json');

function removeCache() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow(pingTimeout = '60') {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'table',
            host: HOST,
            regaEnabled: false,
            bcrfEnabled: false,
            iprfEnabled: true,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: pingTimeout,
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            rpcBinPort: '2117',
            rpcXmlPort: '2118',
        },
    ];
}

function device(address, type, children) {
    return {ADDRESS: address, TYPE: type, VERSION: 1, FIRMWARE: '1.0.0', PARAMSETS: ['MASTER'], CHILDREN: children};
}

function channel(address, parent, parentType, type) {
    return {
        ADDRESS: address,
        TYPE: type,
        PARENT: parent,
        PARENT_TYPE: parentType,
        VERSION: 1,
        INDEX: Number(address.split(':')[1]),
        PARAMSETS: ['MASTER', 'VALUES'],
    };
}

/** the fake hmipserver on 2010: init, ping (PONG while `pong`), listDevices from `list`, getParamsetDescription.
 * Like hmipserver it asks the client for its listDevices after an init and sends newDevices for every entry
 * of its own list the answer does not hold with the same ADDRESS and VERSION. */
function fakeHmipServer() {
    const state = {
        inits: [],
        pings: 0,
        pong: true,
        callback: null,
        id: null,
        list: [
            device('DEV0000001', 'HmIP-T9', ['DEV0000001:1']),
            channel('DEV0000001:1', 'DEV0000001', 'HmIP-T9', 'SWITCH_VIRTUAL_RECEIVER'),
        ],
        descriptions: [],
    };
    const server = xmlrpc.createServer({host: HOST, port: 2010});
    const send = (method, params) =>
        new Promise((resolve) => {
            if (!state.callback) {
                resolve(false);
                return;
            }

            const url = new URL(state.callback);
            const client = xmlrpc.createClient({host: url.hostname, port: Number(url.port), path: '/'});
            client.methodCall(method, params, (err, res) => resolve(err ? null : res));
        });
    state.readBack = async () => {
        const answer = (await send('listDevices', [state.id])) || [];
        const known = new Set(answer.map((d) => d.ADDRESS + '/' + d.VERSION));
        const missing = state.list.filter((d) => !known.has(d.ADDRESS + '/' + d.VERSION));
        if (missing.length > 0) {
            await send('newDevices', [state.id, missing]);
        }

        return missing.length;
    };
    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        state.inits.push({url, id});
        if (id) {
            state.callback = url;
            state.id = id;
            setTimeout(() => state.readBack(), 50);
        }

        callback(null, '');
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('listDevices', (err, params, callback) => callback(null, state.list));
    server.on('getParamsetDescription', (err, params, callback) => {
        state.descriptions.push(params);
        callback(null, params[1] === 'VALUES' ? {STATE: {TYPE: 'BOOL', OPERATIONS: 7, ID: 'STATE'}} : {});
    });
    server.on('ping', (err, params, callback) => {
        state.pings += 1;
        callback(null, true);
        if (state.pong) {
            send('event', [state.id, 'CENTRAL:0', 'PONG', params[0]]);
        }
    });
    state.sendNewDevices = (devices) => send('newDevices', [state.id, devices]);
    state.close = () => new Promise((resolve) => server.close(resolve));
    return state;
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

        await wait(25);
    }

    return Boolean(predicate());
}

function load(nodes, flowJson) {
    return new Promise((resolve) => helper.load(nodes, flowJson, resolve));
}

function infos(id) {
    const {INFO} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === INFO)
        .map((l) => l.msg);
}

describe('device table refresh and the re-init watchdog (task 9)', function () {
    this.timeout(30000);
    let hmip;
    let nc;

    async function start(pingTimeout, cache) {
        removeCache();
        if (cache) {
            fs.writeFileSync(CACHE_FILES[0], JSON.stringify(cache));
        }

        hmip = fakeHmipServer();
        await load([nodeConnection], flow(pingTimeout));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus[IFACE] && hmip.inits.length === 1, 5000)).should.be.true();
    }

    before((done) => {
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        await hmip.close();
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a cold start takes the device table from listDevices and fetches the descriptions', async () => {
        await start();
        (
            await until(() => nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE]['DEV0000001:1'], 3000)
        ).should.be.true();
        (await until(() => hmip.descriptions.length >= 2, 5000)).should.be.true();
        nc.metadata.types[IFACE]['HmIP-T9'].should.deepEqual(['DEV0000001']);
        // the picker sees the channel with its datapoints once the description is in
        const psKey = nc.paramsetName(IFACE, nc.metadata.devices[IFACE]['DEV0000001:1'], 'VALUES');
        (await until(() => nc.paramsetDescriptions[psKey], 3000)).should.be.true();
    });

    it('a channel reported with another TYPE replaces the entry, leaves the old type list, gets a new description', async () => {
        await start();
        (await until(() => hmip.descriptions.length >= 2 && nc.paramsetQueue.length === 0, 5000)).should.be.true();
        const before = hmip.descriptions.length;
        await hmip.sendNewDevices([
            device('DEV0000001', 'HmIP-T9', ['DEV0000001:1']),
            channel('DEV0000001:1', 'DEV0000001', 'HmIP-T9', 'DIMMER_VIRTUAL_RECEIVER'),
        ]);
        (
            await until(() => nc.metadata.devices[IFACE]['DEV0000001:1'].TYPE === 'DIMMER_VIRTUAL_RECEIVER', 2000)
        ).should.be.true();
        // the new paramset key is fetched
        (await until(() => hmip.descriptions.length > before, 5000)).should.be.true();
        const psKey = nc.paramsetName(IFACE, nc.metadata.devices[IFACE]['DEV0000001:1'], 'VALUES');
        psKey.should.match(/DIMMER_VIRTUAL_RECEIVER\/VALUES$/);
        (await until(() => nc.paramsetDescriptions[psKey], 3000)).should.be.true();
        infos('nc')
            .some((m) => m.startsWith('device data changed HmIP-RF DEV0000001:1'))
            .should.be.true();
        // the unchanged device did not count as changed
        infos('nc')
            .filter((m) => m.startsWith('device data changed'))
            .length.should.equal(1);
    });

    it('a cached device the process re-sends with another VERSION at start is taken over; a vanished one waits for the re-read', async () => {
        const cached = {
            devices: {
                [IFACE]: {
                    DEV0000001: {...device('DEV0000001', 'HmIP-OLD', ['DEV0000001:1']), VERSION: 0},
                    'DEV0000001:1': {
                        ...channel('DEV0000001:1', 'DEV0000001', 'HmIP-OLD', 'KEY_TRANSCEIVER'),
                        VERSION: 0,
                    },
                    GONE000001: device('GONE000001', 'HmIP-GONE', []),
                },
            },
            types: {[IFACE]: {'HmIP-OLD': ['DEV0000001'], 'HmIP-GONE': ['GONE000001']}},
        };
        await start('60', cached);
        // hmipserver compares ADDRESS and VERSION: the two entries come again with newDevices
        (await until(() => nc.metadata.devices[IFACE].DEV0000001.TYPE === 'HmIP-T9', 3000)).should.be.true();
        (
            await until(() => nc.metadata.devices[IFACE]['DEV0000001:1'].TYPE === 'SWITCH_VIRTUAL_RECEIVER', 3000)
        ).should.be.true();
        should(nc.metadata.types[IFACE]['HmIP-OLD']).be.undefined();
        nc.metadata.types[IFACE]['HmIP-T9'].should.deepEqual(['DEV0000001']);
        infos('nc')
            .filter((m) => m.startsWith('device data changed'))
            .length.should.equal(2);
        // the process never tells about a device that is gone - the manual re-read does
        nc.metadata.devices[IFACE].GONE000001.TYPE.should.equal('HmIP-GONE');
        const res = await helper.request().post('/ccu/nc/reread').expect(200);
        JSON.parse(res.text)[IFACE].should.deepEqual({total: 2, added: 0, changed: 0, removed: 1});
        should(nc.metadata.devices[IFACE].GONE000001).be.undefined();
    });

    it('POST /ccu/:id/reread re-reads the table and answers a summary; an unknown id is 404', async () => {
        await start();
        (
            await until(() => nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE]['DEV0000001:1'], 3000)
        ).should.be.true();
        hmip.list = [
            device('DEV0000002', 'HmIP-T9', ['DEV0000002:1']),
            channel('DEV0000002:1', 'DEV0000002', 'HmIP-T9', 'SWITCH_VIRTUAL_RECEIVER'),
        ];
        const res = await helper.request().post('/ccu/nc/reread').expect(200);
        const summary = JSON.parse(res.text);
        summary[IFACE].should.deepEqual({total: 2, added: 2, changed: 0, removed: 2});
        should(nc.metadata.devices[IFACE].DEV0000001).be.undefined();
        nc.metadata.devices[IFACE].DEV0000002.TYPE.should.equal('HmIP-T9');
        await helper.request().post('/ccu/nosuchnode/reread').expect(404);
        infos('nc')
            .some((m) => m.startsWith('re-reading device data: HmIP-RF'))
            .should.be.true();
    });

    it('the channel picker answer says "loading" while a description is still being fetched', async () => {
        await start();
        (
            await until(() => nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE]['DEV0000001:1'], 3000)
        ).should.be.true();
        (await until(() => hmip.descriptions.length >= 2, 5000)).should.be.true();
        (await until(() => nc.paramsetQueue.length === 0 && !nc.paramsetPending, 5000)).should.be.true();
        const ready = await helper.request().get('/ccu?config=nc&type=channels&iface=HmIP-RF').expect(200);
        should(ready.headers['x-ccu-loading']).be.undefined();
        JSON.parse(ready.text).should.have.property('DEV0000001:1');

        nc.paramsetQueue.push({iface: IFACE, name: 'x', address: 'DEV0000001:1', paramset: 'MASTER'});
        const loading = await helper.request().get('/ccu?config=nc&type=channels&iface=HmIP-RF').expect(200);
        loading.headers['x-ccu-loading'].should.equal('1');
        nc.paramsetQueue.length = 0;

        // an interface that is not connected yet: loading as well
        nc.ifaceStatus[IFACE] = false;
        const waiting = await helper.request().get('/ccu?config=nc&type=tree').expect(200);
        waiting.headers['x-ccu-loading'].should.equal('1');
        nc.ifaceStatus[IFACE] = true;
    });

    it('an interface without devices is pinged, and re-initialised after the timeout once a PONG ever arrived', async () => {
        hmip = null;
        removeCache();
        hmip = fakeHmipServer();
        hmip.list = [];
        await load([nodeConnection], flow('2'));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus[IFACE] && hmip.inits.length === 1, 5000)).should.be.true();
        await wait(200);
        Object.keys(nc.metadata.devices[IFACE] || {}).length.should.equal(0);
        // HmIP-RF carries its own 600 s timeout; the test's clock is 2 s
        nc.ifaceTypes[IFACE].pingTimeout = 2;
        nc.rpcCheckInit(IFACE);
        // the watchdog (every pingTimeout/4 = 0.5 s) pings after pingTimeout/2 = 1 s without an event
        (await until(() => hmip.pings >= 1, 3000)).should.be.true();
        (await until(() => nc.lastRealEvent[IFACE] > 0, 1000)).should.be.true();
        await wait(2500);
        hmip.inits.length.should.equal(1);
        // the process restarts and forgets us: pings answered, no PONG - the watchdog re-initialises
        hmip.pong = false;
        (await until(() => hmip.inits.length === 2, 6000)).should.be.true();
    });

    it('an interface without devices that never delivered an event is not re-initialised by the watchdog', async () => {
        hmip = null;
        removeCache();
        hmip = fakeHmipServer();
        hmip.list = [];
        hmip.pong = false;
        await load([nodeConnection], flow('2'));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus[IFACE] && hmip.inits.length === 1, 5000)).should.be.true();
        await wait(200);
        nc.ifaceTypes[IFACE].pingTimeout = 2;
        nc.rpcCheckInit(IFACE);
        (await until(() => hmip.pings >= 1, 3000)).should.be.true();
        await wait(3500);
        hmip.inits.length.should.equal(1);
    });
});
