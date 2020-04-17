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

            this.idSubscription = this.ccu.subscribe(filter, msg => {
                let change = false;
                switch (channelType) {
                    case 'SHUTTER_CONTACT':
                        if (msg.datapoint === 'STATE') {
                            payload.state.contact = msg.payload ? 'NOT_DETECTED' : 'DETECTED';
                            change = true;
                        }

                        break;

                    case 'CLIMATECONTROL_RT_TRANSCEIVER':
                    case 'THERMALCONTROL_TRANSMIT':
                        if (msg.datapoint === 'SET_TEMPERATURE') {
                            payload.state.thermostatSetPoint = msg.payload;
                            change = true;
                        }

                        if (msg.datapoint === 'ACTUAL_TEMPERATURE') {
                            payload.state.temperature = msg.payload;
                            change = true;
                        }
                        // TODO if (msg.datapoint === 'CONTROL_MODE') {

                        break;

                    case 'HEATING_CLIMATECONTROL_TRANSCEIVER':
                        if (msg.datapoint === 'SET_POINT_TEMPERATURE') {
                            payload.state.thermostatSetPoint = msg.payload;
                            change = true;
                        }

                        if (msg.datapoint === 'ACTUAL_TEMPERATURE') {
                            payload.state.temperature = msg.payload;
                            change = true;
                        }

                        // TODO if (msg.datapoint === 'SET_POINT_MODE') {
                        break;

                    case 'SWITCH_VIRTUAL_RECEIVER':
                    case 'SWITCH':
                        if (msg.datapoint === 'STATE') {
                            payload.state.power = msg.payload ? 'ON' : 'OFF';
                            change = true;
                        }

                        break;

                    case 'DIMMER_VIRTUAL_RECEIVER':
                    case 'DIMMER':
                        if (msg.datapoint === 'LEVEL') {
                            payload.state.power = msg.payload ? 'ON' : 'OFF';
                            payload.state.brightness = msg.payload * 100;
                            change = true;
                        }

                        break;

                    case 'BLIND':
                    case 'BLIND_VIRTUAL_RECEIVER':
                        if (msg.datapoint === 'LEVEL') {
                            payload.state.rangeValue = msg.payload * 100;
                            change = true;
                        }

                        break;

                    default:
                        this.warn('unsupported channel type ' + channelType);
                        return;
                }

                if (Object.keys(payload.state).length > 0) {
                    if (change) {
                        this.debug(JSON.stringify(payload));
                        this.send({payload});
                        this.status({fill: 'green', shape: 'ring', text: JSON.stringify(payload.state).replace(/^{/, '').replace(/}$/, '')});
                    }
                } else {
                    this.debug('empty state object');
                }
            });

            this.on('input', msg => {
                this.debug('alexa > ' + JSON.stringify(msg));

                if (!this.iface) {
                    this.error('interface undefined');
                    return;
                }

                if (!this.channel) {
                    this.error('channel undefined');
                    return;
                }

                switch (msg.command) {
                    case 'TurnOn':
                    case 'TurnOff':
                        if (channelType.startsWith('DIMMER')) {
                            this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', msg.payload === 'ON' ? 1 : 0);
                        } else {
                            this.ccu.setValueQueued(this.iface, this.channel, 'STATE', msg.payload === 'ON');
                        }

                        break;

                    case 'SetBrightness':
                        if (channelType.startsWith('DIMMER')) {
                            this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', msg.payload / 100);
                        } else {
                            this.ccu.setValueQueued(this.iface, this.channel, 'STATE', msg.payload / 100);
                        }

                        break;

                    case 'SetTargetTemperature':
                        switch (channelType) {
                            case 'CLIMATECONTROL_RT_TRANSCEIVER':
                            case 'THERMALCONTROL_TRANSMIT':
                                this.ccu.setValueQueued(this.iface, this.channel, 'SET_TEMPERATURE', msg.payload);
                                break;

                            case 'HEATING_CLIMATECONTROL_TRANSCEIVER':
                                this.ccu.setValueQueued(this.iface, this.channel, 'SET_POINT_TEMPERATURE', msg.payload);
                                break;

                            default:
                        }

                        break;

                    case 'SetRangeValue':
                        switch (channelType) {
                            case 'BLIND':
                            case 'BLIND_VIRTUAL_RECEIVER':
                                this.ccu.setValueQueued(this.iface, this.channel, 'LEVEL', msg.payload / 100);
                                break;

                            default:
                        }

                        break;

                        // Todo case 'AdjustBrightness':
                        // Todo case 'SetColor':
                        // Todo case 'SetColorTemperature':
                        // Todo case 'AdjustTargetTemperature':
                        // todo case 'SetThermostatMode':

                    default:
                        this.warn('unknown command ' + msg.command);
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
