module.exports = function (RED) {
    class CcuValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

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

            this.on('input', msg => {
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
                    this.ccu.setValue(config.iface, config.channel.split(' ')[0], 'RAMP_TIME', ramp, config.burst);
                    delay += 62;
                }

                if (on) {
                    setTimeout(() => {
                        this.ccu.setValue(config.iface, config.channel.split(' ')[0], 'ON_TIME', on, config.burst);
                    }, delay);
                    delay += 62;
                }

                setTimeout(() => {
                    this.ccu.setValue(config.iface, config.channel.split(' ')[0], config.datapoint, msg.payload, config.burst);
                }, delay);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.log('ccu-value close');
            this.ccu.unsubscribe(this.idSubscription);
            done();
        }
    }

    RED.nodes.registerType('ccu-value', CcuValue);
};
