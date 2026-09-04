const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {effectiveConfig, configCacheKey} = require(path.join(__dirname, '/lib/dynconfig.js'));

/** What a message may supply or override (B-2, #172). */
const DYNAMIC_KEYS = ['iface', 'channel', 'datapoint'];

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
            this.config = config;

            this.ccu.register(this);

            this.subscriptionKey = null;
            this.subscribeTo({
                iface: config.iface,
                channel: config.channel,
                datapoint: config.datapoint,
            });

            this.on('input', (message, send, done) => {
                const [tIface, tChannel, tDatapoint] = (message.topic || '').split('.');
                // msg.config wins over the node's own configuration; the flat
                // msg.iface/channel/datapoint chain below is unchanged
                const {config: over} = effectiveConfig({}, message, DYNAMIC_KEYS);

                const iface = over.iface || config.iface || message.interface || message.iface || tIface;
                const channel = (
                    over.channel ||
                    config.channel ||
                    this.ccu.findChannel(message.channelName, true) ||
                    message.channel ||
                    tChannel ||
                    ''
                ).split(' ')[0];
                const datapoint = over.datapoint || config.datapoint || message.datapoint || tDatapoint;

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

                if (message.payload === undefined) {
                    // don't write to the CCU when the incoming msg carries no
                    // payload (PR #173). Such a message may still retarget the
                    // output side, which is what "configure through message"
                    // asked for (#172) - for a node with its own channel and
                    // datapoint configured this is a no-op unless msg.config
                    // explicitly overrides them.
                    this.subscribeTo({iface, channel, datapoint});
                    done();
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
                    this.ccu[this.queue ? 'setValueQueued' : 'setValue'](
                        iface,
                        channel,
                        datapoint,
                        message.payload,
                        config.burst,
                    )
                        .then(() => {
                            done();
                        })
                        .catch((error) => {
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
                    this.ccu
                        .methodCall(iface, 'putParamset', [channel, 'VALUES', parameters])
                        .then(() => {
                            done();
                        })
                        .catch((error) => {
                            done(error);
                        });
                }
            });

            this.on('close', this._destructor);
        }

        /**
         * (Re-)subscribe the output side. A no-op when the target is
         * unchanged, so a node configured in the editor keeps exactly one
         * subscription for its lifetime as before (#172).
         * @param {{iface: string, channel: string, datapoint: string}} target
         */
        subscribeTo(target) {
            const {config} = this;
            if (!target.iface || !target.channel || !target.datapoint) {
                return;
            }

            const filter = {
                cache: config.cache,
                change: config.change,
                stable: config.working,
                iface: target.iface,
                channel: String(target.channel).split(' ')[0],
                datapoint: target.datapoint,
            };

            // opt-in: only present when the option is enabled, so existing
            // subscriptions keep receiving uncertain values (#96)
            if (config.certainOnly) {
                filter.uncertain = false;
            }

            const key = configCacheKey(filter, ['iface', 'channel', 'datapoint']);
            if (key === this.subscriptionKey) {
                return;
            }

            if (this.idSubscription) {
                this.ccu.unsubscribe(this.idSubscription);
            }

            this.subscriptionKey = key;
            this.idSubscription = this.ccu.subscribe(filter, (message) => {
                this.status({fill: 'green', shape: 'ring', text: String(message.payload)});
                message.topic = this.ccu.topicReplace(config.topic, message);
                this.send(message);
            });
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
