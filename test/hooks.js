/* B-34: the mocha suite's Node-RED userDir. node-red-node-test-helper sets none, so a connection
   node wrote its caches (ccu_*.json) and, worse, fetched paramset descriptions
   (<userDir>/paramsets.json) into the repository's root - the vendored paramsets.json grew fake
   device types during a spec. Every spec's files now land in one temporary directory, removed at
   the end. The directory is made at load (the specs compute their paths from it when they are
   required), the runtime setting is applied in the root hook, after every spec's helper.init(). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const helper = require('node-red-node-test-helper');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-userdir-'));
process.env.NRCCU_TEST_USERDIR = userDir;

exports.mochaHooks = {
    beforeAll() {
        helper.init(require.resolve('node-red'));
        helper.settings({userDir});
    },
    afterAll() {
        fs.rmSync(userDir, {recursive: true, force: true});
    },
};
