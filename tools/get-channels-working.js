const path = require('path');

const f1 = 'paramsets.json';

const ps1 = require(path.join(__dirname, f1));

console.log('WORKING:');
console.log([...new Set(Object.keys(ps1).filter(key => {
    return typeof ps1[key].WORKING !== 'undefined';
}).map(key => key.split('/')[key.split('/').length - 2]))]);

console.log('\nPROCESS:');
console.log([...new Set(Object.keys(ps1).filter(key => {
    return typeof ps1[key].PROCESS !== 'undefined';
}).map(key => key.split('/')[key.split('/').length - 2]))]);
