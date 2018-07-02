const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuPollNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.iface = 'ReGaHSS';

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            this.on('input', () => {
                this.ccu.regaPoll();
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-poll', CcuPollNode);
};
