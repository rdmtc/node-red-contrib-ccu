/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
    'use strict';

    const operators = {
        eq(a, b) {
            return a == b;
        },
        neq(a, b) {
            return a != b;
        },
        lt(a, b) {
            return a < b;
        },
        lte(a, b) {
            return a <= b;
        },
        gt(a, b) {
            return a > b;
        },
        gte(a, b) {
            return a >= b;
        },
        btwn(a, b, c) {
            return a >= b && a <= c;
        },
        cont(a, b) {
            return (String(a)).indexOf(b) != -1;
        },
        regex(a, b, c, d) {
            return (String(a)).match(new RegExp(b, d ? 'i' : ''));
        },
        true(a) {
            return a === true;
        },
        false(a) {
            return a === false;
        },
        null(a) {
            return (typeof a === 'undefined' || a === null);
        },
        nnull(a) {
            return (typeof a !== 'undefined' && a !== null);
        },
        empty(a) {
            if (typeof a === 'string' || Array.isArray(a) || Buffer.isBuffer(a)) {
                return a.length === 0;
            } if (typeof a === 'object' && a !== null) {
                return Object.keys(a).length === 0;
            }
            return false;
        },
        nempty(a) {
            if (typeof a === 'string' || Array.isArray(a) || Buffer.isBuffer(a)) {
                return a.length !== 0;
            } if (typeof a === 'object' && a !== null) {
                return Object.keys(a).length !== 0;
            }
            return false;
        },

        istype(a, b) {
            if (b === 'array') {
                return Array.isArray(a);
            }
            if (b === 'buffer') {
                return Buffer.isBuffer(a);
            }
            if (b === 'json') {
                try {
                    JSON.parse(a); return true;
                } // or maybe ??? a !== null; }
                catch (e) {
                    return false;
                }
            } else if (b === 'null') {
                return a === null;
            } else {
                return typeof a === b && !Array.isArray(a) && !Buffer.isBuffer(a) && a !== null;
            }
        },
        head(a, b, c, d, parts) {
            const count = Number(b);
            return (parts.index < count);
        },
        tail(a, b, c, d, parts) {
            const count = Number(b);
            return (parts.count - count <= parts.index);
        },
        index(a, b, c, d, parts) {
            const min = Number(b);
            const max = Number(c);
            const index = parts.index;
            return ((min <= index) && (index <= max));
        },
        jsonata_exp(a, b) {
            return (b === true);
        },
        else(a) {
            return a === true;
        }
    };

    let _maxKeptCount;

    function getMaxKeptCount() {
        if (_maxKeptCount === undefined) {
            const name = 'nodeMessageBufferMaxLength';
            if (RED.settings.hasOwnProperty(name)) {
                _maxKeptCount = RED.settings[name];
            } else {
                _maxKeptCount = 0;
            }
        }
        return _maxKeptCount;
    }

    function getProperty(node, msg) {
        return new Promise((resolve, reject) => {
            if (node.iface === 'ReGaHSS') {
                resolve(node.ccu.sysvar[node.sysvar] && node.ccu.sysvar[node.sysvar][node.sysvarProperty]);
            } else {
                const address = node.iface + '.' + String(node.channel).split(' ')[0] + '.' + node.datapoint;
                resolve(node.ccu.values[address] && node.ccu.values[address][node.datapointProperty]);
            }
        });
    }

    function getV1(node, msg, rule, hasParts) {
        return new Promise((resolve, reject) => {
            if (rule.vt === 'prev') {
                resolve(node.previousValue);
            } else if (rule.vt === 'jsonata') {
                const exp = rule.v;
                if (rule.t === 'jsonata_exp') {
                    if (hasParts) {
                        exp.assign('I', msg.parts.index);
                        exp.assign('N', msg.parts.count);
                    }
                }
                RED.util.evaluateJSONataExpression(exp, msg, (err, value) => {
                    if (err) {
                        reject(RED._('switch.errors.invalid-expr', {error: err.message}));
                    } else {
                        resolve(value);
                    }
                });
            } else if (rule.vt === 'json') {
                resolve('json');
            } else if (rule.vt === 'null') {
                resolve('null');
            } else {
                RED.util.evaluateNodeProperty(rule.v, rule.vt, node, msg, (err, value) => {
                    if (err) {
                        resolve(undefined);
                    } else {
                        resolve(value);
                    }
                });
            }
        });
    }

    function getV2(node, msg, rule) {
        return new Promise((resolve, reject) => {
            const v2 = rule.v2;
            if (rule.v2t === 'prev') {
                resolve(node.previousValue);
            } else if (rule.v2t === 'jsonata') {
                RED.util.evaluateJSONataExpression(rule.v2, msg, (err, value) => {
                    if (err) {
                        reject(RED._('switch.errors.invalid-expr', {error: err.message}));
                    } else {
                        resolve(value);
                    }
                });
            } else if (typeof v2 !== 'undefined') {
                RED.util.evaluateNodeProperty(rule.v2, rule.v2t, node, msg, (err, value) => {
                    if (err) {
                        resolve(undefined);
                    } else {
                        resolve(value);
                    }
                });
            } else {
                resolve(v2);
            }
        });
    }

    function applyRule(node, msg, property, state) {
        return new Promise((resolve, reject) => {
            const rule = node.rules[state.currentRule];
            let v1, v2;

            getV1(node, msg, rule, state.hasParts).then(value => {
                v1 = value;
            }).then(() => getV2(node, msg, rule)).then(value => {
                v2 = value;
            }).then(() => {
                if (rule.t == 'else') {
                    property = state.elseflag;
                    state.elseflag = true;
                }
                if (operators[rule.t](property, v1, v2, rule.case, msg.parts)) {
                    state.onward.push(msg);
                    state.elseflag = false;
                    if (node.checkall == 'false') {
                        return resolve(false);
                    }
                } else {
                    state.onward.push(null);
                }
                resolve(state.currentRule < node.rules.length - 1);
            });
        });
    }

    function applyRules(node, msg, property, state) {
        if (!state) {
            state = {
                currentRule: 0,
                elseflag: true,
                onward: [],
                hasParts: msg.hasOwnProperty('parts') &&
                msg.parts.hasOwnProperty('id') &&
                msg.parts.hasOwnProperty('index')
            };
        }
        return applyRule(node, msg, property, state).then(hasMore => {
            if (hasMore) {
                state.currentRule++;
                return applyRules(node, msg, property, state);
            }
            node.previousValue = property;
            return state.onward;
        });
    }

    function CcuSwitchNode(n) {
        RED.nodes.createNode(this, n);
        this.ccu = RED.nodes.getNode(n.ccuConfig);
        this.iface = n.iface;
        this.channel = n.channel;
        this.datapoint = n.datapoint;
        this.datapointProperty = n.datapointProperty;
        this.sysvar = n.sysvar;
        this.sysvarProperty = n.sysvarProperty;
        this.rules = n.rules || [];
        this.property = n.property;
        this.propertyType = n.propertyType || 'msg';

        if (this.propertyType === 'jsonata') {
            try {
                this.property = RED.util.prepareJSONataExpression(this.property, this);
            } catch (err) {
                this.error(RED._('switch.errors.invalid-expr', {error: err.message}));
                return;
            }
        }

        this.checkall = n.checkall || 'true';
        this.previousValue = null;
        const node = this;
        let valid = true;
        const repair = n.repair;
        let needsCount = repair;
        for (let i = 0; i < this.rules.length; i += 1) {
            const rule = this.rules[i];
            needsCount = needsCount || ((rule.t === 'tail') || (rule.t === 'jsonata_exp'));
            if (!rule.vt) {
                if (!isNaN(Number(rule.v))) {
                    rule.vt = 'num';
                } else {
                    rule.vt = 'str';
                }
            }
            if (rule.vt === 'num') {
                if (!isNaN(Number(rule.v))) {
                    rule.v = Number(rule.v);
                }
            } else if (rule.vt === 'jsonata') {
                try {
                    rule.v = RED.util.prepareJSONataExpression(rule.v, node);
                } catch (err) {
                    this.error(RED._('switch.errors.invalid-expr', {error: err.message}));
                    valid = false;
                }
            }
            if (typeof rule.v2 !== 'undefined') {
                if (!rule.v2t) {
                    if (!isNaN(Number(rule.v2))) {
                        rule.v2t = 'num';
                    } else {
                        rule.v2t = 'str';
                    }
                }
                if (rule.v2t === 'num') {
                    rule.v2 = Number(rule.v2);
                } else if (rule.v2t === 'jsonata') {
                    try {
                        rule.v2 = RED.util.prepareJSONataExpression(rule.v2, node);
                    } catch (err) {
                        this.error(RED._('switch.errors.invalid-expr', {error: err.message}));
                        valid = false;
                    }
                }
            }
        }

        if (!valid) {
            return;
        }

        let pendingCount = 0;
        let pendingId = 0;
        let pendingIn = {};
        let pendingOut = {};
        let received = {};

        function addMessageToGroup(id, msg, parts) {
            if (!(id in pendingIn)) {
                pendingIn[id] = {
                    count: undefined,
                    msgs: [],
                    seq_no: pendingId++
                };
            }
            const group = pendingIn[id];
            group.msgs.push(msg);
            pendingCount++;
            const max_msgs = getMaxKeptCount();
            if ((max_msgs > 0) && (pendingCount > max_msgs)) {
                clearPending();
                node.error(RED._('switch.errors.too-many'), msg);
            }
            if (parts.hasOwnProperty('count')) {
                group.count = parts.count;
            }
            return group;
        }

        function addMessageToPending(msg) {
            const parts = msg.parts;
            // We've already checked the msg.parts has the require bits
            const group = addMessageToGroup(parts.id, msg, parts);
            const msgs = group.msgs;
            const count = group.count;
            if (count === msgs.length) {
                // We have a complete group - send the individual parts
                return msgs.reduce((promise, msg) => {
                    return promise.then(result => {
                        msg.parts.count = count;
                        return processMessage(msg, false);
                    });
                }, Promise.resolve()).then(() => {
                    pendingCount -= group.msgs.length;
                    delete pendingIn[parts.id];
                });
            }
            return Promise.resolve();
        }

        function sendGroup(onwards, port_count) {
            const counts = new Array(port_count).fill(0);
            for (var i = 0; i < onwards.length; i++) {
                var onward = onwards[i];
                for (var j = 0; j < port_count; j++) {
                    counts[j] += (onward[j] !== null) ? 1 : 0;
                }
            }
            const ids = new Array(port_count);
            for (var j = 0; j < port_count; j++) {
                ids[j] = RED.util.generateId();
            }
            const ports = new Array(port_count);
            const indexes = new Array(port_count).fill(0);
            for (var i = 0; i < onwards.length; i++) {
                var onward = onwards[i];
                for (var j = 0; j < port_count; j++) {
                    const msg = onward[j];
                    if (msg) {
                        const new_msg = RED.util.cloneMessage(msg);
                        const parts = new_msg.parts;
                        parts.id = ids[j];
                        parts.index = indexes[j];
                        parts.count = counts[j];
                        ports[j] = new_msg;
                        indexes[j]++;
                    } else {
                        ports[j] = null;
                    }
                }
                node.send(ports);
            }
        }

        function sendGroupMessages(onward, msg) {
            const parts = msg.parts;
            const gid = parts.id;
            received[gid] = ((gid in received) ? received[gid] : 0) + 1;
            const send_ok = (received[gid] === parts.count);

            if (!(gid in pendingOut)) {
                pendingOut[gid] = {
                    onwards: []
                };
            }
            const group = pendingOut[gid];
            const onwards = group.onwards;
            onwards.push(onward);
            pendingCount++;
            if (send_ok) {
                sendGroup(onwards, onward.length, msg);
                pendingCount -= onward.length;
                delete pendingOut[gid];
                delete received[gid];
            }
            const max_msgs = getMaxKeptCount();
            if ((max_msgs > 0) && (pendingCount > max_msgs)) {
                clearPending();
                node.error(RED._('switch.errors.too-many'), msg);
            }
        }

        function processMessage(msg, checkParts) {
            const hasParts = msg.hasOwnProperty('parts') &&
                msg.parts.hasOwnProperty('id') &&
                msg.parts.hasOwnProperty('index');

            if (needsCount && checkParts && hasParts) {
                return addMessageToPending(msg);
            }
            return getProperty(node, msg)
                .then(property => {
                    node.statusVal = String(property);
                    node.status({text: node.statusVal});
                    return applyRules(node, msg, property)
                })
                .then(onward => {
                    node.status({text: node.statusVal + ' (' + onward.map((e,i) => e ? (i + 1) : null).filter(e => e).join(',') + ')'});
                    if (!repair || !hasParts) {
                        node.send(onward);
                    } else {
                        sendGroupMessages(onward, msg);
                    }
                }).catch(err => {
                    node.warn(err);
                });
        }

        function clearPending() {
            pendingCount = 0;
            pendingId = 0;
            pendingIn = {};
            pendingOut = {};
            received = {};
        }

        const pendingMessages = [];
        let activeMessagePromise = null;
        var processMessageQueue = function (msg) {
            if (msg) {
                // A new message has arrived - add it to the message queue
                pendingMessages.push(msg);
                if (activeMessagePromise !== null) {
                    // The node is currently processing a message, so do nothing
                    // more with this message
                    return;
                }
            }
            if (pendingMessages.length === 0) {
                // There are no more messages to process, clear the active flag
                // and return
                activeMessagePromise = null;
                return;
            }

            // There are more messages to process. Get the next message and
            // start processing it. Recurse back in to check for any more
            const nextMsg = pendingMessages.shift();
            activeMessagePromise = processMessage(nextMsg, true)
                .then(processMessageQueue)
                .catch(err => {
                    node.error(err, nextMsg);
                    return processMessageQueue();
                });
        };

        this.on('input', msg => {
            processMessageQueue(msg);
        });

        this.on('close', () => {
            clearPending();
        });
    }

    RED.nodes.registerType('ccu-switch', CcuSwitchNode);
};
