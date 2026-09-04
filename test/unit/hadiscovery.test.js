const {test} = require('node:test');
const assert = require('node:assert/strict');

const paramsets = require('../../paramsets.json');
const {
    discoveryId,
    discoveryTopic,
    ifaceOf,
    deviceBlock,
    devicePayload,
    removalMessage,
    discoveryMessages,
} = require('../../nodes/lib/hadiscovery.js');

/* Fixtures are built from the shipped paramsets.json — exactly what an
   existing install has (some entries carry CONTROL hints, others do not). */

function fixture(iface, address, type, firmware, version, channelTypes, names = {}) {
    const devices = {[iface]: {}};
    const children = channelTypes.map((_, i) => `${address}:${i}`);
    devices[iface][address] = {ADDRESS: address, TYPE: type, FIRMWARE: firmware, VERSION: version, CHILDREN: children};
    channelTypes.forEach((chType, i) => {
        devices[iface][children[i]] = {ADDRESS: children[i], TYPE: chType, PARENT: address, PARENT_TYPE: type};
    });
    const description = (ifc, chAddress) => {
        const ch = devices[ifc][chAddress];
        const key = `${ifc}/${type}/${firmware}/${version}/${ch.TYPE}/VALUES`;
        assert.ok(paramsets[key], `fixture key ${key} missing in paramsets.json`);
        return paramsets[key];
    };
    return {devices, description, channelName: (a) => names[a]};
}

function ctxFor(fx, more = {}) {
    return {
        prefix: 'homeassistant',
        origin: {name: 'node-red-contrib-ccu', sw: '4.2.0-test', url: 'https://example.invalid'},
        jsonPayloads: true,
        devices: fx.devices,
        selected: Object.keys(fx.devices).flatMap((iface) =>
            Object.values(fx.devices[iface])
                .filter((d) => !d.PARENT)
                .map((d) => d.ADDRESS),
        ),
        description: fx.description,
        channelName: fx.channelName,
        rooms: () => [],
        statusTopicFor: (iface, address, dp) => `hm/status/${fx.channelName(address) || address}/${dp}`,
        setTopicFor: (iface, address, dp) => `hm/set/${address}/${dp}`,
        ...more,
    };
}

function block(fx, more) {
    const ctx = ctxFor(fx, more);
    const address = ctx.selected[0];
    const iface = ifaceOf(fx.devices, address);
    return deviceBlock(ctx, iface, fx.devices[iface][address]);
}

const bsm = () =>
    fixture(
        'HmIP-RF',
        'ABC0001',
        'HmIP-BSM',
        '1.10.12',
        3,
        [
            'MAINTENANCE',
            'KEY_TRANSCEIVER',
            'KEY_TRANSCEIVER',
            'SWITCH_TRANSMITTER',
            'SWITCH_VIRTUAL_RECEIVER',
            'SWITCH_VIRTUAL_RECEIVER',
            'SWITCH_VIRTUAL_RECEIVER',
        ],
        {ABC0001: 'Küche Licht', 'ABC0001:4': 'Küche Licht:4', 'ABC0001:1': 'Küche Taster oben'},
    );

test('discoveryId/discoveryTopic', () => {
    assert.equal(discoveryId('ABC0001'), 'ccu_ABC0001');
    assert.equal(discoveryId('BidCoS-RF:1'), 'ccu_BidCoS-RF_1');
    assert.equal(discoveryTopic('homeassistant', 'ccu_X'), 'homeassistant/device/ccu_X/config');
    assert.equal(discoveryTopic(undefined, 'ccu_X'), 'homeassistant/device/ccu_X/config');
});

test('ifaceOf finds the interface of an address', () => {
    const fx = bsm();
    assert.equal(ifaceOf(fx.devices, 'ABC0001'), 'HmIP-RF');
    assert.equal(ifaceOf(fx.devices, 'ABC0001:3'), 'HmIP-RF');
    assert.equal(ifaceOf(fx.devices, 'NOPE'), undefined);
    assert.equal(ifaceOf(undefined, 'NOPE'), undefined);
});

