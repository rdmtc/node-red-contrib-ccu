const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuSignal {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            this.ccu.register(this);

            this.on('input', () => {
                let payload;
                this.debug(config.channelType);
                switch (config.channelType) {
                    case 'SIGNAL_CHIME':
                        payload = config.chime;
                        this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
                        break;
                    case 'SIGNAL_LED':
                        payload = config.led;
                        this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
                        break;
                    case 'ALARM_SWITCH_VIRTUAL_RECEIVER':
                        this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', {
                            ACOUSTIC_ALARM_SELECTION: config.acoustic_alarm_selection,
                            DURATION_UNIT: config.duration_unit,
                            DURATION_VALUE: parseInt(config.duration_value, 10) || 0,
                            OPTICAL_ALARM_SELECTION: config.optical_alarm_selection
                        }]);
                        break;
                    case 'DIMMER_VIRTUAL_RECEIVER':
                        const params = {
                            LEVEL: config.dimmer_level / 100,
                            RAMP_TIME_UNIT: config.ramp_time_unit,
                            RAMP_TIME_VALUE: Number(config.ramp_time_value),
                            DURATION_UNIT: config.duration_unit,
                            DURATION_VALUE: parseInt(config.duration_value, 10) || 0,
                            REPETITIONS: Number(config.repetitions),
                            OUTPUT_SELECT_SIZE: config.dimmer_list.length
                        };
                        config.dimmer_list.forEach((item, i) => {
                            const index = i + 1;
                            params['COLOR_LIST_' + index] = Number(item.color);
                            params['ON_TIME_LIST_' + index] = Number(item.ontime);
                        });
                        this.ccu.methodCall(config.iface, 'putParamset', [config.channel, 'VALUES', params]);
                        break;
                    default:
                        console.error('channelType', config.channelType, 'unknown');
                }
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-signal', CcuSignal);
};
