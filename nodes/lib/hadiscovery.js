/* Home Assistant MQTT discovery, device-based (HA >= 2024.11):
   https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload

   Ported from hm2mqtt.js lib/hadiscovery.js (+ the scaffold helpers of
   mqtt-interfaces-core) for the ccu-homeassistant node (B-16). One HA device
   per Homematic device, composite entities from the channel roles (light,
   cover, climate, lock, event, switch, ...) and generic entities for every
   other datapoint (disabled by default).

   Pure: devices, descriptions, names and topic builders in, discovery
   messages out. The topics are whole strings rendered by the caller from the
   ccu-mqtt node's templates — a controller has to be told where the values
   actually are, not where a convention would put them. */

const {channelRole, haUnit, isFraction, PARAMETERS} = require('./haroles.js');

const TILT_TYPES = /BLIND/;

/** Platforms without a state topic. */
const STATELESS = new Set(['button', 'notify', 'scene', 'tag']);

/** device classes that only binary_sensor knows — a sensor/number with one of them is rejected by HA */
const BINARY_ONLY_CLASSES = new Set([
    'running',
    'update',
    'problem',
    'tamper',
    'connectivity',
    'motion',
    'occupancy',
    'safety',
    'opening',
    'window',
    'door',
    'smoke',
    'plug',
    'light',
    'lock',
    'presence',
    'vibration',
    'sound',
]);

/**
 * @typedef {object} DiscoveryContext
 * @property {string} [prefix] discovery prefix (default homeassistant)
 * @property {{name: string, sw: string, url?: string}} origin the `o` block (package name/version/url)
 * @property {boolean} [jsonPayloads] status payloads are {val, ts, lc} (ccu-mqtt mqsh-*), false = plain
 * @property {boolean} [generic] generic entities for datapoints without a role (default true)
 * @property {Object<string, Object<string, object>>} devices metadata.devices (iface → address → device)
 * @property {string[]} selected device addresses to publish
 * @property {(iface: string, address: string) => object | undefined} description VALUES description of a channel
 * @property {(address: string) => string | undefined} channelName
 * @property {(address: string) => string[] | undefined} [rooms]
 * @property {(iface: string, address: string, datapoint: string) => string} statusTopicFor
 * @property {(iface: string, address: string, datapoint: string) => string} setTopicFor
 */

