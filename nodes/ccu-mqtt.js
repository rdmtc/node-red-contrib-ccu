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

            this.idEventSubscription = this.ccu.subscribe({cache: config.cache}, msg => {
                this.event(msg);
            });

            this.idSysvarSubscription = this.ccu.subscribeSysvar({cache: config.cache, change: true}, msg => {
                this.sysvarOutput(msg);
            });

            this.idProgramSubscription = this.ccu.subscribeProgram({}, msg => {
                this.programOutput(msg);
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            this.trace('ccu-mqtt close');
            this.ccu.unsubscribe(this.idEventSubscription);
            this.ccu.unsubscribeSysvar(this.idSysvarSubscription);
            this.ccu.unsubscribeProgram(this.idProgramSubscription);
            this.ccu.deregister(this);
            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        event(msg) {
            const topic = this.ccu.topicReplace(this.topicOutputEvent, msg);
            const retain = !(msg.datapoint && msg.datapoint.startsWith('PRESS_'));
            this.send({topic, payload: this.output(msg), retain});

            if (msg.working === false) {
                const msgNotWorking = RED.util.cloneMessage(msg);
                msgNotWorking.datapoint += '_NOTWORKING';
                msgNotWorking.datapointName += '_NOTWORKING';
                this.send({topic, payload: this.output(msg), retain: true});
            }
        }

        sysvarOutput(msg) {
            const topic = this.ccu.topicReplace(this.topicOutputSysvar, msg);
            this.send({topic, payload: this.output(msg), retain: true});
        }

        programOutput(msg) {
            const topic = this.ccu.topicReplace(this.topicOutputSysvar, msg);
            this.send({topic, payload: this.output(msg), retain: true});
        }

        output(msg) {
            msg = RED.util.cloneMessage(msg);
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

        sysvar(filter, payload) {
            if (!filter.name) {
                this.error('name undefined');
                return;
            }
            if (this.ccu.sysvar[filter.name]) {
                this.ccu.setVariable(filter.name, payload);
            } else if (this.ccu.program[filter.name]) {
                if (typeof payload === 'boolean') {
                    this.ccu.programActive(filter.name, payload);
                } else {
                    this.ccu.programExecute(filter.name);
                }
            } else {
                this.error('no sysvar or program with name ' + filter.name + ' found');
            }
        }

        putParam(filter, payload) {
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

            const psName = this.ccu.paramsetName(iface, this.ccu.metadata.devices[iface][filter.channel], filter.paramset);
            const paramsetDescription = this.ccu.paramsetDescriptions[psName];
            if (paramsetDescription && paramsetDescription[filter.param]) {
                if (!(paramsetDescription[filter.param].OPERATIONS) && 2) {
                    log.error('param ' + filter.param + ' not writeable');
                }
                payload = this.paramCast(payload, paramsetDescription[filter.param]);
            } else {
                this.warn('unknown paramset/param ' + filter.paramset + ' ' + filter.param);
            }

            const paramset = {};
            paramset[filter.param] = payload;

            this.ccu.methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch(err => this.error(err.message));
        }

        putParamset(filter, payload) {
            if (typeof payload !== 'object') {
                this.error('payload is not an object');
                return;
            }

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

            const psName = this.ccu.paramsetName(iface, this.ccu.metadata.devices[iface][filter.channel], filter.paramset);
            const paramsetDescription = this.ccu.paramsetDescriptions[psName];

            const paramset = {};

            Object.keys(payload).forEach(param => {
                if (paramsetDescription && paramsetDescription[param]) {
                    if (!(paramsetDescription[param].OPERATIONS) && 2) {
                        log.error('param ' + param + ' not writeable');
                    }
                    paramset[param] = this.paramCast(payload[param], paramsetDescription[filter.param]);
                } else {
                    this.warn('unknown paramset/param ' + filter.paramset + ' ' + param);
                    paramset[param] = payload[param];
                }
            });

            this.ccu.methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch(err => this.error(err.message));
        }


        paramCast(val, paramset) {
            switch (paramset && paramset.TYPE) {
                case 'BOOL':
                // eslint-disable-line no-fallthrough
                case 'ACTION':
                    // OMG this is so ugly...
                    if (val === 'false') {
                        val = false;
                    } else if (!isNaN(val)) { // Make sure that the string "0" gets casted to boolean false
                        val = Number(val);
                    }
                    val = Boolean(val);
                    break;
                case 'FLOAT':
                    val = parseFloat(val);
                    if (val < paramset.MIN) {
                        val = paramset.MIN;
                    } else if (val > paramset.MAX) {
                        val = paramset.MAX;
                    }
                    val = {explicitDouble: val};
                    break;
                case 'ENUM':
                    if (typeof val === 'string') {
                        if (paramset.ENUM && (paramset.ENUM.indexOf(val) !== -1)) {
                            val = paramset.ENUM.indexOf(val);
                        }
                    }
                // eslint-disable-line no-fallthrough
                case 'INTEGER':
                    val = parseInt(val, 10);
                    if (val < paramset.MIN) {
                        val = paramset.MIN;
                    } else if (val > paramset.MAX) {
                        val = paramset.MAX;
                    }
                    break;
                case 'STRING':
                    val = String(val);
                    break;
                default:
            }

            return val;
        }
    }

    RED.nodes.registerType('ccu-mqtt', CcuMqttNode);
};
