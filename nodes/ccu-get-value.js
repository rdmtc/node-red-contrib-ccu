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
                const iface = config.iface || msg.iface;
                const channel = String(config.channel || msg.channel).split(' ')[0];
                const datapoint = config.datapoint || msg.datapoint;
                const sysvar = config.sysvar || msg.sysvar;

                if (iface === 'ReGaHSS') {
                    value = this.ccu.sysvar[sysvar];
                    if (!value) {
                        this.error('unknown variable ' + sysvar);
                        this.status({fill: 'red', shape: 'ring', text: 'error: unknown variable'});
                        return;
                    }
                } else {
                    const address = iface + '.' + channel + '.' + datapoint;
                    value = this.ccu.values[address];
                    if (!value) {
                        this.error('unknown datapoint ' + address);
                        this.status({fill: 'red', shape: 'ring', text: 'error: unknown datapoint'});
                        return;
                    }
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
