/* task 36: the values cache file keeps per datapoint only what the restore needs (the value, its
   timestamps, valuePrevious, and working/direction/valueStable where a message has them); the load
   builds the message around it from the device table, the names and the descriptions. The old file
   (the whole message per datapoint) is read as well. All data here is made up. */

const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createMessage, savedValue, restoreMessage, isFullMessage, SAVED_FIELDS} = require('../../nodes/lib/message.js');

const DESCRIPTIONS = {
    STATE: {TYPE: 'BOOL', MIN: false, MAX: true, DEFAULT: false, CONTROL: 'SWITCH.STATE'},
    LEVEL: {TYPE: 'FLOAT', MIN: 0, MAX: 1, DEFAULT: 0},
    ACTIVITY_STATE: {TYPE: 'ENUM', MIN: 0, MAX: 3, DEFAULT: 0, VALUE_LIST: ['UNKNOWN', 'UP', 'DOWN', 'STABLE']},
    PRESS_SHORT: {TYPE: 'ACTION', MIN: false, MAX: true},
};

/** a connection-shaped object with `count` made-up switch actuators and one blind */
function fakeCcu(count = 1) {
    const devices = {'HmIP-RF': {}};
    const channelNames = {};
    const channelRooms = {};
    const channelFunctions = {};
    for (let i = 0; i < count; i++) {
        const device = 'TEST' + String(i).padStart(10, '0');
        devices['HmIP-RF'][device] = {ADDRESS: device, TYPE: 'HmIP-TEST', FIRMWARE: '1.0.0', VERSION: 1};
        devices['HmIP-RF'][device + ':1'] = {ADDRESS: device + ':1', PARENT: device, TYPE: 'SWITCH_VIRTUAL_RECEIVER'};
        channelNames[device] = 'Testgerät ' + i;
        channelNames[device + ':1'] = 'Testgerät ' + i + ' Kanal 1';
        channelRooms[device + ':1'] = ['Raum ' + (i % 7), 'Etage ' + (i % 3)];
        channelFunctions[device + ':1'] = ['Funktion ' + (i % 5)];
    }

    devices['HmIP-RF'].BLIND00001 = {ADDRESS: 'BLIND00001', TYPE: 'HmIP-TESTBLIND', FIRMWARE: '1.0.0', VERSION: 1};
    devices['HmIP-RF']['BLIND00001:4'] = {
        ADDRESS: 'BLIND00001:4',
        PARENT: 'BLIND00001',
        TYPE: 'BLIND_VIRTUAL_RECEIVER',
    };
    channelNames['BLIND00001:4'] = 'Rollladen';

    const peeked = [];
    return {
        host: 'ccu-test',
        values: {},
        metadata: {devices, types: {}},
        channelNames,
        channelRooms,
        channelFunctions,
        logger: {trace() {}},
        peeked,
        getParamsetDescription(iface, device, paramset, parameter) {
            this.asked = (this.asked || 0) + 1;
            return DESCRIPTIONS[parameter];
        },
        peekParamsetDescription(iface, device, paramset, parameter) {
            peeked.push(parameter);
            return DESCRIPTIONS[parameter];
        },
    };
}

/** what the connection does with an event: build the message, keep it in the values */
function liveEvent(ccu, channel, datapoint, payload, additions = {}) {
    const message = createMessage(ccu, 'HmIP-RF', channel, datapoint, payload, {
        cache: false,
        uncertain: false,
        ...additions,
    });
    ccu.values[message.datapointName] = message;
    return message;
}

/** a message as JSON gives it back: no undefined keys */
const json = (value) => JSON.parse(JSON.stringify(value));

/** the old load: the file's whole message, flagged as a cached value */
const oldLoad = (message) => ({...json(message), cache: true, change: false, uncertain: true});

/** the file the connection writes now */
function slimFile(values) {
    const out = {};
    for (const name of Object.keys(values)) {
        out[name] = savedValue(values[name]);
    }

    return JSON.stringify({format: 2, values: out});
}

test('savedValue keeps only the fields nothing else knows', () => {
    const ccu = fakeCcu();
    liveEvent(ccu, 'TEST0000000000:1', 'STATE', false);
    const message = liveEvent(ccu, 'TEST0000000000:1', 'STATE', true);
    const entry = savedValue(message);
    assert.deepEqual(Object.keys(entry).sort(), ['lc', 'ts', 'tsPrevious', 'value', 'valuePrevious']);
    assert.equal(entry.value, true);
    assert.equal(entry.valuePrevious, false);
    for (const key of Object.keys(entry)) {
        assert.ok(SAVED_FIELDS.includes(key), key);
    }
});

test('savedValue keeps valueStable only while it differs, working and direction where present', () => {
    const ccu = fakeCcu();
    liveEvent(ccu, 'BLIND00001:4', 'LEVEL', 0, {working: false});
    const moving = liveEvent(ccu, 'BLIND00001:4', 'LEVEL', 0.5, {working: true, direction: 1});
    assert.deepEqual(savedValue(moving), {
        value: 0.5,
        ts: moving.ts,
        lc: moving.lc,
        valuePrevious: 0,
        tsPrevious: moving.tsPrevious,
        valueStable: 0,
        working: true,
        direction: 1,
    });
    const stopped = liveEvent(ccu, 'BLIND00001:4', 'LEVEL', 0.5, {working: false});
    assert.equal(savedValue(stopped).valueStable, undefined);
    assert.equal(savedValue(stopped).working, false);
});

