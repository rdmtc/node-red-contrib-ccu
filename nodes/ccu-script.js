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
            this.iface = 'ReGaHSS';

            this.on('input', this._input);

            this.status({});
        }

        _input(msg) {
            let script = this.script || msg.payload;
            script += '\n\nvar nr_script_call_success = true;\n';
            this.ccu.script(script)
                .then(msg => {
                    msg.topic = this.ccu.topicReplace(this.topic, msg);
                    this.send(msg);
                    if (msg && msg.objects && msg.objects.nr_script_call_success) {
                        this.status({fill: 'green', shape: 'dot', text: 'success'});
                    } else {
                        this.status({fill: 'red', shape: 'dot', text: 'error'});
                    }
                })
                .catch(err => {
                    this.error(err.message);
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                });
        }
    }

    RED.nodes.registerType('ccu-script', CcuScriptNode);
};
