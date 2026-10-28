/* task 15: the connection against hm-simulator 1.x on free ports, driven by its
   scenario API - what the fixed-port specs could not cover:
   - a device paired or removed while Node-RED runs reaches the device table
     (newDevices/deleteDevices), with and without the install mode;
   - a putParamset from the value node (ramp time) lands in the simulator's
     write log;
   - a service message the device reports (UNREACH) arrives as an event;
   - an interface process that restarts and forgets its clients is noticed by
     the liveness ping and subscribed again;
   - TLS and basic auth on the XML-RPC interface, with the simulator's
     self-signed certificate.
   The lab fixture's dimmer alone: every description costs 200 ms. */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim.js');
const lab = require('hm-simulator/data/fixtures/lab-2026-09.json');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeRpcEvent = require('../nodes/ccu-rpc-event.js');
const nodeRpc = require('../nodes/ccu-rpc.js');
const nodeValue = require('../nodes/ccu-value.js');
const {simPorts, userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'HmIP-RF';
const DIMMER = '00000000000006';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(userDir(), f),
);
const PARAMSETS_SCRATCH = path.join(userDir(), 'nrccu-scenario-paramsets.json');
const USER = 'Admin';
const PASSWORD = 'lab-secret';

function removeFiles() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** the fixture's HmIP-PDT with its channels, copied: the simulator changes what it is given */
function dimmer() {
    return structuredClone(lab.devices.hmip.devices.filter((d) => d.ADDRESS === DIMMER || d.PARENT === DIMMER));
}

/** a made-up HmIP-PDT that appears while Node-RED runs */
function newDimmer(address) {
    return dimmer().map((d) => ({
        ...d,
        ADDRESS: d.ADDRESS.replace(DIMMER, address),
        ...(d.PARENT ? {PARENT: address} : {CHILDREN: d.CHILDREN.map((c) => c.replace(DIMMER, address))}),
    }));
}

function flow({tls = false, authentication = false, ports = {}} = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'scenario',
            host: HOST,
            ...ports,
            tls,
            inSecure: true,
            authentication,
            username: authentication ? USER : '',
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
            rpcBinPort: '2147',
            rpcXmlPort: '2148',
        },
        {
            id: 'ne',
            type: 'ccu-rpc-event',
            name: '',
            iface: IFACE,
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
            id: 'nr',
            type: 'ccu-rpc',
            name: '',
            iface: IFACE,
            topic: '${CCU}/${Interface}/${Method}',
            method: '',
            params: '',
            ccuConfig: 'nc',
        },
        {
            id: 'nv',
            type: 'ccu-value',
            name: '',
            iface: IFACE,
            channel: DIMMER + ':3',
            datapoint: 'LEVEL',
            mode: '',
            start: false,
            change: false,
            cache: false,
            queue: false,
            on: 0,
            onType: 'undefined',
            ramp: 2.5,
            rampType: 'num',
            working: false,
            ccuConfig: 'nc',
            topic: '${CCU}/${Interface}/${channel}/${datapoint}',
            wires: [[]],
        },
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

function infos(id) {
    const {INFO} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === INFO)
        .map((l) => String(l.msg));
}

async function start({tls = false, auth = false} = {}) {
    const sim = new HmSim({
        devices: {hmip: {devices: dimmer()}},
        paramsetDescriptions: lab.paramsetDescriptions,
        behaviorPath: false,
        tls,
        ...(auth ? {auth: {username: USER, password: PASSWORD}} : {}),
        config: {listenAddress: HOST, xmlrpcListenPort: 0},
    });
    await sim.whenReady();
    await load(
        [nodeConnection, nodeRpcEvent, nodeRpc, nodeValue],
        flow({tls, authentication: auth, ports: simPorts(sim)}),
        auth ? {nc: {password: PASSWORD}} : undefined,
    );
    const nc = helper.getNode('nc');
    nc.paramsetFile = PARAMSETS_SCRATCH;
    (await until(() => nc.ifaceStatus[IFACE] === true, 8000)).should.be.true();
    (await until(() => nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE][DIMMER + ':3'], 5000)).should.be.true();
    // the paramset descriptions, fetched 200 ms apart: a write before they are there is not cast
    (await until(() => nc.paramsetQueue.length === 0 && !nc.paramsetPending, 25000)).should.be.true();
    return {sim, nc};
}

