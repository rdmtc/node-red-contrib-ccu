/* B-29: hmipserver forgets its clients when it restarts and does not tell
   them - init had succeeded, nothing fails, the events simply stop until the
   600 s silence timeout. The connection now pings HmIP-RF after `pingInterval`
   seconds without an event and calls init again when no event (the PONG)
   arrives within `pongTimeout` seconds. A fake hmipserver stands in; the
   intervals are shortened on the node for the test. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IPRF_PORT = 2010;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-liveness-paramsets.json');

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
        name: 'liveness',
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
        rpcBinPort: '2087',
        rpcXmlPort: '2088',
    },
];

/**
 * A fake hmipserver on 2010: remembers every init (url, id), answers ping
 * and - while `subscribed` - sends the PONG event to the last callback. A
 * restart is `forget()`: ping still answers, no PONG is sent (the client is
 * gone from its handler list), until the next init.
 */
function fakeHmipServer() {
    const state = {inits: [], pings: 0, subscribed: false, callback: null, id: null};
    const server = xmlrpc.createServer({host: HOST, port: IPRF_PORT});

    const send = (method, params) =>
        new Promise((resolve) => {
            if (!state.callback) {
                resolve(false);
                return;
            }

            const url = new URL(state.callback);
            const client = xmlrpc.createClient({host: url.hostname, port: Number(url.port), path: '/'});
            client.methodCall(method, params, () => resolve(true));
        });

    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        state.inits.push({url, id});
        if (id) {
            state.callback = url;
            state.id = id;
            state.subscribed = true;
        } else {
            state.subscribed = false;
        }

        callback(null, '');
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('ping', (err, params, callback) => {
        state.pings += 1;
        callback(null, true);
        if (state.subscribed) {
            send('event', [state.id, 'CENTRAL:0', 'PONG', params[0]]);
        }
    });

    state.forget = () => {
        state.subscribed = false;
    };

    state.sendEvent = (address, datapoint, value) => send('event', [state.id, address, datapoint, value]);
    state.sendNewDevices = () =>
        send('newDevices', [state.id, [{ADDRESS: 'B29TEST0001', TYPE: 'HmIP-B29', VERSION: 1, PARAMSETS: ['MASTER']}]]);
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

describe('HmIP-RF liveness ping (B-29)', function () {
    this.timeout(30000);
    let hmip;
    let nc;

    beforeEach(async () => {
        removeCache();
        // a cached device: the 600 s watchdog needs one, the liveness ping does not
        fs.writeFileSync(
            CACHE_FILES[0],
            JSON.stringify({
                devices: {'HmIP-RF': {B29CACHED01: {ADDRESS: 'B29CACHED01', TYPE: 'HmIP-B29', PARAMSETS: []}}},
                types: {},
            }),
        );
        await new Promise((resolve) => helper.startServer(resolve));
        hmip = fakeHmipServer();
        await load([nodeConnection], flow);
        nc = helper.getNode('nc');
        // fetched paramset descriptions would be saved into the repository's paramsets.json (the
        // test helper has no userDir) - a scratch file instead, removed with the cache
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus['HmIP-RF'] && hmip.inits.length === 1, 5000)).should.be.true();
        // the test's clock: a ping after 1 s without an event, the PONG expected within 0.5 s
        nc.ifaceTypes['HmIP-RF'].pingInterval = 1;
        nc.ifaceTypes['HmIP-RF'].pongTimeout = 0.5;
        nc.startLiveness('HmIP-RF');
    });

    afterEach(async () => {
        await helper.unload();
        await hmip.close();
        await new Promise((resolve) => helper.stopServer(resolve));
        removeCache();
    });

    it('pings after the interval without an event, the PONG keeps the subscription, no second init', async () => {
        (await until(() => hmip.pings >= 1, 2500)).should.be.true();
        (await until(() => nc.lastRealEvent['HmIP-RF'] > 0, 1000)).should.be.true();
        await wait(1500);
        hmip.pings.should.be.aboveOrEqual(2);
        hmip.inits.length.should.equal(1);
        nc.ifaceStatus['HmIP-RF'].should.be.true();
        lines('nc', 'WARN').should.deepEqual([]);
    });

    it('no ping while events arrive', async () => {
        (await until(() => hmip.pings >= 1, 2500)).should.be.true();
        const before = hmip.pings;
        for (let i = 0; i < 8; i++) {
            await hmip.sendEvent('B29CACHED01:1', 'STATE', i % 2 === 0);
            await wait(300);
        }

        hmip.pings.should.equal(before);
    });

    it('a restart (ping answered, no PONG) is noticed within the pong timeout and init is called again', async () => {
        (await until(() => nc.lastRealEvent['HmIP-RF'] > 0, 2500)).should.be.true();
        hmip.forget();
        const lost = Date.now();
        (await until(() => hmip.inits.length === 2, 4000)).should.be.true();
        (Date.now() - lost).should.be.below(3000);
        hmip.inits[1].id.should.match(/^nr_[\dA-Za-z]{6}_HmIP-RF$/);
        lines('nc', 'WARN').should.containEql('HmIP-RF: no answer to a ping within 0.5 s - subscribing again');
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true && !nc.ifaceWaiting['HmIP-RF'], 3000)).should.be.true();
        lines('nc', 'INFO').should.containEql('HmIP-RF subscribed again');
        // and the PONGs flow again
        const pings = hmip.pings;
        (await until(() => hmip.pings > pings && nc.lastRealEvent['HmIP-RF'] > lost, 3000)).should.be.true();
        hmip.inits.length.should.equal(2);
    });

    it('a device callback while no PONG is awaited triggers the ping at once', async () => {
        (await until(() => nc.lastRealEvent['HmIP-RF'] > 0, 2500)).should.be.true();
        // wait until the current cycle is over and a fresh interval runs
        await until(() => !nc.liveness['HmIP-RF'].pongTimer, 1000);
        const before = hmip.pings;
        const at = Date.now();
        await hmip.sendNewDevices();
        (await until(() => hmip.pings > before, 800)).should.be.true();
        (Date.now() - at).should.be.below(700);
    });

    it('without any event since init a missing PONG does not re-subscribe', async () => {
        hmip.forget();
        nc.lastRealEvent['HmIP-RF'] = 0;
        nc.startLiveness('HmIP-RF');
        await wait(2500);
        hmip.pings.should.be.aboveOrEqual(1);
        hmip.inits.length.should.equal(1);
        lines('nc', 'WARN').should.deepEqual([]);
    });

    it('a ping the process does not answer at all leads to init, the retry, and connected once it is back', async () => {
        (await until(() => nc.lastRealEvent['HmIP-RF'] > 0, 2500)).should.be.true();
        await hmip.close();
        (await until(() => nc.ifaceWaiting['HmIP-RF'] === true, 4000)).should.be.true();
        should(nc.ifaceStatus['HmIP-RF']).be.false();
        hmip = fakeHmipServer();
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true && hmip.inits.length >= 1, 6000)).should.be.true();
        (await until(() => hmip.pings >= 1, 2500)).should.be.true();
    });

    it('unload stops the liveness timers', async () => {
        await helper.unload();
        Object.keys(nc.liveness).should.deepEqual([]);
    });
});
