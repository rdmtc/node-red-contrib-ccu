/* Party mode on HmIP thermostats (task 2, #156, #161).

   An HmIP HEATING_CLIMATECONTROL_TRANSCEIVER channel carries PARTY_TIME_START,
   PARTY_TIME_END and PARTY_SET_POINT_TEMPERATURE (and the read-only
   PARTY_MODE). The device takes the three only together: a setValue of one
   of them resets the other two - PARTY_TIME_START alone puts PARTY_TIME_END
   back to `1999_11_30 00:00` (#156). The CCU's WebUI writes them as one
   putParamset on VALUES, and so do we: a write to one of the three is merged
   with the current values of the other two into one putParamset.

   The times are strings in the device's own format, `YYYY_MM_DD HH:MM` in
   local time (minutes in steps of five - the device rounds). A Date, an ISO
   string or epoch milliseconds are formatted for it; a string already in the
   format passes through.

   The older HM thermostats (PARTY_MODE_SUBMIT, the PARTY_START_ and PARTY_STOP_ fields)
   are another protocol and not covered here. Pure. */

const PARTY_DATAPOINTS = ['PARTY_TIME_START', 'PARTY_TIME_END', 'PARTY_SET_POINT_TEMPERATURE'];
const PARTY_TIMES = ['PARTY_TIME_START', 'PARTY_TIME_END'];
const TIME_FORMAT = /^\d{4}_\d{2}_\d{2} \d{2}:\d{2}$/;

/**
 * Is this a write the device only takes together with the other two?
 * @param {string} datapoint
 * @param {object} [valuesDescription] the channel's VALUES paramset description
 * @returns {boolean}
 */
function isPartyWrite(datapoint, valuesDescription) {
    return (
        PARTY_DATAPOINTS.includes(datapoint) &&
        Boolean(valuesDescription) &&
        PARTY_DATAPOINTS.every((name) => Boolean(valuesDescription[name]))
    );
}

/**
 * The device's time string for a value: a Date, epoch milliseconds, an ISO
 * (or Date-parsable) string, or a string already in the format.
 * @param {*} value
 * @returns {string} the formatted time, or the value as a string when it cannot be read as a time
 */
function formatPartyTime(value) {
    if (typeof value === 'string' && TIME_FORMAT.test(value)) {
        return value;
    }

    let date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string' && value.trim() !== '') {
        date = new Date(value);
    }

    if (!date || Number.isNaN(date.getTime())) {
        return String(value);
    }

    const pad = (n) => String(n).padStart(2, '0');
    return (
        date.getFullYear() +
        '_' +
        pad(date.getMonth() + 1) +
        '_' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes())
    );
}

/**
 * The complete VALUES paramset for one party write: the written datapoint
 * plus the current values of the other two.
 * @param {string} datapoint the one being written
 * @param {*} value its new value
 * @param {object} current the other datapoints' current values by name (undefined when unknown)
 * @returns {{values: object, missing: string[]}} the merged three, and the names no current value was known for
 */
function mergePartyValues(datapoint, value, current) {
    const values = {};
    const missing = [];
    for (const name of PARTY_DATAPOINTS) {
        let v = name === datapoint ? value : current && current[name];
        if (v === undefined || v === null) {
            missing.push(name);
            continue;
        }

        if (PARTY_TIMES.includes(name)) {
            v = formatPartyTime(v);
        }

        values[name] = v;
    }

    return {values, missing};
}

module.exports = {PARTY_DATAPOINTS, isPartyWrite, formatPartyTime, mergePartyValues};
