const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {effectiveConfig} = require(path.join(__dirname, '/lib/dynconfig.js'));
const {valueStatus} = require(path.join(__dirname, '/lib/valuestatus.js'));

/** What a message may override through msg.config (B-2). */
const DYNAMIC_KEYS = ['name'];

module.exports = function (RED) {
    class CcuSysvarNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.iface = 'ReGaHSS';

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            // Migration
            if (typeof config.change === 'undefined') {
                config.change = true;
            }

            if (typeof config.cache === 'undefined') {
                config.cache = true;
            }

            this.name = config.name;
            this.topic = config.topic;

            // Where the value to write comes from. Defaults to msg.payload,
            // which is what the node has always used (#56).
            this.property = config.property || 'payload';
            this.propertyType = config.propertyType || 'msg';

            this.valueStatus = valueStatus(this);

            this.idSubscription = this.ccu.subscribeSysvar(
                {name: this.name, cache: config.cache, change: config.change},
                (message) => {
                    this.valueStatus.set(message.payload, message.ts);
                    message.topic = this.ccu.topicReplace(config.topic, message);
                    this.send(message);
                },
            );

            // Show the current value even when "emit value on start" is off:
            // the connection knows it either way (#54)
            if (!config.cache && this.name) {
                const known = this.ccu.sysvar[this.name];
                if (known) {
                    this.valueStatus.set(known.value, known.ts);
                }
            }

            this.on('input', this._input);
            this.on('close', this._destructor);
        }

        _input(message, send, done) {
            done = done || ((error) => error && this.error(error, message));
            const {config} = effectiveConfig({name: this.name}, message, DYNAMIC_KEYS);
            const name = config.name || message.topic;

            this.getValue(message)
                .then((value) => {
                    if (value === undefined) {
                        // nothing to write - do not turn an empty message into
                        // a variable write (same guard as the value node)
                        done();
                        return;
                    }

                    return this.ccu.setVariable(name, value).then(() => {
                        this.valueStatus.set(value, Date.now());
                        done();
                    });
                })
                .catch((error) => {
                    this.currentStatus = 'red';
                    this.status({fill: 'red', shape: 'dot', text: 'error'});
                    done(error);
                });
        }

        /**
         * The value to write, from the configured source (#56).
         * @param {object} message
         * @returns {Promise<*>}
         */
        getValue(message) {
            return new Promise((resolve, reject) => {
                switch (this.propertyType) {
                    case 'flow':
                    case 'global': {
                        const contextKey = RED.util.parseContextStore(this.property);
                        this.context()[this.propertyType].get(contextKey.key, contextKey.store, (err, res) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(res);
                            }
                        });
                        break;
                    }

                    case 'str':
                    case 'num':
                    case 'bool':
                    case 'json':
                    case 'env':
                        resolve(RED.util.evaluateNodeProperty(this.property, this.propertyType, this, message));
                        break;

                    default:
                        resolve(RED.util.getMessageProperty(message, this.property));
                }
            });
        }

        _destructor(done) {
            if (this.valueStatus) {
                this.valueStatus.stop();
            }

            if (this.idSubscription) {
                this.debug('unsubscribe');
                this.ccu.unsubscribeSysvar(this.idSubscription);
            }

            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-sysvar', CcuSysvarNode);
};
