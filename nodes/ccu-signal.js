const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {effectiveConfig} = require(path.join(__dirname, '/lib/dynconfig.js'));
const {signalCommand} = require(path.join(__dirname, '/lib/signal.js'));

/** Fields that already carry a typed input (`<name>Type`) in the editor. */
const TYPED_VALUES = ['rampTimeValue', 'durationValue', 'repeat', 'volume', 'soundLevel'];

/** Everything a message may override through `msg.config` (B-2, #80 #148 #185). */
const DYNAMIC_KEYS = [
    'iface',
    'channel',
    'channelType',
    'chime',
    'led',
    'signal',
    'acousticAlarmSelection',
    'opticalAlarmSelection',
    'durationUnit',
    'rampTimeUnit',
    'repetitions',
    'dimmerLevel',
    'dimmerColor',
    'colorBehaviour',
    'dimmerList',
    'soundList',
    ...TYPED_VALUES,
];

module.exports = function (RED) {
    class CcuSignal {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.config = config;

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            this.ccu.register(this);

            this.values = {};

            this.on('input', (message, send, done) => {
                const values = {};

                this.getValue(values, 'rampTimeValue', message)
                    .then(() => this.getValue(values, 'durationValue', message))
                    .then(() => this.getValue(values, 'repeat', message))
                    .then(() => this.getValue(values, 'volume', message))
                    .then(() => this.getValue(values, 'soundLevel', message))
                    .catch((error) => {
                        this.error(error.message);
                    })
                    .then(() => {
                        // msg.config wins over both the stored config and the
                        // typed inputs above
                        const {config: effective} = effectiveConfig({...this.config, ...values}, message, DYNAMIC_KEYS);
                        this.sendCommand(effective)
                            .then(() => {
                                done();
                            })
                            .catch((error) => {
                                done(error);
                            });
                    })
                    .catch(() => {});
            });
        }

        /**
         * The channel's VALUES description as far as it is known, without asking the interface.
         * @param {string} iface
         * @param {string} channel
         * @returns {object|undefined}
         */
        valuesDescription(iface, channel) {
            const devices = this.ccu.metadata && this.ccu.metadata.devices && this.ccu.metadata.devices[iface];
            const device = devices && devices[String(channel).split(' ')[0]];
            const key = device && this.ccu.paramsetName(iface, device, 'VALUES');
            return key ? this.ccu.paramsetDescriptions[key] : undefined;
        }

        sendCommand(config) {
            this.debug(config.channelType);

            let command;
            try {
                command = signalCommand(config, this.valuesDescription(config.iface, config.channel));
            } catch (error) {
                return Promise.reject(error);
            }

            if (command.paramset) {
                return this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', command.paramset]);
            }

            return this.ccu.setValue(config.iface, config.channel, command.datapoint, command.value);
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        getValue(values, name, message) {
            return new Promise((resolve, reject) => {
                const type = this.config[name + 'Type'];
                const value = this.config[name];

                switch (type) {
                    case 'msg':
                        values[name] = RED.util.getMessageProperty(message, value);
                        resolve();
                        break;

                    case 'flow':
                    case 'global': {
                        const contextKey = RED.util.parseContextStore(value);
                        this.context()[type].get(contextKey.key, contextKey.store, (err, res) => {
                            if (err) {
                                reject(err);
                            } else {
                                values[name] = res;
                                resolve();
                            }
                        });
                        break;
                    }

                    case 'env':
                        values[name] = RED.util.evaluateNodeProperty(value, 'env', this);
                        resolve();
                        break;

                    default:
                        values[name] = value;
                        resolve();
                }
            });
        }
    }

    RED.nodes.registerType('ccu-signal', CcuSignal);
};
