/* task 33: the ccu-homeassistant node with Homematic channels as Home Assistant devices - the
   node option, the record of what was published (a file beside the connection's cache files,
   kept across restarts), the order of removals before payloads, and an unticked device whose
   channels were devices of their own.

   The nodes run against a fake RED and a fake connection. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paramsets = require('../../paramsets.json');

const IFACE = 'BidCos-RF';
const DEVICE = 'LEQ1000';
const TOPIC = (id) => `homeassistant/device/${id}/config`;

function fakeRED(userDir) {
    const types = {};
    const nodes = {};
    const RED = {
        settings: {userDir},
        nodes: {
            createNode(node, config) {
                const events = new EventEmitter();
                node.id = config.id;
                node.type = config.type;
                node.on = events.on.bind(events);
                node.emit = events.emit.bind(events);
                node.sent = [];
                node.logged = [];
                node.send = (message) => node.sent.push(message);
                node.status = () => {};
                for (const level of ['log', 'warn', 'debug', 'trace', 'error']) {
                    node[level] = (text) => node.logged.push([level, text]);
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

/** a connection with one HM-LC-Sw2-FM whose channels lie in two rooms */
function fakeCcu() {
    const devices = {[IFACE]: {}};
    const meta = {FIRMWARE: '2.8', VERSION: 26, PARENT_TYPE: 'HM-LC-Sw2-FM', PARAMSETS: ['MASTER', 'VALUES']};
    devices[IFACE][DEVICE] = {
        ADDRESS: DEVICE,
        TYPE: 'HM-LC-Sw2-FM',
        FIRMWARE: '2.8',
        VERSION: 26,
        CHILDREN: [`${DEVICE}:0`, `${DEVICE}:1`, `${DEVICE}:2`],
    };
    devices[IFACE][`${DEVICE}:0`] = {ADDRESS: `${DEVICE}:0`, TYPE: 'MAINTENANCE', PARENT: DEVICE, ...meta};
    devices[IFACE][`${DEVICE}:1`] = {ADDRESS: `${DEVICE}:1`, TYPE: 'SWITCH', PARENT: DEVICE, ...meta};
    devices[IFACE][`${DEVICE}:2`] = {ADDRESS: `${DEVICE}:2`, TYPE: 'SWITCH', PARENT: DEVICE, ...meta};
    const paramsetName = (iface, channel, ps) =>
        `${iface}/${channel.PARENT_TYPE}/${channel.FIRMWARE}/${channel.VERSION}/${channel.TYPE}/${ps}`;
    return {
        host: 'ccu',
        metadata: {devices},
        channelNames: {[DEVICE]: 'Schalter', [`${DEVICE}:1`]: 'Schalter Flur', [`${DEVICE}:2`]: 'Schalter Keller'},
        channelRooms: {[`${DEVICE}:1`]: ['Flur'], [`${DEVICE}:2`]: ['Keller']},
        paramsetDescriptions: {...paramsets},
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
        topicReplace: (template) => template,
        findIface: (address) => (devices[IFACE][address] ? IFACE : undefined),
        paramsetName,
        getParamsetDescription: (iface, channel, ps) => paramsets[paramsetName(iface, channel, ps)] || {},
        methodCall: () => Promise.resolve(false),
    };
}

/** a node of the given config in a Node-RED whose userDir is `dir`; publishes once */
function run(dir, more = {}, ccu = fakeCcu()) {
    const {types, nodes} = fakeRED(dir);
    nodes.conn = ccu;
    nodes.mqtt = new types['ccu-mqtt']({
        id: 'mqtt',
        type: 'ccu-mqtt',
        ccuConfig: 'conn',
        topicOutputEvent: 'hm/status/${channelName}/${datapoint}',
        topicInputSetValue: 'hm/set/${channelNameOrAddress}/${datapoint}',
        payloadOutput: 'mqsh-extended',
    });
    const ha = new types['ccu-homeassistant']({
        id: 'ha1',
        type: 'ccu-homeassistant',
        ccuConfig: 'conn',
        mqttNode: 'mqtt',
        prefix: 'homeassistant',
        generic: false,
        devices: {[DEVICE]: {enabled: true}},
        ...more,
    });
    clearTimeout(ha.readyTimer);
    ha.publish(false);
    ha.closed = true;
    return ha;
}

const discovery = (ha) => ha.sent.filter((m) => m.topic.startsWith('homeassistant/'));

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nrcc-ha-'));
}

