/* task 32: system variables and programs on openccu-lite, from the Logic addon's interface through
   lite-rpc (FakeBox stands in for the system):
   - the interface is followed without a checkbox; the variables and programs are found by their
     metadata names, the editor lists them, a node with "emit value on start" gets the value;
   - a write is setValue of VALUE (cast: a list entry by its text, a FLOAT as a double), an event
     reaches the node (with "changed values only": a change, not a write of the same value);
   - a program: true/false -> ACTIVE, anything else -> RUN_THEN (the CCU's ProgramExecute), an
     event of LAST_RUN is a run;
   - a rename is followed;
   - without the addon the nodes say so, a write is refused with the reason; the addon installed
     while running is taken. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const {FakeBox} = require('occulite-client/testing');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeSysvar = require('../nodes/ccu-sysvar.js');
const nodeProgram = require('../nodes/ccu-program.js');
const nodePoll = require('../nodes/ccu-poll.js');
const lite = require('../nodes/lib/lite.js');
const {userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const CACHE_FILES = [
    'ccu_127.0.0.1.json',
    'ccu_rega_127.0.0.1.json',
    'ccu_values_127.0.0.1.json',
    'ccu_lite_127.0.0.1.json',
].map((f) => path.join(userDir(), f));
const PARAMSETS_SCRATCH = path.join(userDir(), 'nrccu-logic-paramsets.json');
const TOKEN = 'olt_logic';

function logicDevice(prefix, key, type) {
    const address = prefix + '-' + key;
    return [
        {
            ADDRESS: address,
            TYPE: type,
            FIRMWARE: 'f' + key,
            VERSION: 1,
            CHILDREN: [address + ':0', address + ':1'],
            PARAMSETS: ['MASTER'],
        },
        {ADDRESS: address + ':0', TYPE: 'MAINTENANCE', PARENT: address, PARENT_TYPE: type, VERSION: 1, PARAMSETS: []},
        {
            ADDRESS: address + ':1',
            TYPE: type === 'LOGIC-VARIABLE' ? 'LOGIC_VARIABLE' : 'LOGIC_PROGRAM',
            PARENT: address,
            PARENT_TYPE: type,
            VERSION: 1,
            PARAMSETS: ['VALUES'],
        },
    ];
}

const LOGIC_DEVICES = [
    ...logicDevice('var', 'regen', 'LOGIC-VARIABLE'),
    ...logicDevice('var', 'modus', 'LOGIC-VARIABLE'),
    ...logicDevice('var', 'solltemp', 'LOGIC-VARIABLE'),
    ...logicDevice('prg', 'markise', 'LOGIC-PROGRAM'),
];

const LOGIC_DESCRIPTIONS = {
    'Logic.var-regen:1': {VALUE: {TYPE: 'BOOL', OPERATIONS: 7, ID: 'VALUE', VALUE_LIST: ['trocken', 'regnet']}},
    'Logic.var-modus:1': {
        VALUE: {TYPE: 'ENUM', OPERATIONS: 7, ID: 'VALUE', MIN: 0, MAX: 2, VALUE_LIST: ['aus', 'tag', 'nacht']},
    },
    'Logic.var-solltemp:1': {VALUE: {TYPE: 'FLOAT', OPERATIONS: 7, ID: 'VALUE', MIN: 5, MAX: 30, UNIT: '°C'}},
    'Logic.prg-markise:1': {
        ACTIVE: {TYPE: 'BOOL', OPERATIONS: 7, ID: 'ACTIVE'},
        RUN: {TYPE: 'ACTION', OPERATIONS: 2, ID: 'RUN'},
        RUN_THEN: {TYPE: 'ACTION', OPERATIONS: 2, ID: 'RUN_THEN'},
        LAST_RUN: {TYPE: 'INTEGER', OPERATIONS: 5, ID: 'LAST_RUN'},
    },
};

const LOGIC_VALUES = {
    'Logic.var-regen:1.VALUE': {value: false},
    'Logic.var-modus:1.VALUE': {value: 1},
    'Logic.var-solltemp:1.VALUE': {value: 21.5},
    'Logic.prg-markise:1.ACTIVE': {value: true},
    'Logic.prg-markise:1.LAST_RUN': {value: 1, ts: '2026-11-25T10:00:00Z'},
};

const LOGIC_NAMES = {
    'Logic.var-regen': {name: 'Regen'},
    'Logic.var-regen:1': {name: 'Regen'},
    'Logic.var-modus:1': {name: 'Modus'},
    'Logic.var-solltemp:1': {name: 'Solltemperatur'},
    'Logic.prg-markise:1': {name: 'Markise bei Regen'},
};

const HMIP_DEVICES = [
    {ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1, CHILDREN: ['ABC1:1'], PARAMSETS: ['MASTER']},
    {
        ADDRESS: 'ABC1:1',
        TYPE: 'SWITCH_TRANSCEIVER',
        PARENT: 'ABC1',
        PARENT_TYPE: 'HmIP-PDT',
        VERSION: 1,
        PARAMSETS: ['MASTER', 'VALUES'],
    },
];

function removeFiles() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow(port) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'lite',
            host: HOST,
            metaPort: String(port),
            connectionType: 'auto',
            regaEnabled: true,
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
            rpcBinPort: '2167',
            rpcXmlPort: '2168',
        },
        {
            id: 'sv',
            type: 'ccu-sysvar',
            name: 'Regen',
            ccuConfig: 'nc',
            topic: 'ReGaHSS/${Name}',
            change: false,
            cache: true,
            wires: [['svh']],
        },
        {id: 'svh', type: 'helper'},
        {
            id: 'svc',
            type: 'ccu-sysvar',
            name: 'Regen',
            ccuConfig: 'nc',
            topic: '',
            change: true,
            cache: false,
            wires: [['svch']],
        },
        {id: 'svch', type: 'helper'},
        {id: 'sm', type: 'ccu-sysvar', name: 'Modus', ccuConfig: 'nc', change: false, cache: false, wires: [[]]},
        {
            id: 'st',
            type: 'ccu-sysvar',
            name: 'Solltemperatur',
            ccuConfig: 'nc',
            change: false,
            cache: false,
            wires: [[]],
        },
        {id: 'pg', type: 'ccu-program', name: 'Markise bei Regen', ccuConfig: 'nc', topic: '', wires: [['pgh']]},
        {id: 'pgh', type: 'helper'},
        {id: 'pl', type: 'ccu-poll', ccuConfig: 'nc', wires: []},
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

function collect(id) {
    const received = [];
    helper.getNode(id).on('input', (message) => received.push(message));
    return received;
}

function lastStatus(node) {
    return node.__status;
}

function watchStatus(id) {
    const node = helper.getNode(id);
    const status = node.status.bind(node);
    node.status = (s) => {
        node.__status = s;
        status(s);
    };
    return node;
}

function receive(node, message) {
    return new Promise((resolve) => {
        node.receive(message);
        setTimeout(resolve, 50);
    });
}

function setValueCalls(fake, address, datapoint) {
    return fake.calls.filter(
        (call) =>
            call.interface === 'Logic' &&
            call.method === 'setValue' &&
            call.params[0] === address &&
            call.params[1] === datapoint,
    );
}

describe('openccu-lite: sysvar and program nodes on the Logic addon (task 32)', function () {
    this.timeout(30000);
    const addonTokenFile = lite.ADDON_TOKEN_FILE;
    let fake;
    let port;

    async function startFake(withLogic) {
        removeFiles();
        fake = new FakeBox({
            token: TOKEN,
            interfaces: withLogic ? ['HmIP-RF', 'Logic'] : ['HmIP-RF'],
            devices: withLogic ? {'HmIP-RF': HMIP_DEVICES, Logic: LOGIC_DEVICES} : {'HmIP-RF': HMIP_DEVICES},
            values: withLogic ? {...LOGIC_VALUES} : {},
            descriptions: LOGIC_DESCRIPTIONS,
            meta: {revision: 3, objects: {'HmIP-RF.ABC1': {name: 'Lamp'}, ...LOGIC_NAMES}, enums: {}},
        });
        port = new URL(await fake.start()).port;
    }

    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    beforeEach(() => {
        lite.ADDON_TOKEN_FILE = path.join(os.tmpdir(), 'nrccu-no-such-token');
    });

    afterEach(async () => {
        lite.ADDON_TOKEN_FILE = addonTokenFile;
        await helper.unload();
        if (fake) {
            await fake.stop();
            fake = null;
        }

        removeFiles();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    async function start() {
        const received = {};
        await load([nodeConnection, nodeSysvar, nodeProgram, nodePoll], flow(port), {nc: {metaToken: TOKEN}});
        const nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        received.sv = collect('svh');
        received.svc = collect('svch');
        received.pg = collect('pgh');
        return {nc, received};
    }

    it('the interface without a checkbox, names, the editor lists, the value at start, writes and events', async () => {
        await startFake(true);
        const {nc, received} = await start();
        const sv = watchStatus('sv');
        (await until(() => nc.ifaceStatus.Logic === true, 15000)).should.be.true();
        nc.liteIfaces.should.containEql('Logic');
        nc.logicIface.should.equal('Logic');
        nc.ifaceTypes.Logic.addonIface.should.be.true();
        should(nc.ifaceTypes['BidCos-RF'].enabled).not.be.ok();

        // the names come with the metadata - the variable is found by its name
        (
            await until(() => nc.sysvar.Regen && nc.sysvar.Modus && nc.program['Markise bei Regen'], 10000)
        ).should.be.true();
        nc.sysvar.Regen.should.have.properties({
            iface: 'Logic',
            type: 'SYSVAR',
            key: 'regen',
            address: 'var-regen:1',
            value: false,
        });

        // the shape follows the description once fetched
        (await until(() => nc.logicDescription('var-modus:1', 'VALUE') !== undefined, 10000)).should.be.true();
        // the entry takes it, also when its value came before the description
        (await until(() => nc.sysvar.Modus.enum.length === 3, 5000)).should.be.true();
        nc.sysvar.Modus.valueEnum.should.equal('tag');
        (await until(() => nc.sysvar.Solltemperatur.unit === '°C', 5000)).should.be.true();
        nc.sysvar.Solltemperatur.should.have.properties({min: 5, max: 30});

        // the value at start, for the node with "emit value on start"
        (await until(() => received.sv.length > 0, 5000)).should.be.true();
        received.sv[0].should.have.properties({name: 'Regen', value: false, cache: true, topic: 'ReGaHSS/Regen'});
        received.svc.length.should.equal(0);

        // the editor's lists
        const sysvars = await helper.request().get('/ccu?type=sysvar&config=nc').expect(200);
        Object.keys(JSON.parse(sysvars.text)).should.containEql('Regen');
        const programs = await helper.request().get('/ccu?type=program&config=nc').expect(200);
        Object.keys(JSON.parse(programs.text)).should.containEql('Markise bei Regen');

        // the node's status is the Logic interface's
        (await until(() => sv.currentStatus === 'green', 5000)).should.be.true();

        // an event: a change reaches both nodes
        fake.event('Logic', 'var-regen:1', 'VALUE', true);
        (await until(() => received.svc.length === 1, 5000)).should.be.true();
        received.svc[0].should.have.properties({value: true, change: true, cache: false, valueEnum: 'regnet'});
        received.svc[0].valuePrevious.should.equal(false);
        (await until(() => received.sv.length === 2, 5000)).should.be.true();

        // the same value written again: an update - not for "changed values only"
        fake.event('Logic', 'var-regen:1', 'VALUE', true);
        (await until(() => received.sv.length === 3, 5000)).should.be.true();
        received.sv[2].change.should.be.false();
        await wait(200);
        received.svc.length.should.equal(1);

        // writes: a logic value by its text, a list entry by its text, a FLOAT as a double
        await receive(helper.getNode('sv'), {payload: 'trocken'});
        (await until(() => setValueCalls(fake, 'var-regen:1', 'VALUE').length === 1, 5000)).should.be.true();
        setValueCalls(fake, 'var-regen:1', 'VALUE')[0].params[2].should.equal(false);

        await receive(helper.getNode('sm'), {payload: 'nacht'});
        (await until(() => setValueCalls(fake, 'var-modus:1', 'VALUE').length === 1, 5000)).should.be.true();
        setValueCalls(fake, 'var-modus:1', 'VALUE')[0].params[2].should.equal(2);

        await receive(helper.getNode('st'), {payload: '22'});
        (await until(() => setValueCalls(fake, 'var-solltemp:1', 'VALUE').length === 1, 5000)).should.be.true();
        // FakeBox announces json_double: lite.js writes lite-rpc's {double}
        setValueCalls(fake, 'var-solltemp:1', 'VALUE')[0].params[2].should.deepEqual({double: 22});

        // a write to a name Logic does not have
        await nc.setVariable('Gibt es nicht', 1).should.be.rejectedWith(/unknown/);

        // the poll node has nothing to poll and fails nothing
        const pl = helper.getNode('pl');
        const errors = [];
        pl.on('call:error', (call) => errors.push(call));
        await receive(pl, {payload: ''});
        errors.length.should.equal(0);
    });

    it('programs: the state at start, ACTIVE, RUN_THEN for "execute", a run as an event', async () => {
        await startFake(true);
        const {nc, received} = await start();
        (await until(() => received.pg.length > 0, 15000)).should.be.true();
        received.pg[0].should.have.properties({
            name: 'Markise bei Regen',
            type: 'PROGRAM',
            iface: 'Logic',
            active: true,
            payload: true,
        });
        received.pg[0].ts.should.equal(Date.parse('2026-11-25T10:00:00Z'));

        const pg = helper.getNode('pg');
        await receive(pg, {payload: false});
        (await until(() => setValueCalls(fake, 'prg-markise:1', 'ACTIVE').length === 1, 5000)).should.be.true();
        setValueCalls(fake, 'prg-markise:1', 'ACTIVE')[0].params[2].should.equal(false);
        (await until(() => received.pg.at(-1).active === false, 5000)).should.be.true();
        received.pg.at(-1).should.have.properties({payload: false, value: false, activePrevious: true});

        await receive(pg, {payload: ''});
        (await until(() => setValueCalls(fake, 'prg-markise:1', 'RUN_THEN').length === 1, 5000)).should.be.true();
        setValueCalls(fake, 'prg-markise:1', 'RUN_THEN')[0].params[2].should.equal(true);
        setValueCalls(fake, 'prg-markise:1', 'RUN').length.should.equal(0);

        // the addon reports a switch (on the system's page, say) and a run; the confirmation of the
        // node's own switch is no change, as the CCU's poll did not report it again either
        const before = received.pg.length;
        fake.event('Logic', 'prg-markise:1', 'ACTIVE', false);
        await wait(200);
        received.pg.length.should.equal(before);
        fake.event('Logic', 'prg-markise:1', 'ACTIVE', true);
        (await until(() => received.pg.some((m, i) => i >= before && m.active === true), 5000)).should.be.true();
        received.pg.at(-1).activePrevious.should.be.false();
        const ran = received.pg.length;
        await wait(20);
        fake.event('Logic', 'prg-markise:1', 'LAST_RUN', 1);
        (await until(() => received.pg.length > ran, 5000)).should.be.true();
        received.pg.at(-1).ts.should.be.above(Date.parse('2026-11-25T10:00:00Z'));

        await nc.programExecute('Gibt es nicht').should.be.rejectedWith(/not found/);
    });

    it('a rename on the system: the variable is found by its new name', async () => {
        await startFake(true);
        const {nc} = await start();
        (await until(() => nc.sysvar.Regen, 15000)).should.be.ok();
        fake.metaEvent({revision: 4, kind: 'object.updated', ref: 'Logic.var-regen:1', value: {name: 'Niederschlag'}});
        (await until(() => nc.sysvar.Niederschlag && !nc.sysvar.Regen, 5000)).should.be.true();
        nc.sysvar.Niederschlag.address.should.equal('var-regen:1');
    });

    it('without the addon: the nodes say so, a write is refused; installed while running, it is taken', async () => {
        await startFake(false);
        const {nc} = await start();
        const sv = watchStatus('sv');
        const pg = watchStatus('pg');
        (await until(() => nc.liteListed === true, 15000)).should.be.true();
        should(nc.logicIface).be.null();
        nc.pushStatus();
        lastStatus(sv).should.have.properties({fill: 'red', text: 'Logic addon not installed'});
        lastStatus(pg).text.should.equal('Logic addon not installed');
        await nc.setVariable('Regen', true).should.be.rejectedWith(/Logic addon is not installed/);
        await nc.programExecute('Markise bei Regen').should.be.rejectedWith(/Logic addon is not installed/);

        // the addon is installed
        fake.opts.values = {...LOGIC_VALUES};
        fake.addInterface('Logic', {devices: LOGIC_DEVICES});
        (await until(() => nc.logicIface === 'Logic' && nc.ifaceStatus.Logic === true, 10000)).should.be.true();
        (await until(() => sv.currentStatus === 'green', 5000)).should.be.true();
        (
            await until(() => nc.metadata.devices.Logic && nc.metadata.devices.Logic['var-regen:1'], 5000)
        ).should.be.true();
        fake.event('Logic', 'var-regen:1', 'VALUE', true);
        (await until(() => nc.sysvar.Regen && nc.sysvar.Regen.value === true, 5000)).should.be.true();
        await nc.setVariable('Regen', false);
        setValueCalls(fake, 'var-regen:1', 'VALUE').length.should.equal(1);
    });
});
