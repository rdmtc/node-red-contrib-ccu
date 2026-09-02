const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createMessage} = require('../../nodes/lib/message.js');

function fakeCcu(overrides = {}) {
    return {
        host: 'ccu3',
        values: {},
        metadata: {
            devices: {
                'HmIP-RF': {
                    'ABC:1': {PARENT: 'ABC', TYPE: 'SWITCH_CHANNEL'},
                    ABC: {TYPE: 'HmIP-BSM'},
                },
            },
        },
        channelNames: {'ABC:1': 'Lampe', ABC: 'Schalter'},
        channelRooms: {'ABC:1': ['Wohnzimmer', 'EG']},
        channelFunctions: {'ABC:1': ['Licht']},
        getParamsetDescription: () => ({TYPE: 'BOOL', MIN: false, MAX: true}),
        logger: {trace: () => {}},
        ...overrides,
    };
}

test('fills device/channel/room/function metadata', () => {
    const m = createMessage(fakeCcu(), 'HmIP-RF', 'ABC:1', 'STATE', true);
    assert.equal(m.ccu, 'ccu3');
    assert.equal(m.device, 'ABC');
    assert.equal(m.deviceName, 'Schalter');
    assert.equal(m.deviceType, 'HmIP-BSM');
    assert.equal(m.channelName, 'Lampe');
    assert.equal(m.channelType, 'SWITCH_CHANNEL');
    assert.equal(m.channelIndex, 1);
    assert.equal(m.datapointName, 'HmIP-RF.ABC:1.STATE');
    assert.equal(m.datapointType, 'BOOL');
    assert.equal(m.room, 'Wohnzimmer');
    assert.deepEqual(m.rooms, ['Wohnzimmer', 'EG']);
    assert.equal(m.function, 'Licht');
});

test('first value counts as change; unchanged repeat does not', () => {
    const ccu = fakeCcu();
    const m1 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'STATE', true);
    assert.equal(m1.change, true);
    ccu.values[m1.datapointName] = m1;
    const m2 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'STATE', true);
    assert.equal(m2.change, false);
    assert.equal(m2.valuePrevious, true);
    assert.equal(m2.lc, m1.lc);
    const m3 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'STATE', false);
    assert.equal(m3.change, true);
});

test('ACTION datapoints always report change', () => {
    const ccu = fakeCcu({getParamsetDescription: () => ({TYPE: 'ACTION'})});
    const m1 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'PRESS_SHORT', true);
    ccu.values[m1.datapointName] = m1;
    const m2 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'PRESS_SHORT', true);
    assert.equal(m2.change, true);
});

test('working keeps valueStable from the cache and stable=!working', () => {
    const ccu = fakeCcu();
    const m1 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'LEVEL', 0.0);
    ccu.values[m1.datapointName] = m1;
    const m2 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'LEVEL', 0.5, {working: true});
    assert.equal(m2.valueStable, 0.0);
    assert.equal(m2.stable, false);
    const m3 = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'LEVEL', 1.0, {working: false});
    assert.equal(m3.valueStable, 1.0);
    assert.equal(m3.stable, true);
});

test('valueEnum resolves via description ENUM', () => {
    const ccu = fakeCcu({getParamsetDescription: () => ({TYPE: 'ENUM', ENUM: ['IDLE', 'TRIGGERED']})});
    const m = createMessage(ccu, 'HmIP-RF', 'ABC:1', 'STATE', 1);
    assert.equal(m.valueEnum, 'TRIGGERED');
    assert.deepEqual(m.datapointEnum, ['IDLE', 'TRIGGERED']);
});

test('unknown channel: metadata fields undefined, no crash', () => {
    const m = createMessage(fakeCcu(), 'HmIP-RF', 'XYZ:2', 'STATE', true);
    assert.equal(m.device, undefined);
    assert.equal(m.deviceName, undefined);
    assert.equal(m.datapointType, undefined);
    assert.deepEqual(m.rooms, []);
    assert.equal(m.change, true);
});

test('additions override and are merged (cache, uncertain, ts, lc)', () => {
    const m = createMessage(fakeCcu(), 'HmIP-RF', 'ABC:1', 'STATE', true, {
        cache: true,
        uncertain: true,
        ts: 123,
        lc: 122,
    });
    assert.equal(m.cache, true);
    assert.equal(m.uncertain, true);
    assert.equal(m.ts, 123);
    assert.equal(m.lc, 122);
});

test('initializes the values cache entry when missing', () => {
    const ccu = fakeCcu();
    createMessage(ccu, 'HmIP-RF', 'ABC:1', 'STATE', true);
    assert.deepEqual(ccu.values['HmIP-RF.ABC:1.STATE'], {});
});
