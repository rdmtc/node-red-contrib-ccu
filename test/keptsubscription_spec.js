/* B-37: hmipserver keeps a subscriber's registration over its own restart. It calls
   listDevices and newDevices on the kept entry and answers its pings - the PONG arrives,
   so neither the liveness ping (B-29) nor the 600 s watchdog fires - but it delivers no
   event to the kept entry until a fresh init (openccu-lite B-286, measured on a lab
   system). The connection now inits again as soon as the process calls listDevices or
   newDevices outside its own init. A fake hmipserver models the mute kept entry; a second
   test drives hm-simulator's restart that keeps its clients. */

const fs = require('fs');
const os = require('os');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');
const HmSim = require('hm-simulator/sim');

const nodeConnection = require('../nodes/ccu-connection.js');
const {hmSimOptions} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IPRF_PORT = 2010;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-kept-paramsets.json');

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
        name: 'kept',
        host: HOST,
        regaEnabled: false,
        bcrfEnabled: false,
        iprfEnabled: true,
        virtEnabled: false,
        bcwiEnabled: false,
        cuxdEnabled: false,
        regaPoll: false,
        regaInterval: '30',
        rpcPingTimeout: '60',
        rpcInitAddress: HOST,
        rpcServerHost: HOST,
        rpcBinPort: '2097',
        rpcXmlPort: '2098',
    },
];

/**
 * A fake hmipserver on 2010 as measured: `restart()` keeps the registration and calls
 * listDevices and newDevices on it; from then on ping is answered and the PONG delivered,
 * but no other event, until the next init.
 */
function fakeHmipServer() {
    const state = {inits: [], pings: 0, mute: false, callback: null, id: null};
    const server = xmlrpc.createServer({host: HOST, port: IPRF_PORT});

    const send = (method, params) =>
        new Promise((resolve) => {
            if (!state.callback) {
                resolve(false);
                return;
            }

            const url = new URL(state.callback);
            const client = xmlrpc.createClient({host: url.hostname, port: Number(url.port), path: '/'});
            client.methodCall(method, params, (err, res) => resolve(err ? false : res));
        });

    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        state.inits.push({url, id});
        if (id) {
            state.callback = url;
            state.id = id;
            state.mute = false;
        }

        callback(null, '');
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('ping', (err, params, callback) => {
        state.pings += 1;
        callback(null, true);
        send('event', [state.id, 'CENTRAL:0', 'PONG', params[0]]);
    });

    state.restart = async () => {
        state.mute = true;
        await send('listDevices', [state.id]);
        await send('newDevices', [
            state.id,
            [{ADDRESS: 'B37TEST0001', TYPE: 'HmIP-B37', VERSION: 1, PARAMSETS: ['MASTER']}],
        ]);
    };

    state.sendEvent = async (address, datapoint, value) =>
        state.mute ? false : send('event', [state.id, address, datapoint, value]);
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

function lines(id, level) {
    const wanted = helper.log()[level];
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === wanted)
        .map((l) => l.msg);
}

const KEPT = 'outside our init - the interface process restarted and kept the subscription, subscribing afresh';

/** the events (PONGs left out) that reach the connection node */
function recordEvents(nc) {
    const seen = [];
    const original = nc.publishEvent.bind(nc);
    nc.publishEvent = (parameters, ...rest) => {
        if (parameters[2] !== 'PONG') {
            seen.push(parameters.slice(1));
        }

        return original(parameters, ...rest);
    };

    return seen;
}

