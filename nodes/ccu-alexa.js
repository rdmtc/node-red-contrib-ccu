const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuAlexa {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;
            this.channel = config.channel.split(' ')[0];

            this.values = {};

            this.ccu.register(this);

            if (!config.iface || !config.channel) {
                this.error('channel or iface missing');
                return;
            }

            const device = this.ccu.metadata.devices[this.iface][this.channel];
            const channelType = device.TYPE;
            //const paramsetDescription = this.ccu.getParamsetDescription(this.iface, device, 'VALUES');

            this.debug('channel ' + this.channel + ' ' + channelType);

            const filter = {
                cache: true,
                change: true,
                stable: true,
                iface: config.iface,
                channel: String(config.channel).split(' ')[0]
            };

            const payload = {
                acknowledge: true,
                state: {}
            };

            this.idSubscription = this.ccu.subscribe(filter, message => {
                let change = false;
                switch (channelType) {
                    case 'SHUTTER_CONTACT':
                    case 'ROTARY_HANDLE_SENSOR':
                        if (message.datapoint === 'STATE') {
                            payload.state.contact = message.payload ? 'DETECTED' : 'NOT_DETECTED';
                            change = true;
                        }

                        break;

                    case 'CLIMATECONTROL_RT_TRANSCEIVER':
                    case 'THERMALCONTROL_TRANSMIT':
                        if (message.datapoint === 'SET_TEMPERATURE') {
                            payload.state.thermostatSetPoint = message.payload;
                            change = true;
                        }

                        if (message.datapoint === 'ACTUAL_TEMPERATURE') {
                            payload.state.temperature = message.payload;
                            change = true;
                        }
                        // TODO if (msg.datapoint === 'CONTROL_MODE') {

                        break;

                    case 'HEATING_CLIMATECONTROL_TRANSCEIVER':
                        if (message.datapoint === 'SET_POINT_TEMPERATURE') {
                            payload.state.thermostatSetPoint = message.payload;
                            change = true;
                        }

                        if (message.datapoint === 'ACTUAL_TEMPERATURE') {
                            payload.state.temperature = message.payload;
                            change = true;
                        }

                        // TODO if (msg.datapoint === 'SET_POINT_MODE') {
                        break;

                    case 'SWITCH_VIRTUAL_RECEIVER':
                    case 'SWITCH':
                        if (message.datapoint === 'STATE') {
                            payload.state.power = message.payload ? 'ON' : 'OFF';
                            change = true;
                        }

                        break;

                    case 'DIMMER_VIRTUAL_RECEIVER':
                    case 'DIMMER':
                        if (message.datapoint === 'LEVEL') {
                            payload.state.power = message.payload ? 'ON' : 'OFF';
                            payload.state.brightness = message.payload * 100;
                            this.values.brightness = payload.state.brightness;
                            change = true;
                        }

                        break;

                    case 'BLIND':
                    case 'BLIND_VIRTUAL_RECEIVER':
                        if (message.datapoint === 'LEVEL') {
                            payload.state.rangeValue = message.payload * 100;
                            change = true;
                        }

                        break;

                    case 'MOTION_DETECTOR':
                    case 'MOTIONDETECTOR_TRANSCEIVER':
                        if (message.datapoint === 'MOTION') {
                            payload.state.power = message.payload ? 'DETECTED' : 'NOT_DETECTED';
                            change = true;
                        }

                        break;

                    case 'WEATHER':
                    case 'WEATHER_TRANSMIT':
                        if (message.datapoint === 'TEMPERATURE') {
                            payload.state.temperature = message.payload;
                            change = true;
                        }

                        break;

                    case 'KEYMATIC':
                        if (message.datapoint === 'STATE') {
                            payload.state.lock = message.payload ? 'UNLOCKED' : 'LOCKED';
                            change = true;
                        }

                        break;

                    default:
                        this.warn('unsupported channel type ' + channelType);
                        return;
                }

                const keys = Object.keys(payload.state);

                if (keys.length > 0) {
                    if (change) {
                        this.debug(JSON.stringify(payload));
                        this.status({fill: 'green', shape: 'ring', text: JSON.stringify(payload.state).replace(/^{/, '').replace(/}$/, '')});
                        keys.forEach(key => {
                            const distinctPayload = {
                                acknowledge: true,
                                state: {}
                            };
                            distinctPayload.state[key] = payload.state[key];
                            this.send({payload: distinctPayload});
                        });
                    }
                } else {
                    this.debug('empty state object');
                }
            });

            this.on('input', message => {
                this.debug('alexa > ' + JSON.stringify(message));

                if (!this.iface) {
                    this.error('interface undefined');
                    return;
                }

                if (!this.channel) {
                    this.error('channel undefined');
                    return;
                }

                switch (message.command) {
                    case 'TurnOn':
                    case 'TurnOff':
                        if (channelType.startsWith('DIMMER')) {
                            this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', message.payload === 'ON' ? 1 : 0);
                        } else {
                            this.ccu.setValueQueued(this.iface, this.channel, 'STATE', message.payload === 'ON');
                        }

                        break;

                    case 'SetBrightness':
                        if (channelType.startsWith('DIMMER')) {
                            this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', message.payload / 100);
                        } else {
                            this.ccu.setValueQueued(this.iface, this.channel, 'STATE', message.payload > 0);
                        }

                        break;

                    case 'AdjustBrightness':
                        if (channelType.startsWith('DIMMER')) {
                            this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', (this.values.brightness + message.payload) / 100);
                        } else {
                            this.ccu.setValueQueued(this.iface, this.channel, 'STATE', message.payload > 0);
                        }

                        break;

                    case 'SetTargetTemperature':
                        switch (channelType) {
                            case 'CLIMATECONTROL_RT_TRANSCEIVER':
                            case 'THERMALCONTROL_TRANSMIT':
                                this.ccu.setValueQueued(this.iface, this.channel, 'SET_TEMPERATURE', message.payload);
                                break;

                            case 'HEATING_CLIMATECONTROL_TRANSCEIVER':
                                this.ccu.setValueQueued(this.iface, this.channel, 'SET_POINT_TEMPERATURE', message.payload);
                                break;

                            default:
                        }

                        break;

                    case 'SetRangeValue':
                        switch (channelType) {
                            case 'BLIND':
                            case 'BLIND_VIRTUAL_RECEIVER':
                                this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', message.payload / 100);
                                break;

                            default:
                        }

                        break;

                        // Todo case 'SetColor':
                        // Todo case 'SetColorTemperature':
                        // Todo case 'AdjustTargetTemperature':
                        // todo case 'SetThermostatMode':

                    default:
                        this.warn('unknown command ' + message.command);
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

    RED.nodes.registerType('ccu-alexa', CcuAlexa);
};
