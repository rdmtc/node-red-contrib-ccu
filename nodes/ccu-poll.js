module.exports = function (RED) {
    class CcuPollNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.on('input', () => {
                this.ccu.regaPoll();
            });
        }
    }

    RED.nodes.registerType('ccu-poll', CcuPollNode);
};
