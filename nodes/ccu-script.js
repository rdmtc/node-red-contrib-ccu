module.exports = function (RED) {
    class CcuScriptNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.script = config.script;
            this.topic = config.topic;

            this.on('input', this._input);
        }

        _input(msg) {
            this.ccu.script(this.script || msg.payload)
                .then(msg => {
                    msg.topic = this.ccu.topicReplace(this.topic, msg);
                    this.send(msg);
                })
                .catch(err => this.error(err.message));
        }
    }

    RED.nodes.registerType('ccu-script', CcuScriptNode);
};
