const fs = require('fs');
const path = require('path');
const oe = require('obj-ease');

const f1 = 'paramsets.json';
const f2 = 'ccu_paramsets_v2.json';

const ps1 = require(path.join(__dirname, '..', f1));
const ps2 = require(path.join(__dirname, '..', f2));

console.log(f1, Object.keys(ps1).length);
console.log(f2, Object.keys(ps2).length);

oe.extend(ps1, ps2);

console.log('joined', Object.keys(ps1).length);

fs.writeFileSync(path.join(__dirname, '..', f1), JSON.stringify(ps1, null, '  '));
