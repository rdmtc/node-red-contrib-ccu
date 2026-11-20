#!/usr/bin/env node
/* What the connection node writes into its userDir (the persistent storage on a CCU): write and
   rename operations and bytes per phase, against hm-simulator with the lab fixture's devices
   (BidCos-RF and HmIP-RF) and a ReGa holding a value for every VALUES datapoint.

   Phases: the first start (empty userDir), one hour on a CCU (the ReGa names re-read every 15
   minutes, called directly), a redeploy of the connection node, a restart of Node-RED (the
   modules loaded anew), a start where a device type unknown to the paramsets file is paired.

   Run: node test/bench/writes.js */

const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim.js');
const lab = require('hm-simulator/data/fixtures/lab-2026-09.json');
const {freePorts} = require('../utils');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-writes-'));

// --- the spy: every write, rename and copy into the userDir
const counters = {writes: 0, bytes: 0, renames: 0, copies: 0, files: {}};
function count(file, bytes, kind) {
    const name = path.basename(String(file)).replace(/^\.(.*)\.\d+\.[\da-z]+\.tmp$/, '$1');
    counters.files[name] = counters.files[name] || {ops: 0, bytes: 0};
    counters.files[name].ops += 1;
    counters.files[name].bytes += bytes;
    if (kind === 'copy') {
        counters.copies += 1;
    } else {
        counters.writes += 1;
    }

    counters.bytes += bytes;
}

const inUserDir = (file) => String(file).startsWith(userDir);
const {writeFileSync, renameSync, copyFileSync, writeFile} = fs;
fs.writeFileSync = function (file, data, ...rest) {
    if (inUserDir(file)) {
        count(file, Buffer.byteLength(data), 'write');
    }

    return writeFileSync.call(this, file, data, ...rest);
};

fs.writeFile = function (file, data, ...rest) {
    if (inUserDir(file)) {
        count(file, Buffer.byteLength(data), 'write');
    }

    return writeFile.call(this, file, data, ...rest);
};

fs.renameSync = function (from, to) {
    if (inUserDir(to)) {
        counters.renames += 1;
    }

    return renameSync.call(this, from, to);
};

fs.copyFileSync = function (from, to, ...rest) {
    if (inUserDir(to)) {
        count(to, fs.statSync(from).size, 'copy');
    }

    return copyFileSync.call(this, from, to, ...rest);
};

function reset() {
    counters.writes = 0;
    counters.bytes = 0;
    counters.renames = 0;
    counters.copies = 0;
    counters.files = {};
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';
const results = [];
let logged = 0;
function report(phase) {
    const files = Object.entries(counters.files)
        .map(([name, {ops, bytes}]) => name + ' ' + ops + 'x ' + mb(bytes))
        .join(', ');
    results.push({phase, ...counters, files: {...counters.files}});
    if (process.env.BENCH_VERBOSE) {
        const lines = helper
            .log()
            .args.map((a) => a[0])
            .filter((l) => l && l.msg && /saved|copied|paramsets|getParamsetDescription/.test(String(l.msg)))
            .map((l) => '    ' + String(l.msg).slice(0, 160));
        console.log(lines.slice(logged).join('\n'));
        logged = lines.length;
    }

    console.log(
        phase.padEnd(34) +
            String(counters.writes + counters.copies).padStart(3) +
            ' writes, ' +
            String(counters.renames).padStart(3) +
            ' renames, ' +
            mb(counters.bytes).padStart(9) +
            (files ? '  (' + files + ')' : ''),
    );
    reset();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// --- the simulated CCU
const IFACE_PREFIX = {rfd: 'BidCos-RF', hmip: 'HmIP-RF'};
function simOptions(extra = []) {
    const devices = {
        rfd: {devices: structuredClone(lab.devices.rfd.devices)},
        hmip: {devices: structuredClone([...lab.devices.hmip.devices, ...extra])},
    };
    return {
        devices,
        paramsetDescriptions: lab.paramsetDescriptions,
        rega: {
            port: 0,
            variables: [],
            programs: [],
            rooms: [],
            functions: [],
            channels: [],
            values: [],
        },
        config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    };
}

/** a value for every VALUES datapoint of the fixture, as the ReGa's getValues answers */
function regaValues(sim) {
    const values = [];
    const ts = Date.now();
    for (const [iface, prefix] of Object.entries(IFACE_PREFIX)) {
        for (const device of sim.devices[iface].devices) {
            if (!device.PARENT || !(device.PARAMSETS || []).includes('VALUES')) {
                continue;
            }

            const description = sim.getParamsetDescription(iface, device.ADDRESS, 'VALUES') || {};
            for (const [datapoint, d] of Object.entries(description)) {
                const value = d.TYPE === 'BOOL' || d.TYPE === 'ACTION' ? false : d.TYPE === 'STRING' ? '' : 0;
                values.push({name: prefix + '.' + device.ADDRESS + '.' + datapoint, value, ts});
            }
        }
    }

    return values;
}

/** ReGa channels with names and rooms, for the regadata file */
function regaChannels(sim) {
    const channels = [];
    let id = 1000;
    for (const [iface, prefix] of Object.entries(IFACE_PREFIX)) {
        for (const device of sim.devices[iface].devices) {
            channels.push({
                id: id++,
                address: device.ADDRESS,
                name: (device.PARENT ? 'Channel ' : 'Device ') + device.ADDRESS,
                type: device.PARENT ? 'CHANNEL' : 'DEVICE',
                iface: prefix,
                rooms: ['Living room'],
                functions: ['Light'],
            });
        }
    }

    return channels;
}

let modules;
function requireNodes() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes(path.join(path.sep, 'nodes', path.sep))) {
            delete require.cache[key];
        }
    }

    modules = [require('../../nodes/ccu-connection.js')];
}

