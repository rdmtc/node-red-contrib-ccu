/* Message creation for datapoint events, extracted unchanged from
   ccu-connection.js createMessage (Phase 3). Takes the connection (or any
   object with the same shape — see the test fake) as first argument so the
   logic is unit-testable without booting Node-RED.

   Note: mutates ccu.values[datapointName] into existence when missing —
   that is part of the original contract (the caller stores the returned
   message there afterwards). */

/**
 * @param {object} ccu connection-shaped dependency: values, metadata.devices,
 *        channelNames, channelRooms, channelFunctions, host,
 *        getParamsetDescription(iface, device, psName, datapoint), logger.trace
 * @param {string} iface
 * @param {string} channel
 * @param {string} datapoint
 * @param {*} payload
 * @param {object} [additions] merged into the message (cache, working, uncertain, ts, lc, ...)
 * @returns {object} the message
 */
const {enumList} = require('./cast.js');

function createMessage(ccu, iface, channel, datapoint, payload, additions) {
    const datapointName = iface + '.' + channel + '.' + datapoint;
    if (!ccu.values[datapointName]) {
        ccu.values[datapointName] = {};
    }

    const device =
        ccu.metadata.devices[iface] &&
        ccu.metadata.devices[iface][channel] &&
        ccu.metadata.devices[iface][channel].PARENT;
    const ts = Date.now();
    let change = false;

    const valueStable = additions && additions.working ? ccu.values[datapointName].valueStable : payload;

    let description = {};
    if (ccu.metadata.devices[iface] && ccu.metadata.devices[iface][channel]) {
        description =
            ccu.getParamsetDescription(iface, ccu.metadata.devices[iface][channel], 'VALUES', datapoint) || {};
    }

    if (
        description.TYPE === 'ACTION' ||
        ccu.values[datapointName].cache ||
        ccu.values[datapointName].payload !== payload ||
        ccu.values[datapointName].valueStable !== valueStable
    ) {
        change = true;
    }

    ccu.logger.trace('createMessage', channel, datapoint, payload, 'change=' + change);

    const message = {
        topic: '',
        payload,
        ccu: ccu.host,
        iface,
        device,
        deviceName: ccu.channelNames[device],
        deviceType:
            ccu.metadata.devices[iface] &&
            ccu.metadata.devices[iface][device] &&
            ccu.metadata.devices[iface][device].TYPE,
        channel,
        channelName: ccu.channelNames[channel],
        channelType:
            ccu.metadata.devices[iface] &&
            ccu.metadata.devices[iface][channel] &&
            ccu.metadata.devices[iface][channel].TYPE,
        channelIndex: channel && Number.parseInt(channel.split(':')[1], 10),
        datapoint,
        datapointName,
        datapointType: description.TYPE,
        datapointMin: description.MIN,
        datapointMax: description.MAX,
        // the CCU sends the names in VALUE_LIST; reading description.ENUM
        // meant both of these were always undefined (B-3, ROADMAP 8.2)
        datapointEnum: enumList(description),
        datapointDefault: description.DEFAULT,
        datapointControl: description.CONTROL,
        value: payload,
        valuePrevious: ccu.values[datapointName].value,
        valueEnum: enumList(description) ? enumList(description)[Number(payload)] : undefined,
        valueStable,
        rooms: ccu.channelRooms[channel] || [],
        room:
            ccu.channelRooms[channel] && ccu.channelRooms[channel].length > 0
                ? ccu.channelRooms[channel][0]
                : undefined,
        functions: ccu.channelFunctions[channel] || [],
        function:
            ccu.channelFunctions[channel] && ccu.channelFunctions[channel].length > 0
                ? ccu.channelFunctions[channel][0]
                : undefined,
        ts,
        tsPrevious: ccu.values[datapointName].ts,
        lc: change ? ts : ccu.values[datapointName].lc,
        change,
        ...additions,
    };

    message.stable = !message.working;

    return message;
}

