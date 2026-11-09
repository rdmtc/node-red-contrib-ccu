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
const {freePorts} = require('./utils');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-userdir-'));
process.env.NRCCU_TEST_USERDIR = userDir;

/* Every connection node a spec loads gets its callback server ports (rpcBinPort, rpcXmlPort) from
   the OS, whatever the spec wrote: fixed ports collided with a CCU, another suite or anything else
   on the machine, and an occupied port failed the spec with EADDRINUSE. The flow's node is changed
   in place, so a spec that talks to the callback server reads the port from its flow after the
   load. A spec's fake interface processes take free ports of their own (utils.freePorts). */
const load = helper.load.bind(helper);
helper.load = async function (testNode, testFlow, testCredentials, cb) {
    const connections = (Array.isArray(testFlow) ? testFlow : []).filter((node) => node.type === 'ccu-connection');
    const ports = await freePorts(connections.length * 2);
    connections.forEach((node, index) => {
        node.rpcBinPort = String(ports[index * 2]);
        node.rpcXmlPort = String(ports[index * 2 + 1]);
    });
    return load(testNode, testFlow, testCredentials, cb);
};

exports.mochaHooks = {
    beforeAll() {
        helper.init(require.resolve('node-red'));
        helper.settings({userDir});
    },
    afterAll() {
        fs.rmSync(userDir, {recursive: true, force: true});
    },
};
