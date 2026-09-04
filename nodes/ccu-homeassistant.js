const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));
const {topicReplace} = require('./lib/topic.js');
const {discoveryMessages, removalMessage} = require('./lib/hadiscovery.js');

const pkg = require(path.join(__dirname, '..', 'package.json'));

const READY_INTERVAL = 5000;
const READY_ATTEMPTS = 60;

/**
 * Home Assistant MQTT auto-discovery for a checkbox-selected set of devices (B-16).
 *
 * Companion to a ccu-mqtt node: reuses its topic templates and payload format, so
 * the discovery configs point at the topics ccu-mqtt already publishes/consumes.
 * The node itself only emits (a) the retained discovery configs — wire its output
 * to the same mqtt-out node as the ccu-mqtt node — and (b) the aggregate PRESS
 * event Home Assistant's event entities need.
 */
module.exports = function (RED) {
    class CcuHomeAssistantNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.mqttNodeId = config.mqttNode;
            this.prefix = String(config.prefix || 'homeassistant').replace(/\/+$/, '');
            this.generic = config.generic !== false;
            this.devices = config.devices || {};
            this.selected = Object.keys(this.devices).filter(
                (a) => this.devices[a] && this.devices[a].enabled === true,
            );
            this.removed = Object.keys(this.devices).filter(
                (a) => this.devices[a] && this.devices[a].enabled === false,
            );
            this.selectedSet = new Set(this.selected);

            this.ccu.register(this);

            this.on('input', (message, send, done) => {
                // any message republishes the discovery configs
                this.publish(true);
                if (done) {
                    done();
                }
            });

            this.idEventSubscription = this.ccu.subscribe({cache: false}, (message) => {
                this.event(message);
            });

            this.on('close', (done) => {
                this._destructor(done);
            });

            this.attempts = 0;
            this.showStatus({fill: 'grey', shape: 'ring', text: 'waiting for CCU'});
            this.readyTimer = setTimeout(() => this.whenReady(), 1000);
        }

        _destructor(done) {
            this.trace('ccu-homeassistant close');
            clearTimeout(this.readyTimer);
            this.ccu.unsubscribe(this.idEventSubscription);
            this.ccu.deregister(this, done);
        }

        /** connection status pushed by ccu-connection: only override while disconnected */
        setStatus(data) {
            const ifaceStatus = (data && data.ifaceStatus) || {};
            const connected = Object.keys(ifaceStatus).some((iface) => ifaceStatus[iface]);
            if (connected) {
                this.status(this.ownStatus || {fill: 'grey', shape: 'ring', text: 'waiting for CCU'});
            } else {
                statusHelper(this, data);
            }
        }

        /** the node's own status (device count etc.), restored after reconnects */
        showStatus(status) {
            this.ownStatus = status;
            this.status(status);
        }

        /** the referenced ccu-mqtt node, or null with a red status */
        mqtt() {
            const node = this.mqttNodeId && RED.nodes.getNode(this.mqttNodeId);
            if (!node || node.type !== 'ccu-mqtt') {
                this.showStatus({fill: 'red', shape: 'ring', text: 'ccu-mqtt node not found'});
                return null;
            }

            if (node.ccu !== this.ccu) {
                this.showStatus({fill: 'red', shape: 'ring', text: 'ccu-mqtt node uses another CCU'});
                return null;
            }

            return node;
        }

        /** metadata, names and descriptions of every selected device are there */
        ready() {
            const {ccu} = this;
            if (!ccu.metadata || !ccu.metadata.devices || !ccu.channelNames) {
                return false;
            }

            if (Object.keys(ccu.channelNames).length === 0) {
                return false;
            }

            return this.selected.every((address) => {
                const iface = ccu.findIface(address);
                const device = iface && ccu.metadata.devices[iface] && ccu.metadata.devices[iface][address];
                if (!device) {
                    // not (yet) known — do not wait forever for an unpaired device
                    return true;
                }

                return (device.CHILDREN || []).every((ch) => {
                    const channel = ccu.metadata.devices[iface][ch];
                    if (!channel) {
                        return true;
                    }

                    // cached = key present; a legitimately empty VALUES paramset ({}) counts as
                    // cached, only a missing key means the fetch is still pending
                    const key = ccu.paramsetName(iface, channel, 'VALUES');
                    if (ccu.paramsetDescriptions[key] !== undefined) {
                        return true;
                    }

                    ccu.getParamsetDescription(iface, channel, 'VALUES'); // queues the fetch
                    return false;
                });
            });
        }

        whenReady() {
            this.attempts += 1;
            if (this.ready() || this.attempts >= READY_ATTEMPTS) {
                if (!this.ready()) {
                    this.warn(
                        'CCU metadata still incomplete after ' + this.attempts + ' attempts, publishing what is there',
                    );
                }

                this.publish(false);
                return;
            }

            this.readyTimer = setTimeout(() => this.whenReady(), READY_INTERVAL);
        }

        /** the message-shaped object the ccu-mqtt topic templates are rendered against */
        topicMessage(iface, channel, datapoint) {
            const {ccu} = this;
            const devices = (ccu.metadata && ccu.metadata.devices && ccu.metadata.devices[iface]) || {};
            const channelMeta = devices[channel] || {};
            const device = channelMeta.PARENT || String(channel).split(':')[0];
            return {
                ccu: ccu.host,
                iface,
                device,
                deviceName: ccu.channelNames[device],
                deviceType: devices[device] && devices[device].TYPE,
                channel,
                // same fallback as ccu-mqtt: unnamed channels use their address
                channelName: ccu.channelNames[channel] || channel,
                channelNameOrAddress: channel,
                channelType: channelMeta.TYPE,
                channelIndex: Number.parseInt(String(channel).split(':')[1], 10),
                datapoint,
                datapointName: iface + '.' + channel + '.' + datapoint,
            };
        }

        publish(manual) {
            const mqtt = this.mqtt();
            if (!mqtt) {
                return;
            }

            const {ccu} = this;
            const ctx = {
                prefix: this.prefix,
                origin: {name: pkg.name, sw: pkg.version, url: pkg.homepage},
                jsonPayloads: mqtt.payloadOutput !== 'plain',
                generic: this.generic,
                devices: ccu.metadata.devices,
                selected: this.selected,
                description: (iface, address) => {
                    const device = ccu.metadata.devices[iface] && ccu.metadata.devices[iface][address];
                    return device && ccu.getParamsetDescription(iface, device, 'VALUES');
                },
                channelName: (address) => ccu.channelNames[address],
                rooms: (address) => ccu.channelRooms && ccu.channelRooms[address],
                statusTopicFor: (iface, address, dp) =>
                    topicReplace(mqtt.topicOutputEvent, this.topicMessage(iface, address, dp)),
                setTopicFor: (iface, address, dp) =>
                    topicReplace(mqtt.topicInputSetValue, this.topicMessage(iface, address, dp)),
            };

            const {messages, missing, empty} = discoveryMessages(ctx);

            for (const address of this.removed) {
                const {topic, payload} = removalMessage(this.prefix, address);
                this.send({topic, payload, retain: true});
            }

            for (const {topic, payload} of messages) {
                this.send({topic, payload, retain: true});
            }

            if (missing.length > 0) {
                this.warn('selected devices not found on the CCU: ' + missing.join(', '));
            }

            if (empty.length > 0) {
                this.debug('selected devices without any Home Assistant entity: ' + empty.join(', '));
            }

            this.log(
                (manual ? 're' : '') +
                    'published discovery for ' +
                    messages.length +
                    ' devices' +
                    (this.removed.length > 0 ? ', removed ' + this.removed.length : ''),
            );
            this.showStatus({
                fill: missing.length > 0 ? 'yellow' : 'green',
                shape: 'dot',
                text: messages.length + ' devices' + (missing.length > 0 ? ', ' + missing.length + ' missing' : ''),
            });
        }

        /** key presses: Home Assistant's event entity wants one topic per key → <channel>/PRESS */
        event(message) {
            if (!message.datapoint || !message.datapoint.startsWith('PRESS_') || !message.payload) {
                return;
            }

            if (!this.selectedSet.has(message.device)) {
                return;
            }

            const mqtt = this.mqttNodeId && RED.nodes.getNode(this.mqttNodeId);
            if (!mqtt || typeof mqtt.output !== 'function') {
                return;
            }

            const press = RED.util.cloneMessage(message);
            press.payload = message.datapoint;
            press.value = message.datapoint;
            press.datapoint = 'PRESS';
            press.datapointName = String(message.datapointName || '').replace(/PRESS_\w+$/, 'PRESS');
            if (!press.channelName) {
                press.channelName = press.channel;
            }

            this.send({topic: topicReplace(mqtt.topicOutputEvent, press), payload: mqtt.output(press), retain: false});
        }
    }

    RED.nodes.registerType('ccu-homeassistant', CcuHomeAssistantNode);
};
