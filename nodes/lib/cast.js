/* Pure value casting against a paramset description (TYPE/VALUE_LIST/MIN/MAX),
   extracted from ccu-connection.js paramCast (Phase 3) and unified with the
   ccu-mqtt node's divergent copy (B-3): that one clamped to MIN/MAX and cast
   INTEGER slightly differently, which is now the `clamp` option rather than a
   second implementation.

   Note on enum names: the CCU returns them in `VALUE_LIST`, not `ENUM`. The
   old code read `description.ENUM`, which no interface process ever sends -
   all 9494 ENUM-typed datapoints in the shipped paramsets.json carry
   VALUE_LIST and none carries ENUM - so casting an enum by name never worked
   and message.datapointEnum/valueEnum were always undefined (B-3, ROADMAP
   8.2). `ENUM` is still accepted as a fallback for hand-written data. */

/**
 * The list of enum names for a description, or undefined.
 * @param {object} [description]
 * @returns {string[]|undefined}
 */
function enumList(description) {
    if (!description) {
        return undefined;
    }

    const list = description.VALUE_LIST || description.ENUM;
    return Array.isArray(list) ? list : undefined;
}

function clampNumber(value, description) {
    if (typeof description.MIN === 'number' && value < description.MIN) {
        return description.MIN;
    }

    if (typeof description.MAX === 'number' && value > description.MAX) {
        return description.MAX;
    }

    return value;
}

/**
 * Cast a value according to a paramset description.
 * @param {*} value
 * @param {object} [description] paramset description (TYPE, VALUE_LIST, ...);
 *        when missing, numbers are stringified (works for FLOAT/INTEGER
 *        datapoints) and everything else passes through unchanged.
 * @param {object} [options]
 * @param {boolean} [options.clamp=false] limit numbers to MIN/MAX. Off for
 *        the value nodes (#74), on for the mqtt node, which has clamped
 *        since it was written.
 * @returns {*} the casted value; FLOAT becomes {explicitDouble: number}
 */
function castValue(value, description, options) {
    const clamp = Boolean(options && options.clamp);

    if (!description) {
        // Fallback: use string for numbers, this should work for double and integer datapoints
        if (typeof value === 'number') {
            value = String(value);
        }

        return value;
    }

    switch (description.TYPE) {
        case 'ACTION':
        // Fallthrough by intention
        case 'BOOL':
            if (value === 'false') {
                value = false;
            } else if (!isNaN(value)) {
                // Make sure that the string "0" gets casted to boolean false
                value = Number(value);
            }

            value = Boolean(value);
            break;
        case 'FLOAT':
            value = Number.parseFloat(value) || 0;
            /* Todo: rethink, deactivate boundary check for now (https://github.com/rdmtc/node-red-contrib-ccu/issues/74) */
            if (clamp) {
                value = clampNumber(value, description);
            }

            value = {explicitDouble: value};
            break;
        case 'ENUM': {
            const list = enumList(description);
            if (typeof value === 'string' && list && list.includes(value)) {
                value = list.indexOf(value);
            }
        }

        // Fallthrough by intention
        case 'INTEGER':
            if (typeof value === 'boolean') {
                value = Number(value);
            } else {
                value = Number.parseInt(value, 10) || 0;
            }

            if (clamp) {
                value = clampNumber(value, description);
            }

            break;
        case 'STRING':
            value = String(value);
            break;
        default:
    }

    return value;
}

/**
 * Cast a value for writing a ReGa system variable — returns the literal to
 * embed in the `dom.GetObject(id).State(...)` script. Extracted unchanged
 * from ccu-connection.js setVariable (Phase 3).
 * @param {*} value
 * @param {{valueType: string, enum: string[]}} sysvar
 * @returns {boolean|number|string} script literal (strings come back quoted)
 */
function castSysvar(value, sysvar) {
    switch (sysvar.valueType) {
        case 'boolean':
            if (typeof value === 'string') {
                if (sysvar.enum.includes(value)) {
                    value = sysvar.enum.indexOf(value);
                }
            }

            value = Boolean(value);
            break;
        case 'string':
            value = '"' + value + '"';
            break;
        default:
            if (typeof value === 'string') {
                if (sysvar.enum.includes(value)) {
                    value = sysvar.enum.indexOf(value);
                }
            }

            value = Number.parseFloat(value) || 0;
            break;
    }

    return value;
}

module.exports = {castValue, castSysvar, enumList};
