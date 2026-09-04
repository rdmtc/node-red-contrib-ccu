const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {effectiveConfig, configCacheKey} = require(path.join(__dirname, '/lib/dynconfig.js'));
const {channelMatches, datapointsOf, CONFIG_KEYS} = require(path.join(__dirname, '/lib/channelfilter.js'));

/** Configuration keys an incoming message may supply (B-2). */
const DYNAMIC_KEYS = [...CONFIG_KEYS, 'force'];

module.exports = function (RED) {
    class CcuSetValue {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.ccu.register(this);

            this.config = {};
            DYNAMIC_KEYS.forEach((key) => {
                this.config[key] = config[key];
            });

            // Channels already known to (not) match the filter currently in
            // effect. Keyed by that filter, so a message that changes it gets
            // a fresh evaluation instead of inheriting the previous one (#133).
            this.filterKey = null;
            this.blacklist = new Set();
            this.whitelist = new Set();

            this.on('input', (message, send, done) => {
                try {
                    this.setValues(message);
                    if (done) {
                        done();
                    }
                } catch (error) {
                    if (done) {
                        done(error);
                    } else {
                        this.error(error.message, message);
                    }
                }
            });

            this.on('close', this._destructor);
        }

        _destructor(done) {
            if (this.idSubscription) {
                this.debug('ccu-set-value close');
                this.ccu.unsubscribe(this.idSubscription);
            }

            done();
        }

        setStatus(data) {
            statusHelper(this, data);
        }

        /**
         * The match caches are only valid for the filter they were built
         * from — reset them whenever the effective filter changes.
         * @param {object} config effective configuration for this message
         */
        useFilter(config) {
            const key = configCacheKey(config, CONFIG_KEYS);
            if (key !== this.filterKey) {
                this.filterKey = key;
                this.blacklist = new Set();
                this.whitelist = new Set();
            }
        }

        setValues(message) {
            const {config} = effectiveConfig(this.config, message, DYNAMIC_KEYS, {flat: true});
            this.useFilter(config);

            let count = 0;
            Object.keys(this.ccu.metadata.devices).forEach((iface) => {
                if (config.iface && iface !== config.iface) {
                    return;
                }

                Object.keys(this.ccu.metadata.devices[iface]).forEach((address) => {
                    if (this.blacklist.has(address)) {
                        return;
                    }

                    if (!this.whitelist.has(address)) {
                        if (!channelMatches(this.ccu, iface, address, config)) {
                            this.blacklist.add(address);
                            return;
                        }

                        this.whitelist.add(address);
                    }

                    datapointsOf(this.ccu, iface, address, config).forEach((dp) => {
                        const datapointName = iface + '.' + address + '.' + dp;
                        const currentValue = this.ccu.values[datapointName] && this.ccu.values[datapointName].value;
                        count += 1;
                        if (
                            dp.startsWith('PRESS_') ||
                            typeof currentValue === 'undefined' ||
                            currentValue !== message.payload
                        ) {
                            this.ccu
                                .setValueQueued(iface, address, dp, message.payload, false, config.force)
                                .catch(() => {});
                        }
                    });
                });
            });
            this.status({fill: 'green', shape: 'ring', text: String(count) + ' datapoints'});
        }
    }

    RED.nodes.registerType('ccu-set-value', CcuSetValue);
};
