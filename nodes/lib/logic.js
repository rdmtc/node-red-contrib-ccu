/*
 * task 32: system variables and programs on openccu-lite. The system has no ReGaHSS; the addon
 * Logic (lite-addon-logic) offers them as devices of an interface of its own, which the system's
 * lite-rpc carries like the radio interfaces:
 *
 *   system variable `regen`  device var-regen (LOGIC-VARIABLE), channel var-regen:1, VALUE
 *                            (an alarm variable also ACKNOWLEDGE, COUNT, FIRST, LAST)
 *   program `markise`        device prg-markise (LOGIC-PROGRAM), channel prg-markise:1,
 *                            ACTIVE, RUN (with the conditions), RUN_THEN (the CCU's "Start"),
 *                            LAST_RUN (an event at every run)
 *
 * The address is the object's key and stays across a rename; the name is the system's metadata
 * name of the channel (or the device), which the addon writes. The sysvar and program nodes find
 * an object by that name, as they did by the ReGa name on a CCU, so a flow written for a CCU
 * keeps working after the switch once the variables and programs were imported.
 *
 * Pure helpers, no connection state: the connection (ccu-connection.js) keeps the tables.
 */

/** the interface's name as lite-addon-logic registers it */
const LOGIC_IFACE = 'Logic';

/** the addon's id, `addon` in GET /api/rpc/v1/interfaces */
const LOGIC_ADDON = 'logic';

/**
 * Whether an interface the system lists is Logic's: by its addon id, else by its name.
 * @param {string} name
 * @param {{addon?: string}} [info] the entry of GET /api/rpc/v1/interfaces
 * @returns {boolean}
 */
function isLogicIface(name, info) {
    if (info && info.addon) {
        return info.addon === LOGIC_ADDON;
    }

    return name === LOGIC_IFACE;
}

/**
 * What a Logic address stands for: a variable's or a program's value channel (`:1`), else null.
 * @param {string} channel e.g. var-regen:1
 * @returns {{kind: 'variable'|'program', key: string, device: string, channel: string}|null}
 */
function parseAddress(channel) {
    const match = /^(var|prg)-(.+):1$/.exec(String(channel || ''));
    if (!match) {
        return null;
    }

    return {
        kind: match[1] === 'var' ? 'variable' : 'program',
        key: match[2],
        device: match[1] + '-' + match[2],
        channel: match[1] + '-' + match[2] + ':1',
    };
}

/**
 * The name a node finds an object by: the channel's metadata name, else the device's, else its key
 * (a connection without a credential for the names).
 * @param {object} names channelNames, by address
 * @param {{key: string, device: string, channel: string}} ref from parseAddress()
 * @returns {string}
 */
function nameOf(names, ref) {
    const map = names || {};
    return map[ref.channel] || map[ref.device] || ref.key;
}

/**
 * The CCU's shape of a system variable (homematic-rega's getVariables) from the description of
 * Logic's VALUE datapoint: `valueType` boolean | number | string, `enum` (the texts for false and
 * true of a logic value, the entries of a value list), `unit`, and the Homematic type.
 * Without a description (not fetched yet) the type follows the value.
 * @param {object} [description] the paramset description of VALUE
 * @param {*} [value] the current value, for the fallback
 * @returns {{valueType: string, enum: string[], unit: string, type: string|undefined, min?: number, max?: number}}
 */
function variableShape(description, value) {
    const list = description && Array.isArray(description.VALUE_LIST) ? description.VALUE_LIST.map(String) : [];
    const unit = (description && typeof description.UNIT === 'string' && description.UNIT) || '';
    const type = description && description.TYPE;
    const shape = {valueType: 'number', enum: [], unit, type};
    switch (type) {
        case 'BOOL':
        case 'ACTION':
            shape.valueType = 'boolean';
            shape.enum = list;
            break;
        case 'STRING':
            shape.valueType = 'string';
            break;
        case 'ENUM':
            shape.enum = list;
            break;
        case 'FLOAT':
        case 'INTEGER':
            break;
        default:
            if (typeof value === 'boolean') {
                shape.valueType = 'boolean';
            } else if (typeof value === 'string') {
                shape.valueType = 'string';
            }
    }

    if (description && typeof description.MIN === 'number' && shape.valueType === 'number' && type !== 'ENUM') {
        shape.min = description.MIN;
    }

    if (description && typeof description.MAX === 'number' && shape.valueType === 'number' && type !== 'ENUM') {
        shape.max = description.MAX;
    }

    return shape;
}

/**
 * A value for Logic's VALUE, cast the way the CCU path casts a variable (castSysvar): a logic
 * value takes true/false, a number, or one of its two texts; a value list its entry's number or
 * text; a number a number; a string a string. A FLOAT goes out as homematic-xmlrpc's
 * `{explicitDouble}`, which lite.js turns into lite-rpc's double. Limits are the addon's to check:
 * it refuses a number outside them and an entry the list does not have, and the refusal is said.
 * @param {*} value
 * @param {{valueType: string, enum: string[], type?: string}} shape from variableShape()
 * @returns {*}
 */
function castVariable(value, shape) {
    const list = shape.enum || [];
    switch (shape.valueType) {
        case 'boolean':
            if (typeof value === 'string') {
                if (list.includes(value)) {
                    return list.indexOf(value) === 1;
                }

                if (value === 'false' || value === '0') {
                    return false;
                }
            }

            return Boolean(value);
        case 'string':
            return value === null || value === undefined ? '' : String(value);
        default: {
            if (typeof value === 'string' && list.includes(value)) {
                return list.indexOf(value);
            }

            if (typeof value === 'boolean') {
                value = value ? 1 : 0;
            }

            const number = Number.parseFloat(value);
            const safe = Number.isFinite(number) ? number : 0;
            if (shape.type === 'ENUM' || shape.type === 'INTEGER') {
                return Math.round(safe);
            }

            if (shape.type === 'FLOAT') {
                return {explicitDouble: safe};
            }

            return safe;
        }
    }
}

module.exports = {
    LOGIC_IFACE,
    LOGIC_ADDON,
    isLogicIface,
    parseAddress,
    nameOf,
    variableShape,
    castVariable,
};
