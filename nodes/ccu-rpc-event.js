const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {valueStatus} = require(path.join(__dirname, '/lib/valuestatus.js'));

const FILTER_ATTRIBUTES = [
    'rooms',
    'functions',
    'device',
    'deviceName',
    'deviceType',
    'channel',
    'channelName',
    'channelType',
    'channelIndex',
    'datapoint',
];

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
                iface: config.iface,
            };

            // opt-in: only present when the option is enabled, so existing
            // subscriptions keep receiving uncertain values (#96)
            if (config.certainOnly) {
                filter.uncertain = false;
            }

            this.ccu.register(this);

            FILTER_ATTRIBUTES.forEach((attr) => {
                if (!config[attr]) {
                    return;
                }

                if (config[attr + 'Rx'] === 're') {
                    filter[attr] = new RegExp(config[attr]);
                } else {
                    filter[attr] = config[attr];
                }
            });

            // The node used to show nothing at all; show what came through
            // last and how long ago (#52)
            this.valueStatus = valueStatus(this);

            this.idSubscription = this.ccu.subscribe(filter, (message) => {
                message.topic = this.ccu.topicReplace(config.topic, message);
                this.valueStatus.set(message.topic + ' = ' + message.payload, message.ts);
                this.send(message);
            });
            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.debug('ccu-rpc-event close');
            if (this.valueStatus) {
                this.valueStatus.stop();
            }

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
