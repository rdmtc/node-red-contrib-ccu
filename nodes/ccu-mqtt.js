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

            this.topicCounters = config.topicCounters;
            this.rxCounters = {};
            this.txCounters = {};

            this.payloadOutput = config.payloadOutput;

            this.ccu.register(this);

            this.on('input', message => {
                this.input(message);
            });

            this.idEventSubscription = this.ccu.subscribe({cache: config.cache}, message => {
                this.event(message);
            });

            this.idSysvarSubscription = this.ccu.subscribeSysvar({cache: config.cache, change: true}, message => {
                this.sysvarOutput(message);
            });

            this.idProgramSubscription = this.ccu.subscribeProgram({}, message => {
                this.programOutput(message);
            });

            this.on('close', this._destructor);

            if (this.topicCounters) {
                setTimeout(() => {
                    this.ccu.enabledIfaces.forEach(iface => {
                        this.send({topic: this.ccu.topicReplace(this.topicCounters, {iface, rxtx: 'rx'}), payload: '0', retain: true});
                        this.send({topic: this.ccu.topicReplace(this.topicCounters, {iface, rxtx: 'tx'}), payload: '0', retain: true});
                    });
                }, 25000);
                setInterval(() => {
                    this.checkCounters('rxCounters');
                    this.checkCounters('txCounters');
                }, 30000);
            }
        }

        _destructor(done) {
            this.trace('ccu-mqtt close');
            this.ccu.unsubscribe(this.idEventSubscription);
            this.ccu.unsubscribeSysvar(this.idSysvarSubscription);
            this.ccu.unsubscribeProgram(this.idProgramSubscription);
            this.ccu.deregister(this);
            done();
        }

        checkCounters(c) {
            Object.keys(this.ccu[c]).forEach(iface => {
                if (this.ccu[c][iface] !== this[c][iface]) {
                    this[c][iface] = this.ccu[c][iface];
                    const topic = this.ccu.topicReplace(this.topicCounters, {iface, rxtx: c.slice(0, 2)});
                    const payload = this[c][iface];
                    this.send({topic, payload, retain: true});
                }
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        event(message) {
            const topic = this.ccu.topicReplace(this.topicOutputEvent, message);
            const retain = !(message.datapoint && message.datapoint.startsWith('PRESS_'));
            this.send({topic, payload: this.output(message), retain});

            if (['LEVEL', 'STATE'].includes(message.datapoint) && message.working === false) {
                const messageNotWorking = RED.util.cloneMessage(message);
                messageNotWorking.datapoint += '_NOTWORKING';
                messageNotWorking.datapointName += '_NOTWORKING';
                this.send({topic: this.ccu.topicReplace(this.topicOutputEvent, messageNotWorking), payload: this.output(messageNotWorking), retain: true});
            }
        }

        sysvarOutput(message) {
            const topic = this.ccu.topicReplace(this.topicOutputSysvar, message);
            this.send({topic, payload: this.output(message), retain: true});
        }

        programOutput(message) {
            const topic = this.ccu.topicReplace(this.topicOutputSysvar, message);
            this.send({topic, payload: this.output(message), retain: true});
        }

        output(message) {
            message = RED.util.cloneMessage(message);
            switch (this.payloadOutput) {
                case 'mqsh-basic': {
                    return {
                        val: message.payload,
                        ts: message.ts,
                        lc: message.lc
                    };
                }

                case 'mqsh-extended': {
                    const payload = {
                        val: message.payload,
                        ts: message.ts,
                        lc: message.lc,
                        hm: message
                    };
                    delete payload.hm.topic;
                    delete payload.hm.payload;
                    delete payload.hm.value;

                    return payload;
                }

                default: {
                    if (typeof message.payload === 'boolean') {
                        return Number(message.payload);
                    }

                    return message.payload;
                }
            }
        }

        input(message) {
            const {topic, payload} = message;
            this.debug('input ' + topic + ' ' + JSON.stringify(payload).slice(0, 40));

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
                    const patternArray = [];
                    const placeholders = [];
                    for (let i = 0, {length} = parts; i < length; i++) {
                        let match;
                        if (match = parts[i].match(/^\${([\w-]+)}$/)) { // eslint-disable-line no-cond-assign
                            placeholders.push(match[1]);
                            patternArray[i] = (i + 1) < length ? '+' : '#';
                        } else {
                            patternArray[i] = parts[i];
                        }
                    }

                    const pattern = patternArray.join('/');
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
                    filter.channel = this.ccu.findChannel(filter.channelNameOrAddress, true);
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

            this.ccu.setValue(iface, filter.channel, filter.datapoint, payload).catch(() => {});
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
                    this.error('param ' + filter.param + ' not writeable');
                }

                payload = this.paramCast(payload, paramsetDescription[filter.param]);
            } else {
                this.warn('unknown paramset/param ' + filter.paramset + ' ' + filter.param);
            }

            const paramset = {};
            paramset[filter.param] = payload;

            this.ccu.methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch(error => this.error(error.message));
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

            Object.keys(payload).forEach(parameter => {
                if (paramsetDescription && paramsetDescription[parameter]) {
                    if (!(paramsetDescription[parameter].OPERATIONS) && 2) {
                        this.error('param ' + parameter + ' not writeable');
                    }

                    paramset[parameter] = this.paramCast(payload[parameter], paramsetDescription[filter.param]);
                } else {
                    this.warn('unknown paramset/param ' + filter.paramset + ' ' + parameter);
                    paramset[parameter] = payload[parameter];
                }
            });

            this.ccu.methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch(error => this.error(error.message));
        }

        paramCast(value, paramset) {
            switch (paramset && paramset.TYPE) {
                case 'BOOL':
                    // Fallthrough by intention
                case 'ACTION':
                    // OMG this is so ugly...
                    if (value === 'false') {
                        value = false;
                    } else if (!isNaN(value)) { // Make sure that the string "0" gets casted to boolean false
                        value = Number(value);
                    }

                    value = Boolean(value);
                    break;
                case 'FLOAT':
                    value = Number.parseFloat(value);
                    if (value < paramset.MIN) {
                        value = paramset.MIN;
                    } else if (value > paramset.MAX) {
                        value = paramset.MAX;
                    }

                    value = {explicitDouble: value};
                    break;
                case 'ENUM':
                    if (typeof value === 'string') {
                        if (paramset.ENUM && (paramset.ENUM.includes(value))) {
                            value = paramset.ENUM.indexOf(value);
                        }
                    }

                    // Fallthrough by intention
                case 'INTEGER':
                    value = Number.parseInt(value, 10);
                    if (value < paramset.MIN) {
                        value = paramset.MIN;
                    } else if (value > paramset.MAX) {
                        value = paramset.MAX;
                    }

                    break;
                case 'STRING':
                    value = String(value);
                    break;
                default:
            }

            return value;
        }
    }

    RED.nodes.registerType('ccu-mqtt', CcuMqttNode);
};
