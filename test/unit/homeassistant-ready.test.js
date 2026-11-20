/* B-46: the ccu-homeassistant node waits (up to five minutes) until every channel of
   the selected devices has its VALUES description. A description that can never come -
   a channel without a VALUES paramset, a fetch the interface refused with a fault, a
   channel whose parent is missing from the device table - must not hold it; one that is
   only pending still does. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

const IFACE = 'VirtualDevices';
const DEVICE = 'INT0000001';

function fakeRED() {
    const types = {};
    const nodes = {};
    const RED = {
        nodes: {
            createNode(node, config) {
                const events = new EventEmitter();
                node.id = config.id;
                node.on = events.on.bind(events);
                node.status = () => {};
                for (const level of ['log', 'warn', 'debug', 'trace', 'error']) {
                    node[level] = () => {};
                }

                nodes[config.id] = node;
            },
            registerType(name, type) {
                types[name] = type;
            },
            getNode: (id) => nodes[id],
        },
    };
    require('../../nodes/ccu-homeassistant.js')(RED);
    return {types, nodes};
}

function setup(channels) {
    const {types, nodes} = fakeRED();
    const devices = {[IFACE]: {}};
    devices[IFACE][DEVICE] = {
        ADDRESS: DEVICE,
        TYPE: 'HmIP-HEATING',
        FIRMWARE: '1.0',
        VERSION: 1,
        CHILDREN: channels.map((c) => c.ADDRESS),
    };
    for (const channel of channels) {
        devices[IFACE][channel.ADDRESS] = {PARENT: DEVICE, VERSION: 1, ...channel};
    }

    const queued = [];
    const ccu = {
        host: 'ccu',
        metadata: {devices},
        channelNames: {[DEVICE]: 'Heizgruppe'},
        paramsetDescriptions: {},
        paramsetFailed: new Set(),
        register() {},
        subscribe: () => 0,
        unsubscribe() {},
        deregister(node, done) {
            if (done) {
                done();
            }
        },
        findIface: (address) => (devices[IFACE][address] ? IFACE : undefined),
        paramsetName: (iface, channel, ps) =>
            devices[iface][channel.PARENT] ? [iface, 'HmIP-HEATING', channel.TYPE, ps].join('/') : undefined,
        getParamsetDescription(iface, channel, ps) {
            queued.push(channel.ADDRESS + '/' + ps);
            return {};
        },
    };
    nodes.conn = ccu;
    const ha = new types['ccu-homeassistant']({
        id: 'ha',
        type: 'ccu-homeassistant',
        ccuConfig: 'conn',
        mqttNode: 'mqtt',
        devices: {[DEVICE]: {enabled: true}},
    });
    clearTimeout(ha.readyTimer);
    return {ccu, ha, queued};
}

test('B-46: a pending VALUES description still holds the node, and its fetch is queued', () => {
    const {ccu, ha, queued} = setup([
        {ADDRESS: `${DEVICE}:1`, TYPE: 'HEATING_CLIMATECONTROL_TRANSCEIVER', PARAMSETS: ['MASTER', 'VALUES']},
    ]);
    assert.equal(ha.ready(), false);
    assert.deepEqual(queued, [`${DEVICE}:1/VALUES`]);
    ccu.paramsetDescriptions[`${IFACE}/HmIP-HEATING/HEATING_CLIMATECONTROL_TRANSCEIVER/VALUES`] = {};
    assert.equal(ha.ready(), true);
});

test('B-46: a channel without a VALUES paramset does not hold the node', () => {
    const {ha, queued} = setup([{ADDRESS: `${DEVICE}:0`, TYPE: 'MAINTENANCE', PARAMSETS: ['MASTER']}]);
    assert.equal(ha.ready(), true);
    assert.deepEqual(queued, []);
});

test('B-46: a VALUES description the interface refused with a fault does not hold the node', () => {
    const {ccu, ha} = setup([
        {ADDRESS: `${DEVICE}:1`, TYPE: 'HEATING_CLIMATECONTROL_TRANSCEIVER', PARAMSETS: ['VALUES']},
    ]);
    assert.equal(ha.ready(), false);
    ccu.paramsetFailed.add(`${IFACE}/${DEVICE}:1/VALUES`);
    assert.equal(ha.ready(), true);
});

test('B-46: a channel whose parent is missing from the device table does not hold the node', () => {
    const {ccu, ha} = setup([{ADDRESS: `${DEVICE}:1`, TYPE: 'X', PARAMSETS: ['VALUES']}]);
    ccu.metadata.devices[IFACE][`${DEVICE}:1`].PARENT = 'GONE';
    assert.equal(ha.ready(), true);
});
