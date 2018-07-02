const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuSignal {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            this.ccu.register(this);

            this.on('input', () => {
                let payload;
                switch (config.channelType) {
                    case 'SIGNAL_CHIME':
                        payload = config.chime;
                        break;
                    case 'SIGNAL_LED':
                        payload = config.led;
                        break;
                    default:
                        console.error('channelType', config.channelType, 'unknown');
                }
                this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-signal', CcuSignal);
};
