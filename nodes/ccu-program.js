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
                this.idSubscription = this.ccu.subscribeProgram(this.name, message => {
                    message.topic = this.ccu.topicReplace(config.topic, message);
                    this.send(message);
                });
            }

            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(message, send, done) {
            switch (typeof message.payload) {
                case 'boolean':
                    this.ccu.programActive(this.name || message.topic, message.payload)
                        .then(message_ => {
                            send(message_);

                            this.status({fill: 'green', shape: 'dot', text: 'connected'});
                            done();
                        })
                        .catch(error => {
                            this.status({fill: 'red', shape: 'dot', text: 'error'});
                            done(error);
                        });
                    break;
                default:
                    this.ccu.programExecute(this.name || message.topic)
                        .then(message => {
                            send(message);

                            this.status({fill: 'green', shape: 'dot', text: 'connected'});
                            done();
                        })
                        .catch(error => {
                            this.status({fill: 'red', shape: 'dot', text: 'error'});
                            done(error);
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
