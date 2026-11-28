/* task 34: device types no system at hand has paired come from pydevccu's dumps
   (tools/paramsets-from-pydevccu.js), merged with tools/paramsets-join.js. */

const {test} = require('node:test');
const assert = require('node:assert/strict');

const {convert} = require('../../tools/paramsets-from-pydevccu.js');
const paramsets = require('../../paramsets.json');

test('the dump has the keys of paramsets.json: the device firmware and version, the channel type', () => {
    const devices = [
        {ADDRESS: 'VCU1', TYPE: 'HmIP-X', FIRMWARE: '2.0.2', VERSION: 2},
        {ADDRESS: 'VCU1:0', TYPE: 'MAINTENANCE', PARENT: 'VCU1', FIRMWARE: '', VERSION: 7},
        {ADDRESS: 'VCU1:1', TYPE: 'DIMMER_VIRTUAL_RECEIVER', PARENT: 'VCU1', VERSION: 9},
        {ADDRESS: 'VCU1:2', TYPE: 'DIMMER_VIRTUAL_RECEIVER', PARENT: 'VCU1', VERSION: 9},
        {ADDRESS: 'VCU9:1', TYPE: 'ORPHAN', PARENT: 'VCU9'},
    ];
    const descriptions = {
        VCU1: {MASTER: {}, SERVICE: {A: {TYPE: 'BOOL'}}},
        'VCU1:0': {VALUES: {UNREACH: {TYPE: 'BOOL'}}},
        'VCU1:1': {VALUES: {LEVEL: {TYPE: 'FLOAT'}}, LINK: {}},
        'VCU1:2': {VALUES: {LEVEL: {TYPE: 'FLOAT', other: true}}},
        'VCU9:1': {VALUES: {X: {}}},
    };
    assert.deepEqual(convert('HmIP-RF', devices, descriptions), {
        // an empty description is kept, it is what the system answers
        'HmIP-RF/HmIP-X/2.0.2/2//MASTER': {},
        'HmIP-RF/HmIP-X/2.0.2/2//SERVICE': {A: {TYPE: 'BOOL'}},
        'HmIP-RF/HmIP-X/2.0.2/2/MAINTENANCE/VALUES': {UNREACH: {TYPE: 'BOOL'}},
        // the first channel of a type gives the description, as at runtime
        'HmIP-RF/HmIP-X/2.0.2/2/DIMMER_VIRTUAL_RECEIVER/VALUES': {LEVEL: {TYPE: 'FLOAT'}},
        'HmIP-RF/HmIP-X/2.0.2/2/DIMMER_VIRTUAL_RECEIVER/LINK': {},
    });
});

test('a device without descriptions gives nothing', () => {
    assert.deepEqual(convert('HmIP-RF', [{ADDRESS: 'A', TYPE: 'T', FIRMWARE: '1', VERSION: 1}], {}), {});
});

test('the shipped file knows the HmIP-BSL 2.0.2 with COLOR_BEHAVIOUR', () => {
    const values = paramsets['HmIP-RF/HmIP-BSL/2.0.2/2/DIMMER_VIRTUAL_RECEIVER/VALUES'];
    assert.equal(values.COLOR_BEHAVIOUR.TYPE, 'ENUM');
    assert.equal(values.COLOR_BEHAVIOUR.OPERATIONS & 2, 2);
    assert.equal(values.COLOR_BEHAVIOUR.VALUE_LIST[1], 'ON');
    assert.equal(values.COLOR_BEHAVIOUR.DEFAULT, 'OFF');
    // the 1.x description is still there, and has none
    assert.equal(paramsets['HmIP-RF/HmIP-BSL/1.0.2/1/DIMMER_VIRTUAL_RECEIVER/VALUES'].COLOR_BEHAVIOUR, undefined);
});

test('the shipped file knows the HmIP-WRCD display channel, the HmIP-RGBW, the HmIP-DRG-DALI and the HmIPW-WRC6', () => {
    const wrcd = paramsets['HmIP-RF/HmIP-WRCD/1.4.6/3/ACOUSTIC_DISPLAY_RECEIVER/VALUES'];
    assert.equal(wrcd.COMBINED_PARAMETER.OPERATIONS, 2);
    assert.equal(wrcd.DISPLAY_DATA_ICON.VALUE_LIST.length, 32);
    assert.equal(wrcd.ACOUSTIC_NOTIFICATION_SELECTION.VALUE_LIST.length, 8);
    assert.ok(paramsets['HmIP-RF/HmIP-RGBW/1.0.52/1/UNIVERSAL_LIGHT_RECEIVER/VALUES'].HUE);
    assert.ok(paramsets['HmIP-RF/HmIP-DRG-DALI/1.4.8/2/UNIVERSAL_LIGHT_RECEIVER/VALUES'].LEVEL);
    assert.ok(paramsets['HmIP-RF/HmIPW-WRC6/1.0.8/1/OPTICAL_SIGNAL_RECEIVER/VALUES'].COLOR_BEHAVIOUR);
});
