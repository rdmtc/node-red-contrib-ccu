const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            this.ccu.register(this);

            if (config.iface && config.channel && config.datapoint) {
                const id = `${config.iface}.${config.channel}.${config.datapoint}`;
                const filter = {
                    iface: config.iface,
                    cache: config.cache,
                    change: config.change,
                    channel: String(config.channel).split(' ')[0],
                    datapoint: config.datapoint
                };

                this.idSubscription = this.ccu.subscribe(filter, msg => {
                    if (config.working && (msg.working || this.ccu.setValueCache[id])) {
                        return;
                    }
                    msg.topic = this.ccu.topicReplace(config.topic, msg);
                    this.send(msg);
                });
            }

            this.on('input', msg => {
                const [tIface, tChannel, tDatapoint] = (msg.topic || '').split('.');
                const iface = config.iface || msg.interface || msg.iface || tIface;
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
                        ramp = config.ramp; // eslint-disable-line prefer-destructuring
                        break;
                    default:
                }
                ramp = parseFloat(ramp);

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
                        on = config.on; // eslint-disable-line prefer-destructuring
                        break;
                    default:
                }

                on = parseFloat(on);

                if (!ramp && !on) {
                    this.ccu.setValue(iface, channel, datapoint, msg.payload, config.burst);
                } else {
                    const params = {};
                    if (on) {
                        params.ON_TIME = this.ccu.paramCast(iface, channel, 'VALUES', 'ON_TIME', on);
                    }
                    if (ramp) {
                        params.RAMP_TIME = this.ccu.paramCast(iface, channel, 'VALUES', 'RAMP_TIME', ramp);
                    }
                    params[datapoint] = this.ccu.paramCast(iface, channel, 'VALUES', datapoint, msg.payload);
                    this.ccu.methodCall(iface, 'putParamset', [channel, 'VALUES', params]);
                }
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.debug('ccu-value close');
                this.ccu.unsubscribe(this.idSubscription);
            }
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-value', CcuValue);
};
