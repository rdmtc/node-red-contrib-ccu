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

            this.iface = config.iface;
            this.rooms = config.rooms;
            this.functions = config.functions;
            this.device = config.device;
            this.deviceType = config.deviceType;
            this.deviceName = config.deviceName;
            this.channel = config.channel;
            this.channelType = config.channelType;
            this.channelName = config.channelName;
            this.datapoint = config.datapoint;
            this.roomsRx = config.roomsRx;
            this.functionsRx = config.functionsRx;
            this.deviceRx = config.deviceRx;
            this.deviceTypeRx = config.deviceTypeRx;
            this.deviceNameRx = config.deviceNameRx;
            this.channelRx = config.channelRx;
            this.channelTypeRx = config.channelTypeRx;
            this.channelNameRx = config.channelNameRx;
            this.datapointRx = config.datapointRx;
            this.force = config.force;

            this.blacklist = new Set();
            this.whitelist = new Set();

            this.on('input', msg => {
                this.setValues(msg);
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

        setValues(msg) {
            let count = 0;
            Object.keys(this.ccu.metadata.devices).forEach(iface => {
                if (this.iface && iface !== this.iface) {
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
                        if (this.device) {
                            if (this.deviceRx === 'str' && this.device !== channel.PARENT) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.deviceRx === 're' && !channel.PARENT.match(new RegExp(this.device))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }
                        if (this.deviceType) {
                            if (this.deviceTypeRx === 'str' && this.deviceType !== device.TYPE) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.deviceTypeRx === 're' && !device.TYPE.match(new RegExp(this.deviceType))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }
                        if (this.deviceName) {
                            if (!this.ccu.channelNames[address]) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.deviceNameRx === 'str' && this.ccu.channelNames[channel.PARENT] !== this.deviceName) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.deviceNameRx === 're' && !this.ccu.channelNames[channel.PARENT].match(new RegExp(this.deviceName))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }
                        if (this.channel) {
                            if (this.channelRx === 'str' && this.channel !== address) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.channelRx === 're' && !address.match(new RegExp(this.channel))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }
                        if (this.channelType) {
                            if (this.channelTypeTx === 'str' && this.channelType !== channel.TYPE) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.channelTypeTx === 'str' && !this.channelType.match(new RegExp(channel.TYPE))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }
                        if (this.channelName) {
                            if (!this.ccu.channelNames[address]) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.channelNameRx === 'str' && this.ccu.channelNames[address] !== this.channelName) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.channelNameRx === 're' && !this.ccu.channelNames[address].match(new RegExp(this.channelName))) {
                                this.blacklist.add(address);
                                return;
                            }
                        }

                        if (this.rooms) {
                            if (!this.ccu.channelRooms[address]) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.roomsRx === 'str' && !this.ccu.channelRooms[address].includes(this.rooms)) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.roomsRx === 're') {
                                let match = false;
                                this.ccu.channelRooms[address].forEach(room => {
                                    if (room.match(new RegExp(this.rooms))) {
                                        match = true;
                                    }
                                });
                                if (!match) {
                                    this.blacklist.add(address);
                                    return;
                                }
                            }
                        }

                        if (this.functions) {
                            if (!this.ccu.channelFunctions[address]) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.functionsRx === 'str' && !this.ccu.channelFunctions[address].includes(this.functions)) {
                                this.blacklist.add(address);
                                return;
                            }
                            if (this.functionsRx === 're') {
                                let match = false;
                                this.ccu.channelFunctions[address].forEach(func => {
                                    if (func.match(new RegExp(this.functions))) {
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
                        const rx = new RegExp(this.datapoint);
                        Object.keys(this.ccu.paramsetDescriptions[psKey]).forEach(dp => {
                            if (this.datapointRx === 'str' && dp !== this.datapoint) {
                                return;
                            }
                            if (this.datapointRx === 're' && !dp.match(rx)) {
                                return;
                            }
                            const datapointName = iface + '.' + address + '.' + dp;
                            const currentValue = this.ccu.values[datapointName] && this.ccu.values[datapointName].value;
                            count += 1;
                            if (dp.startsWith('PRESS_') || typeof currentValue === 'undefined' || currentValue !== msg.payload) {
                                this.ccu.setValueQueued(iface, address, dp, msg.payload, false, this.force);
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
