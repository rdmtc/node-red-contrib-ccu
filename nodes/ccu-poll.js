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

            this.on('input', (message, send, done) => {
                if (this.ccu.metaMode) {
                    // openccu-lite has no ReGaHSS - nothing to poll (B-17)
                    done(this.ccu.regaMissingError('system variables and programs'));
                    return;
                }

                // regaPoll() returns nothing and handles its own errors (#601)
                this.ccu.regaPoll();
                done();
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-poll', CcuPollNode);
};
