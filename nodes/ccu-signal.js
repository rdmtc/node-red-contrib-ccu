const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

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

            this.on('input', (msg, send, done) => {
                const values = {};

                this.getValue(values, 'rampTimeValue', msg)
                    .then(() => this.getValue(values, 'durationValue', msg))
                    .then(() => this.getValue(values, 'repeat', msg))
                    .then(() => this.getValue(values, 'volume', msg))
                    .then(() => this.getValue(values, 'soundLevel', msg))
                    .catch(err => {
                        this.error(err.message);
                    })
                    .then(() => {
                        this.sendCommand(Object.assign({}, this.config, values)).then(() => {
                            done();
                        }).catch(err => {
                            done(err);
                        });
                    });
            });
        }

        sendCommand(config) {
            let payload;
            this.debug(config.channelType);

            switch (config.channelType) {
                case 'SIGNAL_CHIME':
                    console.log('config.chime', config.chime);
                    payload = [config.volume / 100, config.repeat, 108000, ...config.chime.split(',')];
                    console.log('payload', payload);
                    return this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
                case 'SIGNAL_LED':
                    payload = ['1', config.repeat, 108000, ...config.led.split(',')];
                    return this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
                case 'ALARM_SWITCH_VIRTUAL_RECEIVER':
                    return this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', {
                        ACOUSTIC_ALARM_SELECTION: config.acousticAlarmSelection,
                        DURATION_UNIT: config.durationUnit,
                        DURATION_VALUE: parseInt(config.durationValue, 10) || 0,
                        OPTICAL_ALARM_SELECTION: config.opticalAlarmSelection
                    }]);
                case 'DIMMER_VIRTUAL_RECEIVER': {
                    const params = {
                        LEVEL: config.dimmerLevel / 100,
                        RAMP_TIME_UNIT: config.rampTimeUnit,
                        RAMP_TIME_VALUE: Number(config.rampTimeValue),
                        DURATION_UNIT: config.durationUnit,
                        DURATION_VALUE: parseInt(config.durationValue, 10) || 0,
                        REPETITIONS: Number(config.repetitions),
                        OUTPUT_SELECT_SIZE: config.dimmerList.length
                    };
                    config.dimmerList.forEach((item, i) => {
                        const index = i + 1;
                        params['COLOR_LIST_' + index] = Number(item.color);
                        params['ON_TIME_LIST_' + index] = Number(item.ontime);
                    });
                    return this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', params]);
                }

                case 'BSL_DIMMER_VIRTUAL_RECEIVER': {
                    return this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', {
                        LEVEL: config.dimmerLevel / 100,
                        RAMP_TIME_UNIT: config.rampTimeUnit,
                        RAMP_TIME_VALUE: Number(config.rampTimeValue),
                        DURATION_UNIT: config.durationUnit,
                        DURATION_VALUE: parseInt(config.durationValue, 10) || 0,
                        COLOR: Number(config.dimmerColor)
                    }]);
                }

                case 'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER': {
                    const params = {
                        LEVEL: config.soundLevel / 100,
                        RAMP_TIME_UNIT: config.rampTimeUnit,
                        RAMP_TIME_VALUE: Number(config.rampTimeValue),
                        DURATION_UNIT: config.durationUnit,
                        DURATION_VALUE: parseInt(config.durationValue, 10) || 0,
                        REPETITIONS: Number(config.repetitions),
                        OUTPUT_SELECT_SIZE: config.soundList.length
                    };
                    config.soundList.forEach((item, i) => {
                        const index = i + 1;
                        params['SOUNDFILE_LIST_' + index] = Number(item.sound);
                    });
                    return this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', params]);
                }

                default:
                    return Promise.reject(new Error(`channelType ${config.channelType} unknown`));
            }
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        getValue(values, name, msg) {
            return new Promise((resolve, reject) => {
                const type = this.config[name + 'Type'];
                const val = this.config[name];

                switch (type) {
                    case 'msg':
                        values[name] = RED.util.getMessageProperty(msg, val);
                        resolve();
                        break;

                    case 'flow':
                    case 'global': {
                        const contextKey = RED.util.parseContextStore(val);
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
                        values[name] = RED.util.evaluateNodeProperty(val, 'env', this);
                        resolve();
                        break;

                    default:
                        values[name] = val;
                        resolve();
                }
            });
        }
    }

    RED.nodes.registerType('ccu-signal', CcuSignal);
};
