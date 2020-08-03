const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuRpcEventNode {
        constructor(config) {
            RED.nodes.createNode(this, config);
            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            const filter = {
                cache: config.cache,
                change: config.change,
                stable: config.working,
                iface: config.iface
            };

            this.ccu.register(this);

            [
                'rooms',
                'functions',
                'device',
                'deviceName',
                'deviceType',
                'channel',
                'channelName',
                'channelType',
                'channelIndex',
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
            this.idSubscription = this.ccu.subscribe(filter, message => {
                message.topic = this.ccu.topicReplace(config.topic, message);
                this.send(message);
            });
            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.debug('ccu-rpc-event close');
            this.ccu.unsubscribe(this.idSubscription);
            this.ccu.deregister(this);
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-rpc-event', CcuRpcEventNode);
};
