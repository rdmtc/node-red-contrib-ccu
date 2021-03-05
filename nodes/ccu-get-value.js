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

            this.on('input', (message, send, done) => {
                let value;
                const iface = config.iface || message.iface || message.interface;
                const channel = String(config.channel || message.channel).split(' ')[0];
                const datapoint = config.datapoint || message.datapoint;
                const sysvar = config.sysvar || message.sysvar;

                if (iface === 'ReGaHSS') {
                    value = this.ccu.sysvar[sysvar];
                    if (!value) {
                        const err = new Error('unknown variable ' + sysvar);
                        this.status({fill: 'red', shape: 'ring', text: 'error: unknown variable'});
                        done(err);

                        return;
                    }
                } else {
                    const address = iface + '.' + channel + '.' + datapoint;
                    value = this.ccu.values[address];
                    if (!value) {
                        const err = new Error('unknown datapoint ' + address);
                        this.status({fill: 'red', shape: 'ring', text: 'error: unknown datapoint'});
                        done(err);

                        return;
                    }
                }

                if (config.setPropType === 'cmsg') {
                    Object.assign(message, value);
                    send(message);
                    this.status({fill: 'green', shape: 'ring', text: String(value.payload)});
                    done();
                } else {
                    if (iface === 'ReGaHSS') {
                        if (config.sysvarProperty !== 'all') {
                            value = value[config.sysvarProperty];
                        }
                    } else if (config.datapointProperty !== 'all') {
                        value = value[config.datapointProperty];
                    }

                    this.status({fill: 'green', shape: 'ring', text: String(value)});

                    if (config.setPropType === 'msg') {
                        RED.util.setMessageProperty(message, config.setProp, value);
                        if (send) {
                            send(message);
                        } else {
                            this.send(message);
                        }

                        if (done) {
                            done();
                        }
                    } else if ((this.setPropType === 'flow') || (this.setPropType === 'global')) {
                        const context = RED.util.parseContextStore(this.setProp);
                        const target = this.context()[this.setPropType];
                        target.set(context.key, value, context.store, err => {
                            if (err) {
                                done(err);
                            } else {
                                send(message);

                                done();
                            }
                        });
                    }
                }
            });
        }
    }

    RED.nodes.registerType('ccu-get-value', CcuGetValue);
};
