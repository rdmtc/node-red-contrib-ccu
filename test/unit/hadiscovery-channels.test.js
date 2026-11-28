/* task 33: Homematic channels as Home Assistant devices - the models `off` (one device per
   Homematic device, the payloads of before byte for byte), `children` (child devices in the
   device's payload, HA 2026.11) and `devices` (devices of their own), the per-device and
   per-channel settings, and the removal of what a run no longer publishes. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {fixture, allKnownFixtures, ctxFor, VARIANTS} = require('./helpers/hafixtures.js');
const {
    deviceBlock,
    discoveryMessages,
    ifaceOf,
    placement,
    deviceUnits,
    resolveVirtualReceivers,
    usesChildDevices,
} = require('../../nodes/lib/hadiscovery.js');

/** an HmIP-DRSI4: four inputs, four switch families (transmitter + three virtual receivers) */
const drsi4 = (names = {}) => {
    const types = ['MAINTENANCE'];
    for (let i = 0; i < 4; i++) {
        types.push('MULTI_MODE_INPUT_TRANSMITTER');
    }

    for (let i = 0; i < 4; i++) {
        types.push(
            'SWITCH_TRANSMITTER',
            'SWITCH_VIRTUAL_RECEIVER',
            'SWITCH_VIRTUAL_RECEIVER',
            'SWITCH_VIRTUAL_RECEIVER',
        );
    }

    return fixture('HmIP-RF', 'DRS0001', 'HmIP-DRSI4', '1.4.2', 1, types, {
        DRS0001: 'Verteiler',
        'DRS0001:1': 'Verteiler:1',
        'DRS0001:5': 'Verteiler Flurlicht',
        'DRS0001:9': 'Küche Decke',
        ...names,
    });
};

/** an HM-LC-Sw2-FM: two switch channels */
const sw2 = () =>
    fixture('BidCos-RF', 'LEQ1000', 'HM-LC-Sw2-FM', '2.8', 26, ['MAINTENANCE', 'SWITCH', 'SWITCH'], {
        LEQ1000: 'Schalter',
        'LEQ1000:1': 'Schalter Flur',
        'LEQ1000:2': 'Schalter Keller',
    });

/** an HM-LC-Sw1-FM-like single switch */
const sw1 = () =>
    fixture('BidCos-RF', 'LEQ1001', 'HM-LC-Sw2-FM', '2.8', 26, ['MAINTENANCE', 'SWITCH'], {
        LEQ1001: 'Stecker',
    });

function block(fx, more) {
    const ctx = ctxFor(fx, more);
    const address = ctx.selected[0];
    const iface = ifaceOf(fx.devices, address);
    return deviceBlock(ctx, iface, fx.devices[iface][address]);
}

/** every component key of a payload with where it is: `parent` or the child's id */
function where(payload) {
    const out = {};
    for (const key of Object.keys(payload.cmps)) {
        out[key] = 'parent';
    }

    for (const child of payload.cdevs || []) {
        for (const key of Object.keys(child.cmps)) {
            assert.equal(out[key], undefined, `${key} is in more than one place`);
            out[key] = child.ids[0];
        }
    }

    return out;
}

/* The payload of every device type paramsets.json knows, in four option variants, as the
   ccu-homeassistant node published it before task 33 (sha256 of the JSON of messages,
   availability, missing and empty) - the default model must not change a byte. */
const BEFORE = 'c12a5136a5905ed3d5c4b5c7dbfca4a00df8ba8b80e30cfca65d07d050f4c918';
/** the device types paramsets.json gained after that (4.16.0), checked on their own below */
const ADDED_LATER = [
    'HmIP-RF/HmIP-BSL/2.0.2/2',
    'HmIP-RF/HmIP-DRG-DALI/1.4.8/2',
    'HmIP-RF/HmIP-RGBW/1.0.52/1',
    'HmIP-RF/HmIP-WRCD/1.4.6/3',
    'HmIP-RF/HmIPW-WRC6/1.0.8/1',
];

