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

            this.on('input', (msg, send, done) => {
                let params = config.params || msg.payload;

                if (params && typeof params === 'string') {
                    try {
                        params = JSON.parse(params);
                    } catch (err) {
                        this.error(err);
                        return;
                    }
                } else if (!params) {
                    params = [];
                }

                const method = config.method || msg.method || msg.topic;
                const iface = config.iface || msg.iface || msg.interface;

                if (method === 'setValue') {
                    const [address, param, value] = params;
                    params[2] = this.ccu.paramCast(iface, address, 'VALUES', param, value);
                } else if (method === 'putParamset') {
                    let [address, paramset, values] = params;
                    values = values || {};
                    Object.keys(values).forEach(param => {
                        values[param] = this.ccu.paramCast(iface, address, paramset, param, values[param]);
                    });
                    params[2] = values;
                }

                this.ccu.methodCall(iface, method, params)
                    .then(res => {
                        const msg = {
                            ccu: this.ccu.host,
                            iface,
                            topic: config.topic,
                            payload: res,
                            ts: (new Date()).getTime(),
                            method
                        };
                        msg.topic = this.ccu.topicReplace(config.topic, msg);
                        send(msg);

                        done();
                    }).catch(err => {
                        done(err);
                    });
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-rpc', CcuRpcNode);
};
