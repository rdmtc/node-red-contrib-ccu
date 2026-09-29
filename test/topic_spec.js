/* task 6 (#39): one topic template in every node that emits.
   - the get value node applies the same ${…} template as the other nodes to
     the outgoing message, from the cached datapoint or variable; an empty
     template (the default) leaves msg.topic as it came in;
   - the value node's input takes a datapoint address in msg.topic in the
     shape the nodes emit (slashes, the last three segments) as well as the
     old dotted form.
   Nothing is contacted: every interface is off, the caches are planted. */

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeGetValue = require('../nodes/ccu-get-value.js');
const nodeValue = require('../nodes/ccu-value.js');

helper.init(require.resolve('node-red'));

const HOST = '192.0.2.10';
const CACHE_FILES = [`ccu_${HOST}.json`, `ccu_rega_${HOST}.json`, `ccu_values_${HOST}.json`].map((f) =>
    path.join(__dirname, '..', f),
);

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

const connection = {
    id: 'nc',
    type: 'ccu-connection',
    name: 'topics',
    host: HOST,
    regaEnabled: false,
    bcrfEnabled: false,
    iprfEnabled: false,
    virtEnabled: false,
    bcwiEnabled: false,
    cuxdEnabled: false,
    regaPoll: false,
    regaInterval: '30',
    rpcPingTimeout: '60',
    rpcInitAddress: '127.0.0.1',
    rpcServerHost: '127.0.0.1',
    rpcBinPort: '2147',
    rpcXmlPort: '2148',
};

function getValueFlow(extra = {}) {
    return [
        connection,
        {
            id: 'gv',
            type: 'ccu-get-value',
            ccuConfig: 'nc',
            iface: 'HmIP-RF',
            channel: '000DD8A9931617:3',
            datapoint: 'LEVEL',
            datapointProperty: 'value',
            setProp: 'payload',
            setPropType: 'msg',
            wires: [['out']],
            ...extra,
        },
        {id: 'out', type: 'helper'},
    ];
}

/** the cached datapoint, message-shaped as lib/message.js builds it */
function plantValue(nc) {
    nc.values['HmIP-RF.000DD8A9931617:3.LEVEL'] = {
        topic: '',
        payload: 0.5,
        value: 0.5,
        ccu: HOST,
        iface: 'HmIP-RF',
        device: '000DD8A9931617',
        deviceName: 'Stehlampe',
        channel: '000DD8A9931617:3',
        channelName: 'Stehlampe:3',
        channelType: 'DIMMER_VIRTUAL_RECEIVER',
        channelIndex: 3,
        datapoint: 'LEVEL',
        datapointName: 'HmIP-RF.000DD8A9931617:3.LEVEL',
    };
}

function plantSysvar(nc) {
    nc.sysvar.Anwesenheit = {
        topic: '',
        payload: true,
        value: true,
        ccu: HOST,
        iface: 'ReGaHSS',
        type: 'SYSVAR',
        name: 'Anwesenheit',
        valueType: 'boolean',
    };
}

function load(nodes, flowJson) {
    return new Promise((resolve) => helper.load(nodes, flowJson, resolve));
}

function nextMessage(node) {
    return new Promise((resolve) => node.once('input', resolve));
}

describe('one topic template in every node that emits (task 6, #39)', function () {
    this.timeout(20000);

    before((done) => {
        removeCache();
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('get value with an empty template leaves msg.topic as it came in (the default)', async () => {
        await load([nodeConnection, nodeGetValue], getValueFlow());
        plantValue(helper.getNode('nc'));
        const out = helper.getNode('out');
        const received = nextMessage(out);
        helper.getNode('gv').receive({topic: 'poll/lamp', payload: 'x'});
        const message = await received;
        message.topic.should.equal('poll/lamp');
        message.payload.should.equal(0.5);
    });

    it('get value renders the template from the cached datapoint', async () => {
        await load([nodeConnection, nodeGetValue], getValueFlow({topic: 'hm/${Interface}/${channel}/${datapoint}'}));
        plantValue(helper.getNode('nc'));
        const out = helper.getNode('out');
        const received = nextMessage(out);
        helper.getNode('gv').receive({topic: 'poll/lamp'});
        const message = await received;
        message.topic.should.equal('hm/HmIP-RF/000DD8A9931617:3/LEVEL');
        message.payload.should.equal(0.5);
    });

    it('get value renders the template for a complete message too, with the names', async () => {
        await load(
            [nodeConnection, nodeGetValue],
            getValueFlow({topic: '${CCU}/${Interface}/${channelName}/${datapoint}', setPropType: 'cmsg'}),
        );
        plantValue(helper.getNode('nc'));
        const out = helper.getNode('out');
        const received = nextMessage(out);
        helper.getNode('gv').receive({topic: 'poll/lamp'});
        const message = await received;
        message.topic.should.equal(HOST + '/HmIP-RF/Stehlampe:3/LEVEL');
        message.channelName.should.equal('Stehlampe:3');
    });

    it('get value renders ${Name} for a variable', async () => {
        await load(
            [nodeConnection, nodeGetValue],
            getValueFlow({
                iface: 'ReGaHSS',
                channel: '',
                datapoint: '',
                sysvar: 'Anwesenheit',
                sysvarProperty: 'value',
                topic: 'ReGaHSS/${Name}',
            }),
        );
        plantSysvar(helper.getNode('nc'));
        const out = helper.getNode('out');
        const received = nextMessage(out);
        helper.getNode('gv').receive({topic: 'poll'});
        const message = await received;
        message.topic.should.equal('ReGaHSS/Anwesenheit');
        message.payload.should.equal(true);
    });

    it('the value node takes the address from an emitted-shape topic as well as from the dotted one', async () => {
        await load(
            [nodeConnection, nodeValue],
            [connection, {id: 'v', type: 'ccu-value', ccuConfig: 'nc', iface: '', channel: '', datapoint: ''}],
        );
        const nc = helper.getNode('nc');
        const writes = [];
        nc.setValue = (iface, channel, datapoint, payload) => {
            writes.push([iface, channel, datapoint, payload]);
            return Promise.resolve();
        };
        const v = helper.getNode('v');
        v.receive({topic: 'ccu3/HmIP-RF/000DD8A9931617:3/LEVEL', payload: 0.2});
        v.receive({topic: 'hm/BidCos-RF/OEQ1868878:1/STATE', payload: true});
        v.receive({topic: 'BidCos-RF.OEQ1868878:1.STATE', payload: false});
        await new Promise((resolve) => setTimeout(resolve, 100));
        writes.should.deepEqual([
            ['HmIP-RF', '000DD8A9931617:3', 'LEVEL', 0.2],
            ['BidCos-RF', 'OEQ1868878:1', 'STATE', true],
            ['BidCos-RF', 'OEQ1868878:1', 'STATE', false],
        ]);
    });
});
