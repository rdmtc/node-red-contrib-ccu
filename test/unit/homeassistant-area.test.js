/* task 18: the ccu-homeassistant node suggests the channels' room as the
   device's area (`suggested_area` in the discovery config's device block), from
   the connection's channelRooms - the ReGaHSS's rooms on a CCU, the metadata's
   on openccu-lite - and its option `area` (on by default, also for flows saved
   before the option existed) switches that off.

   The nodes run against a fake RED and a fake connection. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

const paramsets = require('../../paramsets.json');

const IFACE = 'BidCos-RF';
const DEVICE = 'MEQ0752310';

function fakeRED() {
    const types = {};
    const nodes = {};
    const RED = {
        nodes: {
            createNode(node, config) {
                const events = new EventEmitter();
                node.id = config.id;
                node.type = config.type;
                node.on = events.on.bind(events);
                node.sent = [];
                node.send = (message) => node.sent.push(message);
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
        util: {cloneMessage: (message) => structuredClone(message)},
    };
    require('../../nodes/ccu-mqtt.js')(RED);
    require('../../nodes/ccu-homeassistant.js')(RED);
    return {types, nodes};
}

/** a connection with one HM-Sec-SCo whose channels lie in the given rooms */
function fakeCcu(channelRooms) {
    const devices = {[IFACE]: {}};
    const meta = {FIRMWARE: '1.0', VERSION: 3, PARENT_TYPE: 'HM-Sec-SCo'};
    devices[IFACE][DEVICE] = {
        ADDRESS: DEVICE,
        TYPE: 'HM-Sec-SCo',
        FIRMWARE: '1.0',
        VERSION: 3,
        CHILDREN: [`${DEVICE}:0`, `${DEVICE}:1`],
    };
    devices[IFACE][`${DEVICE}:0`] = {ADDRESS: `${DEVICE}:0`, TYPE: 'MAINTENANCE', PARENT: DEVICE, ...meta};
    devices[IFACE][`${DEVICE}:1`] = {ADDRESS: `${DEVICE}:1`, TYPE: 'SHUTTER_CONTACT', PARENT: DEVICE, ...meta};
    const paramsetName = (iface, channel, ps) =>
        `${iface}/${channel.PARENT_TYPE}/${channel.FIRMWARE}/${channel.VERSION}/${channel.TYPE}/${ps}`;
    return {
        host: 'ccu',
        metadata: {devices},
        channelNames: {[DEVICE]: 'Tür', [`${DEVICE}:0`]: 'Tür:0', [`${DEVICE}:1`]: 'Tür:1'},
        channelRooms,
        paramsetDescriptions: paramsets,
        values: {},
        enabledIfaces: [IFACE],
        register() {},
        deregister(node, done) {
            if (done) {
                done();
            }
        },
        subscribe: () => 0,
        unsubscribe() {},
        subscribeSysvar: () => 0,
        subscribeProgram: () => 0,
        unsubscribeSysvar() {},
        unsubscribeProgram() {},
        findIface: (address) => (devices[IFACE][address] ? IFACE : undefined),
        paramsetName,
        getParamsetDescription: (iface, channel, ps) => paramsets[paramsetName(iface, channel, ps)],
        topicReplace: (template) => template,
        methodCall: () => Promise.resolve(false),
    };
}

/** the device block the node publishes with the given rooms and node config */
function published(channelRooms, more = {}) {
    const {types, nodes} = fakeRED();
    nodes.conn = fakeCcu(channelRooms);
    nodes.mqtt = new types['ccu-mqtt']({
        id: 'mqtt',
        type: 'ccu-mqtt',
        ccuConfig: 'conn',
        topicOutputEvent: 'hm/status/${channelName}/${datapoint}',
        topicInputSetValue: 'hm/set/${channelNameOrAddress}/${datapoint}',
        payloadOutput: 'mqsh-extended',
    });
    const ha = new types['ccu-homeassistant']({
        id: 'ha',
        type: 'ccu-homeassistant',
        ccuConfig: 'conn',
        mqttNode: 'mqtt',
        prefix: 'homeassistant',
        generic: true,
        devices: {[DEVICE]: {enabled: true}},
        ...more,
    });
    clearTimeout(ha.readyTimer);
    ha.publish(false);
    const [config] = ha.sent.filter((m) => m.topic === `homeassistant/device/ccu_${DEVICE}/config`);
    assert.ok(config, 'the discovery config was published');
    return config.payload.dev;
}

test('the channel room is the suggested area, also for a flow saved before the option existed', () => {
    const dev = published({[`${DEVICE}:1`]: ['Flur']});
    assert.equal(dev.sa, 'Flur');
    assert.equal(dev.name, 'Tür');
});

test('the option area: false leaves the suggested area out', () => {
    const dev = published({[`${DEVICE}:1`]: ['Flur']}, {area: false});
    assert.equal(dev.sa, undefined);
    assert.equal(published({[`${DEVICE}:1`]: ['Flur']}, {area: true}).sa, 'Flur');
});

test('no room, no suggested area - the key is left out, not null', () => {
    const dev = published({});
    assert.equal('sa' in dev, false);
});

test('nested rooms as openccu-lite lists them (most specific first): the room, not the floor', () => {
    const dev = published({[`${DEVICE}:1`]: ['Küche', 'Erdgeschoss']});
    assert.equal(dev.sa, 'Küche');
});
