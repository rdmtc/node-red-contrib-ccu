module.exports = function (RED) {
    class CcuGetValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.setProp = config.setProp || 'payload';
            this.setPropType = config.setPropType || 'msg';

            if (!this.ccu) {
                return;
            }

            this.on('input', msg => {
                let value;
                const iface = msg.iface || config.iface;
                const channel = msg.channel || config.channel.split(' ')[0];
                const datapoint = msg.datapoint || config.datapoint;
                const sysvar = msg.sysvar || config.sysvar;

                if (iface === 'ReGaHSS') {
                    value = this.ccu.sysvar[sysvar];
                } else {
                    const address = iface + '.' + channel + '.' + datapoint;
                    value = this.ccu.values[address];
                }

                this.status({fill: 'green', shape: 'ring', text: String(value.payload)});

                if (config.setPropType === 'cmsg') {
                    Object.assign(msg, value);
                    this.send(msg);
                } else {
                    if (config.datapointProperty !== 'all') {
                        value = value[config.datapointProperty];
                    }

                    if (config.setPropType === 'msg') {
                        RED.util.setMessageProperty(msg, config.setProp, value);
                        this.send(msg);
                    } else if ((this.setPropType === 'flow') || (this.setPropType === 'global')) {
                        const context = RED.util.parseContextStore(this.setProp);
                        const target = this.context()[this.setPropType];
                        target.set(context.key, value, context.store, err => {
                            if (err) {
                                this.error(err, msg);
                            } else {
                                this.send(msg);
                            }
                        });
                    }
                }
            });
        }
    }

    RED.nodes.registerType('ccu-get-value', CcuGetValue);
};