describe('the connection on hm-simulator 1.x, free ports and the scenario API (task 15)', function () {
    this.timeout(30000);
    let sim;
    let nc;

    before((done) => {
        removeFiles();
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        if (sim) {
            await sim.close();
            sim = null;
        }

        removeFiles();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a device paired while Node-RED runs reaches the device table, and a removed one leaves it', async () => {
        ({sim, nc} = await start());
        const added = '000000000000AA';
        sim.addDevice('hmip', ...newDimmer(added));
        (await until(() => nc.metadata.devices[IFACE][added + ':3'] !== undefined, 5000)).should.be.true();
        nc.metadata.devices[IFACE][added].TYPE.should.equal('HmIP-PDT');
        nc.metadata.types[IFACE]['HmIP-PDT'].should.containEql(added);

        sim.removeDevice('hmip', added);
        (await until(() => nc.metadata.devices[IFACE][added] === undefined, 5000)).should.be.true();
        should(nc.metadata.devices[IFACE][added + ':3']).be.undefined();
        nc.metadata.types[IFACE]['HmIP-PDT'].should.not.containEql(added);
    });

    it('a device scripted for the install mode appears after the rpc node opened it', async () => {
        ({sim, nc} = await start());
        const added = '000000000000AB';
        sim.scriptNewDevices('hmip', newDimmer(added), 200);
        const nr = helper.getNode('nr');
        nr.receive({method: 'setInstallMode', payload: [true, 30]});
        (await until(() => sim.getInstallMode('hmip') > 0, 3000)).should.be.true();
        (await until(() => nc.metadata.devices[IFACE][added] !== undefined, 5000)).should.be.true();
    });

    it('a ramp time makes the value node write a VALUES paramset, which the simulator applies to the channel', async () => {
        ({sim, nc} = await start());
        // the simulator's write log keeps MASTER, LINK and the rest; a VALUES write is applied to the
        // stored values instead (hm-simulator 1.4.0), so that is where it shows
        const stored = () => sim.values.hmip[DIMMER + ':3'].VALUES;
        const nv = helper.getNode('nv');
        nv.receive({payload: 0.4});
        (await until(() => stored().LEVEL === 0.4 && stored().RAMP_TIME === 2.5, 5000)).should.be.true();
        sim.getWriteLog()
            .filter((entry) => entry.paramset === 'VALUES')
            .should.deepEqual([]);
    });

    it('a service message the device reports arrives as an event', async () => {
        ({sim, nc} = await start());
        const nh = helper.getNode('nh');
        const received = [];
        nh.on('input', (message) => received.push(message));
        sim.setServiceMessage('hmip', DIMMER + ':0', 'UNREACH', true);
        (
            await until(() => received.some((m) => m.datapoint === 'UNREACH' && m.payload === true), 5000)
        ).should.be.true();
        const message = received.find((m) => m.datapoint === 'UNREACH');
        message.channel.should.equal(DIMMER + ':0');
        message.iface.should.equal(IFACE);
    });

    it('an interface process that restarts and forgets its clients is subscribed again (B-29)', async () => {
        ({sim, nc} = await start());
        const inits = () => infos('nc').filter((l) => /^init HmIP-RF /.test(l)).length;
        inits().should.equal(1);
        const nh = helper.getNode('nh');
        const received = [];
        nh.on('input', (message) => received.push(message));
        // the liveness ping at test pace: a ping every second, a PONG within half a second
        nc.ifaceTypes[IFACE].pingInterval = 1;
        nc.ifaceTypes[IFACE].pongTimeout = 0.5;
        nc.startLiveness(IFACE);
        // B-29 subscribes again only for an interface that has delivered an event since its init
        sim.fireEvent('hmip', DIMMER + ':3', 'LEVEL', 0.3);
        (await until(() => received.some((m) => m.datapoint === 'LEVEL' && m.payload === 0.3), 5000)).should.be.true();
        await sim.dropConnection('hmip');
        (await until(() => inits() >= 2, 10000)).should.be.true();
        (await until(() => nc.ifaceStatus[IFACE] === true, 5000)).should.be.true();
        // and the subscription works: an event gets through again
        sim.fireEvent('hmip', DIMMER + ':3', 'LEVEL', 0.7);
        (await until(() => received.some((m) => m.datapoint === 'LEVEL' && m.payload === 0.7), 5000)).should.be.true();
    });

    it('TLS and basic auth on the XML-RPC interface (task 5), against the self-signed certificate', async () => {
        ({sim, nc} = await start({tls: true, auth: true}));
        nc.tlsEnabled.should.equal(true);
        nc.ifaceTypes[IFACE].port.should.equal(sim.ports.hmip);
        // the connection is up and a call goes through with the credentials
        const nr = helper.getNode('nr');
        const answered = [];
        nr.on('input', () => {});
        nr.send = (message) => answered.push(message);
        nr.receive({method: 'getVersion', payload: []});
        (await until(() => answered.length > 0, 5000)).should.be.true();
        String(answered[0].payload).should.match(/\d/);
    });
});
