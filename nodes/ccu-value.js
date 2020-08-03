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
            this.queue = config.queue;

            this.ccu.register(this);

            if (config.iface && config.channel && config.datapoint) {
                const filter = {
                    cache: config.cache,
                    change: config.change,
                    stable: config.working,
                    iface: config.iface,
                    channel: String(config.channel).split(' ')[0],
                    datapoint: config.datapoint
                };

                this.idSubscription = this.ccu.subscribe(filter, message => {
                    this.status({fill: 'green', shape: 'ring', text: String(message.payload)});
                    message.topic = this.ccu.topicReplace(config.topic, message);
                    this.send(message);
                });
            }

            this.on('input', (message, send, done) => {
                const [tIface, tChannel, tDatapoint] = (message.topic || '').split('.');
                const iface = config.iface || message.interface || message.iface || tIface;
                const channel = (config.channel || this.ccu.findChannel(message.channelName, true) || message.channel || tChannel || '').split(' ')[0];
                const datapoint = config.datapoint || message.datapoint || tDatapoint;

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
                        ramp = message[config.ramp];
                        break;
                    case 'flow':
                        ramp = this.context().flow.get(config.ramp);
                        break;
                    case 'global':
                        ramp = this.context().global.get(config.ramp);
                        break;
                    case 'num':
                        ramp = config.ramp;
                        break;
                    default:
                }

                ramp = Number.parseFloat(ramp);

                let on;
                switch (config.onType) {
                    case 'msg':
                        on = message[config.on];
                        break;
                    case 'flow':
                        on = this.context().flow.get(config.on);
                        break;
                    case 'global':
                        on = this.context().global.get(config.on);
                        break;
                    case 'num':
                        on = config.on;
                        break;
                    default:
                }

                on = Number.parseFloat(on);

                if (!ramp && !on) {
                    this.ccu[this.queue ? 'setValueQueued' : 'setValue'](iface, channel, datapoint, message.payload, config.burst).then(() => {
                        done();
                    }).catch(error => {
                        done(error);
                    });
                } else {
                    const parameters = {};
                    if (on) {
                        parameters.ON_TIME = this.ccu.paramCast(iface, channel, 'VALUES', 'ON_TIME', on);
                    }

                    if (ramp) {
                        parameters.RAMP_TIME = this.ccu.paramCast(iface, channel, 'VALUES', 'RAMP_TIME', ramp);
                    }

                    parameters[datapoint] = this.ccu.paramCast(iface, channel, 'VALUES', datapoint, message.payload);
                    // Todo queue
                    this.ccu.methodCall(iface, 'putParamset', [channel, 'VALUES', parameters]).then(() => {
                        done();
                    }).catch(error => {
                        done(error);
                    });
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