/** Stable device/unique-id base: ccu_<address>, sanitised. */
function discoveryId(address) {
    return 'ccu_' + String(address).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function discoveryTopic(prefix, id) {
    return (prefix || 'homeassistant') + '/device/' + id + '/config';
}

function templates(json) {
    const v = json ? 'value_json.val' : 'value';
    return {
        v,
        num: `{{ ${v} }}`,
        bool: (on = 'ON', off = 'OFF') =>
            json
                ? `{{ '${on}' if ${v} else '${off}' }}`
                : `{{ '${on}' if (${v} | string | lower) in ('1', 'true', 'on') else '${off}' }}`,
        percent: `{{ ((${v} | float(0)) * 100) | round }}`,
        int: `${v} | int(0)`,
        float: `${v} | float(0)`,
    };
}

function labelOf(channel, deviceName, fallback) {
    const name = channel.name;
    if (!name) {
        return fallback;
    }

    if (deviceName && name !== deviceName && name.startsWith(deviceName)) {
        const rest = name.slice(deviceName.length).replace(/^[\s:.-]+/, '');
        return rest || fallback;
    }

    if (name === deviceName) {
        return fallback;
    }

    return name;
}

function prettify(dp) {
    return dp
        .toLowerCase()
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
}

/** drops undefined values so `extra: {stat_t: undefined}` removes a default */
function compact(object) {
    const out = {};
    for (const [k, v] of Object.entries(object)) {
        if (v !== undefined) {
            out[k] = v;
        }
    }

    return out;
}

/**
 * Finds the interface a device address belongs to.
 * @param {Object<string, Object<string, object>>} devices
 * @param {string} address
 * @returns {string | undefined}
 */
function ifaceOf(devices, address) {
    return Object.keys(devices || {}).find((iface) => devices[iface] && devices[iface][address]);
}

/**
 * HmIP actuators: a *_TRANSMITTER channel (state) followed by three *_VIRTUAL_RECEIVER channels
 * (control). The first receiver becomes the control entity with the transmitter's state topic,
 * the others are secondary (disabled by default).
 */
function resolveVirtualReceivers(channels) {
    const families = [
        {transmitter: 'switch_state', receiver: 'switch'},
        {transmitter: 'dimmer_state', receiver: 'dimmer'},
        {transmitter: 'cover_state', receiver: 'cover'},
    ];
    for (const {transmitter, receiver} of families) {
        let current = null;
        let count = 0;
        for (const ch of channels) {
            if (ch.role === transmitter && /_TRANSMITTER$/.test(ch.TYPE)) {
                current = ch;
                count = 0;
                continue;
            }

            if (ch.role === receiver && /_VIRTUAL_RECEIVER$/.test(ch.TYPE) && current) {
                count += 1;
                ch.stateChannel = current;
                if (count === 1) {
                    current.transmitterFor = ch;
                } else {
                    ch.secondary = true;
                }
            } else if (ch.role === receiver && /_VIRTUAL_RECEIVER$/.test(ch.TYPE)) {
                // standalone receiver blocks without a transmitter: first of three is primary
                count += 1;
                if (count > 1 && (count - 1) % 3 !== 0) {
                    ch.secondary = true;
                }
            }
        }
    }

    // HM virtual dimmers (HM-LC-Dim1TPBU-FM ch 2/3) are secondaries of channel 1
    for (const ch of channels) {
        if (ch.TYPE === 'VIRTUAL_DIMMER') {
            ch.secondary = true;
        }
    }
}

/**
 * Builds the discovery block of one device.
 * @param {DiscoveryContext} ctx
 * @param {string} iface
 * @param {object} device device metadata (ADDRESS, TYPE, CHILDREN, FIRMWARE)
 * @returns {{id: string, device: object, components: object, availability: object[]} | null}
 *          null when the device yields no entity
 */
function deviceBlock(ctx, iface, device) {
    const json = ctx.jsonPayloads !== false;
    const generic = ctx.generic !== false;
    const t = templates(json);
    const list = ctx.devices[iface];
    const st = ctx.statusTopicFor;
    const cmd = ctx.setTopicFor;
    const roomsOf = ctx.rooms || (() => []);

    const id = discoveryId(device.ADDRESS);
    const deviceName = ctx.channelName(device.ADDRESS) || device.ADDRESS;
    const channels = (device.CHILDREN || [])
        .map((address) => list[address])
        .filter(Boolean)
        .map((ch) => ({
            ...ch,
            index: Number.parseInt(String(ch.ADDRESS).split(':')[1], 10),
            name: ctx.channelName(ch.ADDRESS),
            description: ctx.description(iface, ch.ADDRESS) || {},
        }))
        .sort((a, b) => a.index - b.index);
    for (const ch of channels) {
        ch.role = channelRole(ch.TYPE, ch.description);
    }

    resolveVirtualReceivers(channels);

    const components = {};
    const add = (key, e) => {
        components[key] = e;
    };

    const rooms = new Set();
    for (const ch of channels) {
        for (const r of roomsOf(ch.ADDRESS) || []) {
            rooms.add(r);
        }
    }

    const maintenance = channels.find((ch) => ch.index === 0);

    for (const ch of channels) {
        const consumed = new Set();
        const stateCh = ch.stateChannel || ch;
        const sst = (dp) => st(iface, stateCh.ADDRESS, dp);
        const own = (dp) => st(iface, ch.ADDRESS, dp);
        const scmd = (dp) => cmd(iface, ch.ADDRESS, dp);

        /** one entity: common fields + the platform specific `extra` (which may override) */
        const e = (dp, platform, label, more = {}) => {
            const stateless = STATELESS.has(platform);
            const uid = more.uid || `${ch.index}_${dp}`;
            return compact({
                p: platform,
                uniq_id: `${id}_${uid}`,
                name: label,
                ...(!stateless && {stat_t: own(dp)}),
                ...(!stateless && json && {val_tpl: '{{ value_json.val }}'}),
                ...(more.command && {cmd_t: scmd(dp)}),
                ...(more.extra || {}),
            });
        };

        const fallback = ch.index === 0 ? 'Maintenance' : `Channel ${ch.index}`;
        const label = labelOf(ch, deviceName, fallback);
        const has = (dp) => Boolean(ch.description[dp]);
        const key = (dp) => `${ch.index}_${dp}`;
        const disabled = ch.secondary ? {en: false} : {};

        /** key presses: one event entity per channel, fed by the aggregate <channel>/PRESS item
            that the ccu-homeassistant node publishes */
        const pressEvent = () => {
            const types = ['PRESS_SHORT', 'PRESS_LONG', 'PRESS_LONG_RELEASE', 'PRESS_CONT'].filter((dp) => has(dp));
            if (types.length === 0) {
                return;
            }

            add(
                key('PRESS'),
                e('PRESS', 'event', label, {
                    extra: {
                        dev_cla: 'button',
                        evt_typ: types.map((x) => x.toLowerCase()),
                        val_tpl: `{{ {'event_type': (${t.v} | string | lower)} | tojson }}`,
                    },
                }),
            );
            for (const dp of types) {
                consumed.add(dp);
            }
        };

        // HA compares the templated state with state_on/state_off, which default to the
        // command payloads — say explicitly that the template yields ON/OFF
        const onOff = {pl_on: 'true', pl_off: 'false', stat_on: 'ON', stat_off: 'OFF'};

        switch (ch.role) {
            case 'switch':
                if (has('STATE')) {
                    add(
                        key('STATE'),
                        e('STATE', 'switch', label, {
                            command: true,
                            extra: {
                                stat_t: sst('STATE'),
                                val_tpl: t.bool(),
                                ...onOff,
                                ...disabled,
                            },
                        }),
                    );
                    consumed.add('STATE');
                }

                break;
            case 'switch_state':
                if (has('STATE') && !ch.transmitterFor) {
                    add(key('STATE'), e('STATE', 'binary_sensor', label, {extra: {val_tpl: t.bool(), en: false}}));
                    consumed.add('STATE');
                }

                if (ch.transmitterFor) {
                    consumed.add('STATE');
                }

                break;
            case 'dimmer':
                if (has('LEVEL')) {
                    add(
                        key('LEVEL'),
                        e('LEVEL', 'light', label, {
                            command: true,
                            extra: {
                                stat_t: sst('LEVEL'),
                                val_tpl: undefined,
                                stat_val_tpl: `{{ 'ON' if (${t.float}) > 0 else 'OFF' }}`,
                                pl_on: 'ON',
                                pl_off: 'OFF',
                                on_cmd_type: 'brightness',
                                bri_cmd_t: scmd('LEVEL'),
                                bri_cmd_tpl: '{{ (value / 100) | round(3) }}',
                                bri_scl: 100,
                                bri_stat_t: sst('LEVEL'),
                                bri_val_tpl: t.percent,
                                ...disabled,
                            },
                        }),
                    );
                    consumed.add('LEVEL');
                }

                break;
            case 'dimmer_state':
                if (ch.transmitterFor) {
                    consumed.add('LEVEL');
                }

                break;
            case 'cover': {
                if (has('LEVEL')) {
                    const tilt = has('LEVEL_2');
                    const direction = stateCh.description.ACTIVITY_STATE
                        ? 'ACTIVITY_STATE'
                        : stateCh.description.DIRECTION
                          ? 'DIRECTION'
                          : null;
                    add(
                        key('LEVEL'),
                        e('LEVEL', 'cover', label, {
                            command: true,
                            extra: {
                                stat_t: undefined,
                                val_tpl: undefined,
                                dev_cla: TILT_TYPES.test(ch.TYPE) ? 'blind' : 'shutter',
                                pl_open: 'OPEN',
                                pl_cls: 'CLOSE',
                                pl_stop: 'STOP',
                                pos_t: sst('LEVEL'),
                                pos_tpl: t.percent,
                                set_pos_t: scmd('LEVEL'),
                                set_pos_tpl: '{{ (position / 100) | round(3) }}',
                                pos_open: 100,
                                pos_clsd: 0,
                                ...(direction && {
                                    stat_t: sst(direction),
                                    val_tpl: `{% set d = ${t.int} %}{{ 'opening' if d == 1 else 'closing' if d == 2 else 'stopped' }}`,
                                    stat_opening: 'opening',
                                    stat_closing: 'closing',
                                    stat_stopped: 'stopped',
                                }),
                                ...(tilt && {
                                    tilt_cmd_t: scmd('LEVEL_2'),
                                    tilt_cmd_tpl: '{{ (tilt_position / 100) | round(3) }}',
                                    tilt_status_t: sst('LEVEL_2'),
                                    tilt_status_tpl: t.percent,
                                }),
                                ...disabled,
                            },
                        }),
                    );
                    for (const dp of ['LEVEL', 'LEVEL_2', 'STOP']) {
                        consumed.add(dp);
                    }
                }

                break;
            }

            case 'cover_state':
                if (ch.transmitterFor) {
                    for (const dp of ['LEVEL', 'LEVEL_2', 'ACTIVITY_STATE', 'DIRECTION']) {
                        consumed.add(dp);
                    }
                }

                break;
            case 'contact':
                if (has('STATE')) {
                    add(
                        key('STATE'),
                        e('STATE', 'binary_sensor', label, {
                            extra: {
                                dev_cla:
                                    ch.TYPE === 'MULTI_MODE_INPUT_TRANSMITTER'
                                        ? 'opening'
                                        : ch.TYPE === 'TILT_SENSOR'
                                          ? 'moving'
                                          : 'window',
                                val_tpl: t.bool(),
                            },
                        }),
                    );
                    consumed.add('STATE');
                }

                // HmIP input channels (FCI, DRI16/32, SCI) report presses as well
                pressEvent();
                break;
            case 'rotary_handle':
                if (has('STATE')) {
                    add(
                        key('STATE'),
                        e('STATE', 'binary_sensor', label, {
                            extra: {dev_cla: 'window', val_tpl: `{{ 'ON' if (${t.int}) != 0 else 'OFF' }}`},
                        }),
                    );
                    add(
                        key('STATE_text'),
                        e('STATE', 'sensor', `${label} handle`, {
                            uid: `${ch.index}_STATE_text`,
                            extra: {val_tpl: `{{ ['closed', 'tilted', 'open'][${t.int}] }}`, en: false},
                        }),
                    );
                    consumed.add('STATE');
                }

                break;
            case 'key':
                pressEvent();
                break;

            case 'climate_hmip':
                if (has('SET_POINT_TEMPERATURE')) {
                    const d = ch.description;
                    add(
                        key('CLIMATE'),
                        e('SET_POINT_TEMPERATURE', 'climate', label, {
                            uid: `${ch.index}_CLIMATE`,
                            extra: {
                                stat_t: undefined,
                                val_tpl: undefined,
                                temp_unit: 'C',
                                temp_step: 0.5,
                                min_temp: d.SET_POINT_TEMPERATURE.MIN ?? 4.5,
                                max_temp: d.SET_POINT_TEMPERATURE.MAX ?? 30.5,
                                temp_stat_t: own('SET_POINT_TEMPERATURE'),
                                temp_stat_tpl: t.num,
                                temp_cmd_t: scmd('SET_POINT_TEMPERATURE'),
                                ...(has('ACTUAL_TEMPERATURE') && {
                                    curr_temp_t: own('ACTUAL_TEMPERATURE'),
                                    curr_temp_tpl: t.num,
                                }),
                                ...(has('HUMIDITY') && {curr_hum_t: own('HUMIDITY'), curr_hum_tpl: t.num}),
                                modes: ['auto', 'heat'],
                                ...(has('SET_POINT_MODE') && {
                                    mode_stat_t: own('SET_POINT_MODE'),
                                    mode_stat_tpl: `{{ 'auto' if (${t.int}) == 0 else 'heat' }}`,
                                }),
                                ...(has('CONTROL_MODE') && {
                                    mode_cmd_t: scmd('CONTROL_MODE'),
                                    mode_cmd_tpl: "{{ 0 if value == 'auto' else 1 }}",
                                }),
                                ...(has('BOOST_MODE') && {
                                    pr_modes: ['boost'],
                                    pr_mode_stat_t: own('BOOST_MODE'),
                                    pr_mode_val_tpl: `{{ 'boost' if ${t.v} else 'none' }}`,
                                    pr_mode_cmd_t: scmd('BOOST_MODE'),
                                    pr_mode_cmd_tpl: "{{ 'true' if value == 'boost' else 'false' }}",
                                }),
                                ...(has('LEVEL') && {
                                    act_t: own('LEVEL'),
                                    act_tpl: `{{ 'heating' if (${t.float}) > 0 else 'idle' }}`,
                                }),
                            },
                        }),
                    );
                    for (const dp of [
                        'SET_POINT_TEMPERATURE',
                        'ACTUAL_TEMPERATURE',
                        'HUMIDITY',
                        'SET_POINT_MODE',
                        'CONTROL_MODE',
                        'BOOST_MODE',
                        'LEVEL',
                    ]) {
                        consumed.add(dp);
                    }
                }

                break;
            case 'climate_hm':
                if (has('SET_TEMPERATURE')) {
                    const d = ch.description;
                    add(
                        key('CLIMATE'),
                        e('SET_TEMPERATURE', 'climate', label, {
                            uid: `${ch.index}_CLIMATE`,
                            extra: {
                                stat_t: undefined,
                                val_tpl: undefined,
                                temp_unit: 'C',
                                temp_step: 0.5,
                                min_temp: d.SET_TEMPERATURE.MIN ?? 4.5,
                                max_temp: d.SET_TEMPERATURE.MAX ?? 30.5,
                                temp_stat_t: own('SET_TEMPERATURE'),
                                temp_stat_tpl: t.num,
                                temp_cmd_t: scmd('SET_TEMPERATURE'),
                                ...(has('ACTUAL_TEMPERATURE') && {
                                    curr_temp_t: own('ACTUAL_TEMPERATURE'),
                                    curr_temp_tpl: t.num,
                                }),
                                ...(has('ACTUAL_HUMIDITY') && {
                                    curr_hum_t: own('ACTUAL_HUMIDITY'),
                                    curr_hum_tpl: t.num,
                                }),
                                modes: ['auto', 'heat'],
                                ...(has('CONTROL_MODE') && {
                                    // CONTROL_MODE is read-only on HM thermostats; the words are
                                    // translated to the *_MODE actions by ccu-mqtt's setValue
                                    mode_stat_t: own('CONTROL_MODE'),
                                    mode_stat_tpl: `{{ 'heat' if (${t.int}) == 1 else 'auto' }}`,
                                    mode_cmd_t: scmd('CONTROL_MODE'),
                                    mode_cmd_tpl: "{{ 'AUTO-MODE' if value == 'auto' else 'MANU-MODE' }}",
                                    pr_modes: ['boost', 'comfort', 'eco'],
                                    pr_mode_stat_t: own('CONTROL_MODE'),
                                    pr_mode_val_tpl: `{{ 'boost' if (${t.int}) == 3 else 'none' }}`,
                                    pr_mode_cmd_t: scmd('CONTROL_MODE'),
                                    pr_mode_cmd_tpl:
                                        "{{ {'boost': 'BOOST-MODE', 'comfort': 'COMFORT-MODE', 'eco': 'LOWERING-MODE'}.get(value, 'AUTO-MODE') }}",
                                }),
                                ...(has('VALVE_STATE') && {
                                    act_t: own('VALVE_STATE'),
                                    act_tpl: `{{ 'heating' if (${t.int}) > 0 else 'idle' }}`,
                                }),
                            },
                        }),
                    );
                    for (const dp of [
                        'SET_TEMPERATURE',
                        'ACTUAL_TEMPERATURE',
                        'ACTUAL_HUMIDITY',
                        'CONTROL_MODE',
                        'BOOST_MODE',
                        'AUTO_MODE',
                        'MANU_MODE',
                        'COMFORT_MODE',
                        'LOWERING_MODE',
                    ]) {
                        consumed.add(dp);
                    }
                }

                break;
            case 'lock':
                if (has('STATE')) {
                    add(
                        key('STATE'),
                        e('STATE', 'lock', label, {
                            command: true,
                            extra: {
                                val_tpl: t.bool('UNLOCKED', 'LOCKED'),
                                stat_locked: 'LOCKED',
                                stat_unlocked: 'UNLOCKED',
                                pl_lock: 'false',
                                pl_unlk: 'true',
                            },
                        }),
                    );
                    consumed.add('STATE');
                }

                break;
            case 'smoke':
                if (has('SMOKE_DETECTOR_ALARM_STATUS')) {
                    add(
                        key('SMOKE'),
                        e('SMOKE_DETECTOR_ALARM_STATUS', 'binary_sensor', label, {
                            uid: `${ch.index}_SMOKE`,
                            extra: {dev_cla: 'smoke', val_tpl: `{{ 'ON' if (${t.int}) in (1, 3) else 'OFF' }}`},
                        }),
                    );
                    consumed.add('SMOKE_DETECTOR_ALARM_STATUS');
                } else if (has('STATE')) {
                    add(
                        key('STATE'),
                        e('STATE', 'binary_sensor', label, {extra: {dev_cla: 'smoke', val_tpl: t.bool()}}),
                    );
                    consumed.add('STATE');
                }

                break;
            case 'water':
                for (const dp of ['STATE', 'ALARMSTATE', 'MOISTURE_DETECTED', 'WATERLEVEL_DETECTED']) {
                    if (has(dp)) {
                        add(
                            key(dp),
                            e(
                                dp,
                                'binary_sensor',
                                dp === 'STATE' ? label : `${label} ${dp.toLowerCase().replace(/_/g, ' ')}`,
                                {extra: {dev_cla: 'moisture', val_tpl: t.bool()}},
                            ),
                        );
                        consumed.add(dp);
                    }
                }

                break;
            default:
                break;
        }

        // generic layer: everything else in the channel's VALUES description
        for (const [dp, d] of Object.entries(ch.description)) {
            if (consumed.has(dp) || !d || typeof d !== 'object') {
                continue;
            }

            const facts = PARAMETERS[dp] || {};
            const semantic = Boolean(facts.dev_cla || facts.enabled);
            if (!generic && !semantic) {
                continue;
            }

            const ops = typeof d.OPERATIONS === 'number' ? d.OPERATIONS : 5;
            const readable = Boolean(ops & 1) || Boolean(ops & 4);
            const writable = Boolean(ops & 2);
            const dpLabel = ch.index === 0 && ch.role === 'maintenance' ? prettify(dp) : `${label} ${prettify(dp)}`;
            const enabled = facts.enabled === true;
            const common = {
                ...(facts.dev_cla && {dev_cla: facts.dev_cla}),
                ...(facts.ent_cat && {ent_cat: facts.ent_cat}),
                ...(!enabled && {en: false}),
            };
            // sensor/number accept only their own device classes, select none at all
            const sensorCommon = BINARY_ONLY_CLASSES.has(common.dev_cla) ? {...common, dev_cla: undefined} : common;
            const selectCommon = {...common, dev_cla: undefined};
            const unit = facts.unit || haUnit(d.UNIT);
            const value = isFraction(d) ? t.percent : t.num;
            if (d.TYPE === 'BOOL' || d.TYPE === 'ACTION') {
                if (writable && !readable) {
                    if (d.TYPE === 'ACTION') {
                        add(key(dp), e(dp, 'button', dpLabel, {command: true, extra: {pl_prs: 'true', ...common}}));
                    }

                    continue;
                }

                if (writable && d.TYPE === 'BOOL') {
                    add(
                        key(dp),
                        e(dp, 'switch', dpLabel, {
                            command: true,
                            extra: {val_tpl: t.bool(), ...onOff, ...common},
                        }),
                    );
                } else if (d.TYPE === 'BOOL') {
                    add(
                        key(dp),
                        e(dp, 'binary_sensor', dpLabel, {
                            extra: {val_tpl: facts.inverted ? t.bool('OFF', 'ON') : t.bool(), ...common},
                        }),
                    );
                }

                continue;
            }

            if (d.TYPE === 'ENUM' && Array.isArray(d.VALUE_LIST)) {
                if (writable) {
                    add(
                        key(dp),
                        e(dp, 'select', dpLabel, {
                            command: true,
                            extra: {
                                options: d.VALUE_LIST,
                                val_tpl: `{{ ${JSON.stringify(d.VALUE_LIST)}[${t.int}] }}`,
                                cmd_tpl: `{{ ${JSON.stringify(d.VALUE_LIST)}.index(value) }}`,
                                ...selectCommon,
                            },
                        }),
                    );
                } else if (readable) {
                    add(
                        key(dp),
                        e(dp, 'sensor', dpLabel, {
                            extra: {val_tpl: `{{ ${JSON.stringify(d.VALUE_LIST)}[${t.int}] }}`, ...sensorCommon},
                        }),
                    );
                }

                continue;
            }

            if (d.TYPE === 'FLOAT' || d.TYPE === 'INTEGER') {
                if (writable && !readable) {
                    add(
                        key(dp),
                        e(dp, 'number', dpLabel, {
                            command: true,
                            extra: {
                                ...(typeof d.MIN === 'number' && {min: isFraction(d) ? d.MIN * 100 : d.MIN}),
                                ...(typeof d.MAX === 'number' && {
                                    max: isFraction(d) ? Math.min(d.MAX, 1) * 100 : d.MAX,
                                }),
                                step: d.TYPE === 'INTEGER' ? 1 : isFraction(d) ? 1 : 0.1,
                                ...(unit && {unit_of_meas: unit}),
                                ...(isFraction(d) && {cmd_tpl: '{{ (value / 100) | round(3) }}'}),
                                ...sensorCommon,
                            },
                        }),
                    );
                    continue;
                }

                add(
                    key(dp),
                    e(dp, 'sensor', dpLabel, {
                        extra: {
                            val_tpl: value,
                            ...(unit && {unit_of_meas: unit}),
                            ...(facts.stat_cla && {stat_cla: facts.stat_cla}),
                            ...sensorCommon,
                        },
                    }),
                );
                continue;
            }

            if (d.TYPE === 'STRING' && readable) {
                add(key(dp), e(dp, 'sensor', dpLabel, {extra: {val_tpl: t.num, ...sensorCommon}}));
            }
        }
    }

    if (Object.keys(components).length === 0) {
        return null;
    }

    // availability: the device's UNREACH (retained by ccu-mqtt) — there is no
    // bridge "connected" topic in the ccu-mqtt topic scheme
    // (an entry of the availability list takes `val_tpl`; `avty_tpl` is only valid at
    // the top level next to `avty_t` — HA rejects the whole device payload otherwise)
    const availability = [];
    if (maintenance && maintenance.description.UNREACH) {
        availability.push({t: st(iface, maintenance.ADDRESS, 'UNREACH'), val_tpl: t.bool('offline', 'online')});
    }

    return {
        id,
        device: compact({
            name: deviceName,
            mf: 'eQ-3',
            mdl: device.TYPE,
            sw: device.FIRMWARE ? String(device.FIRMWARE) : undefined,
            sa: rooms.size === 1 ? [...rooms][0] : undefined,
        }),
        components,
        availability,
    };
}

/**
 * The full discovery message of one device block.
 * @param {DiscoveryContext} ctx
 * @param {{id: string, device: object, components: object, availability: object[]}} block
 * @returns {{topic: string, payload: object}}
 */
function devicePayload(ctx, block) {
    const origin = ctx.origin || {name: 'node-red-contrib-ccu'};
    const payload = {
        dev: {ids: [block.id], ...block.device},
        o: compact({name: origin.name, sw: origin.sw, url: origin.url}),
        ...(block.availability.length > 0 && {avty: block.availability}),
        ...(block.availability.length > 1 && {avty_mode: 'all'}),
        qos: 0,
        cmps: block.components,
    };
    return {topic: discoveryTopic(ctx.prefix, block.id), payload};
}

/**
 * Empty retained config: removes the device (and all its entities) from Home Assistant.
 * @param {string} prefix
 * @param {string} address device address
 * @returns {{topic: string, payload: string}}
 */
function removalMessage(prefix, address) {
    return {topic: discoveryTopic(prefix, discoveryId(address)), payload: ''};
}

/**
 * Discovery messages for the selected devices.
 * @param {DiscoveryContext} ctx
 * @returns {{messages: Array<{topic: string, payload: object}>, missing: string[], empty: string[]}}
 *          missing: selected addresses not found in the metadata; empty: devices without entities
 */
function discoveryMessages(ctx) {
    const messages = [];
    const missing = [];
    const empty = [];
    for (const address of ctx.selected || []) {
        const iface = ifaceOf(ctx.devices, address);
        const device = iface && ctx.devices[iface][address];
        if (!device || device.PARENT) {
            missing.push(address);
            continue;
        }

        const block = deviceBlock(ctx, iface, device);
        if (!block) {
            empty.push(address);
            continue;
        }

        messages.push(devicePayload(ctx, block));
    }

    return {messages, missing, empty};
}

module.exports = {
    discoveryId,
    discoveryTopic,
    ifaceOf,
    resolveVirtualReceivers,
    deviceBlock,
    devicePayload,
    removalMessage,
    discoveryMessages,
};
