const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuSetValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            this.config = {
                iface: config.iface,
                rooms: config.rooms,
                functions: config.functions,
                device: config.device,
                deviceType: config.deviceType,
                deviceName: config.deviceName,
                channel: config.channel,
                channelType: config.channelType,
                channelIndex: config.channelIndex,
                channelName: config.channelName,
                datapoint: config.datapoint,
                roomsRx: config.roomsRx,
                functionsRx: config.functionsRx,
                deviceRx: config.deviceRx,
                deviceTypeRx: config.deviceTypeRx,
                deviceNameRx: config.deviceNameRx,
                channelRx: config.channelRx,
                channelTypeRx: config.channelTypeRx,
                channelIndexRx: config.channelIndexRx,
                channelNameRx: config.channelNameRx,
                datapointRx: config.datapointRx,
                force: config.force
            };

            this.blacklist = new Set();
            this.whitelist = new Set();

            this.on('input', message => {
                this.setValues(message);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.debug('ccu-set-value close');
                this.ccu.unsubscribe(this.idSubscription);
            }

            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        setValues(message) {
            const {config} = this;
            let dynamicConfig = false;
            Object.keys(config).forEach(key => {
                if (!config[key]) {
                    if (key in message) {
                        dynamicConfig = true;
                        config[key] = message[key];
                    }
                }
            });

            if (dynamicConfig) {
                this.whitelist.clear();
                this.blacklist.clear();
            }

            let count = 0;
            Object.keys(this.ccu.metadata.devices).forEach(iface => {
                if (config.iface && iface !== config.iface) {
                    return;
                }

                Object.keys(this.ccu.metadata.devices[iface]).forEach(address => {
                    if (this.blacklist.has(address)) {
                        return;
                    }

                    const channel = this.ccu.metadata.devices[iface][address];

                    if (!channel.PARENT) {
                        this.blacklist.add(address);
                        return;
                    }

                    if (!this.whitelist.has(address)) {
                        const device = this.ccu.metadata.devices[iface][channel.PARENT];
                        if (config.device) {
                            if (config.deviceRx === 'str' && config.device !== channel.PARENT) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.deviceRx === 're' && !channel.PARENT.match(new RegExp(config.device))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.deviceType) {
                            if (config.deviceTypeRx === 'str' && config.deviceType !== device.TYPE) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.deviceTypeRx === 're' && !device.TYPE.match(new RegExp(config.deviceType))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.deviceName) {
                            if (!this.ccu.channelNames[address]) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.deviceNameRx === 'str' && this.ccu.channelNames[channel.PARENT] !== config.deviceName) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.deviceNameRx === 're' && !this.ccu.channelNames[channel.PARENT].match(new RegExp(config.deviceName))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.channel) {
                            if (config.channelRx === 'str' && config.channel !== address) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.channelRx === 're' && !address.match(new RegExp(config.channel))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.channelType) {
                            if (config.channelTypeRx === 'str' && config.channelType !== channel.TYPE) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.channelTypeRx === 're' && !channel.TYPE.match(new RegExp(config.channelType))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.channelIndex) {
                            if (config.channelIndexRx === 'str' && !address.endsWith(':' + config.channelIndex)) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.channelIndexRx === 're' && !address.split(':')[1].match(new RegExp(String(config.channelIndex)))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.channelName) {
                            if (!this.ccu.channelNames[address]) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.channelNameRx === 'str' && this.ccu.channelNames[address] !== config.channelName) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.channelNameRx === 're' && !this.ccu.channelNames[address].match(new RegExp(config.channelName))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (config.rooms) {
                            if (!this.ccu.channelRooms[address]) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.roomsRx === 'str' && !this.ccu.channelRooms[address].includes(config.rooms)) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.roomsRx === 're') {
                                let match = false;
                                this.ccu.channelRooms[address].forEach(room => {
                                    if (room.match(new RegExp(config.rooms))) {
                                        match = true;
                                    }
                                });
                                if (!match) {
                                    this.blacklist.add(address);
                                    return;
                                }
                            }
                        }

                        if (config.functions) {
                            if (!this.ccu.channelFunctions[address]) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.functionsRx === 'str' && !this.ccu.channelFunctions[address].includes(config.functions)) {
                                this.blacklist.add(address);
                                return;
                            }

                            if (config.functionsRx === 're') {
                                let match = false;
                                this.ccu.channelFunctions[address].forEach(func => {
                                    if (func.match(new RegExp(config.functions))) {
                                        match = true;
                                    }
                                });
                                if (!match) {
                                    this.blacklist.add(address);
                                    return;
                                }
                            }
                        }

                        this.whitelist.add(address);
                    }

                    const psKey = this.ccu.paramsetName(iface, channel, 'VALUES');
                    if (this.ccu.paramsetDescriptions[psKey]) {
                        const rx = new RegExp(config.datapoint);
                        Object.keys(this.ccu.paramsetDescriptions[psKey]).forEach(dp => {
                            if (config.datapointRx === 'str' && dp !== config.datapoint) {
                                return;
                            }

                            if (config.datapointRx === 're' && !dp.match(rx)) {
                                return;
                            }

                            const datapointName = iface + '.' + address + '.' + dp;
                            const currentValue = this.ccu.values[datapointName] && this.ccu.values[datapointName].value;
                            count += 1;
                            if (dp.startsWith('PRESS_') || typeof currentValue === 'undefined' || currentValue !== message.payload) {
                                this.ccu.setValueQueued(iface, address, dp, message.payload, false, config.force).catch(() => {});
                            }
                        });
                    }
                });
            });
            this.status({fill: 'green', shape: 'ring', text: String(count) + ' datapoints'});
        }
    }

    RED.nodes.registerType('ccu-set-value', CcuSetValue);
};
