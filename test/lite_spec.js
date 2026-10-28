/* task 14: on an openccu-lite system the interfaces go through its lite-rpc with
   occulite-client (FakeBox stands in for the system):
   - auto: no callback server and no init of this node's own; the devices come
     from listDevices through lite-rpc, the value cache from the state store,
     an event from the stream reaches a node, a write goes to the system; the
     move is said once (the marker file), not at the next start;
   - CCU by choice: no lite-rpc client, the callback path as before;
   - without a credential the CCU way, and the log says why; the addon's own
     token file stands in for the node's token on the system itself. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const {FakeBox} = require('occulite-client/testing');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeRpcEvent = require('../nodes/ccu-rpc-event.js');
const nodeValue = require('../nodes/ccu-value.js');
const nodeRpc = require('../nodes/ccu-rpc.js');
const lite = require('../nodes/lib/lite.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const CACHE_FILES = [
    'ccu_127.0.0.1.json',
    'ccu_rega_127.0.0.1.json',
    'ccu_values_127.0.0.1.json',
    'ccu_lite_127.0.0.1.json',
].map((f) => path.join(__dirname, '..', f));
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-lite-paramsets.json');
const TOKEN = 'olt_test';

const DEVICES = {
    'HmIP-RF': [
        {
            ADDRESS: 'ABC1',
            TYPE: 'HmIP-PDT',
            FIRMWARE: '1.4.8',
            VERSION: 1,
            CHILDREN: ['ABC1:0', 'ABC1:1'],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: 'ABC1:0',
            TYPE: 'MAINTENANCE',
            PARENT: 'ABC1',
            PARENT_TYPE: 'HmIP-PDT',
            VERSION: 1,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
        {
            ADDRESS: 'ABC1:1',
            TYPE: 'SWITCH_TRANSCEIVER',
            PARENT: 'ABC1',
            PARENT_TYPE: 'HmIP-PDT',
            VERSION: 1,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ],
    'BidCos-RF': [
        {
            ADDRESS: 'LEQ1',
            TYPE: 'HM-LC-Sw1-Pl',
            FIRMWARE: '2.8',
            VERSION: 1,
            CHILDREN: ['LEQ1:1'],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: 'LEQ1:1',
            TYPE: 'SWITCH',
            PARENT: 'LEQ1',
            PARENT_TYPE: 'HM-LC-Sw1-Pl',
            VERSION: 1,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ],
};

function removeFiles() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow(port, {connectionType = 'auto'} = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'lite',
            host: HOST,
            metaPort: String(port),
            connectionType,
            regaEnabled: true,
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
            rpcBinPort: '2157',
            rpcXmlPort: '2158',
        },
        {
            id: 'ne',
            type: 'ccu-rpc-event',
            name: '',
            iface: '',
            ccuConfig: 'nc',
            rooms: '',
            roomsRx: 'str',
            functions: '',
            functionsRx: 'str',
            device: '',
            deviceRx: 'str',
            deviceName: '',
            deviceNameRx: 'str',
            deviceType: '',
            deviceTypeRx: 'str',
            channel: '',
            channelRx: 'str',
            channelName: '',
            channelNameRx: 'str',
            channelType: '',
            channelTypeRx: 'str',
            datapoint: '',
            datapointRx: 'str',
            change: false,
            working: false,
            cache: false,
            topic: '${CCU}/${Interface}/${channel}/${datapoint}',
            wires: [['nh']],
        },
        {id: 'nh', type: 'helper'},
        {
            id: 'nv',
            type: 'ccu-value',
            name: '',
            iface: 'HmIP-RF',
            channel: 'ABC1:1',
            datapoint: 'STATE',
            mode: '',
            start: false,
            change: false,
            cache: false,
            queue: false,
            on: 0,
            onType: 'undefined',
            ramp: 0,
            rampType: 'undefined',
            working: false,
            ccuConfig: 'nc',
            topic: '${CCU}/${Interface}/${channel}/${datapoint}',
            wires: [[]],
        },
        {
            id: 'nr',
            type: 'ccu-rpc',
            name: '',
            iface: 'HmIP-RF',
            topic: '${CCU}/${Interface}/${Method}',
            method: '',
            params: '',
            ccuConfig: 'nc',
            wires: [['nrh']],
        },
        {id: 'nrh', type: 'helper'},
    ];
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

function load(nodes, flowJson, credentials) {
    return new Promise((resolve) => helper.load(nodes, flowJson, credentials, resolve));
}

function lines(id, level) {
    const levels = helper.log();
    return levels.args
        .map((a) => a[0])
        .filter((l) => l && l.id === id && (level === undefined || l.level === levels[level]))
        .map((l) => String(l.msg));
}

describe('openccu-lite through lite-rpc with occulite-client (task 14)', function () {
    this.timeout(30000);
    let fake;
    let port;
    let nc;
    const addonTokenFile = lite.ADDON_TOKEN_FILE;

    before(async () => {
        removeFiles();
        fake = new FakeBox({
            token: TOKEN,
            interfaces: ['HmIP-RF', 'BidCos-RF'],
            devices: DEVICES,
            values: {'HmIP-RF.ABC1:1.STATE': {value: true}, 'HmIP-RF.ABC1:0.UNREACH': {value: false}},
            descriptions: {
                'HmIP-RF.ABC1:1': {
                    STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, ID: 'STATE', DEFAULT: false, MIN: false, MAX: true},
                },
            },
            meta: {revision: 3, objects: {'HmIP-RF.ABC1': {name: 'Lamp'}}, enums: {}},
        });
        port = new URL(await fake.start()).port;
        await new Promise((resolve) => helper.startServer(resolve));
    });

    beforeEach(() => {
        // no addon token on the workstation
        lite.ADDON_TOKEN_FILE = path.join(os.tmpdir(), 'nrccu-no-such-token');
    });

    afterEach(async () => {
        lite.ADDON_TOKEN_FILE = addonTokenFile;
        await helper.unload();
    });

    after(async () => {
        await fake.stop();
        await new Promise((resolve) => helper.stopServer(resolve));
        removeFiles();
    });

    async function start(options, credentials) {
        await load([nodeConnection, nodeRpcEvent, nodeValue, nodeRpc], flow(port, options), credentials);
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        return nc;
    }

    it('auto: the interfaces go through lite-rpc - no callback server, the devices, the cache, an event, a write', async () => {
        await start({}, {nc: {metaToken: TOKEN}});
        (
            await until(() => nc.ifaceStatus['HmIP-RF'] === true && nc.ifaceStatus['BidCos-RF'] === true, 15000)
        ).should.be.true();
        should(nc.lite).be.ok();
        nc.liteIfaces.should.deepEqual(['BidCos-RF', 'HmIP-RF']);
        Object.keys(nc.servers).should.deepEqual([]);
        should(nc.clients['HmIP-RF']).be.undefined();
        fake.streamsOpened.should.be.above(0);

        // the devices through lite-rpc
        (
            await until(() => nc.metadata.devices['HmIP-RF'] && nc.metadata.devices['HmIP-RF']['ABC1:1'], 5000)
        ).should.be.true();
        fake.calls.some((call) => call.interface === 'HmIP-RF' && call.method === 'listDevices').should.be.true();
        nc.metadata.devices['BidCos-RF']['LEQ1:1'].TYPE.should.equal('SWITCH');

        // the value cache from the state store
        (await until(() => nc.cachedValuesReceived === true, 5000)).should.be.true();
        nc.values['HmIP-RF.ABC1:1.STATE'].payload.should.equal(true);
        nc.values['HmIP-RF.ABC1:1.STATE'].cache.should.equal(true);

        // an event from the stream into a node
        const nh = helper.getNode('nh');
        const received = [];
        nh.on('input', (message) => received.push(message));
        fake.event('HmIP-RF', 'ABC1:1', 'STATE', false);
        (
            await until(() => received.some((m) => m.datapoint === 'STATE' && m.payload === false), 5000)
        ).should.be.true();
        received.find((m) => m.datapoint === 'STATE').should.have.properties({iface: 'HmIP-RF', channel: 'ABC1:1'});

        // a write to the system
        const nv = helper.getNode('nv');
        nv.receive({payload: true});
        (
            await until(
                () => fake.calls.some((call) => call.method === 'setValue' && call.params[0] === 'ABC1:1'),
                5000,
            )
        ).should.be.true();

        // the rpc node, through lite-rpc as well
        const nrh = helper.getNode('nrh');
        const answers = [];
        nrh.on('input', (message) => answers.push(message));
        helper.getNode('nr').receive({method: 'listDevices', payload: []});
        (await until(() => answers.length > 0, 5000)).should.be.true();
        answers[0].payload.map((d) => d.ADDRESS).should.containEql('ABC1:1');

        // said once: the move, and the marker that keeps it from being said again
        lines('nc', 'INFO')
            .some((l) => /go through the system's lite-rpc from now on/.test(l))
            .should.be.true();
        lines('nc', 'INFO')
            .some((l) => /^Interface HmIP-RF lite-rpc connected$/.test(l))
            .should.be.true();
        fs.existsSync(path.join(__dirname, '..', 'ccu_lite_127.0.0.1.json')).should.be.true();

        // task 25: the system has no ReGaHSS, so the list of interfaces does not name it
        lines('nc', 'INFO')
            .filter((l) => /^Interfaces: /.test(l))
            .should.deepEqual(['Interfaces: BidCos-RF, HmIP-RF']);
        lines('nc', 'INFO')
            .some((l) => /^this system has no ReGaHSS/.test(l))
            .should.be.true();
        nc.enabledIfaces.should.deepEqual(['BidCos-RF', 'HmIP-RF']);

        // task 24: the device lists of both interfaces (listDevices and the stream's snapshot as
        // newDevices) are one write of the metadata file, not one per interface and path
        (await until(() => lines('nc', 'INFO').some((l) => /^metadata saved to/.test(l)), 5000)).should.be.true();
        await wait(1200);
        lines('nc', 'INFO')
            .filter((l) => /^metadata saved to/.test(l))
            .length.should.equal(1);
    });

    it('the next start does not say "moved" again and saves no metadata; a restart of the stream is followed', async () => {
        await start({}, {nc: {metaToken: TOKEN}});
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true, 15000)).should.be.true();
        lines('nc', 'INFO')
            .some((l) => /from now on, the default on openccu-lite - moved once/.test(l))
            .should.be.false();
        // task 24: the snapshot's newDevices carries the devices the cache already has - no write
        (
            await until(() => nc.metadata.devices['HmIP-RF'] && nc.metadata.devices['BidCos-RF']['LEQ1:1'], 5000)
        ).should.be.true();
        await wait(1500);
        lines('nc', 'INFO')
            .some((l) => /^metadata saved to/.test(l))
            .should.be.false();
        const opened = fake.streamsOpened;
        fake.dropStreams();
        (await until(() => fake.streamsOpened > opened, 10000)).should.be.true();
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true, 10000)).should.be.true();
    });

    it('CCU by choice: no lite-rpc client, the callback path, and the choice is never moved', async () => {
        const opened = fake.streamsOpened;
        await start({connectionType: 'ccu'}, {nc: {metaToken: TOKEN}});
        (await until(() => nc.metaMode === true, 10000)).should.be.true();
        await wait(500);
        should(nc.lite).be.null();
        nc.liteIfaces.should.deepEqual([]);
        fake.streamsOpened.should.equal(opened);
        lines('nc', 'INFO')
            .some((l) => /direct connection with callbacks by choice/.test(l))
            .should.be.true();
        // the callback server of the CCU path was asked for
        (await until(() => Object.keys(nc.servers).length > 0, 5000)).should.be.true();
    });

    it('auto without a credential: the CCU way, and the log says why', async () => {
        const opened = fake.streamsOpened;
        await start({}, undefined);
        // without a credential the metadata snapshot is refused and startMeta() waits its 5 s
        (
            await until(() => lines('nc', 'INFO').some((l) => /without a credential for lite-rpc/.test(l)), 15000)
        ).should.be.true();
        should(nc.lite).be.null();
        fake.streamsOpened.should.equal(opened);
    });

    it("the addon's own token file stands in for the node's token on the system itself", async () => {
        lite.ADDON_TOKEN_FILE = path.join(os.tmpdir(), 'nrccu-lite-addon-token-' + process.pid);
        fs.writeFileSync(lite.ADDON_TOKEN_FILE, TOKEN + '\n');
        try {
            await start({}, undefined);
            (await until(() => nc.ifaceStatus['HmIP-RF'] === true, 15000)).should.be.true();
            should(nc.lite).be.ok();
        } finally {
            fs.unlinkSync(lite.ADDON_TOKEN_FILE);
        }
    });

    it('B-41: a FLOAT goes to lite-rpc as {double}, in setValue, putParamset and a multicall', async () => {
        await start({}, {nc: {metaToken: TOKEN}});
        (await until(() => nc.ifaceStatus['HmIP-RF'] === true, 15000)).should.be.true();
        const before = fake.calls.length;
        await nc.methodCall('HmIP-RF', 'setValue', ['ABC1:1', 'LEVEL', {explicitDouble: 0.85}]);
        await nc.methodCall('HmIP-RF', 'setValue', ['ABC1:1', 'LEVEL', {explicitDouble: 1}]);
        await nc.methodCall('HmIP-RF', 'putParamset', ['ABC1:1', 'VALUES', {LEVEL: {explicitDouble: 0}, COLOR: 0}]);
        await nc
            .methodCall(
                'HmIP-RF',
                'system.multicall',
                [[{methodName: 'setValue', params: ['ABC1:1', 'LEVEL', {explicitDouble: 0.5}]}]],
                {quiet: true},
            )
            .catch(() => {}); // the fake knows no multicall; what went out is what counts
        const sent = fake.calls.slice(before).map((call) => [call.method, call.params]);
        sent.should.deepEqual([
            ['setValue', ['ABC1:1', 'LEVEL', {double: 0.85}]],
            ['setValue', ['ABC1:1', 'LEVEL', {double: 1}]],
            ['putParamset', ['ABC1:1', 'VALUES', {LEVEL: {double: 0}, COLOR: 0}]],
            ['system.multicall', [[{methodName: 'setValue', params: ['ABC1:1', 'LEVEL', {double: 0.5}]}]]],
        ]);
        JSON.stringify(sent).should.not.match(/explicitDouble/);
    });

    it('errors: a fault keeps its code, a scope the token lacks is said as such', () => {
        const fault = lite.translateError(
            Object.assign(new Error('Invalid device'), {
                kind: 'rpc-fault',
                faultCode: -2,
                faultString: 'Invalid device',
            }),
        );
        fault.faultCode.should.equal(-2);
        fault.faultString.should.equal('Invalid device');
        const refused = lite.translateError(
            Object.assign(new Error('forbidden'), {kind: 'forbidden', scope: 'rpc:admin'}),
        );
        refused.message.should.match(/needs rpc:admin/);
        lite.translateError(Object.assign(new Error('x'), {kind: 'timeout'})).kind.should.equal('timeout');
        lite.translateError('boom').message.should.equal('boom');
        should(lite.readAddonToken(path.join(os.tmpdir(), 'nrccu-none'))).be.undefined();
    });
});