test('off (the default): the payloads of before, byte for byte, for every known device type', () => {
    for (const model of [undefined, 'off', 'bogus']) {
        const out = {};
        for (const [name, options] of Object.entries(VARIANTS)) {
            out[name] = {};
            for (const {group, fx} of allKnownFixtures(ADDED_LATER)) {
                const rooms = (a) => (a.endsWith(':1') ? ['Küche'] : a.endsWith(':2') ? ['Flur', 'Küche'] : []);
                const r = discoveryMessages(ctxFor(fx, {...options, rooms, channelDevices: model}));
                out[name][group] = {
                    messages: r.messages,
                    availability: r.availability,
                    missing: r.missing,
                    empty: r.empty,
                };
                assert.deepEqual(r.clear, []);
            }
        }

        const hash = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex');
        assert.equal(hash, BEFORE, `model ${model}: the payloads changed`);
    }
});

test('the device types added later publish in every model and variant', () => {
    const added = allKnownFixtures().filter(({group}) => ADDED_LATER.includes(group));
    assert.deepEqual(added.map(({group}) => group).sort(), ADDED_LATER);
    for (const model of ['off', 'children', 'devices']) {
        for (const options of Object.values(VARIANTS)) {
            for (const {group, fx} of added) {
                const r = discoveryMessages(ctxFor(fx, {...options, channelDevices: model}));
                assert.ok(r.messages.length > 0, `${group} ${model}: nothing published`);
            }
        }
    }
});

test('units: an HmIP family is one unit under its transmitter, the maintenance channel never a function', () => {
    const b = block(drsi4());
    assert.deepEqual(b.children, []);
    assert.deepEqual(b.own, []);
    const fx = drsi4();
    const channels = fx.devices['HmIP-RF'].DRS0001.CHILDREN.map((a) => ({
        ...fx.devices['HmIP-RF'][a],
        index: Number(a.split(':')[1]),
        description: fx.description('HmIP-RF', a),
    }));
    for (const ch of channels) {
        ch.role = require('../../nodes/lib/haroles.js').channelRole(ch.TYPE, ch.description);
    }

    resolveVirtualReceivers(channels);
    const origins = {
        '0_UNREACH': {ch: channels[0], role: true},
        '1_PRESS': {ch: channels[1], role: true},
        '6_STATE': {ch: channels[6], role: true},
        '7_STATE': {ch: channels[7], role: true},
        '5_PROCESS': {ch: channels[5], role: false},
        '21_X': {ch: channels[0], role: false},
    };
    const units = deviceUnits(channels, origins);
    assert.deepEqual(
        [...units.keys()],
        [0, 1, 2, 3, 4, 5, 9, 13, 17],
        'one unit per input, one per switch family (head = transmitter)',
    );
    assert.deepEqual(
        units.get(5).channels.map((ch) => ch.index),
        [5, 6, 7, 8],
    );
    assert.deepEqual(units.get(5).keys.sort(), ['5_PROCESS', '6_STATE', '7_STATE']);
    assert.equal(units.get(5).function, true);
    assert.equal(units.get(0).function, false, 'the maintenance channel is never a function unit');
    assert.equal(units.get(9).function, false, 'no role entity in it here');
});

test('children: the function channels become child devices, keys and unique_ids unchanged', () => {
    const fx = drsi4();
    const off = discoveryMessages(ctxFor(fx)).messages[0].payload;
    const r = discoveryMessages(ctxFor(fx, {channelDevices: 'children'}));
    assert.equal(r.messages.length, 1, 'still one discovery topic');
    const {topic, payload} = r.messages[0];
    assert.equal(topic, 'homeassistant/device/ccu_DRS0001/config');
    assert.deepEqual(payload.dev, off.dev, 'the device block is the same');
    assert.deepEqual(payload.avty, off.avty);

    const places = where(payload);
    assert.deepEqual(Object.keys(places).sort(), Object.keys(off.cmps).sort(), 'every component exactly once');
    for (const [key, component] of Object.entries(off.cmps)) {
        const now =
            places[key] === 'parent'
                ? payload.cmps[key]
                : payload.cdevs.find((c) => c.ids[0] === places[key]).cmps[key];
        assert.equal(now.uniq_id, component.uniq_id, `${key}: unique_id unchanged`);
        assert.equal(now.p, component.p);
    }

    for (const key of Object.keys(places).filter((k) => k.startsWith('0_'))) {
        assert.equal(places[key], 'parent', `${key}: the maintenance channel stays on the device`);
    }

    assert.equal(places['1_PRESS'], 'ccu_DRS0001_1');
    assert.equal(places['6_STATE'], 'ccu_DRS0001_5', 'the family under its transmitter');
    assert.equal(places['7_STATE'], 'ccu_DRS0001_5');
    assert.equal(places['8_STATE'], 'ccu_DRS0001_5');
    assert.deepEqual(
        payload.cdevs.map((c) => c.ids[0]),
        [
            'ccu_DRS0001_1',
            'ccu_DRS0001_2',
            'ccu_DRS0001_3',
            'ccu_DRS0001_4',
            'ccu_DRS0001_5',
            'ccu_DRS0001_9',
            'ccu_DRS0001_13',
            'ccu_DRS0001_17',
        ],
    );
    for (const child of payload.cdevs) {
        assert.deepEqual(
            Object.keys(child).sort(),
            ['cmps', 'ids', 'name'],
            'MQTT child devices take ids and name only',
        );
        assert.notEqual(child.ids[0], payload.dev.ids[0]);
    }
});