test('HmIP switch actuator: one switch from the first virtual receiver, state from the transmitter', () => {
    const b = block(bsm());
    assert.equal(b.id, 'ccu_ABC0001');
    assert.deepEqual(b.device, {name: 'Küche Licht', mf: 'eQ-3', mdl: 'HmIP-BSM', sw: '1.10.12'});

    const sw = b.components['4_STATE'];
    assert.equal(sw.p, 'switch');
    assert.equal(sw.uniq_id, 'ccu_ABC0001_4_STATE');
    assert.equal(sw.name, '4', 'device name prefix is stripped from the channel name');
    assert.equal(sw.stat_t, 'hm/status/ABC0001:3/STATE', 'state topic is the SWITCH_TRANSMITTER channel');
    assert.equal(sw.cmd_t, 'hm/set/ABC0001:4/STATE');
    assert.equal(sw.pl_on, 'true');
    assert.equal(sw.val_tpl, "{{ 'ON' if value_json.val else 'OFF' }}");
    assert.equal(sw.en, undefined, 'first receiver is enabled');

    assert.equal(b.components['5_STATE'].en, false, 'second receiver disabled by default');
    assert.equal(b.components['6_STATE'].en, false);
    assert.equal(b.components['3_STATE'], undefined, 'transmitter STATE is consumed by the switch');
});

test('HmIP key channels become event entities', () => {
    const b = block(bsm());
    const ev = b.components['1_PRESS'];
    assert.equal(ev.p, 'event');
    assert.equal(ev.name, 'Küche Taster oben');
    assert.equal(ev.stat_t, 'hm/status/Küche Taster oben/PRESS');
    assert.deepEqual(ev.evt_typ, ['press_short', 'press_long']);
    assert.equal(ev.dev_cla, 'button');
    assert.equal(b.components['2_PRESS'].name, 'Channel 2', 'unnamed channel gets the fallback label');
    assert.equal(b.components['1_PRESS_SHORT'], undefined, 'PRESS_* are consumed by the event');
});

test('maintenance channel: availability from UNREACH, diagnostics disabled by default', () => {
    const b = block(bsm());
    assert.deepEqual(b.availability, [
        {t: 'hm/status/ABC0001:0/UNREACH', avty_tpl: "{{ 'offline' if value_json.val else 'online' }}"},
    ]);
    const rssi = b.components['0_RSSI_DEVICE'];
    assert.equal(rssi.p, 'sensor');
    assert.equal(rssi.name, 'Rssi Device');
    assert.equal(rssi.ent_cat, 'diagnostic');
    assert.equal(rssi.dev_cla, 'signal_strength');
    assert.equal(rssi.unit_of_meas, 'dBm');
    assert.equal(rssi.en, false);
    const unreach = b.components['0_UNREACH'];
    assert.equal(unreach.p, 'binary_sensor');
    assert.equal(unreach.dev_cla, 'connectivity');
    assert.equal(unreach.val_tpl, "{{ 'OFF' if value_json.val else 'ON' }}", 'connectivity is inverted UNREACH');
});

test('generic: false keeps only semantic entities', () => {
    const b = block(bsm(), {generic: false});
    assert.ok(b.components['0_UNREACH'], 'has a device class → kept');
    assert.ok(b.components['0_RSSI_DEVICE'], 'signal_strength device class → kept (disabled)');
    assert.equal(b.components['0_CONFIG_PENDING'], undefined, 'category only → dropped');
    assert.equal(b.components['0_ERROR_OVERHEAT'], undefined);
    assert.ok(b.components['4_STATE']);
    assert.equal(b.components['4_ON_TIME'], undefined);
    assert.equal(b.components['4_SECTION'], undefined);
    const withGeneric = block(bsm());
    assert.ok(withGeneric.components['0_CONFIG_PENDING']);
    assert.ok(withGeneric.components['4_SECTION']);
});

test('generic entities: write-only ACTION → button, writable FLOAT → number, ENUM → sensor', () => {
    const b = block(bsm());
    const onTime = b.components['4_ON_TIME'];
    assert.equal(onTime.p, 'number');
    assert.equal(onTime.cmd_t, 'hm/set/ABC0001:4/ON_TIME');
    assert.equal(onTime.min, 0);
    assert.equal(onTime.max, 8580000);
    assert.equal(onTime.unit_of_meas, 's');
    assert.equal(onTime.ent_cat, 'config');
    assert.equal(onTime.en, false);
    const process = b.components['4_PROCESS'];
    assert.equal(process.p, 'sensor');
    assert.equal(process.val_tpl, '{{ ["STABLE","NOT_STABLE"][value_json.val | int(0)] }}');
});