test('default model: one config as before, and the record is written beside the cache files', () => {
    const dir = tmp();
    const ha = run(dir);
    const sent = discovery(ha);
    assert.deepEqual(
        sent.map((m) => m.topic),
        [TOPIC('ccu_LEQ1000')],
    );
    assert.equal(sent[0].payload.cdevs, undefined);
    assert.equal(sent[0].retain, true);
    const file = path.join(dir, 'ccu_homeassistant_ha1.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.devices[DEVICE][TOPIC('ccu_LEQ1000')]['1_STATE'], 'switch');
    assert.equal(
        ha.logged.some(([, text]) => /2026\.11/.test(text)),
        false,
        'no note about the Home Assistant version',
    );
});

test('children: child devices in the config, and one log line that they need Home Assistant 2026.11', () => {
    const ha = run(tmp(), {channelDevices: 'children'});
    const [config] = discovery(ha);
    assert.deepEqual(
        config.payload.cdevs.map((c) => c.ids[0]),
        ['ccu_LEQ1000_1', 'ccu_LEQ1000_2'],
    );
    assert.equal(ha.logged.filter(([level, text]) => level === 'log' && /2026\.11/.test(text)).length, 1);
    const perDevice = run(tmp(), {devices: {[DEVICE]: {enabled: true, split: 'children'}}});
    assert.ok(perDevice.logged.some(([, text]) => /2026\.11/.test(text)));
    assert.equal(run(tmp(), {channelDevices: 'bogus'}).channelDevices, 'off');
});

test('devices, then back: the record survives a restart and the channel topics are cleared first', () => {
    const dir = tmp();
    const first = run(dir, {channelDevices: 'devices'});
    assert.deepEqual(
        discovery(first).map((m) => m.topic),
        [TOPIC('ccu_LEQ1000'), TOPIC('ccu_LEQ1000_1'), TOPIC('ccu_LEQ1000_2')],
    );
    assert.equal(discovery(first)[1].payload.dev.sa, 'Flur');
    assert.equal(discovery(first)[2].payload.dev.sa, 'Keller');

    // a new node (a restart or a redeploy) with the default model
    const second = run(dir);
    assert.deepEqual(
        discovery(second).map((m) => [m.topic, m.payload === '' ? '' : 'config']),
        [
            [TOPIC('ccu_LEQ1000_1'), ''],
            [TOPIC('ccu_LEQ1000_2'), ''],
            [TOPIC('ccu_LEQ1000'), 'config'],
        ],
        'the channel topics are emptied before the device config takes the entities back',
    );
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'ccu_homeassistant_ha1.json'), 'utf8'));
    assert.deepEqual(Object.keys(record.devices[DEVICE]), [TOPIC('ccu_LEQ1000')]);
});

test('unticking a device clears its config and the configs of its channels', () => {
    const dir = tmp();
    run(dir, {channelDevices: 'devices'});
    const ha = run(dir, {channelDevices: 'devices', devices: {[DEVICE]: {enabled: false}}});
    assert.deepEqual(
        discovery(ha).map((m) => [m.topic, m.payload]),
        [
            [TOPIC('ccu_LEQ1000'), ''],
            [TOPIC('ccu_LEQ1000_1'), ''],
            [TOPIC('ccu_LEQ1000_2'), ''],
        ],
    );
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'ccu_homeassistant_ha1.json'), 'utf8'));
    assert.deepEqual(record.devices, {});
});

test('a device that is neither ticked nor unticked keeps its record', () => {
    const dir = tmp();
    run(dir);
    const ha = run(dir, {devices: {}});
    assert.deepEqual(discovery(ha), []);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'ccu_homeassistant_ha1.json'), 'utf8'));
    assert.ok(record.devices[DEVICE]);
});

test('a channel that is no longer published goes with a stub', () => {
    const dir = tmp();
    run(dir);
    const ha = run(dir, {devices: {[DEVICE]: {enabled: true, channels: {2: {publish: false}}}}});
    const [config] = discovery(ha);
    assert.deepEqual(config.payload.cmps['2_STATE'], {p: 'switch'});
    assert.ok(config.payload.cmps['1_STATE'].uniq_id);
});

test('a description still being fetched: its components are neither published nor removed', () => {
    const dir = tmp();
    run(dir);
    const ccu = fakeCcu();
    const key = `${IFACE}/HM-LC-Sw2-FM/2.8/26/SWITCH/VALUES`;
    delete ccu.paramsetDescriptions[key];
    const queued = [];
    const known = ccu.getParamsetDescription;
    ccu.getParamsetDescription = (iface, channel, ps) => {
        if (!ccu.paramsetDescriptions[ccu.paramsetName(iface, channel, ps)]) {
            queued.push(channel.ADDRESS);
        }

        return known(iface, channel, ps);
    };

    const ha = run(dir, {}, ccu);
    const [config] = discovery(ha);
    assert.equal(config.payload.cmps['1_STATE'], undefined);
    assert.equal(config.payload.cmps['2_STATE'], undefined, 'no stub either');
    assert.ok(queued.includes(`${DEVICE}:1`), 'the fetch is queued');
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'ccu_homeassistant_ha1.json'), 'utf8'));
    assert.equal(record.devices[DEVICE][TOPIC('ccu_LEQ1000')]['2_STATE'], 'switch', 'still remembered');
});

test('an unreadable or broken record counts as none; without a userDir nothing is written', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'ccu_homeassistant_ha1.json'), '{broken');
    const ha = run(dir);
    assert.equal(discovery(ha).length, 1);
    const none = run(undefined);
    assert.equal(none.publishedFile, null);
    assert.equal(discovery(none).length, 1);

    const readOnly = tmp();
    fs.mkdirSync(path.join(readOnly, 'ccu_homeassistant_ha1.json'));
    const warned = run(readOnly);
    assert.ok(warned.logged.some(([level, text]) => level === 'warn' && /could not write/.test(text)));
});
