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

            this.on('input', (msg, send, done) => {
                let value;
                const iface = config.iface || msg.iface;
                const channel = String(config.channel || msg.channel).split(' ')[0];
                const datapoint = config.datapoint || msg.datapoint;
                const sysvar = config.sysvar || msg.sysvar;

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

                this.status({fill: 'green', shape: 'ring', text: String(value.payload)});
                if (config.setPropType === 'cmsg') {
                    Object.assign(msg, value);
                    send(msg);

                    done();
                } else {
                    if (config.datapointProperty !== 'all') {
                        value = value[config.datapointProperty];
                    }

                    if (config.setPropType === 'msg') {
                        RED.util.setMessageProperty(msg, config.setProp, value);
                        if (send) {
                            send(msg);
                        } else {
                            this.send(msg);
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
                                send(msg);

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
