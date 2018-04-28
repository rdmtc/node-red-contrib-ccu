module.exports = function (RED) {
    class CcuProgramNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.name = config.name;

            this.ccu.subscribeProgram(this.name, msg => {
                msg.topic = this.ccu.topicReplace(config.topic, msg);
                this.send(msg);
            });

            this.on('input', this._input);
        }

        _input(msg) {
            switch (typeof msg.payload) {
                case 'boolean':
                    this.ccu.programActive(this.name || msg.topic, msg.payload)
                        .then(msg => this.send(msg))
                        .catch(err => this.error(err.message));
                    break;
                default:
                    this.ccu.programExecute(this.name || msg.topic)
                        .then(msg => this.send(msg))
                        .catch(err => this.error(err.message));
            }
        }
    }

    RED.nodes.registerType('ccu-program', CcuProgramNode);
};
