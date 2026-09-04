/* Channel matching for the filter form shared by ccu-set-value (and, from
   4.3.0, reusable by anything else that resolves a filter to channels).

   Extracted from ccu-set-value.js as part of B-2 so the matching is pure
   and unit-testable, and so the per-message effective config (see
   dynconfig.js) can be applied without the node caching the wrong thing.

   Each criterion has a companion `<name>Rx` selector: 'str' compares
   literally, 're' treats the configured value as a regular expression. */

/** The filter criteria, in the order they are evaluated. */
const FILTER_KEYS = [
    'device',
    'deviceType',
    'deviceName',
    'channel',
    'channelType',
    'channelIndex',
    'channelName',
    'rooms',
    'functions',
];

/** All configuration keys that make up a filter, including the Rx selectors. */
const CONFIG_KEYS = ['iface', ...FILTER_KEYS, 'datapoint', ...FILTER_KEYS.map((key) => key + 'Rx'), 'datapointRx'];

function matches(value, pattern, rx) {
    if (typeof value !== 'string') {
        return false;
    }

    return rx === 're' ? Boolean(value.match(new RegExp(pattern))) : value === pattern;
}

function matchesList(list, pattern, rx) {
    if (!Array.isArray(list)) {
        return false;
    }

    return rx === 're' ? list.some((item) => matches(item, pattern, 're')) : list.includes(pattern);
}

/**
 * Does one channel address pass the configured filter?
 *
 * @param {object} ccu connection-shaped dependency: metadata.devices,
 *        channelNames, channelRooms, channelFunctions
 * @param {string} iface
 * @param {string} address channel address, e.g. `ABC1234567:1`
 * @param {object} config effective configuration (see dynconfig.js)
 * @returns {boolean} true when the channel is selected by the filter
 */
function channelMatches(ccu, iface, address, config) {
    const channel = ccu.metadata.devices[iface] && ccu.metadata.devices[iface][address];

    // Device-level entries (no PARENT) are never targets, only their channels
    if (!channel || !channel.PARENT) {
        return false;
    }

    const device = ccu.metadata.devices[iface][channel.PARENT] || {};

    if (config.device && !matches(channel.PARENT, config.device, config.deviceRx)) {
        return false;
    }

    if (config.deviceType && !matches(device.TYPE, config.deviceType, config.deviceTypeRx)) {
        return false;
    }

    // Note: this used to test whether the *channel* had a ReGa name while
    // comparing the *device* name, so channels without a name of their own
    // were dropped even when their device matched (fixed in 4.3.0).
    if (config.deviceName && !matches(ccu.channelNames[channel.PARENT], config.deviceName, config.deviceNameRx)) {
        return false;
    }

    if (config.channel && !matches(address, config.channel, config.channelRx)) {
        return false;
    }

    if (config.channelType && !matches(channel.TYPE, config.channelType, config.channelTypeRx)) {
        return false;
    }

    if (config.channelIndex) {
        const index = address.split(':')[1];
        if (config.channelIndexRx === 're') {
            if (!matches(index, String(config.channelIndex), 're')) {
                return false;
            }
        } else if (!address.endsWith(':' + config.channelIndex)) {
            return false;
        }
    }

    if (config.channelName && !matches(ccu.channelNames[address], config.channelName, config.channelNameRx)) {
        return false;
    }

    if (config.rooms && !matchesList(ccu.channelRooms[address], config.rooms, config.roomsRx)) {
        return false;
    }

    if (config.functions && !matchesList(ccu.channelFunctions[address], config.functions, config.functionsRx)) {
        return false;
    }

    return true;
}

/**
 * The datapoints of one channel that pass the datapoint filter.
 * @param {object} ccu connection-shaped dependency: paramsetName, paramsetDescriptions
 * @param {string} iface
 * @param {string} address
 * @param {object} config effective configuration
 * @returns {string[]} datapoint names (empty when the channel has no VALUES description)
 */
function datapointsOf(ccu, iface, address, config) {
    const channel = ccu.metadata.devices[iface] && ccu.metadata.devices[iface][address];
    const psKey = channel && ccu.paramsetName(iface, channel, 'VALUES');
    const description = psKey && ccu.paramsetDescriptions[psKey];
    if (!description) {
        return [];
    }

    // No special case for an empty datapoint filter: with str it selects
    // nothing (a literal comparison against undefined) and with re it
    // selects everything, exactly as before the extraction. Silently
    // widening str to "all datapoints" would write the payload to every
    // datapoint of every matched channel.
    return Object.keys(description).filter((dp) => matches(dp, config.datapoint, config.datapointRx));
}

module.exports = {channelMatches, datapointsOf, FILTER_KEYS, CONFIG_KEYS};