test('a restored value equals the old load of the same live message, field for field', () => {
    const live = fakeCcu();
    liveEvent(live, 'TEST0000000000:1', 'STATE', false);
    liveEvent(live, 'TEST0000000000:1', 'STATE', true);
    liveEvent(live, 'BLIND00001:4', 'LEVEL', 0, {working: false});
    liveEvent(live, 'BLIND00001:4', 'LEVEL', 0.25, {working: true, direction: 2});
    liveEvent(live, 'BLIND00001:4', 'ACTIVITY_STATE', 2);
    liveEvent(live, 'TEST0000000000:1', 'PRESS_SHORT', true);
    // a value from the start's read (ReGa getValues / the state store): working false, no previous
    const read = createMessage(live, 'HmIP-RF', 'TEST0000000000:1', 'LEVEL', 0.75, {
        cache: true,
        change: false,
        working: false,
        uncertain: false,
        ts: 1000,
        lc: 900,
    });
    live.values[read.datapointName] = read;

    const {values} = JSON.parse(slimFile(live.values));
    const restoring = fakeCcu();
    for (const name of Object.keys(live.values)) {
        const restored = restoreMessage(restoring, name, values[name]);
        assert.deepEqual(json(restored), oldLoad(live.values[name]), name);
    }

    assert.equal(restoring.asked, undefined, 'no description fetch queued at load');
    assert.ok(restoring.peeked.length > 0);
    assert.deepEqual(restoring.values, {}, 'the connection values are left to the caller');
});

test('the old format (whole message per datapoint) is read: the same message, the next write is short', () => {
    const live = fakeCcu();
    liveEvent(live, 'TEST0000000000:1', 'STATE', false);
    const message = liveEvent(live, 'TEST0000000000:1', 'STATE', true);
    const oldFile = JSON.parse(JSON.stringify({values: live.values}));
    const entry = oldFile.values[message.datapointName];
    assert.ok(isFullMessage(entry));

    const restoring = fakeCcu();
    const restored = restoreMessage(restoring, message.datapointName, entry);
    assert.deepEqual(json(restored), oldLoad(message));
    assert.deepEqual(savedValue(restored), savedValue(message));
    assert.equal(isFullMessage(savedValue(restored)), false);
});

test('the old format takes names, rooms and types from the metadata of now', () => {
    const live = fakeCcu();
    const message = liveEvent(live, 'TEST0000000000:1', 'STATE', true);
    const entry = json(message);
    const restoring = fakeCcu();
    restoring.channelNames['TEST0000000000:1'] = 'Umbenannt';
    restoring.channelRooms['TEST0000000000:1'] = ['Anderer Raum'];
    const restored = restoreMessage(restoring, message.datapointName, entry);
    assert.equal(restored.channelName, 'Umbenannt');
    assert.equal(restored.room, 'Anderer Raum');
    assert.equal(restored.value, true);
});

test('an old entry whose channel the device table does not know is kept as it was', () => {
    const live = fakeCcu();
    const message = liveEvent(live, 'TEST0000000000:1', 'STATE', true);
    const restoring = fakeCcu();
    restoring.metadata = {devices: {}, types: {}};
    const restored = restoreMessage(restoring, message.datapointName, json(message));
    assert.deepEqual(restored, oldLoad(message));
});

test('a short entry of an unknown channel gets what there is: the value, the address, no names', () => {
    const restored = restoreMessage(fakeCcu(), 'CUxD.CUX0000001:1.STATE', {value: 1, ts: 5, lc: 4});
    assert.equal(restored.iface, 'CUxD');
    assert.equal(restored.channel, 'CUX0000001:1');
    assert.equal(restored.datapoint, 'STATE');
    assert.equal(restored.datapointName, 'CUxD.CUX0000001:1.STATE');
    assert.equal(restored.payload, 1);
    assert.equal(restored.ts, 5);
    assert.equal(restored.lc, 4);
    assert.equal(restored.device, undefined);
    assert.equal(restored.cache, true);
    assert.equal(restored.uncertain, true);
    assert.equal(restored.stable, true);
});

test('a connection without metadata or names does not throw', () => {
    const restored = restoreMessage({host: 'h', getParamsetDescription: () => ({})}, 'A.B:1.C', {
        value: 2,
        ts: 1,
        lc: 1,
    });
    assert.equal(restored.value, 2);
    assert.deepEqual(restored.rooms, []);
});

test('a key that is not iface.channel.datapoint or an entry that is not an object is skipped', () => {
    const ccu = fakeCcu();
    for (const name of ['', 'nodots', '.a.b', 'a..b', 'a.b.', 'a.b']) {
        assert.equal(restoreMessage(ccu, name, {value: 1, ts: 1, lc: 1}), null, name);
    }

    assert.equal(restoreMessage(ccu, 'HmIP-RF.TEST0000000000:1.STATE', null), null);
    assert.equal(restoreMessage(ccu, 'HmIP-RF.TEST0000000000:1.STATE', 5), null);
});

test('size: the short file is a fraction of the old one', () => {
    const live = fakeCcu(500);
    for (const channel of Object.keys(live.metadata.devices['HmIP-RF']).filter((a) => a.endsWith(':1'))) {
        liveEvent(live, channel, 'STATE', false);
        liveEvent(live, channel, 'STATE', true);
        liveEvent(live, channel, 'ACTIVITY_STATE', 3);
    }

    const before = JSON.stringify({values: live.values}).length;
    const after = slimFile(live.values).length;
    assert.ok(after * 4 < before, after + ' of ' + before);
});
