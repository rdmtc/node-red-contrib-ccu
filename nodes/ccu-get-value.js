module.exports = function (RED) {
    class CcuGetValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.on('input', (msg) => {
                let out = {};

                if (config.iface === 'ReGaHSS') {
                    Object.assign(out, this.ccu.sysvar[config.sysvar]);
                } else {
                    const address = config.iface + '.' + config.channel.split(' ')[0] + '.' + config.datapoint;
                    Object.assign(out, this.ccu.values[address]);
                }
                out.topic = msg.topic;
                this.send(out);
            });
        }
    }

    RED.nodes.registerType('ccu-get-value', CcuGetValue);
};