test('HM blind: cover with position, DIRECTION state and no tilt', () => {
    const fx = fixture('BidCos-RF', 'LEQ0001', 'HM-LC-Bl1-FM', '1.5', 1, ['MAINTENANCE', 'BLIND'], {
        LEQ0001: 'Rollo',
        'LEQ0001:1': 'Rollo Wohnzimmer',
    });
    const b = block(fx);
    const cover = b.components['1_LEVEL'];
    assert.equal(cover.p, 'cover');
    assert.equal(cover.dev_cla, 'blind');
    assert.equal(cover.name, 'Wohnzimmer', 'device name prefix stripped from the channel name');
    assert.equal(cover.pos_t, 'hm/status/Rollo Wohnzimmer/LEVEL');
    assert.equal(cover.pos_tpl, '{{ ((value_json.val | float(0)) * 100) | round }}');
    assert.equal(cover.set_pos_t, 'hm/set/LEQ0001:1/LEVEL');
    assert.equal(cover.cmd_t, 'hm/set/LEQ0001:1/LEVEL');
    assert.equal(cover.pl_stop, 'STOP');
    assert.equal(cover.stat_t, 'hm/status/Rollo Wohnzimmer/DIRECTION');
    assert.match(cover.val_tpl, /opening/);
    assert.equal(cover.tilt_cmd_t, undefined);
    assert.equal(b.components['1_STOP'], undefined, 'STOP is consumed by the cover');
    assert.equal(b.components['1_WORKING'].p, 'binary_sensor');
    assert.equal(b.components['1_WORKING'].dev_cla, 'running');
});

test('HmIP shutter actuator: one shutter cover from the first virtual receiver', () => {
    const fx = fixture('HmIP-RF', 'ABC0002', 'HmIP-BROLL', '1.6.2', 3, [
        'MAINTENANCE',
        'KEY_TRANSCEIVER',
        'KEY_TRANSCEIVER',
        'SHUTTER_TRANSMITTER',
        'SHUTTER_VIRTUAL_RECEIVER',
        'SHUTTER_VIRTUAL_RECEIVER',
        'SHUTTER_VIRTUAL_RECEIVER',
    ]);
    const b = block(fx);
    const cover = b.components['4_LEVEL'];
    assert.equal(cover.p, 'cover');
    assert.equal(cover.dev_cla, 'shutter');
    assert.equal(cover.pos_t, 'hm/status/ABC0002:3/LEVEL', 'position from the transmitter channel');
    assert.equal(cover.set_pos_t, 'hm/set/ABC0002:4/LEVEL');
    assert.equal(cover.en, undefined);
    assert.equal(b.components['5_LEVEL'].en, false);
    assert.equal(b.components['6_LEVEL'].en, false);
    assert.equal(b.components['3_LEVEL'], undefined);
    assert.equal(b.device.name, 'ABC0002', 'unnamed device falls back to its address');
    assert.equal(b.components['7_LEVEL'], undefined, 'no week profile channel in the fixture');
});

test('HM thermostat: climate with mode words for ccu-mqtt to translate', () => {
    const fx = fixture(
        'BidCos-RF',
        'MEQ0001',
        'HM-CC-RT-DN',
        '1.4',
        29,
        [
            'MAINTENANCE',
            'WEATHER_RECEIVER',
            'CLIMATECONTROL_RECEIVER',
            'WINDOW_SWITCH_RECEIVER',
            'CLIMATECONTROL_RT_TRANSCEIVER',
            'CLIMATECONTROL_RT_RECEIVER',
            'REMOTECONTROL_RECEIVER',
        ],
        {MEQ0001: 'Heizung Bad'},
    );
    const b = block(fx);
    const climate = b.components['4_CLIMATE'];
    assert.equal(climate.p, 'climate');
    assert.equal(climate.uniq_id, 'ccu_MEQ0001_4_CLIMATE');
    assert.equal(climate.name, 'Channel 4');
    assert.equal(climate.stat_t, undefined);
    assert.equal(climate.val_tpl, undefined);
    assert.equal(climate.min_temp, 4.5);
    assert.equal(climate.max_temp, 30.5);
    assert.equal(climate.temp_cmd_t, 'hm/set/MEQ0001:4/SET_TEMPERATURE');
    assert.equal(climate.temp_stat_t, 'hm/status/MEQ0001:4/SET_TEMPERATURE');
    assert.equal(climate.curr_temp_t, 'hm/status/MEQ0001:4/ACTUAL_TEMPERATURE');
    assert.equal(climate.mode_cmd_t, 'hm/set/MEQ0001:4/CONTROL_MODE');
    assert.equal(climate.mode_cmd_tpl, "{{ 'AUTO-MODE' if value == 'auto' else 'MANU-MODE' }}");
    assert.deepEqual(climate.pr_modes, ['boost', 'comfort', 'eco']);
    assert.equal(climate.act_t, 'hm/status/MEQ0001:4/VALVE_STATE');
    assert.equal(b.components['4_BOOST_MODE'], undefined, 'mode actions are consumed');
    const valve = b.components['4_VALVE_STATE'];
    assert.equal(valve.p, 'sensor', 'VALVE_STATE stays a sensor next to the climate action');
    assert.equal(valve.unit_of_meas, '%');
    assert.equal(valve.en, undefined, 'enabled by default');
    assert.equal(b.components['4_BATTERY_STATE'].p, 'sensor');
});