test('children: names - the channel name without the device name, else "Channel n"; entities by their label', () => {
    const {payload} = discoveryMessages(ctxFor(drsi4(), {channelDevices: 'children'})).messages[0];
    const child = (id) => payload.cdevs.find((c) => c.ids[0] === id);
    assert.equal(child('ccu_DRS0001_5').name, 'Flurlicht', 'the device name is stripped');
    assert.equal(child('ccu_DRS0001_9').name, 'Küche Decke', 'a name of its own is kept');
    assert.equal(child('ccu_DRS0001_1').name, 'Channel 1', 'the CCU default name "Verteiler:1" is no name');
    assert.equal(child('ccu_DRS0001_13').name, 'Channel 13', 'no name at all');

    const light = child('ccu_DRS0001_5').cmps;
    assert.equal(light['6_STATE'].name, null, 'the main entity is named after its (child) device');
    assert.equal(light['7_STATE'].name, 'Channel 7', 'a secondary receiver keeps its own label');
    assert.equal(light['6_PROCESS'].name, 'Process', 'a generic entity: the datapoint only');
    assert.equal(light['7_PROCESS'].name, 'Channel 7 Process');
    assert.equal(child('ccu_DRS0001_1').cmps['1_PRESS'].name, null);

    // the same entities in the default model keep their names
    const off = discoveryMessages(ctxFor(drsi4())).messages[0].payload.cmps;
    assert.equal(off['6_STATE'].name, 'Channel 6');
    assert.equal(off['6_PROCESS'].name, 'Channel 6 Process');
});

test('a device with a single function channel is not split', () => {
    for (const model of ['children', 'devices']) {
        const r = discoveryMessages(ctxFor(sw1(), {channelDevices: model}));
        assert.equal(r.messages.length, 1);
        assert.equal(r.messages[0].payload.cdevs, undefined, model);
        assert.ok(r.messages[0].payload.cmps['1_STATE']);
    }
});

test('two-channel actuator: children and devices', () => {
    const children = discoveryMessages(ctxFor(sw2(), {channelDevices: 'children'})).messages[0].payload;
    assert.deepEqual(
        children.cdevs.map((c) => [c.ids[0], c.name]),
        [
            ['ccu_LEQ1000_1', 'Flur'],
            ['ccu_LEQ1000_2', 'Keller'],
        ],
    );

    const rooms = (a) => ({'LEQ1000:1': ['Flur'], 'LEQ1000:2': ['Keller']})[a];
    const r = discoveryMessages(ctxFor(sw2(), {channelDevices: 'devices', rooms}));
    assert.deepEqual(
        r.messages.map((m) => m.topic),
        [
            'homeassistant/device/ccu_LEQ1000/config',
            'homeassistant/device/ccu_LEQ1000_1/config',
            'homeassistant/device/ccu_LEQ1000_2/config',
        ],
        'the device first, then its channels',
    );
    const [parent, one, two] = r.messages.map((m) => m.payload);
    assert.equal(parent.dev.sa, 'Flur', "the device's area as before");
    assert.deepEqual(one.dev, {
        ids: ['ccu_LEQ1000_1'],
        name: 'Schalter Flur',
        mf: 'eQ-3',
        mdl: 'HM-LC-Sw2-FM',
        sw: '2.8',
        sa: 'Flur',
        via_device: 'ccu_LEQ1000',
    });
    assert.equal(two.dev.sa, 'Keller', 'a device of its own has the room of its channel');
    assert.deepEqual(one.avty, parent.avty, "the device's availability");
    assert.equal(one.cmps['1_STATE'].uniq_id, 'ccu_LEQ1000_1_STATE');
    assert.equal(one.cmps['1_STATE'].name, null);
    assert.equal(parent.cmps['1_STATE'].p, 'switch', 'a stub: the component leaves the device (no record yet)');
    assert.deepEqual(parent.cmps['1_STATE'], {p: 'switch'});
    assert.equal(parent.cmps['0_UNREACH'].uniq_id, 'ccu_LEQ1000_0_UNREACH');

    const noArea = discoveryMessages(ctxFor(sw2(), {channelDevices: 'devices', rooms, area: false}));
    assert.equal(noArea.messages[1].payload.dev.sa, undefined);
    const roomless = discoveryMessages(
        ctxFor(sw2(), {channelDevices: 'devices', rooms: (a) => (a === 'LEQ1000' ? ['Haus'] : [])}),
    );
    assert.equal(roomless.messages[1].payload.dev.sa, 'Haus', "no room of the channel: the device's");
});

