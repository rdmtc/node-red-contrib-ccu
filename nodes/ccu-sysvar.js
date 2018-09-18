const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuSysvarNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.iface = 'ReGaHSS';

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            // Migration
            if (typeof config.change === 'undefined') {
                config.change = true;
            }
            if (typeof config.cache === 'undefined') {
                config.cache = true;
            }

            this.name = config.name;
            this.topic = config.topic;

            this.idSubscription = this.ccu.subscribeSysvar({name: this.name, cache: config.cache, change: config.change}, msg => {
                msg.topic = this.ccu.topicReplace(config.topic, msg);
                this.send(msg);
            });

            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(msg) {
            const name = this.name || msg.topic;
            const val = msg.payload;
            this.ccu.setVariable(name, val)
                .then(() => {
                    this.status({fill: 'green', shape: 'dot', text: 'connected'});
                })
                .catch(err => {
                    this.error(err.message);
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                });
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.debug('unsubscribe');
                this.ccu.unsubscribeSysvar(this.idSubscription);
            }
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-sysvar', CcuSysvarNode);
};
