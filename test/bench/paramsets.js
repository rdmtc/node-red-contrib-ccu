#!/usr/bin/env node
/* task 28: the heap the paramset descriptions take - the whole vendored file (what every
   connection held until 4.7.2) against the descriptions of a number of device types (what a
   system with that many types holds now). Run: node --expose-gc test/bench/paramsets.js [types] */

const fs = require('fs');
const path = require('path');

if (typeof global.gc !== 'function') {
    console.error('run with --expose-gc');
    process.exit(1);
}

const types = Number(process.argv[2]) || 40;
const file = path.join(__dirname, '..', '..', 'paramsets.json');

function heapMB() {
    global.gc();
    global.gc();
    return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

const baseline = heapMB();
let all = JSON.parse(fs.readFileSync(file));
const keys = Object.keys(all);
const full = heapMB() - baseline;

// the device types (iface/type/firmware/version) the keys belong to
const byType = new Map();
for (const key of keys) {
    const type = key.split('/').slice(0, 4).join('/');
    if (!byType.has(type)) {
        byType.set(type, []);
    }

    byType.get(type).push(key);
}

// every n-th type, so the sample spans the file
const typeList = [...byType.keys()];
const step = Math.max(1, Math.floor(typeList.length / types));
const subset = {};
let picked = 0;
for (let i = 0; i < typeList.length && picked < types; i += step) {
    for (const key of byType.get(typeList[i])) {
        subset[key] = all[key];
    }

    picked += 1;
}

all = null;
const present = heapMB() - baseline;

console.log(
    'paramsets.json: ' +
        keys.length +
        ' keys of ' +
        typeList.length +
        ' device types, ' +
        Math.round(fs.statSync(file).size / 1024 / 1024) +
        ' MB on disk',
);
console.log('  the whole file in memory:           ' + full + ' MB');
console.log('  ' + picked + ' device types (' + Object.keys(subset).length + ' keys) in memory: ' + present + ' MB');
