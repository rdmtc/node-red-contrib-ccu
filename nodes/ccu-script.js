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

        _input(message, send, done) {
            let script = this.script || message.payload;
            script += '\n\nvar nr_script_call_success = true;\n';
            this.ccu.script(script)
                .then(message => {
                    message.iface = this.iface;
                    message.ccu = this.ccu.host;
                    message.topic = this.ccu.topicReplace(this.topic, message);
                    send(message);

                    if (message && message.objects && message.objects.nr_script_call_success === 'true') {
                        this.status({fill: 'green', shape: 'dot', text: 'success'});
                        done();
                    } else {
                        this.status({fill: 'red', shape: 'dot', text: 'error'});
                        done(new Error('Script call failed'));
                    }
                })
                .catch(error => {
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                    done(error);
                });
        }
    }

    RED.nodes.registerType('ccu-script', CcuScriptNode);
};
