/* task 11: a failed init is retried with backoff (2 s first), with and without
   cached devices and for an interface without ping; the interface shows
   "waiting" meanwhile, no error line is logged for a refused connection, and
   close stops the retry. Fake interface processes that appear late. */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeRpc = require('../nodes/ccu-rpc.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow({bcrf = false, iprf = false, virt = false} = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'retry',
            host: HOST,
            regaEnabled: false,
            bcrfEnabled: bcrf,
            bcrfBinRpc: true,
            iprfEnabled: iprf,
            virtEnabled: virt,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            rpcBinPort: '2057',
            rpcXmlPort: '2058',
        },
        {
            id: 'nip',
            type: 'ccu-rpc',
            name: '',
            iface: 'HmIP-RF',
            topic: '',
            method: '',
            params: '',
            ccuConfig: 'nc',
        },
    ];
}

/** a fake interface process; `fault` makes init answer with a fault */
function fakeServer(protocol, port, {fault = false} = {}) {
    const calls = [];
    const rpc = protocol === 'binrpc' ? binrpc : xmlrpc;
    const server = rpc.createServer({host: HOST, port});
    server.on('init', (err, params, callback) => {
        calls.push(['init', params]);
        if (fault) {
            callback({faultCode: -1, faultString: 'Failure'});
        } else {
            callback(null, '');
        }
    });
    server.on('getLinks', (err, params, callback) => {
        calls.push(['getLinks', params]);
        callback(null, []);
    });
    server.on('ping', (err, params, callback) => callback(null, true));
    server.on('NotFound', (method) => calls.push([method]));
    return {
        calls,
        inits: () => calls.filter((c) => c[0] === 'init' && c[1] && c[1][1]).length,
        close: () => server.close(),
    };
}

function levels(id) {
    const {ERROR, WARN, INFO} = helper.log();
    const lines = helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id);
    return {
        errors: lines.filter((l) => l.level === ERROR).map((l) => l.msg),
        warns: lines.filter((l) => l.level === WARN).map((l) => l.msg),
        infos: lines.filter((l) => l.level === INFO).map((l) => l.msg),
    };
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

describe('init retry (task 11)', function () {
    this.timeout(20000);
    let servers = [];

    before((done) => {
        removeCache();
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        await Promise.all(servers.map((s) => s.close()));
        servers = [];
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('connects within one backoff step after the processes appear, without cached devices', async () => {
        await load([nodeConnection, nodeRpc], flow({bcrf: true, iprf: true, virt: true}));
        const nc = helper.getNode('nc');
        const nip = helper.getNode('nip');

        (await until(() => nc.ifaceWaiting['HmIP-RF'] && nc.ifaceWaiting['VirtualDevices'], 1500)).should.be.true();
        nip.currentStatus.should.equal('waiting');
        should(nc.ifaceStatus['HmIP-RF']).be.false();
        Object.keys(nc.metadata.devices).length.should.equal(0);

        const started = Date.now();
        servers = [fakeServer('binrpc', 2001), fakeServer('http', 2010), fakeServer('http', 9292)];

        (
            await until(
                () => nc.ifaceStatus['HmIP-RF'] && nc.ifaceStatus['BidCos-RF'] && nc.ifaceStatus.VirtualDevices,
                4000,
            )
        ).should.be.true();
        (Date.now() - started).should.be.below(3000);
        nip.currentStatus.should.equal('green');
        nc.ifaceWaiting.should.deepEqual({});

        const log = levels('nc');
        log.errors.should.deepEqual([]);
        log.warns.filter((m) => m.includes('not reachable yet')).length.should.equal(3);
        log.warns.should.containEql('HmIP-RF not reachable yet (connect ECONNREFUSED), retrying');
        log.infos.should.containEql('HmIP-RF connected after 2 attempts');
        log.infos.should.containEql('VirtualDevices connected after 2 attempts');
        servers.forEach((s) => s.inits().should.equal(1));
    });

    it('retries with cached devices after 2 s, not after the ping timeout', async () => {
        fs.writeFileSync(
            CACHE_FILES[0],
            JSON.stringify({
                devices: {'HmIP-RF': {'0000000000TEST': {ADDRESS: '0000000000TEST', TYPE: 'HmIP-TEST'}}},
                types: {},
            }),
        );
        await load([nodeConnection, nodeRpc], flow({iprf: true}));
        const nc = helper.getNode('nc');
        (await until(() => nc.ifaceWaiting['HmIP-RF'], 1500)).should.be.true();
        servers = [fakeServer('http', 2010)];
        (await until(() => nc.ifaceStatus['HmIP-RF'], 3000)).should.be.true();
        levels('nc').errors.should.deepEqual([]);
    });

    it('close stops the retry: no timer, no client, no later init', async () => {
        await load([nodeConnection, nodeRpc], flow({bcrf: true, iprf: true}));
        const nc = helper.getNode('nc');
        (await until(() => nc.ifaceWaiting['HmIP-RF'] && nc.ifaceWaiting['BidCos-RF'], 1500)).should.be.true();
        const retries = Object.values(nc.initRetry);
        retries.length.should.equal(2);
        retries.forEach((r) => r.pending.should.be.true());

        await helper.unload();
        retries.forEach((r) => r.pending.should.be.false());
        Object.keys(nc.initRetry).length.should.equal(0);
        Object.keys(nc.clients).length.should.equal(0);

        servers = [fakeServer('binrpc', 2001), fakeServer('http', 2010)];
        await wait(3000);
        servers.forEach((s) => s.calls.length.should.equal(0));
        Object.keys(nc.clients).length.should.equal(0);
        levels('nc').errors.should.deepEqual([]);
    });

    it('a fault answer is still an error, and the init is retried', async () => {
        servers = [fakeServer('http', 2010, {fault: true})];
        await load([nodeConnection, nodeRpc], flow({iprf: true}));
        const nc = helper.getNode('nc');
        const nip = helper.getNode('nip');
        (await until(() => servers[0].calls.length >= 2, 3500)).should.be.true();
        const log = levels('nc');
        log.errors.should.deepEqual(['init HmIP-RF failed: fault -1 Failure, retrying in 2 s']);
        should(nc.ifaceWaiting['HmIP-RF']).be.undefined();
        nip.currentStatus.should.equal('red');
    });
});
