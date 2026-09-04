/* Semantic roles of channels and the Home Assistant facts of datapoints.
   Ported from hm2mqtt.js lib/roles.js (same author) for B-16.

   hm2mqtt derives the role from the CONTROL hint eQ-3 puts on every VALUES
   parameter. In the paramset cache shipped with this package (and therefore
   in the persisted cache of existing installs) only about half of the VALUES
   descriptions carry CONTROL fields — the older contributed user dumps were
   stripped of them — so here the channel TYPE is the primary key and CONTROL
   only refines where the description has it. Pure functions and tables, no I/O. */

/** CONTROL hint of a channel's primary datapoint → role; checked in this order */
const ROLE_BY_CONTROL = [
    ['LOCK.STATE', 'lock'],
    ['HEATING_CONTROL_HMIP.SETPOINT', 'climate_hmip'],
    ['HEATING_CONTROL.SETPOINT', 'climate_hm'],
    ['BLIND.LEVEL', 'cover'],
    ['BLIND_VIRTUAL_RECEIVER.LEVEL', 'cover'],
    ['SHUTTER_VIRTUAL_RECEIVER.LEVEL', 'cover'],
    ['BLIND_TRANSMITTER.LEVEL', 'cover_state'],
    ['SHUTTER_TRANSMITTER.LEVEL', 'cover_state'],
    ['DIMMER.LEVEL', 'dimmer'],
    ['DIMMER_REAL.LEVEL', 'dimmer_state'],
    ['SWITCH.STATE', 'switch'],
    ['SWITCH_TRANSMITTER.STATE', 'switch_state'],
    ['DANGER.STATE', 'smoke'],
    ['DOOR_SENSOR.STATE', 'contact'],
    ['RHS.STATE', 'rotary_handle'],
    ['MOTIONDETECTOR_TRANSCEIVER.MOTION_DETECTION_STATE', 'motion'],
    ['POWERMETER.POWER', 'energy'],
    ['POWERMETER_PSM.POWER', 'energy'],
    ['WEATHER_TRANSMIT.ACTUAL_TEMPERATURE', 'weather'],
    ['BUTTON.SHORT', 'key'],
    ['BUTTON_NO_FUNCTION.SHORT', 'key'],
];

/** channel type → role (HM classic, HmIP and the CCU's own channels) */
const ROLE_BY_TYPE = {
    MAINTENANCE: 'maintenance',

    // HM classic actuators
    SWITCH: 'switch',
    DIMMER: 'dimmer',
    VIRTUAL_DIMMER: 'dimmer',
    BLIND: 'cover',
    KEYMATIC: 'lock',

    // HmIP actuators: one *_TRANSMITTER (state) followed by *_VIRTUAL_RECEIVER channels (control)
    SWITCH_VIRTUAL_RECEIVER: 'switch',
    SWITCH_TRANSMITTER: 'switch_state',
    DIMMER_VIRTUAL_RECEIVER: 'dimmer',
    DIMMER_TRANSMITTER: 'dimmer_state',
    BLIND_VIRTUAL_RECEIVER: 'cover',
    SHUTTER_VIRTUAL_RECEIVER: 'cover',
    BLIND_TRANSMITTER: 'cover_state',
    SHUTTER_TRANSMITTER: 'cover_state',

    // thermostats
    HEATING_CLIMATECONTROL_TRANSCEIVER: 'climate_hmip',
    CLIMATECONTROL_RT_TRANSCEIVER: 'climate_hm',
    THERMALCONTROL_TRANSMIT: 'climate_hm',

    // sensors
    SHUTTER_CONTACT: 'contact',
    SHUTTER_CONTACT_TRANSCEIVER: 'contact',
    MULTI_MODE_INPUT_TRANSMITTER: 'contact',
    TILT_SENSOR: 'contact',
    ROTARY_HANDLE_SENSOR: 'rotary_handle',
    ROTARY_HANDLE_TRANSCEIVER: 'rotary_handle',
    MOTION_DETECTOR: 'motion',
    MOTIONDETECTOR_TRANSCEIVER: 'motion',
    PRESENCEDETECTOR_TRANSCEIVER: 'presence',
    WEATHER: 'weather',
    WEATHER_TRANSMIT: 'weather',
    WATERDETECTIONSENSOR: 'water',
    WATER_DETECTION_TRANSMITTER: 'water',
    SMOKE_DETECTOR: 'smoke',
    SMOKE_DETECTOR_TEAM: 'smoke',
    SMOKE_DETECTOR_TEAM_V2: 'smoke',
    POWERMETER: 'energy',
    ENERGIE_METER_TRANSMITTER: 'energy',

    // keys
    KEY: 'key',
    VIRTUAL_KEY: 'key',
    KEY_TRANSCEIVER: 'key',
    CENTRAL_KEY: 'key',
};

/**
 * @param {string} channelType
 * @param {object} [description] VALUES paramset description of the channel
 * @returns {string | null}
 */
function channelRole(channelType, description) {
    if (ROLE_BY_TYPE[channelType] === 'maintenance') {
        return 'maintenance';
    }

    if (description) {
        const controls = new Set(Object.values(description).map((d) => d && d.CONTROL));
        for (const [control, role] of ROLE_BY_CONTROL) {
            if (controls.has(control)) {
                return role;
            }
        }
    }

    return ROLE_BY_TYPE[channelType] || null;
}

