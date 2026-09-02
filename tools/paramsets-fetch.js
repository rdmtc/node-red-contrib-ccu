#!/usr/bin/env node
/* Fetch paramset descriptions from a live CCU into a dump file that
   tools/paramsets-join.js can merge into paramsets.json.

   Usage:
     node tools/paramsets-fetch.js --host <ccu> [options]

   Options:
     --host <host>      CCU hostname/IP (required)
     --ifaces <list>    comma-separated <iface>:<port>[/<path>] entries
                        (default: BidCos-RF:2001,HmIP-RF:2010,VirtualDevices:9292/groups,BidCos-Wired:2000)
     --out <file>       output file (default: ccu_paramsets_dump.json)
     --delay <ms>       throttle between getParamsetDescription calls (default: 200)
     --limit <n>        stop after n keys per interface (smoke tests)

   See docs/paramsets.md for the full regeneration procedure. Keys are built
   with the exact paramsetName() logic from nodes/ccu-connection.js:
   <iface>/<device TYPE>/<FIRMWARE>/<VERSION>/<channel TYPE>/<paramset>. */

const fs = require('fs');
const xmlrpc = require('homematic-xmlrpc');

function parseArgs(argv) {
    const args = {
        ifaces: 'BidCos-RF:2001,HmIP-RF:2010,VirtualDevices:9292/groups,BidCos-Wired:2000',
        out: 'ccu_paramsets_dump.json',
        delay: 200,
    };
    for (let i = 2; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '');
        args[key] = argv[i + 1];
    }

    if (!args.host) {
        console.error(
            'usage: node tools/paramsets-fetch.js --host <ccu> [--ifaces ...] [--out file] [--delay ms] [--limit n]',
        );
        process.exit(1);
    }

    args.delay = Number(args.delay);
    if (args.limit) {
        args.limit = Number(args.limit);
    }

    return args;
}

function methodCall(client, method, parameters) {
    return new Promise((resolve, reject) => {
        client.methodCall(method, parameters, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* same logic as paramsetName() in nodes/ccu-connection.js */
function paramsetKey(iface, devices, device, paramset) {
    let cType = '';
    let d;
    if (device.PARENT) {
        cType = device.TYPE;
        d = devices[device.PARENT];
    } else {
        d = device;
    }

    if (!d) {
        return null;
    }

    return [iface, d.TYPE, d.FIRMWARE, d.VERSION, cType, paramset].join('/');
}

async function fetchIface(iface, spec, host, dump, {delay, limit}) {
    const [port, path] = spec.split('/');
    const clientOptions = path ? {url: 'http://' + host + ':' + port + '/' + path} : {host, port: Number(port)};
    const client = xmlrpc.createClient(clientOptions);

    let deviceList;
    try {
        deviceList = await methodCall(client, 'listDevices', []);
    } catch (error) {
        console.error(iface + ': listDevices failed (' + error.message + ') - skipping interface');
        return;
    }

    const devices = {};
    deviceList.forEach((d) => {
        devices[d.ADDRESS] = d;
    });

    console.log(iface + ': ' + deviceList.length + ' devices/channels');
    let fetched = 0;
    let failed = 0;

    for (const device of deviceList) {
        for (const paramset of device.PARAMSETS || []) {
            const key = paramsetKey(iface, devices, device, paramset);
            if (!key || dump[key] !== undefined) {
                continue;
            }

            if (limit && fetched >= limit) {
                console.log(iface + ': --limit ' + limit + ' reached');
                return;
            }

            try {
                dump[key] = await methodCall(client, 'getParamsetDescription', [device.ADDRESS, paramset]);
                fetched++;
                process.stdout.write('\r' + iface + ': ' + fetched + ' keys fetched');
            } catch {
                failed++;
                await sleep(delay);
                try {
                    dump[key] = await methodCall(client, 'getParamsetDescription', [device.ADDRESS, paramset]);
                    fetched++;
                } catch (retryError) {
                    console.error('\n' + iface + ' ' + key + ': ' + retryError.message);
                }
            }

            await sleep(delay);
        }
    }

    console.log('\n' + iface + ': done, ' + fetched + ' keys' + (failed ? ' (' + failed + ' first-try failures)' : ''));
}

async function main() {
    const args = parseArgs(process.argv);
    const dump = {};

    for (const entry of args.ifaces.split(',')) {
        const idx = entry.indexOf(':');
        const iface = entry.slice(0, idx);
        const spec = entry.slice(idx + 1);
        await fetchIface(iface, spec, args.host, dump, args);
    }

    const sorted = {};
    Object.keys(dump)
        .sort()
        .forEach((k) => {
            sorted[k] = dump[k];
        });

    fs.writeFileSync(args.out, JSON.stringify(sorted, null, 2));
    console.log('wrote ' + Object.keys(sorted).length + ' keys to ' + args.out);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
