const fs = require('fs');
const path = require('path');

module.exports = {
    /**
     * B-34: the suite's Node-RED userDir (test/hooks.js makes it), where the connection node's
     * cache files and fetched paramset descriptions land - never the repository.
     * @returns {string}
     */
    userDir() {
        return process.env.NRCCU_TEST_USERDIR || path.join(__dirname, '..');
    },
    removeFiles() {
        const files = [
            'ccu_localhost.json',
            'ccu_paramsets_v2.json',
            'ccu_rega_localhost.json',
            'ccu_values_localhost.json',
            'ccu_lite_localhost.json',
        ];
        for (const file of files) {
            try {
                fs.unlinkSync(path.join(module.exports.userDir(), file));
            } catch {}
        }
    },
    hmSimOptions() {
        const {devices} = JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/devices.json')));
        return {
            /*
            log: {
                debug: console.log,
                info: console.log,
                warn: console.log,
                error: console.log
            },*/

            devices: {
                rfd: {devices: Object.keys(devices['BidCos-RF']).map((addr) => devices['BidCos-RF'][addr])},
                hmip: {devices: Object.keys(devices['HmIP-RF']).map((addr) => devices['HmIP-RF'][addr])},
            },
            rega: {
                // task 15: free ports, so the suite runs beside a CCU or another suite; the
                // connection node gets them through simPorts() once whenReady() resolved
                port: 0,
                variables: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/variables.json'))),
                programs: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/programs.json'))),
                rooms: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/rooms.json'))),
                functions: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/functions.json'))),
                channels: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/channels.json'))),
            },
            config: {
                listenAddress: '127.0.0.1',
                binrpcListenPort: 0,
                xmlrpcListenPort: 0,
            },
            behaviorPath: path.join(__dirname, 'simulator-behaviors'),
        };
    },
    /**
     * task 15: the ports hm-simulator picked, as the connection node's config fields.
     * @param {object} sim a started HmSim (after whenReady())
     * @returns {object} bcrfPort, iprfPort, regaPort (when the ReGa mock runs)
     */
    simPorts(sim) {
        return {
            bcrfPort: sim.ports.rfd,
            iprfPort: sim.ports.hmip,
            ...(sim.regaSim && sim.regaSim.port ? {regaPort: sim.regaSim.port} : {}),
        };
    },
    /**
     * task 15: the connection node of a flow, to hand it the simulator's ports.
     * @param {Array} flow
     * @returns {object}
     */
    connectionNode(flow) {
        return flow.find((node) => node.type === 'ccu-connection');
    },
};
