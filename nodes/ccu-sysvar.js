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

            this.name = config.name;
            this.topic = config.topic;

            this.idSubscription = this.ccu.subscribeSysvar(this.name, msg => {
                msg.topic = this.ccu.topicReplace(config.topic, msg);
                this.send(msg);
            });
            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(msg) {
            const name = this.name || msg.topic;
            const value = msg.payload;
            this.ccu.setVariable(name, value)
                .then(msg => {
                    msg.topic = this.ccu.topicReplace(this.topic, msg);
                    this.send(msg);
                    this.status({fill: 'green', shape: 'dot', text: 'connected'});
                })
                .catch(err => {
                    this.error(err.message);
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                });
        }

        _destructor(done) {
            this.log('ccu-sysvar close');
            this.ccu.unsubscribeSysvar(this.idSubscription);
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-sysvar', CcuSysvarNode);
};