test('HmIP thermostat: climate from the HEATING_CLIMATECONTROL_TRANSCEIVER channel', () => {
    const fx = fixture(
        'HmIP-RF',
        'ABC0003',
        'HmIP-eTRV-2',
        '2.2.8',
        4,
        ['MAINTENANCE', 'HEATING_CLIMATECONTROL_TRANSCEIVER'],
        {ABC0003: 'Heizung Büro', 'ABC0003:1': 'Heizung Büro'},
    );
    const b = block(fx);
    const climate = b.components['1_CLIMATE'];
    assert.equal(climate.p, 'climate');
    assert.equal(climate.name, 'Channel 1', 'channel named like the device gets the fallback label');
    assert.equal(climate.temp_cmd_t, 'hm/set/ABC0003:1/SET_POINT_TEMPERATURE');
    assert.equal(climate.temp_stat_t, 'hm/status/Heizung Büro/SET_POINT_TEMPERATURE');
    assert.deepEqual(climate.modes, ['auto', 'heat']);
    assert.equal(climate.mode_stat_t, 'hm/status/Heizung Büro/SET_POINT_MODE');
    assert.equal(climate.mode_cmd_t, 'hm/set/ABC0003:1/CONTROL_MODE');
    assert.deepEqual(climate.pr_modes, ['boost']);
    assert.equal(climate.act_t, 'hm/status/Heizung Büro/LEVEL');
    assert.ok(b.components['0_LOW_BAT'], 'battery sensor');
    assert.equal(b.components['0_LOW_BAT'].dev_cla, 'battery');
    assert.equal(b.components['0_LOW_BAT'].en, undefined, 'LOW_BAT enabled by default');
});

test('HM shutter contact: window binary_sensor and battery', () => {
    const fx = fixture('BidCos-RF', 'LEQ0002', 'HM-Sec-SC-2', '2.4', 16, ['MAINTENANCE', 'SHUTTER_CONTACT'], {
        LEQ0002: 'Fenster Bad',
    });
    const b = block(fx);
    const contact = b.components['1_STATE'];
    assert.equal(contact.p, 'binary_sensor');
    assert.equal(contact.dev_cla, 'window');
    assert.equal(contact.stat_t, 'hm/status/LEQ0002:1/STATE');
    assert.equal(contact.cmd_t, undefined);
    assert.equal(b.components['0_LOWBAT'].dev_cla, 'battery');
});

test('KEYMATIC: lock entity plus a button for the write-only OPEN action', () => {
    const fx = fixture('BidCos-RF', 'LEQ0003', 'HM-Sec-Key', '2.5', 7, ['MAINTENANCE', 'KEYMATIC'], {
        LEQ0003: 'Haustür',
    });
    const b = block(fx);
    const lock = b.components['1_STATE'];
    assert.equal(lock.p, 'lock');
    assert.equal(lock.pl_lock, 'false');
    assert.equal(lock.pl_unlk, 'true');
    assert.equal(lock.val_tpl, "{{ 'UNLOCKED' if value_json.val else 'LOCKED' }}");
    assert.equal(b.components['1_OPEN'].p, 'button');
    assert.equal(b.components['1_OPEN'].pl_prs, 'true');
});

