module.exports = function (RED) {
    class CcuValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            if (config.iface && config.channel && config.datapoint) {
                const filter = {
                    iface: config.iface,
                    cache: config.cache,
                    change: config.change,
                    channel: config.channel.split(' ')[0],
                    datapoint: config.datapoint
                };

                this.idSubscription = this.ccu.subscribe(filter, msg => {
                    if (!msg.working || !config.working) {
                        msg.topic = this.ccu.topicReplace(config.topic, msg);
                        this.send(msg);
                    }
                });
            }

            this.on('input', msg => {
                const [tIface, tChannel, tDatapoint] = msg.topic.split('.');
                const iface = config.iface || msg.interface || tIface;
                const channel = (config.channel || msg.channel || tChannel || '').split(' ')[0];
                const datapoint = config.datapoint || msg.datapoint || tDatapoint;

                if (!iface) {
                    this.error('interface undefined');
                    return;
                }
                if (!channel) {
                    this.error('channel undefined');
                    return;
                }
                if (!datapoint) {
                    this.error('datapoint undefined');
                    return;
                }

                let ramp;
                switch (config.rampType) {
                    case 'msg':
                        ramp = msg[config.ramp];
                        break;
                    case 'flow':
                        ramp = this.context().flow.get(config.ramp);
                        break;
                    case 'global':
                        ramp = this.context().global.get(config.ramp);
                        break;
                    case 'num':
                        ramp = parseInt(config.ramp, 10);
                        break;
                    default:
                }

                let on;
                switch (config.onType) {
                    case 'msg':
                        on = msg[config.on];
                        break;
                    case 'flow':
                        on = this.context().flow.get(config.on);
                        break;
                    case 'global':
                        on = this.context().global.get(config.on);
                        break;
                    case 'num':
                        on = parseInt(config.on, 10);
                        break;
                    default:
                }

                let delay = 0;

                if (ramp) {
                    this.ccu.setValue(iface, channel, 'RAMP_TIME', ramp, config.burst);
                    delay += 62;
                }

                if (on) {
                    setTimeout(() => {
                        this.ccu.setValue(iface, channel, 'ON_TIME', on, config.burst);
                    }, delay);
                    delay += 62;
                }

                setTimeout(() => {
                    this.ccu.setValue(iface, channel, datapoint, msg.payload, config.burst);
                }, delay);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.ccu.unsubscribe(this.idSubscription);
            }
            done();
        }
    }

    RED.nodes.registerType('ccu-value', CcuValue);
};