async function startSim(extra) {
    const sim = new HmSim(simOptions(extra));
    await sim.whenReady();
    sim.regaSim.values = regaValues(sim);
    sim.regaSim.devices = regaChannels(sim);
    sim.regaSim.rooms = [{id: 1, name: 'Living room', channels: []}];
    sim.regaSim.functions = [{id: 2, name: 'Light', channels: []}];
    return sim;
}

async function load(sim) {
    const [bin, xml] = await freePorts(2);
    const flow = [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'bench',
            host: '127.0.0.1',
            regaEnabled: true,
            bcrfEnabled: true,
            iprfEnabled: true,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: '127.0.0.1',
            rpcServerHost: '127.0.0.1',
            rpcBinPort: String(bin),
            rpcXmlPort: String(xml),
            bcrfPort: sim.ports.rfd,
            iprfPort: sim.ports.hmip,
            regaPort: sim.regaSim.port,
        },
    ];
    await new Promise((resolve) => helper.load(modules, flow, resolve));
    const nc = helper.getNode('nc');
    const settled = () =>
        nc.cachedValuesReceived &&
        nc.ifaceStatus['BidCos-RF'] &&
        nc.ifaceStatus['HmIP-RF'] &&
        nc.paramsetQueue.length === 0 &&
        !nc.paramsetPending &&
        !nc.newParamsetDescription &&
        Object.keys(nc.paramsetNew).length === 0;
    // settled for three seconds in a row: the device lists, the paramset queue and the debounced
    // writes are through
    const end = Date.now() + 120000;
    let since = 0;
    while (Date.now() < end) {
        if (settled()) {
            since = since || Date.now();
            if (Date.now() - since >= 3000) {
                break;
            }
        } else {
            since = 0;
        }

        await wait(100);
    }

    if (!settled()) {
        throw new Error('the connection did not settle');
    }

    return nc;
}

async function main() {
    helper.init(require.resolve('node-red'));
    helper.settings({userDir});
    await new Promise((resolve) => helper.startServer(resolve));
    requireNodes();

    let sim = await startSim();
    let nc = await load(sim);
    report('first start (empty userDir)');

    for (let i = 0; i < 4; i++) {
        await nc.refreshRegaData();
    }

    await wait(1500);
    report('1 h on a CCU (4 name re-reads)');

    await helper.unload();
    nc = await load(sim);
    report('redeploy (stop + start)');

    await helper.unload();
    requireNodes();
    nc = await load(sim);
    report('Node-RED restart (stop + start)');

    // a device type the paramsets file does not know: its descriptions are fetched and saved
    await helper.unload();
    sim.close();
    const base = lab.devices.hmip.devices.find((d) => !d.PARENT && d.TYPE === 'HmIP-BBL');
    const extra = lab.devices.hmip.devices
        .filter((d) => d === base || d.PARENT === base.ADDRESS)
        .map((d) => {
            const copy = structuredClone(d);
            copy.ADDRESS = copy.ADDRESS.replace(base.ADDRESS, '0000BENCH0001');
            if (copy.PARENT) {
                copy.PARENT = '0000BENCH0001';
                copy.PARENT_TYPE = 'HmIP-BENCH';
            } else {
                copy.TYPE = 'HmIP-BENCH';
                copy.CHILDREN = copy.CHILDREN.map((c) => c.replace(base.ADDRESS, '0000BENCH0001'));
            }

            return copy;
        });
    const descriptions = {};
    for (const [key, value] of Object.entries(lab.paramsetDescriptions)) {
        if (key.startsWith('HmIP-RF/HmIP-BBL/' + base.FIRMWARE + '/' + base.VERSION + '/')) {
            descriptions[key.replace('/HmIP-BBL/', '/HmIP-BENCH/')] = value;
        }
    }

    sim = await startSim(extra);
    Object.assign(sim.paramsetDescriptions, descriptions);
    nc = await load(sim);
    report('start with a new device type');

    await helper.unload();
    report('stop');

    const sizes = fs
        .readdirSync(userDir)
        .map((f) => f + ' ' + mb(fs.statSync(path.join(userDir, f)).size))
        .join(', ');
    console.log('userDir: ' + sizes);
    sim.close();
    await new Promise((resolve) => helper.stopServer(resolve));
    fs.rmSync(userDir, {recursive: true, force: true});
    if (process.env.BENCH_JSON) {
        fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2));
    }

    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
