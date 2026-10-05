/* B-38: Home Assistant shows every entity of a device "unavailable" until the
   availability topic of its discovery config (the maintenance channel's
   UNREACH) delivers a value. ccu-mqtt publishes UNREACH only when it changes or
   in its start-up cache burst, so a device that never went unreachable stayed
   unavailable for good. The ccu-homeassistant node now puts the current UNREACH
   on that topic itself, retained, right after the discovery configs.

   The nodes run against a fake RED and a fake connection; the payload format
   comes from the real ccu-mqtt node. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

const paramsets = require('../../paramsets.json');

const IFACE = 'BidCos-RF';
const DEVICE = 'MEQ0752310';
const NAME = 'KR_Türe_Kontakt';
const UNREACH_TOPIC = `hm/status/${NAME}:0/UNREACH`;
const UNREACH_DP = `${IFACE}.${DEVICE}:0.UNREACH`;

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
                node.emit = events.emit.bind(events);
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
    return {RED, types, nodes};
}

/** a connection with one HM-Sec-SCo; `getValue` answers what the test says */
function fakeCcu(getValue) {
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

    const subscriptions = [];
    const calls = [];
    const paramsetName = (iface, channel, ps) =>
        `${iface}/${channel.PARENT_TYPE}/${channel.FIRMWARE}/${channel.VERSION}/${channel.TYPE}/${ps}`;
    return {
        host: 'ccu',
        metadata: {devices},
        channelNames: {[DEVICE]: NAME, [`${DEVICE}:0`]: `${NAME}:0`, [`${DEVICE}:1`]: `${NAME}:1`},
        channelRooms: {},
        paramsetDescriptions: paramsets,
        values: {},
        enabledIfaces: [IFACE],
        subscriptions,
        calls,
        register() {},
        deregister(node, done) {
            if (done) {
                done();
            }
        },
        subscribe(filter, callback) {
            subscriptions.push({filter, callback});
            return subscriptions.length - 1;
        },
        unsubscribe(id) {
            subscriptions[id] = null;
        },
        subscribeSysvar: () => 0,
        subscribeProgram: () => 0,
        unsubscribeSysvar() {},
        unsubscribeProgram() {},
        findIface: (address) => (devices[IFACE][address] ? IFACE : undefined),
        paramsetName,
        getParamsetDescription: (iface, channel, ps) => paramsets[paramsetName(iface, channel, ps)],
        topicReplace: (template) => template,
        methodCall(iface, method, parameters) {
            calls.push([iface, method, parameters]);
            return getValue(iface, method, parameters);
        },
        /** deliver a message to the subscriptions whose datapoint filter matches */
        deliver(message) {
            for (const sub of subscriptions) {
                if (!sub) {
                    continue;
                }

                if (sub.filter.cache === false && message.cache) {
                    continue;
                }

                if (sub.filter.datapoint && sub.filter.datapoint !== message.datapoint) {
                    continue;
                }

                sub.callback(structuredClone(message));
            }
        },
    };
}

function unreachMessage(value, more = {}) {
    return {
        topic: '',
        payload: value,
        value,
        ccu: 'ccu',
        iface: IFACE,
        device: DEVICE,
        deviceName: NAME,
        channel: `${DEVICE}:0`,
        channelName: `${NAME}:0`,
        datapoint: 'UNREACH',
        datapointName: UNREACH_DP,
        ts: 1000,
        lc: 1000,
        cache: false,
        change: true,
        ...more,
    };
}

/** both nodes, the discovery not yet published */
function setup({getValue = () => Promise.resolve(false), payloadOutput = 'mqsh-extended', values = {}} = {}) {
    const {types, nodes} = fakeRED();
    const ccu = fakeCcu(getValue);
    Object.assign(ccu.values, values);
    nodes.conn = ccu;
    const mqtt = new types['ccu-mqtt']({
        id: 'mqtt',
        type: 'ccu-mqtt',
        ccuConfig: 'conn',
        cache: true,
        topicOutputEvent: 'hm/status/${channelName}/${datapoint}',
        topicInputSetValue: 'hm/set/${channelNameOrAddress}/${datapoint}',
        payloadOutput,
    });
    const ha = new types['ccu-homeassistant']({
        id: 'ha',
        type: 'ccu-homeassistant',
        ccuConfig: 'conn',
        mqttNode: 'mqtt',
        prefix: 'homeassistant',
        generic: true,
        devices: {[DEVICE]: {enabled: true}},
    });
    clearTimeout(ha.readyTimer);
    return {ccu, mqtt, ha};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const discovery = (ha) => ha.sent.filter((m) => m.topic.startsWith('homeassistant/'));
const availability = (ha) => ha.sent.filter((m) => m.topic === UNREACH_TOPIC);

/** what Home Assistant makes of a value with the config's availability template */
function haAvailability(config, payload) {
    const [entry] = config.avty;
    assert.equal(entry.val_tpl, "{{ 'offline' if value_json.val else 'online' }}");
    return payload.val ? 'offline' : 'online';
}

test('B-38: without any UNREACH from ccu-mqtt the device is available once the interface answers', async () => {
    const {ccu, ha} = setup({getValue: () => Promise.resolve(false)});
    assert.equal(ha.ready(), true);
    ha.publish(false);

    const [config] = discovery(ha);
    assert.equal(config.topic, `homeassistant/device/ccu_${DEVICE}/config`);
    assert.deepEqual(
        config.payload.avty.map((a) => a.t),
        [UNREACH_TOPIC],
    );
    assert.deepEqual(ccu.calls, [[IFACE, 'getValue', [`${DEVICE}:0`, 'UNREACH']]]);

    await settle();
    const sent = availability(ha);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].retain, true);
    assert.equal(sent[0].payload.val, false);
    assert.equal(sent[0].payload.hm.channelName, `${NAME}:0`);
    assert.equal(haAvailability(config.payload, sent[0].payload), 'online');
    // the discovery config goes out before the value it depends on
    assert.ok(ha.sent.indexOf(config) < ha.sent.indexOf(sent[0]));
});