/*
 * The values cache file (task 36). An entry used to be the whole message (names, types, rooms,
 * functions, the description's MIN/MAX/ENUM ...), about 730 bytes; all of that comes from the
 * device table, the names and the paramset descriptions, which are loaded before the values. The
 * file keeps only the message's own fields that nothing else knows - under their message names,
 * so an entry is a subset of the message - and the load builds the message around them again.
 */
const SAVED_FIELDS = ['value', 'ts', 'lc', 'valuePrevious', 'tsPrevious', 'valueStable', 'working', 'direction'];

/**
 * The part of a cached message the values file keeps. `valueStable` only where it differs from
 * the value (while a datapoint is working), `working`/`direction` only where the message has them.
 * @param {object} message
 * @returns {object} the entry
 */
function savedValue(message) {
    const entry = {};
    for (const key of SAVED_FIELDS) {
        if (message[key] === undefined) {
            continue;
        }

        if (key === 'valueStable' && message.valueStable === message.value) {
            continue;
        }

        entry[key] = message[key];
    }

    return entry;
}

/**
 * Whether an entry of the values file is a whole message (the format up to 4.14).
 * @param {object} entry
 * @returns {boolean}
 */
function isFullMessage(entry) {
    return Boolean(entry) && (entry.datapointName !== undefined || entry.iface !== undefined);
}

/**
 * Builds the cached message of a values file entry again: the metadata as createMessage puts it
 * into a live event's message, the saved fields, and what a cached value is at start (cache, no
 * change, uncertain). An entry in the old format (the whole message) is taken through its saved
 * fields the same way; only when the device table does not know its channel (an interface whose
 * table was not read yet) is the old entry kept as it is, as the old load did.
 * @param {object} ccu connection-shaped (see createMessage); `peekParamsetDescription` (the same
 *        arguments as getParamsetDescription), if it has one, is asked instead: no fetch queued
 * @param {string} datapointName iface.channel.datapoint
 * @param {object} entry the file's entry
 * @returns {object|null} the message, null for a key that is not a datapoint name
 */
function restoreMessage(ccu, datapointName, entry) {
    const first = datapointName.indexOf('.');
    const last = datapointName.lastIndexOf('.');
    if (!entry || typeof entry !== 'object' || first < 1 || last <= first + 1 || last === datapointName.length - 1) {
        return null;
    }

    const iface = datapointName.slice(0, first);
    const channel = datapointName.slice(first + 1, last);
    const datapoint = datapointName.slice(last + 1);
    const full = isFullMessage(entry);
    const metadata = ccu.metadata && ccu.metadata.devices ? ccu.metadata : {devices: {}};
    const devices = metadata.devices[iface];
    if (full && !(devices && devices[channel])) {
        return {...entry, cache: true, change: false, uncertain: true};
    }

    const saved = full ? savedValue(entry) : entry;
    const additions = {};
    for (const key of SAVED_FIELDS) {
        if (saved[key] !== undefined) {
            additions[key] = saved[key];
        }
    }

    if (additions.valueStable === undefined) {
        additions.valueStable = saved.value;
    }

    // a view of the connection: createMessage reads the previous value from `values` and adds
    // an empty entry there, and asks for the description - neither may touch the connection
    const view = {
        host: ccu.host,
        metadata,
        channelNames: ccu.channelNames || {},
        channelRooms: ccu.channelRooms || {},
        channelFunctions: ccu.channelFunctions || {},
        values: {},
        logger: {trace() {}},
        getParamsetDescription: (i, device, paramset, parameter) =>
            (ccu.peekParamsetDescription || ccu.getParamsetDescription).call(ccu, i, device, paramset, parameter),
    };
    const message = createMessage(view, iface, channel, datapoint, saved.value, {
        ...additions,
        cache: true,
        change: false,
        uncertain: true,
    });

    return message;
}

module.exports = {createMessage, savedValue, restoreMessage, isFullMessage, SAVED_FIELDS};
