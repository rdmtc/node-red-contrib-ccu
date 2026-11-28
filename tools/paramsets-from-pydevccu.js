#!/usr/bin/env node
/* Build a paramsets dump from pydevccu's device files (MIT,
   github.com/SukramJ/pydevccu): its device_descriptions/<type>.json is a
   listDevices result and its paramset_descriptions/<type>.json the
   getParamsetDescription results of a real device, by address. The dump has
   the keys of paramsets.json and is merged with tools/paramsets-join.js.

   For device types no system at hand has paired. See docs/paramsets.md.

   Usage:
     node tools/paramsets-from-pydevccu.js --dir <pydevccu>/pydevccu \
          [--iface HmIP-RF] [--out ccu_paramsets_dump.json] <type> [<type> ...] */

const fs = require('fs');
const path = require('path');

/**
 * The dump of one device type.
 * @param {string} iface interface name, the key's first part
 * @param {object[]} deviceList pydevccu's device descriptions (the device and its channels)
 * @param {object} descriptions pydevccu's paramset descriptions: address -> paramset -> description
 * @returns {object} paramsets.json key -> description
 */
function convert(iface, deviceList, descriptions) {
    const devices = {};
    for (const d of deviceList) {
        devices[d.ADDRESS] = d;
    }

    const dump = {};
    for (const device of deviceList) {
        // same logic as paramsetName() in nodes/ccu-connection.js
        const d = device.PARENT ? devices[device.PARENT] : device;
        if (!d) {
            continue;
        }

        const cType = device.PARENT ? device.TYPE : '';
        for (const [paramset, description] of Object.entries(descriptions[device.ADDRESS] || {})) {
            const key = [iface, d.TYPE, d.FIRMWARE, d.VERSION, cType, paramset].join('/');
            // an empty description is kept: it is what the system answers, and a missing key would be fetched
            if (dump[key] === undefined && description) {
                dump[key] = description;
            }
        }
    }

    return dump;
}

function main(argv) {
    const args = {iface: 'HmIP-RF', out: 'ccu_paramsets_dump.json', types: []};
    for (let i = 0; i < argv.length; i++) {
        if (['--dir', '--iface', '--out'].includes(argv[i])) {
            args[argv[i].slice(2)] = argv[++i];
        } else {
            args.types.push(argv[i]);
        }
    }

    if (!args.dir || args.types.length === 0) {
        console.error(
            'usage: paramsets-from-pydevccu.js --dir <pydevccu>/pydevccu [--iface HmIP-RF] [--out file] <type> ...',
        );
        process.exit(1);
    }

    const dump = {};
    for (const type of args.types) {
        const read = (folder) => JSON.parse(fs.readFileSync(path.join(args.dir, folder, type + '.json')));
        const part = convert(args.iface, read('device_descriptions'), read('paramset_descriptions'));
        console.log(type + ': ' + Object.keys(part).length + ' keys');
        Object.assign(dump, part);
    }

    const sorted = {};
    for (const key of Object.keys(dump).sort()) {
        sorted[key] = dump[key];
    }

    fs.writeFileSync(args.out, JSON.stringify(sorted, null, 2));
    console.log(args.out + ': ' + Object.keys(sorted).length + ' keys');
}

if (require.main === module) {
    main(process.argv.slice(2));
}

module.exports = {convert};