test("placement: a channel's setting wins, then the device's split, then the node's model", () => {
    const units = new Map([
        [0, {function: false}],
        [1, {function: true}],
        [2, {function: true}],
        [3, {function: false}],
    ]);
    const run = (ctx) => Object.fromEntries(placement(ctx, 'D', units));
    assert.deepEqual(run({}), {0: 'parent', 1: 'parent', 2: 'parent', 3: 'parent'});
    assert.deepEqual(run({channelDevices: 'children'}), {0: 'parent', 1: 'child', 2: 'child', 3: 'parent'});
    assert.deepEqual(run({channelDevices: 'devices'}), {0: 'parent', 1: 'own', 2: 'own', 3: 'parent'});
    assert.deepEqual(run({channelDevices: 'children', overrides: {D: {enabled: true, split: 'off'}}}), {
        0: 'parent',
        1: 'parent',
        2: 'parent',
        3: 'parent',
    });
    assert.deepEqual(run({overrides: {D: {enabled: true, split: 'devices'}}}), {
        0: 'parent',
        1: 'own',
        2: 'own',
        3: 'parent',
    });
    assert.deepEqual(
        run({
            channelDevices: 'children',
            overrides: {
                D: {enabled: true, channels: {0: {device: 'own'}, 1: {device: 'parent'}, 3: {device: 'child'}}},
            },
        }),
        {0: 'parent', 1: 'parent', 2: 'child', 3: 'child'},
        'a non-function channel goes where it is told; :0 stays',
    );
    assert.deepEqual(run({overrides: {D: {channels: {2: {publish: false}, 0: {publish: false}}}}}), {
        0: 'drop',
        1: 'parent',
        2: 'drop',
        3: 'parent',
    });
    assert.deepEqual(run({overrides: {D: {channels: {1: {device: 'bogus'}}}, split: 'bogus'}}), {
        0: 'parent',
        1: 'parent',
        2: 'parent',
        3: 'parent',
    });
    // a single function unit: explicit settings still apply
    const single = new Map([
        [0, {function: false}],
        [1, {function: true}],
    ]);
    assert.deepEqual(Object.fromEntries(placement({channelDevices: 'children'}, 'D', single)), {
        0: 'parent',
        1: 'parent',
    });
    assert.deepEqual(Object.fromEntries(placement({overrides: {D: {channels: {1: {device: 'child'}}}}}, 'D', single)), {
        0: 'parent',
        1: 'child',
    });
});

test('publish: false leaves out exactly that channel (with its family)', () => {
    const fx = drsi4();
    const off = discoveryMessages(ctxFor(fx)).messages[0].payload.cmps;
    const overrides = {DRS0001: {enabled: true, channels: {5: {publish: false}}}};
    const {payload} = discoveryMessages(ctxFor(fx, {overrides, previous: {}})).messages[0];
    const gone = Object.keys(off).filter((k) => !(k in payload.cmps) || Object.keys(payload.cmps[k]).length === 1);
    assert.ok(gone.includes('6_STATE') && gone.includes('5_PROCESS') && gone.includes('8_STATE'));
    assert.deepEqual(
        gone.filter((k) => !/^[5-8]_/.test(k)),
        [],
        'only the channels 5-8',
    );
    assert.deepEqual(
        Object.keys(off).filter((k) => /^[5-8]_/.test(k) && !gone.includes(k)),
        [],
        'all of them',
    );
});

