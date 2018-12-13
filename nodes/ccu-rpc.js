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

            this.iface = config.iface;

            this.ccu.register(this);

            this.on('input', msg => {
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

                if (method === 'setValue') {
                    const [address, param, value] = params;
                    params[2] = this.ccu.paramCast(config.iface, address, 'VALUES', param, value);
                } else if (method === 'putParamset') {
                    let [address, paramset, values] = params;
                    values = values || {};
                    Object.keys(values).forEach(param => {
                        values[param] = this.ccu.paramCast(config.iface, address, paramset, param, values[param]);
                    });
                    params[2] = values;
                }

                this.ccu.methodCall(config.iface, method, params)
                    .then(res => {
                        const msg = {
                            ccu: this.ccu.host,
                            iface: config.iface,
                            topic: config.topic,
                            payload: res,
                            ts: (new Date()).getTime(),
                            method
                        };
                        msg.topic = this.ccu.topicReplace(config.topic, msg);
                        this.send(msg);
                    }).catch(err => {
                        this.error(err.message);
                    });
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-rpc', CcuRpcNode);
};
