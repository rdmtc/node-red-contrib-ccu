const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuRpcNode {
        constructor(config) {
            RED.nodes.createNode(this, config);
            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            this.on('input', (message, send, done) => {
                let parameters = config.params || message.payload;

                if (parameters && typeof parameters === 'string') {
                    try {
                        parameters = JSON.parse(parameters);
                    } catch (error) {
                        this.error(error);
                        return;
                    }
                } else if (!parameters) {
                    parameters = [];
                }

                const method = config.method || message.method || message.topic;
                const iface = config.iface || message.iface || message.interface;

                if (method === 'setValue') {
                    const [address, parameter, value] = parameters;
                    parameters[2] = this.ccu.paramCast(iface, address, 'VALUES', parameter, value);
                } else if (method === 'putParamset') {
                    let [address, paramset, values] = parameters;
                    values = values || {};
                    Object.keys(values).forEach(parameter => {
                        values[parameter] = this.ccu.paramCast(iface, address, paramset, parameter, values[parameter]);
                    });
                    parameters[2] = values;
                }

                this.ccu.methodCall(iface, method, parameters)
                    .then(res => {
                        const message = {
                            ccu: this.ccu.host,
                            iface,
                            topic: config.topic,
                            payload: res,
                            ts: (new Date()).getTime(),
                            method
                        };
                        message.topic = this.ccu.topicReplace(config.topic, message);
                        send(message);

                        done();
                    }).catch(error => {
                        done(error);
                    });
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-rpc', CcuRpcNode);
};