/** units as the interface processes send them → Home Assistant */
function haUnit(unit) {
    if (!unit || unit === '""') {
        return undefined;
    }

    const u = String(unit).replace(/�|&#176;/g, '°');
    return (
        {
            '100%': '%',
            '% rF': '%',
            Lux: 'lx',
            degree: '°',
            '°': '°',
            min: 'min',
            s: 's',
            mA: 'mA',
        }[u] || u
    );
}

/** `100%` values are 0..1 on the wire */
function isFraction(description) {
    return Boolean(description && description.UNIT === '100%');
}

/**
 * Home Assistant facts of a datapoint by name: device class, state class, unit override,
 * entity category, enabled by default. Anything not listed is a plain sensor / binary_sensor,
 * disabled by default.
 */
const PARAMETERS = {
    ACTUAL_TEMPERATURE: {dev_cla: 'temperature', stat_cla: 'measurement', unit: '°C', enabled: true},
    TEMPERATURE: {dev_cla: 'temperature', stat_cla: 'measurement', unit: '°C', enabled: true},
    SET_POINT_TEMPERATURE: {dev_cla: 'temperature', unit: '°C'},
    SET_TEMPERATURE: {dev_cla: 'temperature', unit: '°C'},
    HUMIDITY: {dev_cla: 'humidity', stat_cla: 'measurement', unit: '%', enabled: true},
    ACTUAL_HUMIDITY: {dev_cla: 'humidity', stat_cla: 'measurement', unit: '%', enabled: true},
    ILLUMINATION: {dev_cla: 'illuminance', stat_cla: 'measurement', unit: 'lx', enabled: true},
    CURRENT_ILLUMINATION: {dev_cla: 'illuminance', stat_cla: 'measurement', unit: 'lx'},
    AVERAGE_ILLUMINATION: {dev_cla: 'illuminance', stat_cla: 'measurement', unit: 'lx'},
    BRIGHTNESS: {stat_cla: 'measurement', enabled: true},
    POWER: {dev_cla: 'power', stat_cla: 'measurement', unit: 'W', enabled: true},
    CURRENT: {dev_cla: 'current', stat_cla: 'measurement', unit: 'mA', enabled: true},
    VOLTAGE: {dev_cla: 'voltage', stat_cla: 'measurement', unit: 'V', enabled: true},
    FREQUENCY: {dev_cla: 'frequency', stat_cla: 'measurement', unit: 'Hz'},
    ENERGY_COUNTER: {dev_cla: 'energy', stat_cla: 'total_increasing', unit: 'Wh', enabled: true},
    RAIN_COUNTER: {dev_cla: 'precipitation', stat_cla: 'total_increasing', unit: 'mm', enabled: true},
    RAINING: {dev_cla: 'moisture', enabled: true},
    WIND_SPEED: {dev_cla: 'wind_speed', stat_cla: 'measurement', unit: 'km/h', enabled: true},
    WIND_DIRECTION: {stat_cla: 'measurement', unit: '°', enabled: true},
    WIND_DIR: {stat_cla: 'measurement', unit: '°', enabled: true},
    SUNSHINEDURATION: {stat_cla: 'total_increasing', enabled: true},
    AIR_PRESSURE: {dev_cla: 'atmospheric_pressure', stat_cla: 'measurement', unit: 'hPa', enabled: true},
    VALVE_STATE: {stat_cla: 'measurement', unit: '%', enabled: true},
    LEVEL: {stat_cla: 'measurement', unit: '%'},
    BOOST_STATE: {unit: 'min'},
    LOW_BAT: {dev_cla: 'battery', ent_cat: 'diagnostic', enabled: true},
    LOWBAT: {dev_cla: 'battery', ent_cat: 'diagnostic', enabled: true},
    UNREACH: {dev_cla: 'connectivity', ent_cat: 'diagnostic', inverted: true},
    STICKY_UNREACH: {dev_cla: 'problem', ent_cat: 'diagnostic'},
    CONFIG_PENDING: {ent_cat: 'diagnostic'},
    UPDATE_PENDING: {dev_cla: 'update', ent_cat: 'diagnostic'},
    DUTY_CYCLE: {dev_cla: 'problem', ent_cat: 'diagnostic'},
    DUTYCYCLE: {dev_cla: 'problem', ent_cat: 'diagnostic'},
    SABOTAGE: {dev_cla: 'tamper', ent_cat: 'diagnostic'},
    ERROR_SABOTAGE: {dev_cla: 'tamper', ent_cat: 'diagnostic'},
    RSSI_DEVICE: {dev_cla: 'signal_strength', stat_cla: 'measurement', unit: 'dBm', ent_cat: 'diagnostic'},
    RSSI_PEER: {dev_cla: 'signal_strength', stat_cla: 'measurement', unit: 'dBm', ent_cat: 'diagnostic'},
    OPERATING_VOLTAGE: {dev_cla: 'voltage', stat_cla: 'measurement', unit: 'V', ent_cat: 'diagnostic'},
    ERROR_CODE: {ent_cat: 'diagnostic'},
    WORKING: {dev_cla: 'running'},
    PROCESS: {dev_cla: 'running'},
    MOTION: {dev_cla: 'motion', enabled: true},
    PRESENCE_DETECTION_STATE: {dev_cla: 'occupancy', enabled: true},
    ALARMSTATE: {dev_cla: 'safety', enabled: true},
    MOISTURE_DETECTED: {dev_cla: 'moisture', enabled: true},
    WATERLEVEL_DETECTED: {dev_cla: 'moisture', enabled: true},
    ON_TIME: {ent_cat: 'config', unit: 's'},
    RAMP_TIME: {ent_cat: 'config', unit: 's'},
};

module.exports = {ROLE_BY_CONTROL, ROLE_BY_TYPE, channelRole, haUnit, isFraction, PARAMETERS};
