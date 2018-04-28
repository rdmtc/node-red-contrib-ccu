module.exports = function (RED) {
    class CcuValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            const filter = {
                iface: config.iface,
                cache: config.cache,
                change: config.change,
                channel: config.channel.split(' ')[0],
                datapoint: config.datapoint
            };

            this.ccu.subscribe(filter, msg => {
                msg.topic = this.ccu.topicReplace(config.topic, msg);
                this.send(msg);
            });

            this.on('input', msg => {
                this.ccu.setValue(config.iface, config.channel.split(' ')[0], config.datapoint, msg.payload, config.burst);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.log('ccu-value close');
            done();
        }
    }

    RED.nodes.registerType('ccu-value', CcuValue);
};
