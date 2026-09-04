const {test} = require('node:test');
const assert = require('node:assert/strict');

const {channelMatches, datapointsOf} = require('../../nodes/lib/channelfilter.js');

/** A connection-shaped fake: one device with two channels. */
function fakeCcu() {
    return {
        metadata: {
            devices: {
                'HmIP-RF': {
                    ABC1234567: {ADDRESS: 'ABC1234567', TYPE: 'HmIP-BSM'},
                    'ABC1234567:1': {ADDRESS: 'ABC1234567:1', PARENT: 'ABC1234567', TYPE: 'KEY_TRANSCEIVER'},
                    'ABC1234567:4': {ADDRESS: 'ABC1234567:4', PARENT: 'ABC1234567', TYPE: 'SWITCH_VIRTUAL_RECEIVER'},
                },
            },
        },
        channelNames: {
            ABC1234567: 'Kitchen switch',
            'ABC1234567:4': 'Kitchen light',
        },
        channelRooms: {'ABC1234567:4': ['Kitchen', 'Ground floor']},
        channelFunctions: {'ABC1234567:4': ['Light']},
        paramsetName: (iface, channel, ps) => iface + '/' + channel.TYPE + '/' + ps,
        paramsetDescriptions: {
            'HmIP-RF/SWITCH_VIRTUAL_RECEIVER/VALUES': {STATE: {}, ON_TIME: {}, PROCESS: {}},
        },
    };
}

const CH = 'ABC1234567:4';

test('device-level entries never match', () => {
    assert.equal(channelMatches(fakeCcu(), 'HmIP-RF', 'ABC1234567', {}), false);
});

test('an empty filter matches every channel', () => {
    assert.equal(channelMatches(fakeCcu(), 'HmIP-RF', CH, {}), true);
});

test('unknown addresses do not match', () => {
    assert.equal(channelMatches(fakeCcu(), 'HmIP-RF', 'NOPE:1', {}), false);
});

test('channelType str and re', () => {
    const ccu = fakeCcu();
    assert.equal(
        channelMatches(ccu, 'HmIP-RF', CH, {channelType: 'SWITCH_VIRTUAL_RECEIVER', channelTypeRx: 'str'}),
        true,
    );
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {channelType: 'KEY_TRANSCEIVER', channelTypeRx: 'str'}), false);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {channelType: '^SWITCH', channelTypeRx: 're'}), true);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {channelType: '^KEY', channelTypeRx: 're'}), false);
});

test('deviceType is read from the parent device', () => {
    const ccu = fakeCcu();
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {deviceType: 'HmIP-BSM', deviceTypeRx: 'str'}), true);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {deviceType: 'HmIP-BSL', deviceTypeRx: 'str'}), false);
});

test('deviceName matches a channel that has no name of its own', () => {
    // regression: the old code required channelNames[address] to exist while
    // comparing channelNames[PARENT], dropping unnamed channels
    const ccu = fakeCcu();
    assert.equal(
        channelMatches(ccu, 'HmIP-RF', 'ABC1234567:1', {deviceName: 'Kitchen switch', deviceNameRx: 'str'}),
        true,
    );
});

test('channelName does not match when the channel has no name', () => {
    const ccu = fakeCcu();
    assert.equal(
        channelMatches(ccu, 'HmIP-RF', 'ABC1234567:1', {channelName: 'Kitchen light', channelNameRx: 'str'}),
        false,
    );
});

test('channelIndex str compares the suffix, not a substring', () => {
    const ccu = fakeCcu();
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {channelIndex: '4', channelIndexRx: 'str'}), true);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {channelIndex: '1', channelIndexRx: 'str'}), false);
});

test('rooms and functions match on list membership', () => {
    const ccu = fakeCcu();
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {rooms: 'Kitchen', roomsRx: 'str'}), true);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {rooms: 'Cellar', roomsRx: 'str'}), false);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {rooms: '^Ground', roomsRx: 're'}), true);
    assert.equal(channelMatches(ccu, 'HmIP-RF', CH, {functions: 'Light', functionsRx: 'str'}), true);
    // a channel with no rooms at all is filtered out rather than throwing
    assert.equal(channelMatches(ccu, 'HmIP-RF', 'ABC1234567:1', {rooms: 'Kitchen', roomsRx: 'str'}), false);
});

test('datapoint filter: str selects exactly one', () => {
    assert.deepEqual(datapointsOf(fakeCcu(), 'HmIP-RF', CH, {datapoint: 'STATE', datapointRx: 'str'}), ['STATE']);
});

test('datapoint filter: re selects by pattern', () => {
    assert.deepEqual(datapointsOf(fakeCcu(), 'HmIP-RF', CH, {datapoint: '^ON_', datapointRx: 're'}), ['ON_TIME']);
});

test('datapoint filter: empty + str selects nothing (safety)', () => {
    assert.deepEqual(datapointsOf(fakeCcu(), 'HmIP-RF', CH, {datapoint: '', datapointRx: 'str'}), []);
});

test('datapoint filter: empty + re selects everything', () => {
    assert.deepEqual(datapointsOf(fakeCcu(), 'HmIP-RF', CH, {datapoint: '', datapointRx: 're'}), [
        'STATE',
        'ON_TIME',
        'PROCESS',
    ]);
});

test('channels without a VALUES description yield no datapoints', () => {
    assert.deepEqual(datapointsOf(fakeCcu(), 'HmIP-RF', 'ABC1234567:1', {datapoint: '', datapointRx: 're'}), []);
});
