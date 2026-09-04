const {test} = require('node:test');
const assert = require('node:assert/strict');

const {channelRole, haUnit, isFraction, ROLE_BY_TYPE, PARAMETERS} = require('../../nodes/lib/haroles.js');

test('role comes from the channel TYPE when the description has no CONTROL hints', () => {
    // about half of the shipped paramsets.json VALUES entries carry no CONTROL fields
    const noControl = {STATE: {TYPE: 'BOOL', OPERATIONS: 7}};
    assert.equal(channelRole('SWITCH_VIRTUAL_RECEIVER', noControl), 'switch');
    assert.equal(channelRole('SWITCH_TRANSMITTER', noControl), 'switch_state');
    assert.equal(channelRole('SHUTTER_VIRTUAL_RECEIVER', {LEVEL: {}}), 'cover');
    assert.equal(channelRole('HEATING_CLIMATECONTROL_TRANSCEIVER', {}), 'climate_hmip');
    assert.equal(channelRole('CLIMATECONTROL_RT_TRANSCEIVER', {}), 'climate_hm');
    assert.equal(channelRole('SHUTTER_CONTACT', {}), 'contact');
    assert.equal(channelRole('KEY_TRANSCEIVER', {}), 'key');
    assert.equal(channelRole('KEYMATIC', {}), 'lock');
});

test('a CONTROL hint wins over the channel TYPE', () => {
    const description = {STATE: {TYPE: 'BOOL', CONTROL: 'DOOR_SENSOR.STATE'}};
    assert.equal(channelRole('MULTI_MODE_INPUT_TRANSMITTER', description), 'contact');
    assert.equal(channelRole('SOMETHING_NEW', {LEVEL: {CONTROL: 'BLIND.LEVEL'}}), 'cover');
});

test('maintenance is decided by TYPE alone', () => {
    assert.equal(channelRole('MAINTENANCE', {UNREACH: {CONTROL: 'DOOR_SENSOR.STATE'}}), 'maintenance');
});

test('unknown channel types have no role', () => {
    assert.equal(channelRole('BLIND_WEEK_PROFILE', {}), null);
    assert.equal(channelRole('BLIND_WEEK_PROFILE'), null);
});

test('every role table entry maps to a role the discovery builder knows', () => {
    const known = new Set([
        'maintenance',
        'switch',
        'switch_state',
        'dimmer',
        'dimmer_state',
        'cover',
        'cover_state',
        'contact',
        'rotary_handle',
        'motion',
        'presence',
        'weather',
        'water',
        'smoke',
        'energy',
        'key',
        'lock',
        'climate_hm',
        'climate_hmip',
    ]);
    for (const role of Object.values(ROLE_BY_TYPE)) {
        assert.ok(known.has(role), role);
    }
});

test('haUnit maps interface units to Home Assistant units', () => {
    assert.equal(haUnit('100%'), '%');
    assert.equal(haUnit('% rF'), '%');
    assert.equal(haUnit('Lux'), 'lx');
    assert.equal(haUnit('�C'), '°C');
    assert.equal(haUnit('W'), 'W');
    assert.equal(haUnit(''), undefined);
    assert.equal(haUnit('""'), undefined);
    assert.equal(haUnit(undefined), undefined);
});

test('isFraction recognises 0..1 percent values', () => {
    assert.equal(isFraction({UNIT: '100%'}), true);
    assert.equal(isFraction({UNIT: '%'}), false);
    assert.equal(isFraction(undefined), false);
});

test('PARAMETERS facts are well-formed', () => {
    for (const [name, facts] of Object.entries(PARAMETERS)) {
        for (const key of Object.keys(facts)) {
            assert.ok(
                ['dev_cla', 'stat_cla', 'unit', 'ent_cat', 'enabled', 'inverted'].includes(key),
                `${name}.${key}`,
            );
        }
    }
});
