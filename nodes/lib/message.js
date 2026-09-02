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
        datapointEnum: description.ENUM,
        datapointDefault: description.DEFAULT,
        datapointControl: description.CONTROL,
        value: payload,
        valuePrevious: ccu.values[datapointName].value,
        valueEnum: description.ENUM ? description.ENUM[Number(payload)] : undefined,
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

module.exports = {createMessage};