test('plain payloads: templates read `value` and parse 0/1/true/on', () => {
    const b = block(bsm(), {jsonPayloads: false});
    const sw = b.components['4_STATE'];
    assert.equal(sw.val_tpl, "{{ 'ON' if (value | string | lower) in ('1', 'true', 'on') else 'OFF' }}");
    assert.equal(b.components['0_RSSI_DEVICE'].val_tpl, '{{ value }}');
    assert.deepEqual(
        b.availability[0].avty_tpl,
        "{{ 'offline' if (value | string | lower) in ('1', 'true', 'on') else 'online' }}",
    );
});

test('a single room becomes the suggested area', () => {
    const b = block(bsm(), {rooms: (address) => (address === 'ABC0001:4' ? ['Küche'] : [])});
    assert.equal(b.device.sa, 'Küche');
    const b2 = block(bsm(), {rooms: (address) => (address === 'ABC0001:4' ? ['Küche'] : ['Flur'])});
    assert.equal(b2.device.sa, undefined, 'channels in several rooms → no area');
});

test('devicePayload: HA device discovery structure', () => {
    const fx = bsm();
    const ctx = ctxFor(fx);
    const b = deviceBlock(ctx, 'HmIP-RF', fx.devices['HmIP-RF'].ABC0001);
    const {topic, payload} = devicePayload(ctx, b);
    assert.equal(topic, 'homeassistant/device/ccu_ABC0001/config');
    assert.deepEqual(payload.dev, {
        ids: ['ccu_ABC0001'],
        name: 'Küche Licht',
        mf: 'eQ-3',
        mdl: 'HmIP-BSM',
        sw: '1.10.12',
    });
    assert.deepEqual(payload.o, {name: 'node-red-contrib-ccu', sw: '4.2.0-test', url: 'https://example.invalid'});
    assert.equal(payload.qos, 0);
    assert.equal(payload.avty.length, 1);
    assert.equal(payload.avty_mode, undefined);
    assert.equal(payload.cmps, b.components);
    assert.doesNotThrow(() => JSON.stringify(payload));
});

test('removalMessage clears the retained config', () => {
    assert.deepEqual(removalMessage('homeassistant', 'ABC0001'), {
        topic: 'homeassistant/device/ccu_ABC0001/config',
        payload: '',
    });
});

test('discoveryMessages: selected devices, missing addresses, devices without entities', () => {
    const fx = bsm();
    fx.devices['HmIP-RF'].EMPTY01 = {ADDRESS: 'EMPTY01', TYPE: 'HmIP-Nothing', CHILDREN: ['EMPTY01:1']};
    fx.devices['HmIP-RF']['EMPTY01:1'] = {ADDRESS: 'EMPTY01:1', TYPE: 'BLIND_WEEK_PROFILE', PARENT: 'EMPTY01'};
    const description = fx.description;
    fx.description = (iface, address) => (address.startsWith('EMPTY01') ? {} : description(iface, address));
    const ctx = ctxFor(fx, {selected: ['ABC0001', 'EMPTY01', 'GONE01', 'ABC0001:4']});
    const {messages, missing, empty} = discoveryMessages(ctx);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].topic, 'homeassistant/device/ccu_ABC0001/config');
    assert.deepEqual(missing, ['GONE01', 'ABC0001:4'], 'channels are not devices');
    assert.deepEqual(empty, ['EMPTY01']);
});

test('topics are taken verbatim from the callbacks (custom ccu-mqtt templates)', () => {
    const calls = [];
    const b = block(bsm(), {
        statusTopicFor: (iface, address, dp) => {
            calls.push([iface, address, dp]);
            return `ccu3/${iface}/${address}/${dp}`;
        },
        setTopicFor: (iface, address, dp) => `ccu3/${iface}/${address}/${dp}/set`,
    });
    assert.equal(b.components['4_STATE'].stat_t, 'ccu3/HmIP-RF/ABC0001:3/STATE');
    assert.equal(b.components['4_STATE'].cmd_t, 'ccu3/HmIP-RF/ABC0001:4/STATE/set');
    assert.ok(calls.some(([iface, address, dp]) => iface === 'HmIP-RF' && address === 'ABC0001:0' && dp === 'UNREACH'));
});
