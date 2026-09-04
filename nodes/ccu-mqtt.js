const path = require('path');
const mw = require('mqtt-wildcard');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {castValue} = require(path.join(__dirname, '/lib/cast.js'));

/** HM thermostats: CONTROL_MODE is read-only, the modes are set through actions */
const HM_MODES = {
    'AUTO-MODE': () => ['AUTO_MODE', true],
    'MANU-MODE': (setpoint) => ['MANU_MODE', setpoint],
    'BOOST-MODE': () => ['BOOST_MODE', true],
    'COMFORT-MODE': () => ['COMFORT_MODE', true],
    'LOWERING-MODE': () => ['LOWERING_MODE', true],
};

/** Words Home Assistant sends to LEVEL; 1.005 is the actuators' "old level" value */
const LEVEL_WORDS = {OPEN: 1, CLOSE: 0, ON: 1.005, OFF: 0};

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

            this.topicInputGet = config.topicInputGet;

            this.topicInputRpc = config.topicInputRpc;
            this.topicOutputRpc = config.topicOutputRpc;

            this.topicCounters = config.topicCounters;
            this.rxCounters = {};
            this.txCounters = {};

            this.payloadOutput = config.payloadOutput;

            this.ccu.register(this);

            this.on('input', (message) => {
                this.input(message);
            });

            this.idEventSubscription = this.ccu.subscribe({cache: config.cache}, (message) => {
                this.event(message);
            });

            this.idSysvarSubscription = this.ccu.subscribeSysvar({cache: config.cache, change: true}, (message) => {
                this.sysvarOutput(message);
            });

            this.idProgramSubscription = this.ccu.subscribeProgram({}, (message) => {
                this.programOutput(message);
            });

            this.on('close', this._destructor);

            if (this.topicCounters) {
                setTimeout(() => {
                    this.ccu.enabledIfaces.forEach((iface) => {
                        this.send({
                            topic: this.ccu.topicReplace(this.topicCounters, {iface, rxtx: 'rx'}),
                            payload: '0',
                            retain: true,
                        });
                        this.send({
                            topic: this.ccu.topicReplace(this.topicCounters, {iface, rxtx: 'tx'}),
                            payload: '0',
                            retain: true,
                        });
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
            Object.keys(this.ccu[c]).forEach((iface) => {
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
            // channels without a ReGa name used to produce hm/status//STATE-style
            // topics — fall back to the address (B-3)
            const topicMessage = message.channelName ? message : {...message, channelName: message.channel};
            const topic = this.ccu.topicReplace(this.topicOutputEvent, topicMessage);
            const retain = !(message.datapoint && message.datapoint.startsWith('PRESS_'));
            this.send({topic, payload: this.output(message), retain});

            if (['LEVEL', 'STATE'].includes(message.datapoint) && message.working === false) {
                const messageNotWorking = RED.util.cloneMessage(topicMessage);
                messageNotWorking.datapoint += '_NOTWORKING';
                messageNotWorking.datapointName += '_NOTWORKING';
                this.send({
                    topic: this.ccu.topicReplace(this.topicOutputEvent, messageNotWorking),
                    payload: this.output(messageNotWorking),
                    retain: true,
                });
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
                        lc: message.lc,
                    };
                }

                case 'mqsh-extended': {
                    const payload = {
                        val: message.payload,
                        ts: message.ts,
                        lc: message.lc,
                        hm: message,
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
                get: this.topicInputGet,
                setValue: this.topicInputSetValue,
                sysvar: this.topicInputSysvar,
                putParam: this.topicInputPutParam,
                putParamset: this.topicInputPutParamset,
                rpc: this.topicInputRpc,
            };

            let command;
            let filter;
            Object.keys(topicList).forEach((key) => {
                // a topic left empty in the editor disables that command
                if (!command && topicList[key]) {
                    const parts = topicList[key].split('/');
                    const patternArray = [];
                    const placeholders = [];
                    for (let i = 0, {length} = parts; i < length; i++) {
                        let match;
                        if ((match = parts[i].match(/^\${([\w-]+)}$/))) {
                            placeholders.push(match[1]);
                            patternArray[i] = i + 1 < length ? '+' : '#';
                        } else {
                            patternArray[i] = parts[i];
                        }
                    }

                    const pattern = patternArray.join('/');
                    const match = mw(topic, pattern);
                    if (match && match.length === placeholders.length) {
                        command = key;
                        filter = Object.assign.apply(
                            {},
                            placeholders.map((v, i) => ({[v]: match[i]})),
                        );
                    }
                }
            });

            if (command && typeof this[command] === 'function') {
                this[command](filter, payload);
            }
        }

        /**
         * Resolve `channelNameOrAddress` to a channel address and its
         * interface, reporting the same errors the commands used to report
         * inline.
         * @param {object} filter parsed from the topic; `channel` is filled in
         * @param {boolean} [exact] pass through to findChannel
         * @returns {string|null} the interface, or null when unresolvable
         */
        resolveChannel(filter, exact) {
            if (filter.channelNameOrAddress) {
                if (this.ccu.channelNames[filter.channelNameOrAddress]) {
                    filter.channel = filter.channelNameOrAddress;
                } else {
                    filter.channel = this.ccu.findChannel(filter.channelNameOrAddress, exact);
                }

                if (!filter.channel) {
                    this.error('channel ' + filter.channelNameOrAddress + ' not found');
                    return null;
                }
            }

            if (!filter.channel) {
                this.error('channel undefined');
                return null;
            }

            const iface = this.ccu.findIface(filter.channel);

            if (!iface) {
                this.error('no interface found for channel ' + filter.channel);
                return null;
            }

            return iface;
        }

        /**
         * Republish the last known value of a datapoint on its status topic,
         * so a flow can ask for a refresh over MQTT instead of waiting for the
         * next event (#115). An empty datapoint republishes the whole channel.
         * @param {object} filter
         */
        get(filter) {
            const iface = this.resolveChannel(filter, true);
            if (!iface) {
                return;
            }

            const prefix = iface + '.' + filter.channel + '.';
            const names = filter.datapoint
                ? [prefix + filter.datapoint]
                : Object.keys(this.ccu.values).filter((name) => name.startsWith(prefix));

            if (names.length === 0) {
                this.error('unknown datapoint ' + prefix + (filter.datapoint || '#'));
                return;
            }

            names.forEach((name) => {
                const value = this.ccu.values[name];
                if (value) {
                    this.event({...value});
                } else {
                    this.error('unknown datapoint ' + name);
                }
            });
        }

        /**
         * Call an arbitrary RPC method on an interface and publish the result
         * (#22). The topic supplies interface, method and a caller-chosen id
         * that the response topic echoes; the payload is the parameter array
         * (a single value is accepted and wrapped).
         * @param {object} filter
         * @param {*} payload
         */
        rpc(filter, payload) {
            if (!filter.iface) {
                this.error('interface undefined');
                return;
            }

            if (!filter.method) {
                this.error('method undefined');
                return;
            }

            let parameters = payload;
            if (parameters === undefined || parameters === null || parameters === '') {
                parameters = [];
            } else if (!Array.isArray(parameters)) {
                parameters = [parameters];
            }

            const respond = (result, error) => {
                if (!this.topicOutputRpc) {
                    return;
                }

                this.send({
                    topic: this.ccu.topicReplace(this.topicOutputRpc, {
                        iface: filter.iface,
                        method: filter.method,
                        callid: filter.callid,
                    }),
                    payload: error ? {error: error.message} : {result},
                    retain: false,
                });
            };

            this.ccu
                .methodCall(filter.iface, filter.method, parameters)
                .then((result) => respond(result))
                .catch((error) => {
                    this.error(error.message);
                    respond(undefined, error);
                });
        }

        setValue(filter, payload) {
            const iface = this.resolveChannel(filter, true);
            if (!iface) {
                return;
            }

            const command = this.translateCommand(iface, filter.channel, filter.datapoint, payload);
            this.ccu.setValue(iface, filter.channel, command.datapoint, command.payload).catch(() => {});
        }

        /**
         * Words Home Assistant's single-topic conventions send (see the
         * ccu-homeassistant node): LEVEL accepts OPEN, CLOSE, STOP, ON (restore the
         * last level) and OFF; HM thermostats accept the CONTROL_MODE names
         * (AUTO-MODE, MANU-MODE, BOOST-MODE, COMFORT-MODE, LOWERING-MODE), which
         * are translated to the *_MODE actions because CONTROL_MODE itself is
         * read-only there. Everything else passes through unchanged.
         * @returns {{datapoint: string, payload: *}}
         */
        translateCommand(iface, channel, datapoint, payload) {
            if (typeof payload !== 'string') {
                return {datapoint, payload};
            }

            const word = payload.trim().toUpperCase();
            const device = this.ccu.metadata.devices[iface] && this.ccu.metadata.devices[iface][channel];
            const description = (device && this.ccu.getParamsetDescription(iface, device, 'VALUES')) || {};

            if (datapoint === 'LEVEL') {
                if (word === 'STOP' && description.STOP) {
                    return {datapoint: 'STOP', payload: true};
                }

                if (word in LEVEL_WORDS) {
                    return {datapoint, payload: LEVEL_WORDS[word]};
                }
            }

            if (
                datapoint === 'CONTROL_MODE' &&
                HM_MODES[word] &&
                description.CONTROL_MODE &&
                !(description.CONTROL_MODE.OPERATIONS & 2)
            ) {
                const current = this.ccu.values[iface + '.' + channel + '.SET_TEMPERATURE'];
                const setpoint = current && typeof current.value === 'number' ? current.value : 20;
                const [dp, value] = HM_MODES[word](setpoint);
                return {datapoint: dp, payload: value};
            }

            return {datapoint, payload};
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
            const iface = this.resolveChannel(filter);
            if (!iface) {
                return;
            }

            const psName = this.ccu.paramsetName(
                iface,
                this.ccu.metadata.devices[iface][filter.channel],
                filter.paramset,
            );
            const paramsetDescription = this.ccu.paramsetDescriptions[psName];
            if (paramsetDescription && paramsetDescription[filter.param]) {
                // was `!(OPERATIONS) && 2`, which is always false - the check
                // never fired and the write went out regardless (B-3)
                if (!(paramsetDescription[filter.param].OPERATIONS & 2)) {
                    this.error('param ' + filter.param + ' not writeable');
                    return;
                }

                payload = castValue(payload, paramsetDescription[filter.param], {clamp: true});
            } else {
                this.warn('unknown paramset/param ' + filter.paramset + ' ' + filter.param);
            }

            const paramset = {};
            paramset[filter.param] = payload;

            this.ccu
                .methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch((error) => this.error(error.message));
        }

        putParamset(filter, payload) {
            if (typeof payload !== 'object') {
                this.error('payload is not an object');
                return;
            }

            const iface = this.resolveChannel(filter);
            if (!iface) {
                return;
            }

            const psName = this.ccu.paramsetName(
                iface,
                this.ccu.metadata.devices[iface][filter.channel],
                filter.paramset,
            );
            const paramsetDescription = this.ccu.paramsetDescriptions[psName];

            const paramset = {};

            Object.keys(payload).forEach((parameter) => {
                if (paramsetDescription && paramsetDescription[parameter]) {
                    // was `!(OPERATIONS) && 2` (always false), and the cast
                    // used paramsetDescription[filter.param], which is
                    // undefined here - so every value went out uncast (B-3)
                    if (!(paramsetDescription[parameter].OPERATIONS & 2)) {
                        this.error('param ' + parameter + ' not writeable');
                        return;
                    }

                    paramset[parameter] = castValue(payload[parameter], paramsetDescription[parameter], {
                        clamp: true,
                    });
                } else {
                    this.warn('unknown paramset/param ' + filter.paramset + ' ' + parameter);
                    paramset[parameter] = payload[parameter];
                }
            });

            this.ccu
                .methodCall(iface, 'putParamset', [filter.channel, filter.paramset, paramset])
                .catch((error) => this.error(error.message));
        }
    }

    RED.nodes.registerType('ccu-mqtt', CcuMqttNode);
};