test('B-38: an unreachable device is published offline', async () => {
    const {ha} = setup({getValue: () => Promise.resolve(true)});
    ha.publish(false);
    await settle();
    const [config] = discovery(ha);
    const [sent] = availability(ha);
    assert.equal(sent.payload.val, true);
    assert.equal(haAvailability(config.payload, sent.payload), 'offline');
});

test('B-38: a certain cached value goes out at once, the same answer of the interface is not repeated', async () => {
    const {ha} = setup({
        getValue: () => Promise.resolve(false),
        values: {[UNREACH_DP]: unreachMessage(false, {cache: true, change: false})},
    });
    ha.publish(false);
    assert.equal(availability(ha).length, 1, 'published before the interface answered');
    await settle();
    assert.equal(availability(ha).length, 1);
    assert.equal(availability(ha)[0].payload.val, false);
});

test('B-38: an uncertain cached value (from the values file) waits for the interface', async () => {
    const {ha} = setup({
        getValue: () => Promise.resolve(false),
        values: {[UNREACH_DP]: unreachMessage(true, {cache: true, uncertain: true})},
    });
    ha.publish(false);
    assert.equal(availability(ha).length, 0);
    await settle();
    assert.deepEqual(
        availability(ha).map((m) => m.payload.val),
        [false],
    );
});

test('B-38: when the interface cannot answer, the next UNREACH the connection delivers is published', async () => {
    const {ccu, ha} = setup({getValue: () => Promise.reject(new Error('fault -2'))});
    ha.publish(false);
    await settle();
    assert.equal(availability(ha).length, 0);

    // the ReGa's values (cache) arrive later
    ccu.deliver(unreachMessage(false, {cache: true, change: false}));
    assert.deepEqual(
        availability(ha).map((m) => m.payload.val),
        [false],
    );

    // the same value again is not repeated, a change is
    ccu.deliver(unreachMessage(false));
    ccu.deliver(unreachMessage(true));
    ccu.deliver(unreachMessage(false));
    assert.deepEqual(
        availability(ha).map((m) => m.payload.val),
        [false, true, false],
    );
    assert.ok(availability(ha).every((m) => m.retain === true));
});

test('B-38: UNREACH of a device that is not published is ignored', async () => {
    const {ccu, ha} = setup();
    ha.publish(false);
    await settle();
    const before = ha.sent.length;
    ccu.deliver(unreachMessage(true, {datapointName: 'BidCos-RF.OTHER:0.UNREACH', channelName: 'other:0'}));
    assert.equal(ha.sent.length, before);
});

test('B-38: UNREACH that arrives before the discovery is published is not sent ahead of it', () => {
    const {ccu, ha} = setup();
    ccu.deliver(unreachMessage(false));
    assert.equal(ha.sent.length, 0);
});

test('B-38: a republish sends the availability again', async () => {
    const {ha} = setup();
    ha.publish(false);
    await settle();
    ha.emit('input', {payload: 1});
    await settle();
    assert.equal(discovery(ha).length, 2);
    assert.equal(availability(ha).length, 2);
});

test("B-38: Home Assistant's birth message republishes, its last will does not", async () => {
    const {ha} = setup();
    ha.emit('input', {topic: 'homeassistant/status', payload: 'offline'});
    assert.equal(ha.sent.length, 0);
    ha.emit('input', {topic: 'homeassistant/status', payload: 'online'});
    await settle();
    assert.equal(discovery(ha).length, 1);
    assert.equal(availability(ha).length, 1);
});

test('B-38: plain payloads carry the value the plain template reads', async () => {
    const {ha} = setup({payloadOutput: 'plain', getValue: () => Promise.resolve(true)});
    ha.publish(false);
    await settle();
    const [config] = discovery(ha);
    assert.equal(
        config.payload.avty[0].val_tpl,
        "{{ 'offline' if (value | string | lower) in ('1', 'true', 'on') else 'online' }}",
    );
    assert.equal(availability(ha)[0].payload, 1);
});

test('B-38: an answer that arrives after the node closed is not sent', async () => {
    let answer;
    const {ha} = setup({getValue: () => new Promise((resolve) => (answer = resolve))});
    ha.publish(false);
    ha.emit('close', () => {});
    answer(false);
    await settle();
    assert.equal(availability(ha).length, 0);
});
