#!/usr/bin/env node
/* Merge a paramsets dump (from tools/paramsets-fetch.js, or a user's
   <userDir>/paramsets.json contributed in an issue) into the shipped
   paramsets.json.

   Usage: node tools/paramsets-join.js [dumpfile]   (default: ccu_paramsets_dump.json)

   The dump wins per paramset key (whole-object replacement, so parameters
   removed by a firmware update do not linger); existing keys are never
   deleted (users on old device firmware still need them). Output is
   key-sorted for stable diffs. See docs/paramsets.md. */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'paramsets.json');
const dumpFile = process.argv[2] || 'ccu_paramsets_dump.json';

const paramsets = JSON.parse(fs.readFileSync(target));
const dump = JSON.parse(fs.readFileSync(dumpFile));

console.log('paramsets.json:', Object.keys(paramsets).length, 'keys');
console.log(dumpFile + ':', Object.keys(dump).length, 'keys');

let added = 0;
let changed = 0;
let unchanged = 0;

Object.keys(dump).forEach((key) => {
    if (paramsets[key] === undefined) {
        added++;
    } else if (JSON.stringify(paramsets[key]) === JSON.stringify(dump[key])) {
        unchanged++;
        return;
    } else {
        changed++;
    }

    paramsets[key] = dump[key];
});

const sorted = {};
Object.keys(paramsets)
    .sort()
    .forEach((k) => {
        sorted[k] = paramsets[k];
    });

fs.writeFileSync(target, JSON.stringify(sorted, null, 2));
console.log(
    'added ' +
        added +
        ', changed ' +
        changed +
        ', unchanged ' +
        unchanged +
        ' -> ' +
        Object.keys(sorted).length +
        ' keys total',
);
