/* Pure value casting against a paramset description (TYPE/ENUM/MIN/MAX),
   extracted unchanged from ccu-connection.js paramCast (Phase 3).

   Note: nodes/ccu-mqtt.js still carries its own divergent variant (with
   MIN/MAX clamping and different INTEGER handling) — unifying that one is
   roadmap item B-3, deliberately not done in this behavior-preserving
   extraction. */

/**
 * Cast a value according to a paramset description.
 * @param {*} value
 * @param {object} [description] paramset description (TYPE, ENUM, ...);
 *        when missing, numbers are stringified (works for FLOAT/INTEGER
 *        datapoints) and everything else passes through unchanged.
 * @returns {*} the casted value; FLOAT becomes {explicitDouble: number}
 */
function castValue(value, description) {
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
            value = {explicitDouble: value};
            break;
        case 'ENUM':
            if (typeof value === 'string') {
                if (description.ENUM && description.ENUM.includes(value)) {
                    value = description.ENUM.indexOf(value);
                }
            }

        // Fallthrough by intention
        case 'INTEGER':
            if (typeof value === 'boolean') {
                value = Number(value);
            } else {
                value = Number.parseInt(value, 10) || 0;
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

module.exports = {castValue, castSysvar};
