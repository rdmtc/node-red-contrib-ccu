module.exports = function (RED) {
    class CcuSysvarNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.name = config.name;
            this.topic = config.topic;

            this.ccu.subscribeSysvar(this.name, msg => {
                msg.topic = this.ccu.topicReplace(config.topic, msg);
                this.send(msg);
            });
            this.on('input', this._input);
        }

        _input(msg) {
            const name = this.name || msg.name || msg.topic;
            const value = msg.value || msg.payload;
            this.ccu.setVariable(name, value)
                .then(msg => {
                    msg.topic = this.ccu.topicReplace(this.topic, msg);
                    this.send(msg);
                })
                .catch(err => this.error(err.message));
        }
    }

    RED.nodes.registerType('ccu-sysvar', CcuSysvarNode);
};
