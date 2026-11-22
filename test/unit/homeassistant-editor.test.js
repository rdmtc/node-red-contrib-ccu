/* task 33: the ccu-homeassistant editor's device and channel settings. The editor script runs
   in a vm with a fake RED; its pure part (`haModel` on the node definition) is what turns the
   table's checkboxes and selects into the stored `devices` entries and back. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function definition() {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'nodes', 'ccu-homeassistant.html'), 'utf8');
    const script = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html)[1];
    let registered;
    // in this realm (not a vm context), so the objects it makes compare with deepEqual
    const run = vm.compileFunction(script, ['RED']);
    run({
        nodes: {
            registerType(name, def) {
                registered = {name, def};
            },
        },
    });
    assert.equal(registered.name, 'ccu-homeassistant');
    return registered.def;
}

const def = definition();
const m = def.haModel;

test('the node option channelDevices defaults to off (flows saved before it load unchanged)', () => {
    assert.deepEqual(def.defaults.channelDevices, {value: 'off'});
    assert.deepEqual(def.defaults.devices, {value: {}});
});

test('untouched channels store nothing; a default value removes the key again', () => {
    const model = m.copy({A: {enabled: true}});
    m.setChannel(model, 'A', 1, {publish: true});
    m.setChannel(model, 'A', 2, {device: ''});
    assert.deepEqual(model.A, {enabled: true}, 'defaults are not stored');

    m.setChannel(model, 'A', 1, {publish: false});
    m.setChannel(model, 'A', 2, {device: 'own'});
    m.setChannel(model, 'A', 2, {publish: false});
    assert.deepEqual(model.A, {enabled: true, channels: {1: {publish: false}, 2: {device: 'own', publish: false}}});
    assert.deepEqual(m.channel(model, 'A', 2), {publish: false, device: 'own'});
    assert.deepEqual(m.channel(model, 'A', 3), {publish: true, device: ''});

    m.setChannel(model, 'A', 1, {publish: true});
    m.setChannel(model, 'A', 2, {device: 'bogus', publish: true});
    assert.deepEqual(model.A, {enabled: true}, 'back to the defaults: nothing stored');

    m.setSplit(model, 'A', 'children');
    assert.equal(model.A.split, 'children');
    m.setSplit(model, 'A', '');
    assert.equal('split' in model.A, false);
    m.setSplit(model, 'B', 'devices');
    assert.deepEqual(model.B, {enabled: false, split: 'devices'}, 'an entry is created on demand');
});

test('serialize: ticked, unticked and unlisted devices, with their settings - a round trip', () => {
    const previous = {
        A: {enabled: true, split: 'children', channels: {3: {publish: false}}},
        B: {enabled: true},
        C: {enabled: true, channels: {1: {device: 'own'}}},
    };
    const model = m.copy(previous);
    assert.notEqual(model.A, previous.A, 'a copy');
    m.setChannel(model, 'B', 2, {device: 'child'});
    model.B.enabled = false;
    model.D = {enabled: true};
    const devices = m.serialize(model, ['A', 'D'], ['A', 'B', 'D', 'E'], previous);
    assert.deepEqual(devices, {
        A: {enabled: true, split: 'children', channels: {3: {publish: false}}},
        B: {enabled: false, channels: {2: {device: 'child'}}},
        D: {enabled: true},
        C: {enabled: true, channels: {1: {device: 'own'}}},
    });
    assert.equal('E' in devices, false, 'a device never ticked is not stored');

    // reopening the dialog shows what was stored
    const again = m.copy(devices);
    assert.deepEqual(m.channel(again, 'A', 3), {publish: false, device: ''});
    assert.deepEqual(m.channel(again, 'B', 2), {publish: true, device: 'child'});
    assert.deepEqual(m.serialize(again, ['A', 'D'], ['A', 'B', 'D'], devices), devices, 'unchanged');
});

test('filter: devices by name, address, type, interface; channels also by room and function', () => {
    const dev = {name: 'Verteiler', type: 'HmIP-DRSI4', iface: 'HmIP-RF'};
    assert.equal(m.matchesDevice('', 'X', dev), true);
    assert.equal(m.matchesDevice('drsi4', 'X', dev), true);
    assert.equal(m.matchesDevice('küche', 'X', dev), false);
    const channels = [
        {name: 'Decke', address: 'X:9', type: 'SWITCH_TRANSMITTER', rooms: ['Küche'], functions: ['Licht']},
    ];
    assert.equal(m.matchesChannels('küche', channels), true);
    assert.equal(m.matchesChannels('licht', channels), true);
    assert.equal(m.matchesChannels('bad', channels), false);
    assert.equal(m.matchesChannels('', []), true);
});

test('units: rows from the runtime units, one per channel without them; a preview of the entities', () => {
    const dev = {
        channels: [
            {address: 'X:0', type: 'MAINTENANCE'},
            {address: 'X:5', type: 'SWITCH_TRANSMITTER'},
            {address: 'X:6', type: 'SWITCH_VIRTUAL_RECEIVER'},
        ],
        units: [
            {index: 0, channels: [0], function: false, platforms: [{p: 'binary_sensor', en: false}]},
            {
                index: 5,
                channels: [5, 6],
                function: true,
                platforms: [
                    {p: 'switch', en: true},
                    {p: 'sensor', en: true},
                    {p: 'sensor', en: true},
                    {p: 'sensor', en: false},
                ],
            },
        ],
    };
    const units = m.units(dev);
    assert.deepEqual(
        units.map((u) => [u.index, u.channels.map((c) => c.address)]),
        [
            [0, ['X:0']],
            [5, ['X:5', 'X:6']],
        ],
    );
    assert.equal(m.preview(units[1].platforms), 'switch, 2 × sensor, +1 disabled');
    assert.equal(m.preview([]), 'nothing');
    assert.equal(m.preview(undefined), 'not known yet');

    const bare = m.units({channels: dev.channels});
    assert.deepEqual(
        bare.map((u) => u.index),
        [0, 5, 6],
    );
    assert.equal(bare[1].platforms, undefined);
});
