const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuProgramNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.iface = 'ReGaHSS';

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            this.name = config.name;

            if (this.name) {
                this.idSubscription = this.ccu.subscribeProgram(this.name, msg => {
                    msg.topic = this.ccu.topicReplace(config.topic, msg);
                    this.send(msg);
                });
            }

            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(msg) {
            switch (typeof msg.payload) {
                case 'boolean':
                    this.ccu.programActive(this.name || msg.topic, msg.payload)
                        .then(msg => {
                            this.send(msg);
                            this.status({fill: 'green', shape: 'dot', text: 'connected'});
                        })
                        .catch(err => {
                            this.error(err.message);
                            this.status({fill: 'red', shape: 'dot', text: 'error'});
                        });
                    break;
                default:
                    this.ccu.programExecute(this.name || msg.topic)
                        .then(msg => {
                            this.send(msg);
                            this.status({fill: 'green', shape: 'dot', text: 'connected'});
                        })
                        .catch(err => {
                            this.error(err.message);
                            this.status({fill: 'red', shape: 'dot', text: 'error'});
                        });
            }
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.debug('unsubscribe');
                this.ccu.unsubscribeProgram(this.idSubscription);
            }
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-program', CcuProgramNode);
};
