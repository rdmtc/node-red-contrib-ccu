const fs = require('fs');
const path = require('path');

module.exports = {
    removeFiles() {
        try {
            fs.unlinkSync(path.join(__dirname, '..', 'ccu_localhost.json'));
            fs.unlinkSync(path.join(__dirname, '..', 'ccu_paramsets_v2.json'));
            fs.unlinkSync(path.join(__dirname, '..', 'ccu_rega_localhost.json'));
            fs.unlinkSync(path.join(__dirname, '..', 'ccu_values_localhost.json'));
        } catch (_) {}
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
                rfd: {devices: Object.keys(devices['BidCos-RF']).map(addr => devices['BidCos-RF'][addr])},
                hmip: {devices: Object.keys(devices['HmIP-RF']).map(addr => devices['HmIP-RF'][addr])}
            },
            rega: {
                port: 8181,
                variables: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/variables.json'))),
                programs: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/programs.json'))),
                rooms: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/rooms.json'))),
                functions: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/functions.json'))),
                channels: JSON.parse(fs.readFileSync(path.join(__dirname, 'simulator-data/channels.json')))
            },
            config: {
                listenAddress: '127.0.0.1',
                binrpcListenPort: 2001,
                xmlrpcListenPort: 2010
            },
            behaviorPath: path.join(__dirname, 'simulator-behaviors')
        };
    }

};
