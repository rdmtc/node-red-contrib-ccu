/* Fixtures for the Home Assistant discovery tests, built from the shipped paramsets.json -
   exactly what an existing install has (some entries carry CONTROL hints, others do not). */

const paramsets = require('../../../paramsets.json');

/**
 * One device with the given channel types (channel i gets the i-th type).
 * @returns {{devices: object, description: Function, channelName: Function}}
 */
function fixture(iface, address, type, firmware, version, channelTypes, names = {}) {
    const devices = {[iface]: {}};
    const children = channelTypes.map((_, i) => `${address}:${i}`);
    devices[iface][address] = {ADDRESS: address, TYPE: type, FIRMWARE: firmware, VERSION: version, CHILDREN: children};
    channelTypes.forEach((chType, i) => {
        devices[iface][children[i]] = {ADDRESS: children[i], TYPE: chType, PARENT: address, PARENT_TYPE: type};
    });
    const description = (ifc, chAddress) => {
        const ch = devices[ifc][chAddress];
        const key = `${ifc}/${type}/${firmware}/${version}/${ch.TYPE}/VALUES`;
        if (!paramsets[key]) {
            throw new Error(`fixture key ${key} missing in paramsets.json`);
        }

        return paramsets[key];
    };
    return {devices, description, channelName: (a) => names[a]};
}

/** every device type paramsets.json knows, as a synthetic device with one channel per channel type */
function allKnownFixtures() {
    const groups = new Map();
    for (const key of Object.keys(paramsets)) {
        const [iface, type, firmware, version, chType, paramset] = key.split('/');
        if (paramset !== 'VALUES' || !iface || !type || !chType) {
            continue;
        }

        const gkey = [iface, type, firmware, version].join('/');
        if (!groups.has(gkey)) {
            groups.set(gkey, {iface, type, firmware, version: Number(version), channelTypes: []});
        }

        const g = groups.get(gkey);
        if (!g.channelTypes.includes(chType)) {
            g.channelTypes.push(chType);
        }
    }

    const out = [];
    for (const [gkey, g] of groups) {
        const channelTypes = [
            ...g.channelTypes.filter((t) => t === 'MAINTENANCE'),
            ...g.channelTypes.filter((t) => t !== 'MAINTENANCE'),
        ];
        const address = 'SYN' + String(out.length).padStart(7, '0');
        const names = {[address]: `${g.type} ${address}`};
        channelTypes.forEach((_, i) => {
            // every third channel carries a name of its own, the others the CCU's default
            names[`${address}:${i}`] = i % 3 === 1 ? `Raum ${i}` : `${g.type} ${address}:${i}`;
        });
        out.push({
            group: gkey,
            address,
            fx: fixture(g.iface, address, g.type, g.firmware, g.version, channelTypes, names),
        });
    }

    return out;
}

/** the discovery context the pure functions take */
function ctxFor(fx, more = {}) {
    return {
        prefix: 'homeassistant',
        origin: {name: 'node-red-contrib-ccu', sw: '4.2.0-test', url: 'https://example.invalid'},
        jsonPayloads: true,
        devices: fx.devices,
        selected: Object.keys(fx.devices).flatMap((iface) =>
            Object.values(fx.devices[iface])
                .filter((d) => !d.PARENT)
                .map((d) => d.ADDRESS),
        ),
        description: fx.description,
        channelName: fx.channelName,
        rooms: () => [],
        statusTopicFor: (iface, address, dp) => `hm/status/${fx.channelName(address) || address}/${dp}`,
        setTopicFor: (iface, address, dp) => `hm/set/${address}/${dp}`,
        ...more,
    };
}

/** the variants of the node's options the payload snapshot covers */
const VARIANTS = {
    extended: {jsonPayloads: true, hmPayload: true, generic: true},
    basic: {jsonPayloads: true, hmPayload: false, generic: true},
    plain: {jsonPayloads: false, generic: true},
    semantic: {jsonPayloads: true, hmPayload: true, generic: false},
};

module.exports = {fixture, allKnownFixtures, ctxFor, VARIANTS};
