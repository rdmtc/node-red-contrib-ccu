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

            this.idSubscription = this.ccu.subscribeSysvar({name: this.name, cache: config.cache, change: config.change}, message => {
                this.status({fill: 'green', shape: 'ring', text: String(message.payload)});
                message.topic = this.ccu.topicReplace(config.topic, message);
                this.send(message);
            });

            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(message, send, done) {
            const name = this.name || message.topic;
            const value = message.payload;
            this.ccu.setVariable(name, value)
                .then(() => {
                    this.status({fill: 'green', shape: 'ring', text: String(value)});
                    done();
                })
                .catch(error => {
                    this.currentStatus = 'red';
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                    done(error);
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
