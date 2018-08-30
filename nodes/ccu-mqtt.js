const path = require('path');
const mw = require('mqtt-wildcard');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuMqttNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.topicOutputEvent = config.topicOutputEvent;
            this.topicInputSetValue = config.topicInputSetValue;

            this.topicOutputSysvar = config.topicOutputSysvar;
            this.topicInputSysvar = config.topicInputSysvar;

            this.topicInputPutParam = config.topicInputPutParam;
            this.topicInputPutParamset = config.topicInputPutParamset;

            this.topicInputRpc = config.topicInputRpc;

            this.payloadOutput = config.payloadOutput;

            this.ccu.register(this);

            this.on('input', (msg) => {
                this.input(msg);
            });

            this.idEventSubscription = this.ccu.subscribe({}, msg => {
                this.event(msg);
            });

            this.idSysvarSubscription = this.ccu.subscribeSysvar({name: this.name, cache: config.cache, change: config.change}, msg => {
                this.sysvar(msg);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.debug('ccu-mqtt close');
            this.ccu.unsubscribe(this.idEventSubscription);
            this.ccu.unsubscribe(this.idSysvarSubscription);
            this.ccu.deregister(this);
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        event(msg) {
            const topic = this.ccu.topicReplace(this.topicOutputEvent, msg);
            this.send({topic, payload: this.output(msg)});

            if (msg.working === false) {
                const msgNotWorking = RED.util.cloneMessage(msg);
                msgNotWorking.datapoint += '_NOTWORKING';
                msgNotWorking.datapointName += '_NOTWORKING';
                this.send({topic, payload: this.output(msg)});
            }
        }

        sysvar(msg) {
            const topic = this.ccu.topicReplace(this.topicOutputSysvar, msg);
            this.send({topic, payload: this.output(msg)});
        }

        output(msg) {
            switch (this.payloadOutput) {
                case 'mqsh-basic': {
                    return {
                        val: msg.payload,
                        ts: msg.ts,
                        lc: msg.lc
                    };
                }
                case 'mqsh-extended': {
                    const payload = {
                        val: msg.payload,
                        ts: msg.ts,
                        lc: msg.lc,
                        hm: msg
                    };
                    delete payload.hm.topic;
                    delete payload.hm.payload;
                    delete payload.hm.value;

                    return payload;
                }
                default: {
                    if (typeof msg.payload === 'boolean') {
                        return Number(msg.payload);
                    }
                    return msg.payload;
                }
            }
        }

        input(msg) {
            const {topic, payload} = msg;
            this.debug('input ' + topic + ' ' + JSON.stringify(payload).slice(0,40));

            const topicList = {
                setValue: this.topicInputSetValue,
                sysvar: this.topicInputSysvar,
                putParam: this.topicInputPutParam,
                putParamset: this.topicInputPutParamset,
                rpc: this.topicInputRpc
            };

            let command;
            let filter;
            Object.keys(topicList).forEach(key => {
                if (!command) {
                    const parts = topicList[key].split('/');
                    const patternArr = [];
                    const placeholders = [];
                    for (let i = 0, len = parts.length; i < len; i++) {
                        let match;
                        if (match = parts[i].match(/^\${([a-zA-Z0-9_-]+)}$/)) {
                            placeholders.push(match[1]);
                            patternArr[i] = (i + 1) < len ? '+' : '#';
                        } else {
                            patternArr[i] = parts[i];
                        }
                    }
                    const pattern = patternArr.join('/');
                    const match = mw(topic, pattern);
                    if (match && match.length === placeholders.length) {
                        command = key;
                        filter = Object.assign.apply({}, placeholders.map((v, i) => ({[v]: match[i]})));
                    }
                }
            });

            if (command && typeof this[command] === 'function') {
                this[command](filter, payload);
            }
        }

        setValue(filter, payload) {
            if (filter.channelNameOrAddress) {
                if (this.ccu.channelNames[filter.channelNameOrAddress]) {
                    filter.channel = filter.channelNameOrAddress;
                } else {
                    filter.channel = this.ccu.findChannel(filter.channelNameOrAddress);
                }
                if (!filter.channel) {
                    this.error('channel ' + filter.channelNameOrAddress + ' not found');
                    return;
                }
            }

            if (!filter.channel) {
                this.error('channel undefined');
                return;
            }
            const iface = this.ccu.findIface(filter.channel);

            if (!iface) {
                this.error('no interface found for channel ' + filter.channel);
                return;
            }

            this.ccu.setValue(iface, filter.channel, filter.datapoint, payload);
        }



    }

    RED.nodes.registerType('ccu-mqtt', CcuMqttNode);
};
