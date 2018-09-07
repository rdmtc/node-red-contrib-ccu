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
            this.delay = config.delay;

            this.on('input', msg => {
                this.shiftQueue(this.createQueue(msg));
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

        createQueue(msg) {
            const queue = [];
            Object.keys(this.ccu.metadata.devices).forEach(iface => {
                if (this.iface && iface === this.iface) {
                    return;
                }
                Object.keys(this.ccu.metadata.devices[iface]).forEach(address => {
                    const channel = this.ccu.metadata.devices[iface][address];
                    if (!channel.PARENT) {
                        return;
                    }
                    const device = this.ccu.metadata.devices[iface][channel.PARENT];
                    if (this.device && this.device !== channel.PARENT) {
                        return;
                    }
                    if (this.deviceType && this.deviceType !== device.TYPE) {
                        return;
                    }
                    if (this.deviceName) {
                        if (!this.ccu.channelNames[address] || this.ccu.channelNames[channel.PARENT] !== this.deviceName) {
                            return;
                        }
                    }
                    if (this.channel && this.channel !== address) {
                        return;
                    }
                    if (this.channelType && this.channelType !== channel.TYPE) {
                        return;
                    }
                    if (this.channelName) {
                        if (!this.ccu.channelNames[address] || this.ccu.channelNames[address] !== this.channelName) {
                            return;
                        }
                    }

                    if (this.rooms) {
                        if (!this.ccu.channelRooms[address] || !this.ccu.channelRooms[address].includes(this.rooms)) {
                            return;
                        }
                    }

                    const psKey = this.ccu.paramsetName(iface, channel, 'VALUES');

                    if (this.ccu.paramsetDescriptions[psKey] && Object.keys(this.ccu.paramsetDescriptions[psKey]).includes(this.datapoint)) {
                        const datapointName = iface + '.' + address + '.' + this.datapoint;
                        const currentValue = this.ccu.values[datapointName] && this.ccu.values[datapointName].value;
                        if (this.datapoint.startsWith('PRESS_') || typeof currentValue === 'undefined' || currentValue !== msg.payload) {
                            queue.push({iface, params: [address, this.datapoint, msg.payload]});
                        }
                    }
                });
            });
            return queue;
        }

        shiftQueue(queue) {
            if (queue.length > 0) {
                const {iface, params} = queue.shift();
                const [address, datapoint, value] = params;
                this.ccu.setValue(iface, address, datapoint, value);
                setTimeout(() => {
                    this.shiftQueue(queue);
                }, this.delay);
            }
        }
    }

    RED.nodes.registerType('ccu-set-value', CcuSetValue);
};
