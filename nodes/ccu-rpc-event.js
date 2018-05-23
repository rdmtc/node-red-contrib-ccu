module.exports = function (RED) {
    class CcuRpcEventNode {
        constructor(config) {
            RED.nodes.createNode(this, config);
            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            const filter = {
                iface: config.iface,
                cache: config.cache,
                change: config.change
            };

            [
                'rooms',
                'functions',
                'device',
                'deviceName',
                'deviceType',
                'channel',
                'channelName',
                'channelType',
                'datapoint'

            ].forEach(attr => {
                if (!config[attr]) {
                    return;
                }
                if (config[attr + 'Rx'] === 're') {
                    filter[attr] = new RegExp(config[attr]);
                } else {
                    filter[attr] = config[attr];
                }
            });
            this.idSubscription = this.ccu.subscribe(filter, msg => {
                if (!msg.working || !config.working) {
                    msg.topic = this.ccu.topicReplace(config.topic, msg);
                    this.send(msg);
                }
            });
            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.log('ccu-rpc-event close');
            this.ccu.unsubscribe(this.idSubscription);
            done();
        }
    }

    RED.nodes.registerType('ccu-rpc-event', CcuRpcEventNode);
};
