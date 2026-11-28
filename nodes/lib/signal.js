/* The signal node's commands, by channel type (pure: no connection, no Node-RED).

   COLOR_BEHAVIOUR (#177): the HmIP-BSL with firmware 2.x and the channel type
   OPTICAL_SIGNAL_RECEIVER (HmIPW-WRC6) have a datapoint beside COLOR and LEVEL that
   says how the LED lights - on, blinking, flashing, billowing. Its default is OFF,
   so a command without it leaves the LED dark. The channel's description decides
   whether it is sent: a BSL 2.x keeps the channel type DIMMER_VIRTUAL_RECEIVER of
   the 1.x, which does not have the datapoint. */

/** COLOR_BEHAVIOUR's entries, in the order of the devices' VALUE_LIST */
const COLOR_BEHAVIOURS = [
    'OFF',
    'ON',
    'BLINKING_SLOW',
    'BLINKING_MIDDLE',
    'BLINKING_FAST',
    'FLASH_SLOW',
    'FLASH_MIDDLE',
    'FLASH_FAST',
    'BILLOW_SLOW',
    'BILLOW_MIDDLE',
    'BILLOW_FAST',
    'OLD_VALUE',
    'DO_NOT_CARE',
];

/** what a node without the setting sends: the LED lights steadily */
const DEFAULT_COLOR_BEHAVIOUR = 1;

/**
 * Accept both the editor's list shape and a plain array of values, so a
 * flow can send `msg.config.soundList = [1, 2]` instead of building
 * `[{sound: 1}, {sound: 2}]` by hand (#148).
 * @param {*} list
 * @param {string} key 'sound' or 'color'
 * @returns {object[]}
 */
function normalizeList(list, key) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list.map((item) => (item !== null && typeof item === 'object' ? item : {[key]: item}));
}

/**
 * The COLOR_BEHAVIOUR to send, as the entry's number.
 * @param {*} value the setting: a number, a number as text or an entry's name; empty = the default
 * @param {string[]} [list] the channel's VALUE_LIST
 * @returns {number}
 * @throws {Error} a value the list does not have
 */
function colorBehaviourValue(value, list) {
    const entries = Array.isArray(list) && list.length > 0 ? list : COLOR_BEHAVIOURS;
    if (value === undefined || value === null || value === '') {
        return DEFAULT_COLOR_BEHAVIOUR;
    }

    const number = typeof value === 'number' ? value : /^\d+$/.test(String(value).trim()) ? Number(value) : -1;
    const index = number === -1 ? entries.indexOf(String(value).trim().toUpperCase()) : number;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
        throw new Error(`colorBehaviour ${value} unknown`);
    }

    return index;
}

/**
 * Whether a coloured-LED channel takes COLOR_BEHAVIOUR.
 * @param {string} channelType
 * @param {object} [description] the channel's VALUES description, if known
 * @returns {boolean}
 */
function hasColorBehaviour(channelType, description) {
    if (description && Object.keys(description).length > 0) {
        const dp = description.COLOR_BEHAVIOUR;
        return Boolean(dp && dp.OPERATIONS & 2);
    }

    // no description at hand: the channel type OPTICAL_SIGNAL_RECEIVER always has it, a BSL only from 2.x
    return channelType === 'OPTICAL_SIGNAL_RECEIVER';
}

/**
 * The command for one message.
 * @param {object} config the node's effective configuration
 * @param {object} [description] the channel's VALUES description, if known
 * @returns {{datapoint: string, value: *}|{paramset: object}} a setValue or a putParamset on VALUES
 * @throws {Error} an unknown channel type or setting
 */
function signalCommand(config, description) {
    switch (config.channelType) {
        case 'SIGNAL_CHIME':
            return {
                datapoint: 'SUBMIT',
                value: [config.volume / 100, config.repeat, 108000, ...String(config.chime).split(',')],
            };
        case 'SIGNAL_LED':
            return {datapoint: 'SUBMIT', value: ['1', config.repeat, 108000, ...String(config.led).split(',')]};
        case 'ALARM_SWITCH_VIRTUAL_RECEIVER':
            return {
                paramset: {
                    ACOUSTIC_ALARM_SELECTION: config.acousticAlarmSelection,
                    DURATION_UNIT: config.durationUnit,
                    DURATION_VALUE: Number.parseInt(config.durationValue, 10) || 0,
                    OPTICAL_ALARM_SELECTION: config.opticalAlarmSelection,
                },
            };
        case 'DIMMER_VIRTUAL_RECEIVER': {
            const dimmerList = normalizeList(config.dimmerList, 'color');
            const paramset = {
                LEVEL: config.dimmerLevel / 100,
                RAMP_TIME_UNIT: config.rampTimeUnit,
                RAMP_TIME_VALUE: Number(config.rampTimeValue),
                DURATION_UNIT: config.durationUnit,
                DURATION_VALUE: Number.parseInt(config.durationValue, 10) || 0,
                REPETITIONS: Number(config.repetitions),
                OUTPUT_SELECT_SIZE: dimmerList.length,
            };
            dimmerList.forEach((item, i) => {
                const index = i + 1;
                paramset['COLOR_LIST_' + index] = Number(item.color);
                paramset['ON_TIME_LIST_' + index] = Number(item.ontime);
            });
            return {paramset};
        }

        case 'BSL_DIMMER_VIRTUAL_RECEIVER':
        case 'OPTICAL_SIGNAL_RECEIVER': {
            const paramset = {
                LEVEL: config.dimmerLevel / 100,
                RAMP_TIME_UNIT: config.rampTimeUnit,
                RAMP_TIME_VALUE: Number(config.rampTimeValue),
                DURATION_UNIT: config.durationUnit,
                DURATION_VALUE: Number.parseInt(config.durationValue, 10) || 0,
                COLOR: Number(config.dimmerColor),
            };
            if (hasColorBehaviour(config.channelType, description)) {
                const list = description && description.COLOR_BEHAVIOUR && description.COLOR_BEHAVIOUR.VALUE_LIST;
                paramset.COLOR_BEHAVIOUR = colorBehaviourValue(config.colorBehaviour, list);
            }

            return {paramset};
        }

        case 'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER': {
            const soundList = normalizeList(config.soundList, 'sound');
            const paramset = {
                LEVEL: config.soundLevel / 100,
                RAMP_TIME_UNIT: config.rampTimeUnit,
                RAMP_TIME_VALUE: Number(config.rampTimeValue),
                DURATION_UNIT: config.durationUnit,
                DURATION_VALUE: Number.parseInt(config.durationValue, 10) || 0,
                REPETITIONS: Number(config.repetitions),
                OUTPUT_SELECT_SIZE: soundList.length,
            };
            soundList.forEach((item, i) => {
                paramset['SOUNDFILE_LIST_' + (i + 1)] = Number(item.sound);
            });
            return {paramset};
        }

        default:
            throw new Error(`channelType ${config.channelType} unknown`);
    }
}

module.exports = {
    COLOR_BEHAVIOURS,
    DEFAULT_COLOR_BEHAVIOUR,
    colorBehaviourValue,
    hasColorBehaviour,
    normalizeList,
    signalCommand,
};
