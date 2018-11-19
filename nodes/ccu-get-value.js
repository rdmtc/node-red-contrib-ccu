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
                if (config.iface === 'ReGaHSS') {
                    value = this.ccu.sysvar[config.sysvar];
                } else {
                    const address = config.iface + '.' + config.channel.split(' ')[0] + '.' + config.datapoint;
                    value = this.ccu.values[address];
                    if (config.datapointProperty !== 'all') {
                        value = value[config.datapointProperty];
                    }
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
            });
        }
    }

    RED.nodes.registerType('ccu-get-value', CcuGetValue);
};