test('removal: what the last run published and this one does not is sent as a stub once', () => {
    const fx = drsi4();
    const first = discoveryMessages(ctxFor(fx));
    const topic = 'homeassistant/device/ccu_DRS0001/config';
    assert.deepEqual(Object.keys(first.published), ['DRS0001']);
    assert.equal(first.published.DRS0001[topic]['6_STATE'], 'switch');

    const overrides = {DRS0001: {enabled: true, channels: {9: {publish: false}}}};
    const second = discoveryMessages(ctxFor(fx, {overrides, previous: first.published}));
    const cmps = second.messages[0].payload.cmps;
    assert.deepEqual(cmps['10_STATE'], {p: 'switch'});
    assert.deepEqual(cmps['9_PROCESS'], {p: 'sensor'});
    assert.equal(second.published.DRS0001[topic]['10_STATE'], undefined, 'the stub is not remembered');

    const third = discoveryMessages(ctxFor(fx, {overrides, previous: second.published}));
    assert.equal(third.messages[0].payload.cmps['10_STATE'], undefined, 'sent once');

    // moving between the device and its children is no removal
    const children = discoveryMessages(ctxFor(fx, {channelDevices: 'children', previous: first.published}));
    const all = JSON.stringify(children.messages[0].payload);
    assert.ok(!all.includes('{"p":"switch"}'), 'no stub when a component only moves inside the payload');
});

test('removal: a channel back from a device of its own clears that topic first', () => {
    const fx = sw2();
    const devices = discoveryMessages(ctxFor(fx, {channelDevices: 'devices', previous: {}}));
    assert.deepEqual(devices.clear, []);
    assert.deepEqual(Object.keys(devices.published.LEQ1000).sort(), [
        'homeassistant/device/ccu_LEQ1000/config',
        'homeassistant/device/ccu_LEQ1000_1/config',
        'homeassistant/device/ccu_LEQ1000_2/config',
    ]);
    assert.deepEqual(devices.messages[0].payload.cmps['1_STATE'], {p: 'switch'}, 'no record of the device yet: a stub');
    const again = discoveryMessages(ctxFor(fx, {channelDevices: 'devices', previous: devices.published}));
    assert.equal(again.messages[0].payload.cmps['1_STATE'], undefined, 'the record says it is gone: no stub');

    const back = discoveryMessages(ctxFor(fx, {previous: devices.published}));
    assert.deepEqual(back.clear, [
        {topic: 'homeassistant/device/ccu_LEQ1000_1/config', payload: ''},
        {topic: 'homeassistant/device/ccu_LEQ1000_2/config', payload: ''},
    ]);
    assert.equal(back.messages.length, 1);
    assert.equal(back.messages[0].payload.cmps['1_STATE'].uniq_id, 'ccu_LEQ1000_1_STATE');
    assert.deepEqual(Object.keys(back.published.LEQ1000), ['homeassistant/device/ccu_LEQ1000/config']);

    // a device of its own whose channel is no longer published: its topic is cleared
    const unpublished = discoveryMessages(
        ctxFor(fx, {
            channelDevices: 'devices',
            previous: devices.published,
            overrides: {LEQ1000: {enabled: true, channels: {2: {publish: false}}}},
        }),
    );
    assert.deepEqual(unpublished.clear, [{topic: 'homeassistant/device/ccu_LEQ1000_2/config', payload: ''}]);
});

test('removal: nothing of a channel whose description is not known (yet) is removed or forgotten', () => {
    const fx = sw2();
    const first = discoveryMessages(ctxFor(fx, {channelDevices: 'devices', previous: {}}));
    const description = fx.description;
    fx.description = (iface, a) => (a === 'LEQ1000:2' ? undefined : description(iface, a));
    const r = discoveryMessages(ctxFor(fx, {channelDevices: 'devices', previous: first.published}));
    assert.deepEqual(r.clear, [], 'the topic of channel 2 stays');
    assert.equal(r.messages.length, 2);
    assert.deepEqual(
        r.published.LEQ1000['homeassistant/device/ccu_LEQ1000_2/config'],
        first.published.LEQ1000['homeassistant/device/ccu_LEQ1000_2/config'],
        'and its record',
    );

    // on the device's own topic: no stub for an unknown channel's component, the record keeps it
    const off = discoveryMessages(ctxFor(sw2(), {previous: {}}));
    const partial = discoveryMessages(ctxFor(fx, {previous: off.published}));
    const topic = 'homeassistant/device/ccu_LEQ1000/config';
    assert.equal(partial.messages[0].payload.cmps['2_STATE'], undefined);
    assert.equal(partial.published.LEQ1000[topic]['2_STATE'], 'switch');
});