describe('HmIP-RF: a restart that kept the subscription (B-37)', function () {
    this.timeout(30000);
    let hmip;
    let nc;

    beforeEach(async () => {
        removeCache();
        fs.writeFileSync(
            CACHE_FILES[0],
            JSON.stringify({
                devices: {'HmIP-RF': {B37CACHED01: {ADDRESS: 'B37CACHED01', TYPE: 'HmIP-B37', PARAMSETS: []}}},
                types: {},
            }),
        );
        await new Promise((resolve) => helper.startServer(resolve));
        hmip = fakeHmipServer();
        await load([nodeConnection], flow);
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus['HmIP-RF'] && hmip.inits.length === 1, 5000)).should.be.true();
        // the test's clock: listDevices/newDevices later than 0.5 s after our init are the process's own
        nc.initGrace = 500;
    });

    afterEach(async () => {
        await helper.unload();
        await hmip.close();
        await new Promise((resolve) => helper.stopServer(resolve));
        removeCache();
    });

    it('listDevices and newDevices right after our own init do not init again', async () => {
        nc.initGrace = 10000;
        await hmip.restart();
        await wait(500);
        hmip.inits.length.should.equal(1);
        lines('nc', 'INFO')
            .filter((l) => String(l).includes(KEPT))
            .should.deepEqual([]);
    });

    it('the restart is answered with one fresh init at once, and events flow again', async () => {
        const events = recordEvents(nc);
        await wait(600);
        const at = Date.now();
        await hmip.restart();
        (await until(() => hmip.inits.length === 2, 2000)).should.be.true();
        (Date.now() - at).should.be.below(1500);
        hmip.inits[1].id.should.equal(hmip.inits[0].id);
        hmip.inits[1].url.should.equal(hmip.inits[0].url);
        await until(() => !hmip.mute, 1000);
        await hmip.sendEvent('B37CACHED01:1', 'STATE', false);
        (await until(() => events.length === 1, 2000)).should.be.true();
        events.should.deepEqual([['B37CACHED01:1', 'STATE', false]]);
        // one restart, one fresh init: newDevices after listDevices does not start a second one
        await wait(300);
        hmip.inits.length.should.equal(2);
        lines('nc', 'INFO').should.containEql('HmIP-RF: listDevices ' + KEPT);
        lines('nc', 'WARN').should.deepEqual([]);
        nc.ifaceStatus['HmIP-RF'].should.be.true();
    });

    it('without the fresh init the kept entry stays mute while the PONGs keep the liveness ping content', async () => {
        // the behaviour before B-37, to show what the model does
        nc.keptSubscription = () => false;
        nc.ifaceTypes['HmIP-RF'].pingInterval = 1;
        nc.ifaceTypes['HmIP-RF'].pongTimeout = 0.5;
        nc.startLiveness('HmIP-RF');
        const events = recordEvents(nc);
        await wait(600);
        await hmip.restart();
        const pings = hmip.pings;
        for (let i = 0; i < 6; i++) {
            await hmip.sendEvent('B37CACHED01:1', 'STATE', i % 2 === 0);
            await wait(500);
        }

        hmip.pings.should.be.above(pings);
        hmip.inits.length.should.equal(1);
        events.should.deepEqual([]);
    });

    it('a newDevices alone (a device paired later) costs one init the same way', async () => {
        await wait(600);
        hmip.mute = true;
        // newDevices without listDevices before it
        const url = new URL(hmip.callback);
        const client = xmlrpc.createClient({host: url.hostname, port: Number(url.port), path: '/'});
        await new Promise((resolve) =>
            client.methodCall(
                'newDevices',
                [hmip.id, [{ADDRESS: 'B37TEST0002', TYPE: 'HmIP-B37', VERSION: 1, PARAMSETS: ['MASTER']}]],
                resolve,
            ),
        );
        (await until(() => hmip.inits.length === 2, 2000)).should.be.true();
        lines('nc', 'INFO').should.containEql('HmIP-RF: newDevices ' + KEPT);
    });

    it('no fresh init while the connection closes', async () => {
        await wait(600);
        nc.closing = true;
        await hmip.restart();
        await wait(300);
        hmip.inits.length.should.equal(1);
        nc.closing = false;
    });
});

describe('HmIP-RF: hm-simulator restarts and keeps its clients (B-37)', function () {
    this.timeout(30000);
    let sim;
    let nc;

    before(async () => {
        removeCache();
        sim = new HmSim({...hmSimOptions(), rega: undefined, behaviorPath: false});
        await sim.whenReady();
    });

    after(async () => {
        await sim.close();
        removeCache();
    });

    beforeEach(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
        await load([nodeConnection], flow);
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true, 5000)).should.be.true();
        nc.initGrace = 500;
    });

    afterEach(async () => {
        await helper.unload();
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    it('its listDevices after the restart brings a fresh init within a second', async () => {
        const inits = () => lines('nc', 'INFO').filter((l) => /^init HmIP-RF /.test(String(l))).length;
        (await until(() => inits() === 1, 2000)).should.be.true();
        await wait(600);
        const at = Date.now();
        await sim.restartInterface('hmip', {downMs: 200, forgetClients: false});
        (await until(() => inits() === 2, 3000)).should.be.true();
        (Date.now() - at).should.be.below(2000);
        lines('nc', 'INFO').should.containEql('HmIP-RF: listDevices ' + KEPT);
        await wait(500);
        inits().should.equal(2);
    });
});