test('removal: a device that is missing or has no entity now keeps its record', () => {
    const fx = sw2();
    const previous = {LEQ1000: {t: {a: 'switch'}}, GONE: {u: {b: 'sensor'}}};
    const r = discoveryMessages(ctxFor(fx, {selected: ['LEQ1000', 'GONE'], previous}));
    assert.deepEqual(r.published.GONE, previous.GONE);
    assert.deepEqual(r.missing, ['GONE']);
    assert.deepEqual(r.clear, [{topic: 't', payload: ''}], 'a topic of the device with no payload now');

    const empty = fixture('HmIP-RF', 'EMPTY01', 'HmIP-BROLL', '1.6.2', 3, ['BLIND_WEEK_PROFILE']);
    empty.description = () => ({});
    const e = discoveryMessages(ctxFor(empty, {previous: {EMPTY01: {t: {a: 'cover'}}}}));
    assert.deepEqual(e.empty, ['EMPTY01']);
    assert.deepEqual(e.published.EMPTY01, {t: {a: 'cover'}});
});

test('a device whose every unit is unpublished clears its topic', () => {
    const fx = sw2();
    const first = discoveryMessages(ctxFor(fx, {previous: {}}));
    const overrides = {
        LEQ1000: {enabled: true, channels: {0: {publish: false}, 1: {publish: false}, 2: {publish: false}}},
    };
    const r = discoveryMessages(ctxFor(fx, {overrides, previous: first.published}));
    assert.deepEqual(r.messages, []);
    assert.deepEqual(r.clear, [{topic: 'homeassistant/device/ccu_LEQ1000/config', payload: ''}]);
    assert.deepEqual(r.availability, [], 'no availability for a device that is not published');
    assert.deepEqual(r.published.LEQ1000, {});

    const never = discoveryMessages(ctxFor(fx, {overrides, previous: {LEQ1000: {}}}));
    assert.deepEqual(never.clear, [], 'nothing to clear when nothing was published');
});

test('usesChildDevices: the node model, a device split or a channel setting', () => {
    assert.equal(usesChildDevices('children', {}), true);
    assert.equal(usesChildDevices('off', {}), false);
    assert.equal(usesChildDevices('devices', undefined), false);
    assert.equal(usesChildDevices('off', {A: {enabled: true, split: 'children'}}), true);
    assert.equal(usesChildDevices('off', {A: {enabled: false, split: 'children'}}), false, 'an unticked device');
    assert.equal(usesChildDevices('off', {A: {enabled: true, channels: {1: {device: 'child'}}}}), true);
    assert.equal(
        usesChildDevices('off', {A: {enabled: true, channels: {1: {device: 'own'}, 2: null}}, B: null}),
        false,
    );
});

test('HM dimmer: the virtual dimmers are one unit with the real one', () => {
    const fx = fixture(
        'BidCos-RF',
        'LEQ2000',
        'HM-LC-Dim1TPBU-FM',
        '2.2',
        13,
        ['MAINTENANCE', 'DIMMER', 'VIRTUAL_DIMMER', 'VIRTUAL_DIMMER'],
        {LEQ2000: 'Dimmer'},
    );
    const r = discoveryMessages(ctxFor(fx, {channelDevices: 'children'}));
    assert.equal(r.messages[0].payload.cdevs, undefined, 'one function unit: no split');
    const own = discoveryMessages(ctxFor(fx, {overrides: {LEQ2000: {enabled: true, channels: {1: {device: 'child'}}}}}))
        .messages[0].payload;
    assert.deepEqual(
        Object.keys(own.cdevs[0].cmps)
            .filter((k) => /^\d+_LEVEL$/.test(k))
            .sort(),
        ['1_LEVEL', '2_LEVEL', '3_LEVEL'],
    );
});
