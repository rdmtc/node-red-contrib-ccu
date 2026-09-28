const os = require('os');
const dns = require('dns');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const base62 = require('./lib/base62.js').toBase62;
const {castValue, castSysvar} = require('./lib/cast.js');
const {combinedParameterValue} = require('./lib/combined.js');
const {createMessage} = require('./lib/message.js');
const {topicReplace} = require('./lib/topic.js');
const {isLocalCcu} = require('./lib/localccu.js');
const {bestMatch} = require('./lib/similarity.js');
const nextport = require('./lib/nextport.js');
const hmDiscover = require('./lib/discover.js');
const {Rega} = require('homematic-rega'); // ES module - require(esm) needs Node >= 20.19 / >= 22.12
const metaProvider = require('./lib/metaprovider.js');
const {InitRetry, retryDelay} = require('./lib/initretry.js');
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const pkg = require(path.join(__dirname, '..', 'package.json'));

/**
 * check if an object is iterable
 * @link https://stackoverflow.com/a/37837872
 * @param obj
 * @returns {boolean}
 */
/* homematic-rega 2.x has a promise API; these adapters feed the existing
   callback-style call sites. execToCallback maps exec()'s {output, objects}
   to the old (err, output, objects) signature. */
function toCallback(promise, callback) {
    promise.then(
        (res) => callback(null, res),
        (err) => callback(err),
    );
}

function execToCallback(promise, callback) {
    promise.then(
        ({output, objects}) => callback(null, output, objects),
        (err) => callback(err),
    );
}

/** B-28: how often an inconclusive metadata api detection is repeated (1, 2, 4, 8 s, then every 15 s) */
const META_REDETECT_ATTEMPTS = 20;

function isIterable(object) {
    return object != null && typeof object[Symbol.iterator] === 'function' && typeof object.forEach === 'function';
}

module.exports = function (RED) {
    RED.log.info('node-red-contrib-ccu version: ' + pkg.version);

    const ccu = {network: {listen: [], ports: []}};

    /**
     *
     * @param start
     * @returns {Promise<any>}
     */
    function findport(start) {
        return new Promise((resolve, reject) => {
            nextport(start, (port) => {
                if (port) {
                    ccu.network.ports.push(port);
                    resolve();
                } else {
                    reject();
                }
            });
        });
    }

    hmDiscover((res) => {
        ccu.network.discover = res;
    });

    const networkInterfaces = os.networkInterfaces();
    Object.keys(networkInterfaces).forEach((name) => {
        networkInterfaces[name].forEach((addr) => {
            if (addr.family === 'IPv4') {
                ccu.network.listen.push(addr.address);
            }
        });
    });
    ccu.network.listen.push('0.0.0.0');

    RED.httpAdmin.get('/ccu', RED.auth.needsPermission('ccu.read'), (request, res) => {
        if (request.query.config && request.query.config !== '_ADD_') {
            const config = RED.nodes.getNode(request.query.config);
            if (!config) {
                res.status(500).send(JSON.stringify({}));
                return;
            }

            const object = {};

            switch (request.query.type) {
                case 'ifaces': {
                    Object.keys(config.ifaceTypes).forEach((iface) => {
                        object[iface] = {
                            enabled: Boolean(config.ifaceTypes[iface].enabled),
                            connected: Boolean(config.ifaceStatus[iface]),
                            waiting: Boolean(config.ifaceWaiting && config.ifaceWaiting[iface]),
                        };
                    });
                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'channels': {
                    const devices = config.metadata.devices[request.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach((addr) => {
                            if (addr.match(/:\d+$/)) {
                                const psKey = config.paramsetName(request.query.iface, devices[addr], 'VALUES');
                                if (config.paramsetDescriptions[psKey]) {
                                    object[addr] = {
                                        name: config.channelNames[addr],
                                        datapoints: Object.keys(config.paramsetDescriptions[psKey]),
                                        rxMode: devices[devices[addr].PARENT] && devices[devices[addr].PARENT].RX_MODE,
                                    };
                                }
                            }
                        });
                    }

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'tree': {
                    const processChannels = (iface, devices, callback) => {
                        if (!devices) {
                            return;
                        }

                        Object.keys(devices).forEach((addr) => {
                            if (addr.match(/:\d+$/)) {
                                const psKey = config.paramsetName(iface, devices[addr], 'VALUES');
                                if (config.paramsetDescriptions[psKey]) {
                                    const devID = devices[addr].PARENT;
                                    const dps = [];
                                    const chName = config.channelNames[addr];

                                    Object.keys(config.paramsetDescriptions[psKey]).forEach((dp) => {
                                        dps.push({
                                            id: iface + '.' + addr + '.' + dp,
                                            iface,
                                            channel: chName ? addr + ' ' + chName : addr,
                                            label: dp,
                                            icon: 'fa fa-tag fa-fw',
                                            class: request.query.classDp,
                                        });
                                    });
                                    dps.sort((a, b) => a.label.localeCompare(b.label));
                                    const channel = {
                                        id: iface + '.' + addr,
                                        iface,
                                        label: chName ? chName + '  (' + addr + ')' : addr,
                                        children: dps,
                                        rooms: config.channelRooms[addr],
                                        functions: config.channelFunctions[addr],
                                        icon: 'fa fa-tags fa-fw',
                                        class: request.query.classCh,
                                    };
                                    callback(iface, devID, channel, addr);
                                }
                            }
                        });
                    };

                    if (request.query.iface) {
                        const devices = config.metadata.devices[request.query.iface];
                        processChannels(request.query.iface, devices, (iface, devID, channel, chID) => {
                            if (!channel.children || channel.children.length === 0) {
                                return;
                            }

                            if (!object[devID]) {
                                object[devID] = {
                                    id: iface + '.' + devID,
                                    name: config.channelNames[devID],
                                    label: config.channelNames[devID]
                                        ? config.channelNames[devID] + '  (' + devID + ')'
                                        : devID,
                                    type: devices[devID].TYPE,
                                    iface,
                                    icon: 'fa fa-archive fa-fw',
                                    channels: {},
                                    children: [],
                                };
                            }

                            object[devID].channels[chID] = channel;
                            object[devID].children.push(channel);
                        });
                    } else {
                        Object.keys(config.metadata.devices).forEach((iface) => {
                            const devices = config.metadata.devices[iface];
                            processChannels(iface, devices, (iface, devID, channel, chID) => {
                                if (!channel.children || channel.children.length === 0) {
                                    return;
                                }

                                object[chID] = channel;
                            });
                        });
                    }

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'devices': {
                    // ccu-homeassistant editor: every device (not channel) of every, or the
                    // given, interface with its channels
                    const all = (config.metadata && config.metadata.devices) || {};
                    const ifaces = request.query.iface ? [request.query.iface] : Object.keys(all);
                    ifaces.forEach((iface) => {
                        const devices = all[iface] || {};
                        Object.keys(devices).forEach((addr) => {
                            const device = devices[addr];
                            if (!device || device.PARENT) {
                                return;
                            }

                            object[addr] = {
                                name: config.channelNames[addr],
                                type: device.TYPE,
                                iface,
                                firmware: device.FIRMWARE,
                                channels: (device.CHILDREN || [])
                                    .filter((ch) => devices[ch])
                                    .map((ch) => ({
                                        address: ch,
                                        name: config.channelNames[ch],
                                        type: devices[ch].TYPE,
                                    })),
                            };
                        });
                    });

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'rooms':
                    res.status(200).send(
                        JSON.stringify({
                            rooms: config.rooms,
                        }),
                    );
                    break;

                case 'functions':
                    res.status(200).send(
                        JSON.stringify({
                            functions: config.functions,
                        }),
                    );
                    break;

                case 'sysvar':
                    res.status(200).send(JSON.stringify(config.sysvar));
                    break;

                case 'program':
                    res.status(200).send(JSON.stringify(config.program));
                    break;

                case 'signal': {
                    const devices = config.metadata.devices[request.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach((addr) => {
                            if (
                                ['SIGNAL_CHIME', 'SIGNAL_LED', 'ALARM_SWITCH_VIRTUAL_RECEIVER'].includes(
                                    devices[addr].TYPE,
                                )
                            ) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].TYPE,
                                    deviceType: devices[addr].PARENT_TYPE,
                                };
                            }

                            if (
                                ['HmIP-MP3P', 'HmIP-BSL'].includes(devices[addr].PARENT_TYPE) &&
                                ['ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER', 'DIMMER_VIRTUAL_RECEIVER'].includes(
                                    devices[addr].TYPE,
                                )
                            ) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].TYPE,
                                    deviceType: devices[addr].PARENT_TYPE,
                                };
                            }
                        });
                    }

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'display': {
                    const devices = config.metadata.devices[request.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach((addr) => {
                            if (
                                (addr.endsWith(':3') && devices[addr].PARENT_TYPE.match(/HM-Dis-EP-WM55/)) ||
                                ((addr.endsWith(':1') || addr.endsWith(':2')) &&
                                    devices[addr].PARENT_TYPE.match(/HM-Dis-WM55/))
                            ) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].PARENT_TYPE,
                                };
                            }
                        });
                    }

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                default:
                    res.status(200).send(
                        JSON.stringify({
                            channelNames: config.channelNames,
                            metadata: config.metadata,
                            paramsetDescriptions: config.paramsetDescriptions,
                            rooms: config.rooms,
                            functions: config.functions,
                            sysvar: config.sysvar,
                            program: config.program,
                            channelRooms: config.channelRooms,
                            channelFunctions: config.channelFunctions,
                            enabledIfaces: config.enabledIfaces,
                        }),
                    );
            }
        } else {
            ccu.network.ports = [];
            const start = 2040 + Math.floor(Math.random() * 50);
            findport(start)
                .then(() => findport(ccu.network.ports[0] + 1))
                .then(() => {
                    res.status(200).send(JSON.stringify(ccu.network));
                });
        }
    });

    /**
     *
     * @returns {number}
     */
    function now() {
        return new Date().getTime();
    }

    /**
     *
     * @param host
     * @returns {Promise<any>}
     */
    function resolveHost(host) {
        function unifyLoopback(addr) {
            if (addr.startsWith('127.')) {
                return '127.0.0.1';
            }

            return addr;
        }

        return new Promise((resolve) => {
            if (
                /^([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])$/g.test(
                    host,
                )
            ) {
                resolve(unifyLoopback(host));
            } else if (
                /^([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4}))*::([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4}))*|([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4})){7}$/g.test(
                    host,
                )
            ) {
                resolve(host);
            } else {
                dns.lookup(host, (err, addr) => {
                    if (err) {
                        resolve(host);
                    } else {
                        resolve(unifyLoopback(addr));
                    }
                });
            }
        });
    }

    class CcuConnectionNode {
        /**
         *
         * @param config
         */
        constructor(config) {
            RED.nodes.createNode(this, config);

            // B-31: the CCU password and the openccu-lite token come from Node-RED's
            // credentials. A flow written by an older version still carries them as
            // plain properties: use them once and move them into the credentials, so
            // the next deploy drops them from flows.json.
            const secrets = this.migrateSecrets(config);
            config = {...config, password: secrets.password, metaToken: secrets.metaToken};

            this.logger.debug('ccu-connection', config.host);

            this.checkDuplicateConfig(config);

            // B-4: this used to grep /etc/lighttpd/conf.d/proxy.conf for the
            // direct port. That file is a bare include on current firmware, so
            // the check never matched and every local install went through the
            // proxy. Ask the kernel for a listener instead.
            this.isLocal = isLocalCcu(config.host);
            if (this.isLocal) {
                this.logger.info('local connection on ccu >= v3.41 detected');
            }

            this.ifaceTypes = {
                ReGaHSS: {
                    conf: 'rega',
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 31999 : 1999,
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    init: false,
                    ping: false,
                },
                'BidCos-RF': {
                    conf: 'bcrf',
                    rpc: this.isLocal || config.bcrfBinRpc ? binrpc : xmlrpc,
                    port: this.isLocal ? 32001 : config.tls ? 42001 : 2001,
                    protocol: this.isLocal || config.bcrfBinRpc ? 'binrpc' : 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true,
                },
                'BidCos-Wired': {
                    conf: 'bcwi',
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 32000 : config.tls ? 42000 : 2000,
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true,
                },
                'HmIP-RF': {
                    conf: 'iprf',
                    rpc: xmlrpc,
                    port: this.isLocal ? 32010 : config.tls ? 42010 : 2010,
                    protocol: 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true, // Todo https://github.com/eq-3/occu/issues/42 - should be fixed, but isn't
                    pingTimeout: 600, // Overwrites ccu-connection config
                    // B-29: hmipserver forgets its clients when it restarts and does not tell them;
                    // a ping every 30 s without an event, and init again when no PONG comes within 10 s
                    pingInterval: 30,
                    pongTimeout: 10,
                },
                VirtualDevices: {
                    conf: 'virt',
                    rpc: xmlrpc,
                    port: this.isLocal ? 39292 : config.tls ? 49292 : 9292,
                    path: 'groups',
                    protocol: 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: false, // Todo ?
                },
                CUxD: {
                    conf: 'cuxd',
                    rpc: binrpc,
                    port: 8701,
                    protocol: 'binrpc',
                    init: true,
                    ping: true,
                },
                'CCU-Jack': {
                    conf: 'jack',
                    rpc: xmlrpc,
                    port: Number(config.jackPort) || (config.tls ? 2122 : 2121),
                    path: 'RPC3',
                    protocol: 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: false,
                },
            };

            this.name = config.name;
            this.host = config.host;
            this.users = {};

            this.globalContext = this.context().global;
            this.contextStore = config.contextStore;

            if (ccu.network.listen.includes(config.rpcServerHost)) {
                this.rpcServerHost = config.rpcServerHost;
            } else {
                this.rpcServerHost = bestMatch(config.rpcServerHost, ccu.network.listen);
                this.logger.error(
                    'Local address ' +
                        config.rpcServerHost +
                        ' not available. Using ' +
                        this.rpcServerHost +
                        ' instead.',
                );
            }

            this.rpcInitAddress = config.rpcInitAddress || this.rpcServerHost;
            this.rpcBinPort = Number.parseInt(config.rpcBinPort, 10);
            this.rpcXmlPort = Number.parseInt(config.rpcXmlPort, 10);
            this.rpcPingTimeout = Number.parseInt(config.rpcPingTimeout, 10) || 60;
            // #44: opt out of the periodic ping/timeout supervision. Off means
            // no pings and no timeout-triggered re-init for this connection -
            // reconnecting after a CCU restart is then up to the CCU.
            this.rpcPingEnabled = config.rpcPing === undefined ? true : Boolean(config.rpcPing);
            this.rpcPingTimer = {};
            // B-29: the liveness ping per interface, and when an event (PONG included) last arrived
            this.liveness = {};
            this.lastRealEvent = {};
            this.ifaceStatus = {};
            // task 11: interfaces whose init failed and is retried (InitRetry per iface),
            // and which of them are waiting for an unreachable process
            this.initRetry = {};
            this.ifaceWaiting = {};
            this.closing = false;
            this.serverError = {};
            this.queueTimeout = Number.parseInt(config.queueTimeout, 10) || 5000;
            this.queuePause = Number.parseInt(config.queuePause, 10) || 0;

            this.methodCallQueue = {};

            this.regaEnabled = config.regaEnabled;
            this.regaPollEnabled = config.regaPoll;
            // B-17 openccu-lite: the metadata api sits behind the box's
            // lighttpd, i.e. on the plain http(s) port. The field exists for
            // reverse proxies and tests, it is empty in every normal install.
            this.tlsEnabled = Boolean(config.tls);
            this.inSecure = Boolean(config.inSecure);
            this.metaPort = Number.parseInt(config.metaPort, 10) || (config.tls ? 443 : 80);
            this.metaToken = config.metaToken || metaProvider.readLocalToken();
            this.metaMode = false;
            this.meta = null;
            // #167: minutes between re-reads of channel names, rooms and
            // functions. 0 switches it off.
            this.regaMetaInterval =
                config.regaMetaInterval === undefined ? 15 : Number.parseInt(config.regaMetaInterval, 10) || 0;
            this.regaInterval = Number.parseInt(config.regaInterval, 10);
            this.hadTimeout = new Set();

            this.enabledIfaces = [];

            this.clients = {};
            this.servers = {};

            this.newParamsetDescriptionCount = 0;
            this.paramsetQueue = [];
            this.paramsQueue = [];

            this.paramsetFile = path.join(RED.settings.userDir || path.join(__dirname, '..'), 'paramsets.json');

            this.loadParamsets();

            this.callbacks = {};
            this.idCallback = 0;
            this.callbackBlacklists = {};
            this.callbackWhitelists = {};

            this.sysvarCallbacks = {};
            this.idSysvarCallback = 0;

            this.programCallbacks = {};
            this.idProgramCallback = 0;

            this.channelNames = {};
            this.regaIdChannel = {};
            this.regaChannels = [];
            this.channelRooms = {};
            this.channelFunctions = {};

            this.groups = {};

            this.sysvar = {};
            this.program = {};
            this.setVariableQueue = {};
            this.setVariableQueueTimeout = {};

            this.values = {};
            this.params = {MASTER: {}};
            this.links = {};

            this.workingTimeout = {};

            this.setValueThrottle = 500;
            this.setValueTimers = {};
            this.setValueCache = {};
            // B-19: the value this connection last wrote to a datapoint, so the queued
            // write's dedupe can tell the echo of its own write from another source
            this.lastWrite = {};
            this.setValueQueue = [];

            this.lastEvent = {};
            this.rxCounters = {};
            this.txCounters = {};

            this.metadataFile = path.join(
                RED.settings.userDir || path.join(__dirname, '..'),
                'ccu_' + this.host + '.json',
            );
            this.regadataFile = path.join(
                RED.settings.userDir || path.join(__dirname, '..'),
                'ccu_rega_' + this.host + '.json',
            );
            this.valuesFile = path.join(
                RED.settings.userDir || path.join(__dirname, '..'),
                'ccu_values_' + this.host + '.json',
            );

            this.loadMetadata();
            this.loadRegadata();
            this.loadValues();

            this.setContext();

            this.rega = new Rega({
                host: this.host,
                port: this.isLocal ? 8183 : config.tls ? 48181 : 8181,
                tls: config.tls,
                insecure: config.inSecure,
                username: config.authentication ? config.username : undefined,
                password: config.authentication ? config.password : undefined,
            });

            this.enabledIfaces = [];
            Object.keys(this.ifaceTypes).forEach((iface) => {
                const enabled = config[this.ifaceTypes[iface].conf + 'Enabled'];
                if (enabled) {
                    this.enabledIfaces.push(iface);
                    this.ifaceStatus[iface] = null;
                }
            });

            if (config.regaEnabled) {
                this.lastRegaDataRefresh = now();
                // B-17: ask the box once whether it speaks the openccu-lite
                // metadata api. It does not on a CCU/RaspberryMatic/OpenCCU,
                // where everything below runs exactly as before.
                this.lastMetaProbe = now();
                this.detectMetaOutcome()
                    .then((outcome) => {
                        if (outcome.info) {
                            return this.startMeta(outcome.info);
                        }

                        // B-28: a timeout or a refused connection decides nothing -
                        // the ReGa path starts, and the detection is repeated
                        this.scheduleMetaRedetect(outcome);
                        return this.getRegaData().then(() => {
                            this.regaPoll();
                        });
                    })
                    .catch((error) => {
                        this.logger.error('name sync ' + error.message);
                    })
                    .then(() => {
                        this.initIfaces(config);
                    });
            } else {
                this.initIfaces(config);
            }

            this.stats(true);

            this.on('close', this.destructor);
        }

        /**
         * B-31: the password and the token, from the credentials or - once - from the
         * plain properties of a flow written before 4.4.6.
         * @param {object} config the node's configuration as deployed
         * @returns {{password: string, metaToken: string}}
         */
        migrateSecrets(config) {
            const credentials = this.credentials || {};
            const result = {
                password: credentials.password || config.password || '',
                metaToken: credentials.metaToken || config.metaToken || '',
            };
            const plain = ['password', 'metaToken'].filter((key) => config[key] && !credentials[key]);
            if (plain.length > 0) {
                const moved = {...credentials};
                plain.forEach((key) => {
                    moved[key] = config[key];
                });
                if (typeof RED.nodes.addCredentials === 'function') {
                    RED.nodes.addCredentials(this.id, moved);
                    this.warn(
                        'the ' +
                            plain.join(' and ') +
                            ' of this connection came from the flow in plain text - moved into the credentials, the next deploy removes ' +
                            (plain.length > 1 ? 'them' : 'it') +
                            ' from flows.json',
                    );
                } else {
                    this.warn('the ' + plain.join(' and ') + ' of this connection is stored in the flow in plain text');
                }
            }

            return result;
        }

        get logger() {
            return {
                trace: (...args) => {
                    this.trace(args.join(' ').slice(0, 300));
                },
                debug: (...args) => {
                    this.debug(args.join(' ').slice(0, 300));
                },
                info: (...args) => {
                    this.log(args.join(' ').slice(0, 300));
                },
                warn: (...args) => {
                    this.warn(args.join(' ').slice(0, 300));
                },
                error: (...args) => {
                    this.error(args.join(' ').slice(0, 300));
                },
            };
        }

        /**
         *
         * @param config
         */
        checkDuplicateConfig(config) {
            resolveHost(config.host).then((myAddr) => {
                RED.nodes.eachNode((n) => {
                    if (n.type === this.type && n.id !== this.id) {
                        resolveHost(n.host).then((addr) => {
                            if (myAddr === addr) {
                                this.logger.error(
                                    'ccu-connection node ' +
                                        n.name +
                                        ' (' +
                                        n.id +
                                        ') is configured to connect to the same ccu. this leads to problems - only one ccu-connection node per ccu should exist!',
                                );
                            }
                        });
                    }
                });
            });
        }

        /**
         *
         */
        setContext() {
            if (this.contextStore) {
                this.globalContext.set(
                    'ccu-' + this.host.replace(/\./g, '_'),
                    {
                        values: this.values,
                        sysvar: this.sysvar,
                        program: this.program,
                    },
                    this.contextStore,
                );
            }
        }

        /**
         *
         * @param node
         */
        register(node) {
            this.users[node.id] = node;
        }

        /**
         *
         * @param node
         * @param done
         * @returns {*}
         */
        deregister(node, done) {
            delete this.users[node.id];
            if (typeof done === 'function') {
                done();
            }
        }

        /**
         *
         * @param enable
         */
        stats(enable) {
            if (!enable) {
                clearInterval(this.statsInterval);
                return;
            }

            if (RED.settings.logging) {
                const [firstLogger] = Object.keys(RED.settings.logging);
                if (
                    RED.settings.logging[firstLogger] &&
                    RED.settings.logging[firstLogger].level !== 'debug' &&
                    RED.settings.logging[firstLogger].level !== 'trace'
                ) {
                    return;
                }
            }

            this.statsInterval = setInterval(() => {
                this.logger.debug(
                    'stats rpc rx: ' + JSON.stringify(this.rxCounters) + ' tx: ' + JSON.stringify(this.txCounters),
                );
                this.logger.debug('stats rpc subscribers ' + Object.keys(this.callbacks).length);
                this.logger.debug(
                    'stats rega subscribers ' +
                        (Object.keys(this.programCallbacks).length + Object.keys(this.sysvarCallbacks).length),
                );
            }, 60000);
        }

        /**
         *
         * @param iface
         * @param connected
         */
        setIfaceStatus(iface, connected, waiting = false) {
            if (!iface || !this.ifaceTypes[iface]) {
                // B-32: never a status line for something that is not an interface of ours
                return;
            }

            waiting = Boolean(waiting) && !connected;
            const waitingChanged = Boolean(this.ifaceWaiting[iface]) !== waiting;
            if (this.ifaceStatus[iface] !== connected || waitingChanged) {
                if (this.ifaceStatus[iface] !== connected) {
                    if (iface === 'ReGaHSS') {
                        this.logger.info('Interface', iface, connected ? 'connected' : 'disconnected');
                    } else if (waiting) {
                        // task 11: the retry logs the one warn line, this stays quiet
                        this.logger.debug('Interface', iface, 'waiting');
                    } else {
                        this.logger.info(
                            'Interface',
                            iface,
                            connected
                                ? this.ifaceTypes[iface].protocol +
                                      ' port ' +
                                      this.ifaceTypes[iface].port +
                                      ' connected'
                                : 'disconnected',
                        );
                    }
                }

                this.ifaceStatus[iface] = !this.serverError[iface] && connected;
                if (waiting) {
                    this.ifaceWaiting[iface] = true;
                } else {
                    delete this.ifaceWaiting[iface];
                }

                Object.keys(this.users).forEach((id) => {
                    if (typeof this.users[id].setStatus === 'function') {
                        this.users[id].setStatus({ifaceStatus: this.ifaceStatus, ifaceWaiting: this.ifaceWaiting});
                    }
                });
            }
        }

        /**
         * task 11: the init retry of an interface, created on its first failure.
         * @param iface
         * @returns {InitRetry}
         */
        getInitRetry(iface) {
            if (!this.initRetry[iface]) {
                this.initRetry[iface] = new InitRetry({
                    iface,
                    logger: this.logger,
                    attempt: () => this.rpcInit(iface, {retry: true}),
                    onState: (state) => {
                        if (state === 'connected') {
                            this.setIfaceStatus(iface, true);
                        } else {
                            this.hadTimeout.add(iface);
                            this.setIfaceStatus(iface, false, state === 'waiting');
                        }
                    },
                });
            }

            return this.initRetry[iface];
        }

        /**
         * An init succeeded (the first one, a retry, or a re-init after a ping timeout).
         * @param iface
         */
        rpcInitSucceeded(iface) {
            if (this.initRetry[iface]) {
                this.initRetry[iface].succeeded();
            } else {
                this.setIfaceStatus(iface, true);
            }
        }

        /**
         * An init failed: retry it with backoff, whether or not the interface has
         * cached devices or a ping (task 11).
         * @param iface
         * @param error
         */
        rpcInitFailed(iface, error) {
            if (this.closing || !this.ifaceTypes[iface] || !this.ifaceTypes[iface].enabled) {
                return;
            }

            this.getInitRetry(iface).failed(error);
        }

        /** stop every scheduled init retry (close, redeploy) */
        stopInitRetries() {
            Object.keys(this.initRetry).forEach((iface) => {
                this.initRetry[iface].stop();
            });
            this.initRetry = {};
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveMetadata() {
            return new Promise((resolve) => {
                fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata));
                this.logger.info('metadata saved to', this.metadataFile);
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveRegadata() {
            return new Promise((resolve) => {
                fs.writeFileSync(
                    this.regadataFile,
                    JSON.stringify({
                        channelNames: this.channelNames,
                        regaIdChannel: this.regaIdChannel,
                        regaChannels: this.regaChannels,
                        channelRooms: this.channelRooms,
                        channelFunctions: this.channelFunctions,
                        rooms: this.rooms,
                        functions: this.functions,
                        groups: this.groups,
                        sysvar: this.sysvar,
                        program: this.program,
                    }),
                );
                this.logger.info('regadata saved to', this.regadataFile);
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveValues() {
            return new Promise((resolve) => {
                fs.writeFileSync(
                    this.valuesFile,
                    JSON.stringify({
                        values: this.values,
                    }),
                );
                this.logger.info('values saved to', this.valuesFile);
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadMetadata() {
            return new Promise((resolve) => {
                try {
                    this.metadata = JSON.parse(fs.readFileSync(this.metadataFile));
                    this.logger.info('metadata loaded from', this.metadataFile);
                    resolve();
                } catch {
                    this.logger.info('no cached metadata yet, starting empty');
                    this.metadata = {
                        devices: {},
                        types: {},
                    };
                    resolve();
                }
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadRegadata() {
            return new Promise((resolve) => {
                try {
                    const regadata = JSON.parse(fs.readFileSync(this.regadataFile));
                    this.logger.info('regadata loaded from', this.regadataFile);
                    this.channelNames = regadata.channelNames;
                    this.regaIdChannel = regadata.regaIdChannel;
                    this.regaChannels = regadata.regaChannels;
                    this.channelRooms = regadata.channelRooms;
                    this.channelFunctions = regadata.channelFunctions;
                    this.groups = regadata.groups;
                    // written since 4.4.0 - the editor's room/function pickers
                    // were empty until the first successful sync before that
                    if (Array.isArray(regadata.rooms)) {
                        this.rooms = regadata.rooms;
                    }

                    if (Array.isArray(regadata.functions)) {
                        this.functions = regadata.functions;
                    }

                    /*
                    this.sysvar = regadata.sysvar;
                    Object.keys(this.sysvar).forEach(s => {
                        this.sysvar[s].fromFile = true;
                    });
                    this.program = regadata.program;
                    Object.keys(this.program).forEach(s => {
                        this.program[s].fromFile = true;
                    });
                    */
                    resolve();
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        this.logger.info('no cached regadata yet (first start)');
                    } else {
                        this.logger.error('error loading regadata ' + error.message);
                    }

                    resolve();
                }
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadValues() {
            return new Promise((resolve) => {
                try {
                    const {values} = JSON.parse(fs.readFileSync(this.valuesFile));
                    this.logger.info('values loaded from', this.valuesFile);

                    for (const datapointName in values) {
                        this.values[datapointName] = {
                            ...values[datapointName],
                            cache: true,
                            change: false,
                            uncertain: true,
                        };
                    }

                    resolve();
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        this.logger.info('no cached values yet (first start)');
                    } else {
                        this.logger.error('error loading values ' + error.message);
                    }

                    resolve();
                }
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveParamsets() {
            return new Promise((resolve) => {
                fs.writeFileSync(this.paramsetFile, JSON.stringify(this.paramsetDescriptions, null, '  '));
                this.logger.info(
                    'paramsets saved to',
                    this.paramsetFile,
                    this.paramsetDescriptions ? Object.keys(this.paramsetDescriptions).length : 0,
                );
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadParamsets() {
            return new Promise((resolve) => {
                const load = (file) => {
                    try {
                        this.paramsetDescriptions = JSON.parse(fs.readFileSync(file));
                        this.logger.info('paramsets loaded from', file);
                    } catch {
                        this.logger.info('paramsets new empty');
                        this.paramsetDescriptions = {};
                    }
                };

                if (fs.existsSync(this.paramsetFile)) {
                    load(this.paramsetFile);
                    resolve();
                } else {
                    load(path.join(__dirname, '..', 'paramsets.json'));
                    this.saveParamsets().then(resolve);
                }
            });
        }

        /**
         *
         * @param done
         */
        destructor(done) {
            this.logger.debug('ccu-connection destructor');
            this.closing = true;
            this.stopInitRetries();
            this.stats(false);

            this.logger.debug('clear regaPollTimeout');
            this.cancelRegaPoll = true;
            clearTimeout(this.regaPollTimeout);
            clearTimeout(this.metaRedetectTimeout);
            this.metaRedetectTimeout = null;

            if (this.meta) {
                this.logger.debug('stop metadata event stream');
                this.meta.stop();
                this.meta = null;
            }

            Object.keys(this.rpcPingTimer).forEach((iface) => {
                this.logger.debug('clear rpcPingTimer', iface);
                clearTimeout(this.rpcPingTimer[iface]);
            });
            Object.keys(this.liveness).forEach((iface) => this.stopLiveness(iface));

            this.saveRegadata();
            this.saveValues();

            this.rpcClose()
                .then(() => {
                    this.logger.info('rpc close done');
                    done();
                })
                .catch((error) => {
                    this.logger.warn(error);
                    done();
                });

            this.setContext();
        }

        /**
         *
         * @param data
         * @param key
         * @param val
         * @returns {*}
         */
        getEntry(data, key, value) {
            if (!data) {
                return {};
            }

            for (const element of data) {
                if (element[key] === value) {
                    return element;
                }
            }
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getGroupsData() {
            return new Promise((resolve) => {
                this.logger.debug('virtualdevices get groups');
                execToCallback(
                    this.rega.exec(`
                    var stdoutGroups;
                    var stderrGroups;
                    system.Exec("cat /etc/config/groups.gson", &stdoutGroups, &stderrGroups);
                `),
                    (err, stdout, objects) => {
                        if (!err && objects && objects.stderrGroups === 'null') {
                            try {
                                const {groups} = JSON.parse(objects.stdoutGroups);
                                groups.forEach((group) => {
                                    this.groups[group.id] = group;
                                });
                            } catch {}
                        }

                        resolve();
                    },
                );
            });
        }

        /**
         *
         * @returns {Promise<any | never>}
         */
        getRegaData() {
            return this.getRegaChannels()
                .then(() => this.getRegaRooms())
                .then(() => this.getRegaFunctions())
                .then(() => this.getRegaValues())
                .then(() => this.getGroupsData())
                .catch((error) => {
                    this.logger.error(error);
                    this.recheckMeta();
                });
        }

        /**
         * B-17: is this box an openccu-lite? `GET /api/meta/v1/version` needs
         * no credential and answers only there - a CCU replies 404 or HTML.
         * Never rejects; an unreachable box is simply "no".
         * @returns {Promise<object|null>}
         */
        detectMeta() {
            return this.detectMetaOutcome().then((outcome) => outcome.info);
        }

        /**
         * B-28: the detection with its outcome - `info` for an openccu-lite,
         * `inconclusive` when nothing was decided (timeout, refused connection,
         * the web server up but the api behind it not yet).
         * @returns {Promise<{info: object|null, inconclusive: boolean, reason?: string}>}
         */
        detectMetaOutcome() {
            return metaProvider.detectOutcome({
                host: this.host,
                port: this.metaPort,
                tls: Boolean(this.tlsEnabled),
                insecure: Boolean(this.inSecure),
                logger: this.logger,
            });
        }

        /**
         * B-28: an inconclusive detection (the box busy or still starting) used
         * to leave the connection in ReGa mode for good - the only re-detection
         * ran from rare error paths, at most every five minutes. Ask again after
         * 1, 2, 4, 8 s, then every 15 s, up to META_REDETECT_ATTEMPTS times;
         * after that the five-minute rule of recheckMeta() applies.
         * @param {{inconclusive: boolean, reason?: string}} outcome
         */
        scheduleMetaRedetect(outcome) {
            if (!outcome || !outcome.inconclusive || this.metaMode || this.cancelRegaPoll) {
                this.metaRedetectAttempt = 0;
                return;
            }

            this.metaRedetectAttempt = (this.metaRedetectAttempt || 0) + 1;
            if (this.metaRedetectAttempt > META_REDETECT_ATTEMPTS) {
                this.logger.info(
                    'meta api detection still inconclusive (' +
                        outcome.reason +
                        ') after ' +
                        META_REDETECT_ATTEMPTS +
                        ' attempts - staying with the ReGaHSS, detecting again every five minutes',
                );
                this.metaRedetectAttempt = 0;
                return;
            }

            const delay = retryDelay(this.metaRedetectAttempt);
            const line =
                'meta api detection inconclusive (' +
                outcome.reason +
                ') - names come from the ReGaHSS until the box answers, detecting again in ' +
                delay / 1000 +
                ' s';
            if (this.metaRedetectAttempt === 1) {
                this.logger.info(line);
            } else {
                this.logger.debug(line);
            }

            clearTimeout(this.metaRedetectTimeout);
            this.metaRedetectTimeout = setTimeout(() => this.redetectMeta(), delay);
        }

        /** B-28: one scheduled re-detection. */
        redetectMeta() {
            this.metaRedetectTimeout = null;
            if (this.metaMode || this.cancelRegaPoll) {
                return;
            }

            this.lastMetaProbe = now();
            this.detectMetaOutcome().then((outcome) => {
                if (this.metaMode || this.cancelRegaPoll) {
                    return;
                }

                if (outcome.info) {
                    this.logger.info('meta api detected after ' + (this.metaRedetectAttempt + 1) + ' attempts');
                    this.metaRedetectAttempt = 0;
                    return this.startMeta(outcome.info);
                }

                if (outcome.inconclusive) {
                    this.scheduleMetaRedetect(outcome);
                    return;
                }

                this.metaRedetectAttempt = 0;
                this.logger.info(
                    'not an openccu-lite (' + outcome.reason + ') - names, rooms and functions come from the ReGaHSS',
                );
            });
        }

        /**
         * Take names, rooms and functions from the openccu-lite metadata api
         * instead of from the ReGaHSS. Resolves as soon as the first snapshot
         * has been applied (or after 5 s, so a missing credential does not hold
         * up the interfaces).
         * @param {object} info the /version document
         * @returns {Promise<any>}
         */
        startMeta(info) {
            this.metaMode = true;
            this.lastMetaProbe = now();
            clearTimeout(this.regaPollTimeout);
            if (this.clients.ReGaHSS) {
                // the box became an openccu-lite while Node-RED was running
                // (recheckMeta): no ReGaHSS to talk to any more (B-27)
                this.logger.info('rpc client ReGaHSS closed: openccu-lite has no ReGaHSS');
                this.closeClient('ReGaHSS');
            }

            this.logger.info(
                'openccu-lite detected (' +
                    (info.implementation || 'meta api') +
                    ', api version ' +
                    info.version +
                    ') - names, rooms and functions come from its metadata api',
            );
            this.logger.info(
                'this box has no ReGaHSS: system variables, programs and HM-Script are not available (sysvar, program, poll and script nodes stay idle)',
            );

            if (info.version > 1) {
                this.logger.warn(
                    'the box speaks metadata api version ' +
                        info.version +
                        ', this version of node-red-contrib-ccu implements version 1',
                );
            }

            if (!this.metaToken) {
                this.logger.warn(
                    'no metadata api token: create one on the box (Users page) and enter it in the connection node, or run on the box where ' +
                        metaProvider.LOCAL_TOKEN_FILE +
                        ' is readable. Without it the nodes work with addresses only.',
                );
            }

            return new Promise((resolve) => {
                const done = setTimeout(resolve, 5000);
                this.meta = new metaProvider.MetaProvider({
                    host: this.host,
                    port: this.metaPort,
                    tls: Boolean(this.tlsEnabled),
                    insecure: Boolean(this.inSecure),
                    token: this.metaToken,
                    logger: this.logger,
                    onNames: (names) => {
                        this.applyMetaNames(names);
                        clearTimeout(done);
                        resolve();
                    },
                    onStatus: (connected) => {
                        this.setIfaceStatus('ReGaHSS', connected);
                    },
                    onGone: () => {
                        this.metaMode = false;
                        this.meta = null;
                        this.lastMetaProbe = 0;
                        this.logger.warn('this box no longer answers as openccu-lite - detecting again');
                        this.detectMetaOutcome().then((outcome) => {
                            if (outcome.info) {
                                return this.startMeta(outcome.info);
                            }

                            // B-28: an unreachable box is not a CCU yet - keep asking
                            this.scheduleMetaRedetect(outcome);

                            if (this.ifaceTypes.ReGaHSS.enabled && !this.clients.ReGaHSS) {
                                this.createClient('ReGaHSS').then(() => this.setIfaceStatus('ReGaHSS', true));
                            }

                            return this.getRegaData().then(() => this.regaPoll());
                        });
                    },
                });
                this.meta.start();
            });
        }

        /**
         * The metadata api's answer, in the shape the rest of the code expects
         * from the ReGa: names by address, rooms and functions as arrays of
         * names. Called for the snapshot and again for every change event.
         * @param {object} names
         */
        applyMetaNames(names) {
            this.channelNames = names.channelNames;
            this.channelRooms = names.channelRooms;
            this.channelFunctions = names.channelFunctions;
            this.rooms = names.rooms;
            this.functions = names.functions;
            this.logger.debug(
                'meta revision ' +
                    names.revision +
                    ': ' +
                    Object.keys(names.channelNames).length +
                    ' names, ' +
                    names.rooms.length +
                    ' rooms, ' +
                    names.functions.length +
                    ' functions',
            );
            this.saveRegadata();
        }

        /**
         * The ReGa did not answer. Maybe this box became an openccu-lite (a
         * restored backup, a firmware swap) - probe again, at most every five
         * minutes, so a box that changes underneath a running Node-RED is
         * picked up without a redeploy.
         */
        recheckMeta() {
            if (this.metaMode || this.cancelRegaPoll || this.metaRecheckPending || this.metaRedetectTimeout) {
                return;
            }

            if (now() - (this.lastMetaProbe || 0) < 300000) {
                return;
            }

            this.lastMetaProbe = now();
            this.metaRecheckPending = true;
            this.detectMeta()
                .then((info) => {
                    this.metaRecheckPending = false;
                    if (info && !this.metaMode) {
                        return this.startMeta(info);
                    }
                })
                .catch(() => {
                    this.metaRecheckPending = false;
                });
        }

        /**
         * The error a ReGa-only feature answers with on openccu-lite. The
         * nodes stay in the palette and in the flow, every message gets this.
         * @param {string} feature
         * @returns {Error}
         */
        regaMissingError(feature) {
            return new Error(feature + ' are not available on this box (openccu-lite has no ReGaHSS)');
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getRegaValues() {
            return new Promise((resolve, reject) => {
                this.logger.info('rega getValues');
                toCallback(this.rega.getValues(), (err, res) => {
                    if (err) {
                        reject(new Error('rega getValues ' + err.message));
                    } else {
                        res.forEach((dp) => {
                            // dp.ts is epoch ms since homematic-rega 2.x (0 = never)
                            const ts = dp.ts;
                            const [iface, channel, datapoint] = dp.name.split('.');
                            if (this.enabledIfaces.includes(iface) && datapoint) {
                                if (
                                    ['RSSI_DEVICE', 'RSSI_PEER'].includes(datapoint) &&
                                    typeof dp.value === 'number' &&
                                    dp.value > 127
                                ) {
                                    // the ReGa reports the unsigned byte; without
                                    // the guard an already-signed value or the 0
                                    // for "never received" became -318 / -256 (#183)
                                    dp.value -= 256;
                                }

                                const message = this.createMessage(iface, channel, datapoint, dp.value, {
                                    cache: true,
                                    change: false,
                                    working: false,
                                    uncertain: dp.ts === 0,
                                    ts,
                                    lc: ts,
                                });
                                this.values[message.datapointName] = message;
                                if (!datapoint.startsWith('PRESS_')) {
                                    this.callCallbacks(message);
                                }
                            }
                        });
                        this.cachedValuesReceived = true;
                        this.saveValues();
                        resolve();
                    }
                });
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getRegaChannels() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getChannels');
                toCallback(this.rega.getChannels(), (err, res) => {
                    if (err) {
                        reject(new Error('rega getChannels ' + err.message));
                    } else {
                        if (res.length > 0) {
                            this.regaChannels = [];
                            this.regaIdChannel = {};
                            this.channelNames = {};
                        }

                        res.forEach((ch) => {
                            this.regaChannels.push(ch);
                            this.regaIdChannel[ch.id] = ch.address;
                            this.channelNames[ch.address] = ch.name;
                        });
                        resolve();
                    }
                });
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getRegaRooms() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getRooms');
                toCallback(this.rega.getRooms(), (err, res) => {
                    if (err) {
                        reject(new Error('rega getRooms ' + err.message));
                    } else {
                        this.rooms = [];
                        if (res.length > 0) {
                            this.channelRooms = {};
                        }

                        res.forEach((room) => {
                            this.rooms.push(room.name);
                            room.channels.forEach((chId) => {
                                const regaChannel = this.getEntry(this.regaChannels, 'id', chId);
                                const address = regaChannel && regaChannel.address;
                                if (address) {
                                    if (this.channelRooms[address]) {
                                        this.channelRooms[address].push(room.name);
                                    } else {
                                        this.channelRooms[address] = [room.name];
                                    }
                                }
                            });
                        });
                        resolve();
                    }
                });
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getRegaFunctions() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getFunctions');
                toCallback(this.rega.getFunctions(), (err, res) => {
                    if (err) {
                        reject(new Error('rega getFunctions ' + err.message));
                    } else {
                        this.functions = [];
                        if (res.length > 0) {
                            this.channelFunctions = {};
                        }

                        res.forEach((func) => {
                            this.functions.push(func.name);
                            func.channels.forEach((chId) => {
                                const regaChannel = this.getEntry(this.regaChannels, 'id', chId);
                                const address = regaChannel && regaChannel.address;
                                if (address) {
                                    if (this.channelFunctions[address]) {
                                        this.channelFunctions[address].push(func.name);
                                    } else {
                                        this.channelFunctions[address] = [func.name];
                                    }
                                }
                            });
                        });
                        resolve();
                    }
                });
            });
        }

        /**
         * Set ReGaHSS program active/inactive
         * @param {string} name
         * @param {boolean} active
         * @returns {Promise}
         */
        programActive(name, active) {
            return new Promise((resolve, reject) => {
                if (this.metaMode) {
                    reject(this.regaMissingError('programs'));
                    return;
                }

                const program = this.program[name];
                if (program) {
                    const script = `dom.GetObject(${program.id}).Active(${active});`;
                    this.logger.debug('rega programActive', name, script);
                    execToCallback(this.rega.exec(script + '\n'), (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            Object.assign(program, {
                                active,
                            });
                            resolve(program);
                        }
                    });
                } else {
                    reject(new Error('programActive ' + name + ' not found'));
                }
            });
        }

        /**
         * Execute ReGaHSS program
         * @param {string} name
         * @returns {Promise}
         */
        programExecute(name) {
            return new Promise((resolve, reject) => {
                if (this.metaMode) {
                    reject(this.regaMissingError('programs'));
                    return;
                }

                const program = this.program[name];
                if (program) {
                    const d = new Date();
                    const script = `dom.GetObject(${program.id}).ProgramExecute();`;
                    this.logger.debug('rega programExecute', name, script);
                    execToCallback(
                        this.rega.exec(
                            script + `\nvar lastExecTime = dom.GetObject(${program.id}).ProgramLastExecuteTime();\n`,
                        ),
                        (err, res, objects) => {
                            if (err) {
                                reject(err);
                            } else {
                                program.ts = new Date(
                                    objects.lastExecTime + ' UTC+' + d.getTimezoneOffset() / -60,
                                ).getTime();
                                resolve(program);
                            }
                        },
                    );
                } else {
                    reject(new Error('programExecute ' + name + ' not found'));
                }
            });
        }

        /**
         * Set a ReGaHSS variable
         * @param {string} name
         * @param {string|number|boolean} value
         * @returns {Promise}
         */
        setVariable(name, value) {
            return new Promise((resolve, reject) => {
                if (this.metaMode) {
                    reject(this.regaMissingError('system variables'));
                    return;
                }

                if (!this.hasRegaVariables) {
                    this.logger.debug('variables not yet known. defer setVariable ' + name);
                    clearTimeout(this.setVariableQueueTimeout[name]);
                    this.setVariableQueue[name] = value;
                    this.setVariableQueueTimeout[name] = setTimeout(() => {
                        this.logger.error('setVariable failed. variables still not known after timeout');
                        delete this.setVariableQueue[name];
                    }, 30000);
                    return;
                }

                const sysvar = this.sysvar[name];
                delete this.setVariableQueue[name];
                if (sysvar) {
                    value = castSysvar(value, sysvar);

                    const script = `dom.GetObject(${sysvar.id}).State(${value});`;
                    this.logger.debug('setVariable', name, script);
                    execToCallback(this.rega.exec(script + '\n'), (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            if (!this.regaPollPending) {
                                this.regaPoll();
                            }

                            resolve(sysvar);
                        }
                    });
                } else {
                    reject(new Error('setVariable ' + name + ' unknown'));
                }
            });
        }

        /**
         * Poll ReGaHSS variables and programs
         */
        regaPoll() {
            //this.logger.trace('regaPoll');
            if (this.metaMode) {
                // nothing to poll: no variables, no programs, and names arrive
                // over the metadata api's event stream
                return;
            }

            if (this.regaPollPending) {
                // #166: writing several variables at once used to lose all but
                // the first immediate re-poll, so their new values only showed
                // up at the next scheduled one (30 s by default). Remember the
                // request and run exactly one more poll afterwards.
                this.logger.debug('rega poll already pending, will repeat');
                this.regaPollAgain = true;
            } else {
                this.regaPollPending = true;
                clearTimeout(this.regaPollTimeout);
                this.getRegaVariables()
                    .catch((error) => {
                        this.logger.error('getRegaVariables', error);
                        // B-28: the poll is what fails on a box without ReGaHSS
                        this.recheckMeta();
                    })
                    .then(() => this.getRegaPrograms())
                    .catch((error) => {
                        this.logger.error('getRegaPrograms', error);
                        this.recheckMeta();
                    })
                    .finally(() => {
                        if (this.regaInterval && this.regaPollEnabled && !this.cancelRegaPoll) {
                            //this.logger.trace('rega next poll in', this.regaInterval, 'seconds');
                            this.regaPollTimeout = setTimeout(() => {
                                this.regaPoll();
                            }, this.regaInterval * 1000);
                        }

                        if (!this.firstRegaPollDone) {
                            this.saveRegadata();
                        }

                        this.firstRegaPollDone = true;
                        this.regaPollPending = false;

                        if (this.regaPollAgain && !this.cancelRegaPoll) {
                            this.regaPollAgain = false;
                            this.regaPoll();
                        } else {
                            this.regaPollAgain = false;
                            this.refreshRegaDataIfDue();
                        }
                    })
                    // a throw inside the finally above would otherwise be an
                    // unhandled rejection, see #601
                    .catch((error) => this.logger.error('regaPoll', error));
            }
        }

        /**
         * Find interface of a given channel
         * @param channel
         * @returns {String|undefined}
         */
        findIface(channel) {
            for (const iface in this.metadata.devices) {
                if (this.metadata.devices[iface][channel]) {
                    return iface;
                }
            }
        }

        /**
         * Find channel or device by name
         * @param {string} name
         * @param {boolean} noDevices
         * @returns {String|undefined} channel/device address
         */
        findChannel(name, noDevices) {
            for (const addr in this.channelNames) {
                if (this.channelNames[addr] === name) {
                    if (!noDevices || addr.includes(':')) {
                        return addr;
                    }
                }
            }
        }

        /**
         *
         * @param sysvar
         */
        updateRegaVariable(sysvar) {
            //this.logger.trace('updateRegaVariable', JSON.stringify(sysvar));
            let isNew = false;

            if (!this.sysvar[sysvar.name]) {
                isNew = true;
                this.sysvar[sysvar.name] = {
                    topic: '',
                    payload: sysvar.val,
                    ccu: this.host,
                    iface: 'ReGaHSS',
                    type: 'SYSVAR',
                    name: sysvar.name,
                    info: sysvar.info,
                    value: sysvar.val,
                    valueType: sysvar.type,
                    valueEnum: sysvar.enum[Number(sysvar.val)],
                    unit: sysvar.unit,
                    enum: sysvar.enum,
                    id: sysvar.id,
                    cache: isNew,
                };
                if (sysvar.channel) {
                    const channel = this.regaIdChannel[sysvar.channel];
                    const iface = this.findIface(channel);
                    const device =
                        this.metadata.devices[iface] &&
                        this.metadata.devices[iface][channel] &&
                        this.metadata.devices[iface][channel].PARENT;
                    Object.assign(this.sysvar[sysvar.name], {
                        device,
                        deviceName: this.channelNames[device],
                        deviceType:
                            this.metadata.devices[iface] &&
                            this.metadata.devices[iface][device] &&
                            this.metadata.devices[iface][device].TYPE,
                        channel,
                        channelName: this.channelNames[channel],
                        channelType:
                            this.metadata.devices[iface] &&
                            this.metadata.devices[iface][channel] &&
                            this.metadata.devices[iface][channel].TYPE,
                        channelIndex: channel && Number.parseInt(channel.split(':')[1], 10),
                        rooms: this.channelRooms[channel],
                        room:
                            this.channelRooms[channel] && this.channelRooms[channel].length === 1
                                ? this.channelRooms[channel][0]
                                : undefined,
                        functions: this.channelFunctions[channel],
                        function:
                            this.channelFunctions[channel] && this.channelFunctions[channel].length === 1
                                ? this.channelFunctions[channel][0]
                                : undefined,
                    });
                }
            } else if (this.sysvar[sysvar.name].fromFile) {
                isNew = true;
                delete this.sysvar[sysvar.name].fromFile;
            }

            if (isNew || this.sysvar[sysvar.name].ts !== sysvar.ts) {
                Object.assign(this.sysvar[sysvar.name], {
                    payload: sysvar.val,
                    info: sysvar.info,
                    value: sysvar.val,
                    valueEnum: this.sysvar[sysvar.name].enum[Number(sysvar.val)],
                    valuePrevious: this.sysvar[sysvar.name].value,
                    valueEnumPrevious: this.sysvar[sysvar.name].valueEnum,
                    ts: sysvar.ts,
                    tsPrevious: this.sysvar[sysvar.name].ts,
                    lc:
                        this.sysvar[sysvar.name].value !== sysvar.val && !isNew
                            ? sysvar.ts
                            : this.sysvar[sysvar.name].lc,
                    lcPrevious: this.sysvar[sysvar.name].lc,
                    change: isNew ? false : this.sysvar[sysvar.name].value !== sysvar.val,
                    cache: isNew,
                });

                Object.keys(this.sysvarCallbacks).forEach((key) => {
                    const {filter, callback} = this.sysvarCallbacks[key];
                    let match = !filter.name || filter.name === sysvar.name;
                    if (this.sysvar[sysvar.name].cache && !filter.cache) {
                        match = false;
                    } else if (filter.change && !this.sysvar[sysvar.name].change) {
                        if (!(this.sysvar[sysvar.name].cache && filter.cache)) {
                            match = false;
                        }
                    }

                    //this.logger.trace('match', match, JSON.stringify(filter), 'name:' + sysvar.name + ' cache:' + this.sysvar[sysvar.name].cache + ' change:' + this.sysvar[sysvar.name].change);
                    if (match) {
                        callback(RED.util.cloneMessage(this.sysvar[sysvar.name]));
                    }
                });
            }
        }

        /**
         * Poll ReGaHSS variables and call subscription callbacks
         * @returns {Promise}
         */
        /**
         * Re-read the ReGa metadata that only ever got fetched once, in the
         * constructor: channel names, rooms and functions. A room or function
         * added in the CCU WebUI was invisible until the flow was redeployed
         * (#167). Cheap enough for a slow schedule - three small scripts.
         * @returns {Promise<any>}
         */
        refreshRegaData() {
            this.lastRegaDataRefresh = now();
            this.logger.debug('refreshRegaData');
            return this.getRegaChannels()
                .then(() => this.getRegaRooms())
                .then(() => this.getRegaFunctions())
                .then(() => this.saveRegadata())
                .catch((error) => {
                    this.logger.error('refreshRegaData', error);
                    this.recheckMeta();
                });
        }

        /** Runs refreshRegaData() when the configured interval has elapsed. */
        refreshRegaDataIfDue() {
            if (!this.regaMetaInterval || this.cancelRegaPoll) {
                return;
            }

            const elapsed = now() - (this.lastRegaDataRefresh || 0);
            if (elapsed >= this.regaMetaInterval * 60000) {
                this.refreshRegaData();
            }
        }

        getRegaVariables() {
            return new Promise((resolve, reject) => {
                this.logger.debug('getRegaVariables');
                toCallback(this.rega.getVariables(), (err, res) => {
                    if (err) {
                        reject(err);
                        this.hadTimeout.add('ReGaHSS');
                        this.setIfaceStatus('ReGaHSS', false);
                    } else {
                        res.forEach((sysvar) => {
                            //this.logger.trace(JSON.stringify(sysvar));
                            // sysvar.ts is epoch ms since homematic-rega 2.x (0 = never)
                            sysvar.ts = sysvar.ts || Date.now();
                            this.updateRegaVariable(sysvar);
                        });
                        if (!this.hasRegaVariables) {
                            this.hasRegaVariables = true;
                            Object.keys(this.setVariableQueueTimeout).forEach((name) =>
                                clearTimeout(this.setVariableQueueTimeout[name]),
                            );
                            // #601: a rejected write here used to be an
                            // unhandled rejection, which Node >= 15 turns into
                            // an uncaught exception - it killed the whole
                            // process seconds after start whenever ReGaHSS
                            // dropped the connection (RedMatic #601).
                            Object.keys(this.setVariableQueue)
                                .reduce(
                                    (p, name) => p.then((_) => this.setVariable(name, this.setVariableQueue[name])),
                                    Promise.resolve(),
                                )
                                .catch((error) => this.logger.error('deferred setVariable', error));
                        }

                        resolve();
                        this.setIfaceStatus('ReGaHSS', true);
                    }
                });
            });
        }

        /**
         * Poll ReGaHSS programs and call subscription callbacks
         * @returns {Promise}
         */
        getRegaPrograms() {
            return new Promise((resolve, reject) => {
                this.logger.debug('getRegaPrograms');
                toCallback(this.rega.getPrograms(), (err, res) => {
                    if (err) {
                        reject(err);
                        this.hadTimeout.add('ReGaHSS');
                        this.setIfaceStatus('ReGaHSS', false);
                    } else if (res && Array.isArray(res)) {
                        res.forEach((prg) => {
                            prg.type = 'PROGRAM';
                            // prg.ts is epoch ms since homematic-rega 2.x (0 = never)
                            if (!this.program[prg.name]) {
                                this.program[prg.name] = {};
                            }

                            if (this.program[prg.name].fromFile) {
                                delete this.program[prg.name].fromFile;
                                return;
                            }

                            if (this.program[prg.name].active !== prg.active || this.program[prg.name].ts !== prg.ts) {
                                this.program[prg.name] = {
                                    id: prg.id,
                                    ccu: this.host,
                                    iface: 'ReGaHSS',
                                    type: 'PROGRAM',
                                    name: prg.name,
                                    payload: prg.active,
                                    value: prg.active,
                                    active: prg.active,
                                    activePrevious: this.program[prg.name].active,
                                    ts: prg.ts,
                                    tsPrevious: this.program[prg.name].ts,
                                };
                                Object.keys(this.programCallbacks).forEach((key) => {
                                    const {filter, callback} = this.programCallbacks[key];
                                    if (!filter.name || filter.name === prg.name) {
                                        callback(this.program[prg.name]);
                                    }
                                });
                            }
                        });
                        resolve();
                    }
                });
            });
        }

        /**
         *
         * @param config
         */
        initIfaces(config) {
            Object.keys(this.ifaceTypes).forEach((iface) => {
                const enabled = config[this.ifaceTypes[iface].conf + 'Enabled'];
                this.ifaceTypes[iface].enabled = enabled;
                if (enabled && iface === 'ReGaHSS' && this.metaMode) {
                    // B-27: openccu-lite has no ReGaHSS, nothing listens on 31999.
                    // A client would only reconnect forever (with binrpc < 4.3.0
                    // exponentially, at 100 % CPU). The metadata api reports the
                    // interface status instead; the client is created if the box
                    // stops being an openccu-lite (onGone).
                    this.logger.info('rpc client ReGaHSS not created: openccu-lite has no ReGaHSS');
                    return;
                }

                if (enabled) {
                    this.createClient(iface)
                        .then(() => {
                            if (this.ifaceTypes[iface].init) {
                                return this.rpcInit(iface)
                                    .then(() => {
                                        this.rpcInitSucceeded(iface);
                                    })
                                    .catch((error) => {
                                        this.rpcInitFailed(iface, error);
                                    });
                            }

                            this.setIfaceStatus(iface, true);
                        })
                        .catch(() => {});
                }
            });
            this.logger.info('Interfaces:', this.enabledIfaces.join(', '));
        }

        /**
         *
         * @param iface
         * @returns {Promise<any>}
         */
        /**
         * Drop an rpc client and stop its reconnect timer (binrpc >= 4.3.0 has
         * close(); the xmlrpc client holds no timer). Without this a replaced
         * client kept reconnecting in the background for the life of the process.
         * @param iface
         */
        closeClient(iface) {
            const client = this.clients[iface];
            if (!client) {
                return;
            }

            delete this.clients[iface];
            if (typeof client.close === 'function') {
                try {
                    client.close();
                } catch (error) {
                    this.logger.debug('close rpc client ' + iface + ': ' + error.message);
                }
            }
        }

        createClient(iface, {quiet = false} = {}) {
            return new Promise((resolve) => {
                const {rpc, port, path, protocol, auth, user, pass, tls, inSecure} = this.ifaceTypes[iface];
                const clientOptions = {};
                if (path) {
                    clientOptions.url = protocol + '://' + this.host + ':' + port + '/' + path;
                } else {
                    clientOptions.host = this.host;
                    clientOptions.port = port;
                }

                if (auth) {
                    clientOptions.basic_auth = {user, pass};
                }

                clientOptions.rejectUnauthorized = !inSecure; // https://github.com/baalexander/node-xmlrpc/issues/84

                if (tls) {
                    this.clients[iface] = rpc.createSecureClient(clientOptions);
                } else {
                    this.clients[iface] = rpc.createClient(clientOptions);
                }

                this.logger[quiet ? 'debug' : 'info'](
                    'rpc client ' +
                        iface +
                        ' ' +
                        (protocol === 'binrpc' ? 'binrpc' : tls ? 'xmlrpc/tls' : 'xmlrpc') +
                        ' ' +
                        this.host +
                        ':' +
                        port +
                        (path ? '/' + path : ''),
                );
                if (this.methodCallQueue[iface]) {
                    this.methodCallQueue[iface].forEach((c) => {
                        this.methodCall(iface, c[0], c[1]).then(c[2]).catch(c[3]);
                    });
                    delete this.methodCallQueue[iface];
                }

                resolve(iface);
            });
        }

        /**
         *
         * @param iface
         * @returns {Promise<any>}
         */
        rpcInit(iface, {retry = false} = {}) {
            return new Promise((resolve, reject) => {
                const initUrl = this.rpcServer(iface);
                const hash = base62(crypto.createHash('sha1').update(initUrl).digest()).slice(0, 6);
                const initId = 'nr_' + hash + '_' + iface;
                this.lastEvent[iface] = now();

                const {protocol, port} = this.ifaceTypes[iface];
                // task 11: a retry logs its attempt at debug level
                this.logger[retry ? 'debug' : 'info'](
                    'init ' +
                        iface +
                        ' (' +
                        (protocol === 'binrpc' ? 'binrpc' : 'xmlrpc') +
                        ' ' +
                        this.host +
                        ':' +
                        port +
                        ') callback ' +
                        initUrl +
                        ' ' +
                        initId,
                );
                if (retry) {
                    // a fresh client: the one created after the failure (binrpc) may
                    // still wait for its own reconnect timer and fail the write at once
                    this.closeClient(iface);
                    this.createClient(iface, {quiet: true});
                }

                // a failed init is logged by the retry (InitRetry), not here
                this.methodCall(iface, 'init', [initUrl, initId], {quiet: true})
                    .then(() => {
                        // the ping/re-init liveness starts after a successful init only;
                        // a failed one is retried by rpcInitFailed (task 11)
                        if (this.ifaceTypes[iface].ping && !this.closing) {
                            this.rpcCheckInit(iface);
                            this.startLiveness(iface);
                        }

                        if (iface === 'CUxD') {
                            this.getDevices(iface)
                                .then(() => resolve(iface))
                                .catch(() => resolve(iface));
                        } else if (['BidCos-RF', 'BidCos-Wired', 'HmIP-RF'].includes(iface)) {
                            this.methodCall(iface, 'getLinks', [])
                                .then((res) => {
                                    this.links[iface] = res;
                                    resolve(iface);
                                })
                                .catch(() => resolve(iface));
                        } else {
                            resolve(iface);
                        }
                    })
                    .catch((error) => reject(error));
            });
        }

        /**
         * Returns the links of a specific channel
         * @param {String} iface
         * @param {String} address
         * @param {Boolean} receiver direction: true=RECEIVER, false=SENDER
         * @returns {Array}
         */
        getLinks(iface, address, receiver) {
            const links = [];
            if (this.links[iface]) {
                this.links[iface].forEach((link) => {
                    if (link[receiver ? 'RECEIVER' : 'SENDER'] === address) {
                        links.push(link[receiver ? 'SENDER' : 'RECEIVER']);
                    }
                });
            }

            return links;
        }

        /**
         *
         * @param iface
         * @returns {Promise<any>}
         */
        getDevices(iface) {
            return new Promise((resolve, reject) => {
                this.methodCall(iface, 'listDevices', [])
                    .then((devices) => {
                        if (!this.metadata.devices[iface]) {
                            this.metadata.devices[iface] = {};
                        }

                        const knownDevices = [];
                        let change = false;
                        devices.forEach((device) => {
                            knownDevices.push(device.ADDRESS);
                            if (!this.metadata.devices[iface][device.ADDRESS]) {
                                this.newDevice(iface, device);
                                change = true;
                            }
                        });

                        Object.keys(this.metadata.devices[iface]).forEach((addr) => {
                            if (!knownDevices.includes(addr)) {
                                this.deleteDevice(iface, addr);
                                change = true;
                            }
                        });

                        if (change) {
                            this.saveMetadata();
                        }

                        resolve();
                    })
                    .catch(reject);
            });
        }

        /**
         * B-29: the liveness ping of an interface with a `pingInterval` (HmIP-RF).
         * hmipserver forgets its clients when it restarts and does not tell them:
         * `init` had succeeded, so nothing failed, and the events simply stopped
         * until the 600 s silence timeout of rpcCheckInit(). After `pingInterval`
         * seconds without an event a `ping` goes out; when no event (the PONG)
         * arrives within `pongTimeout` seconds the subscription is lost and `init`
         * is called again at once - task 11's retry then covers the time the
         * process is down. Only an event counts as proof; a device callback
         * (newDevices after a restart) triggers the ping instead. An interface
         * that never delivered an event since its init is not re-subscribed by
         * this (a callback address the CCU cannot reach would cost an init, and
         * hmipserver's full newDevices re-send, every 40 s).
         * @param iface
         */
        startLiveness(iface) {
            const {pingInterval} = this.ifaceTypes[iface] || {};
            if (!pingInterval || !this.rpcPingEnabled || this.closing) {
                return;
            }

            this.stopLiveness(iface);
            this.liveness[iface] = {initAt: now(), pingAt: 0, timer: null, pongTimer: null, quietLogged: false};
            this.scheduleLiveness(iface, pingInterval * 1000);
        }

        /** @param iface */
        stopLiveness(iface) {
            const state = this.liveness[iface];
            if (state) {
                clearTimeout(state.timer);
                clearTimeout(state.pongTimer);
                delete this.liveness[iface];
            }
        }

        /**
         * @param iface
         * @param {number} delay ms until the next check
         */
        scheduleLiveness(iface, delay) {
            const state = this.liveness[iface];
            if (!state) {
                return;
            }

            clearTimeout(state.timer);
            state.timer = setTimeout(() => this.livenessCheck(iface), Math.max(delay, 100));
        }

        /** @param iface */
        livenessCheck(iface) {
            const state = this.liveness[iface];
            if (!state || this.closing) {
                return;
            }

            const {pingInterval} = this.ifaceTypes[iface];
            const sinceEvent = now() - (this.lastRealEvent[iface] || 0);
            if (sinceEvent < pingInterval * 1000) {
                // events arrive: the subscription is alive, no ping needed
                this.scheduleLiveness(iface, pingInterval * 1000 - sinceEvent);
                return;
            }

            this.livenessPing(iface);
        }

        /** @param iface */
        livenessPing(iface) {
            const state = this.liveness[iface];
            if (!state || state.pongTimer || this.closing) {
                return;
            }

            const {pongTimeout} = this.ifaceTypes[iface];
            clearTimeout(state.timer);
            state.pingAt = now();
            this.logger.debug('liveness ping', iface);
            state.pongTimer = setTimeout(() => this.livenessPongMissing(iface), pongTimeout * 1000);
            this.methodCall(iface, 'ping', ['nr'], {quiet: true}).catch((error) => {
                // the process itself does not answer: no need to wait for the PONG
                const current = this.liveness[iface];
                if (current && current.pongTimer) {
                    clearTimeout(current.pongTimer);
                    current.pongTimer = null;
                    this.livenessLost(iface, 'ping failed: ' + (error && error.message ? error.message : error));
                }
            });
        }

        /** the PONG did not arrive in time @param iface */
        livenessPongMissing(iface) {
            const state = this.liveness[iface];
            if (!state) {
                return;
            }

            state.pongTimer = null;
            const {pingInterval, pongTimeout} = this.ifaceTypes[iface];
            if (!this.lastRealEvent[iface] || this.lastRealEvent[iface] < state.initAt) {
                // never an event since the init: do not re-subscribe on that alone
                if (!state.quietLogged) {
                    state.quietLogged = true;
                    this.logger.debug(
                        'liveness',
                        iface,
                        'no PONG within ' + pongTimeout + ' s and no event since init - not subscribing again',
                    );
                }

                this.scheduleLiveness(iface, pingInterval * 1000);
                return;
            }

            this.livenessLost(iface, 'no answer to a ping within ' + pongTimeout + ' s');
        }

        /**
         * The subscription is lost: init again at once.
         * @param iface
         * @param {string} reason
         */
        livenessLost(iface, reason) {
            if (!this.liveness[iface] || this.closing) {
                return;
            }

            this.stopLiveness(iface);
            this.logger.warn(iface + ': ' + reason + ' - subscribing again');
            this.hadTimeout.add(iface);
            this.setIfaceStatus(iface, false, true);
            this.rpcInit(iface)
                .then(() => {
                    this.logger.info(iface + ' subscribed again');
                    this.rpcInitSucceeded(iface);
                })
                .catch((error) => this.rpcInitFailed(iface, error));
        }

        /**
         * An event arrived (PONG included): the subscription delivers.
         * @param iface
         */
        livenessEvent(iface) {
            this.lastRealEvent[iface] = now();
            const state = this.liveness[iface];
            if (state && state.pongTimer) {
                clearTimeout(state.pongTimer);
                state.pongTimer = null;
                this.scheduleLiveness(iface, this.ifaceTypes[iface].pingInterval * 1000);
            }
        }

        /**
         * A device callback (newDevices, deleteDevices, ...) arrived. After a
         * restart hmipserver sends newDevices to the read-back handler about
         * 16 s in, before any event: ask for the PONG at once instead of
         * waiting for the interval.
         * @param iface
         */
        deviceCallback(iface) {
            const state = this.liveness[iface];
            if (state && !state.pongTimer && !this.closing) {
                this.livenessPing(iface);
            }
        }

        /**
         *
         * @param iface
         */
        rpcCheckInit(iface) {
            if (!this.rpcPingEnabled) {
                return;
            }

            if (!this.metadata.devices[iface] || !Object.keys(this.metadata.devices[iface]).length > 0) {
                return;
            }

            clearTimeout(this.rpcPingTimer[iface]);
            const pingTimeout = this.ifaceTypes[iface].pingTimeout || this.rpcPingTimeout;
            const elapsed = Math.round((now() - (this.lastEvent[iface] || 0)) / 1000);
            this.logger.debug('rpcCheckInit', iface, elapsed, pingTimeout);
            if (elapsed > pingTimeout) {
                this.hadTimeout.add(iface);
                this.setIfaceStatus(iface, false);
                this.logger.warn('ping timeout', iface, elapsed);
                this.rpcInit(iface)
                    .then(() => this.rpcInitSucceeded(iface))
                    .catch((error) => this.rpcInitFailed(iface, error));
                return;
            }

            if (elapsed >= pingTimeout / 2) {
                //this.logger.trace('ping', iface, elapsed);
                this.methodCall(iface, 'ping', ['nr']).catch(() => {
                    this.setIfaceStatus(iface, false);
                });
            }

            this.rpcPingTimer[iface] = setTimeout(() => {
                this.rpcCheckInit(iface);
            }, pingTimeout * 250);
        }

        /**
         *
         * @returns {*}
         */
        rpcClose() {
            this.logger.debug('rpcClose');
            const calls = [];
            Object.keys(this.clients).forEach((iface) => {
                // an interface still waiting for its process never took our init
                if (this.ifaceTypes[iface].init && !this.ifaceWaiting[iface]) {
                    this.logger.debug('queue de-init ' + iface + ' ' + this.initUrl(iface));
                    calls.push(() => {
                        return new Promise((resolve) => {
                            this.logger.debug('de-init ' + iface + ' ' + this.initUrl(iface));
                            this.methodCall(iface, 'init', [this.initUrl(iface), ''])
                                .then(() => {
                                    this.logger.info('de-init ' + iface + ' ' + this.initUrl(iface) + ' done');
                                    resolve();
                                })
                                .catch((error) => {
                                    this.logger.error(
                                        'de-init ' + iface + ' ' + this.initUrl(iface) + ' failed ' + error,
                                    );
                                    resolve();
                                });
                        });
                    });
                }
            });

            this.logger.debug('queue binrpc server closing');
            calls.push(() => {
                return new Promise((resolve) => {
                    this.logger.debug('binrpc server closing');
                    let timeout;
                    if (this.servers.binrpc && this.servers.binrpc.server) {
                        timeout = setTimeout(() => {
                            this.logger.error('binrpc server close timeout');
                            resolve();
                        }, 2000);
                        this.servers.binrpc.server.close(() => {
                            clearTimeout(timeout);
                            this.logger.info('binrpc server closed');
                            resolve();
                        });
                    } else {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });

            this.logger.debug('xmlrpc binrpc server closing');
            calls.push(() => {
                return new Promise((resolve) => {
                    this.logger.debug('xmlrpc server closing');
                    let timeout;
                    if (this.servers.http && this.servers.http.close) {
                        timeout = setTimeout(() => {
                            delete this.servers.http;
                            this.logger.error('xmlrpc server close timeout');
                            resolve();
                        }, 2000);
                        this.logger.debug('xmlrpc server closing');
                        this.servers.http.close(() => {
                            clearTimeout(timeout);
                            this.logger.info('xmlrpc server closed');
                            resolve();
                        });
                    } else {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });

            // last: the clients themselves, so their reconnect timers die with the
            // node (a redeploy used to leave every binrpc client reconnecting)
            calls.push(() => {
                Object.keys(this.clients).forEach((iface) => {
                    this.closeClient(iface);
                });
                return Promise.resolve();
            });

            this.logger.debug('shutdown tasks: ' + calls.length);
            return calls.reduce((p, task) => p.then(task), Promise.resolve());
        }

        /**
         *
         * @param iface
         * @returns {string}
         */
        initUrl(iface) {
            const {protocol} = this.ifaceTypes[iface];
            const port = protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort;
            return protocol + '://' + (this.rpcInitAddress || this.rpcServerHost) + ':' + port;
        }

        /**
         *
         * @param iface
         * @returns {string}
         */
        rpcServer(iface) {
            const url = this.initUrl(iface);
            const {rpc, protocol} = this.ifaceTypes[iface];
            const port = protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort;
            if (!this.servers[protocol]) {
                this.servers[protocol] = rpc.createServer({host: this.rpcServerHost, port}, () => {
                    // Todo homematic-xmlrpc and binrpc module: clarify onListening callback params
                    this.logger.info(protocol === 'binrpc' ? 'binrpc' : 'xmlrpc', 'server listening on', url);
                    this.serverError[iface] = null;
                });

                // Todo binrpc module: emit error event on server object to eliminate the reach-in
                const errorEmitter = protocol === 'binrpc' ? this.servers[protocol].server : this.servers[protocol];
                errorEmitter.on('error', (err) => {
                    this.logger.error(protocol + ' ' + err.message);
                    this.serverError[iface] = err.message;
                });

                Object.keys(this.rpcMethods).forEach((method) => {
                    this.servers[protocol].on(method, (err, parameters, callback) => {
                        if (err) {
                            this.logger.error('rpc <', protocol, method, err);
                        }

                        this.logger.debug('rpc <', protocol, method, JSON.stringify(parameters));
                        const handler = method === 'event' ? 'eventSingle' : method;

                        if (isIterable(parameters)) {
                            this.callRpcMethod(handler, err, parameters, callback);
                        } else {
                            this.logger.error(
                                'rpc <',
                                protocol,
                                'method',
                                method,
                                'params not iterable',
                                JSON.stringify(parameters),
                            );
                            callback(null, this.rpcDefaultAnswer(method));
                        }
                    });
                });
                this.servers[protocol].on('NotFound', (method, parameters) => {
                    this.logger.error('rpc <', protocol, 'method', method, 'not found:', JSON.stringify(parameters));
                });
            }

            return url;
        }

        /**
         *
         * @param iface
         * @param device
         * @param paramset
         * @returns {string}
         */
        paramsetName(iface, device, paramset) {
            let cType = '';
            let d;
            if (device) {
                if (device.PARENT) {
                    // channel
                    cType = device.TYPE;
                    d = this.metadata.devices[iface][device.PARENT];
                } else {
                    // device
                    d = device;
                }

                if (paramset.match(/[\da-f]+:\d+/i)) {
                    paramset = 'LINK';
                }

                if (d) {
                    return [iface, d.TYPE, d.FIRMWARE, d.VERSION, cType, paramset].join('/');
                }
            }
        }

        paramsQueuePush(iface, device, paramset = 'MASTER') {
            this.paramsQueue.push({
                iface,
                address: device.ADDRESS,
                paramset,
            });
        }

        paramsQueueShift() {
            const item = this.paramsQueue.shift();
            if (item) {
                const {iface, address, paramset} = item;
                this.methodCall(iface, 'getParamset', [address, paramset])
                    .then((res) => {
                        this.params[paramset][address] = res;
                    })
                    .catch((error) => this.logger.error(error))
                    .then(() => {
                        clearTimeout(this.getParamsTimeout);
                        this.getParamsTimeout = setTimeout(() => {
                            this.paramsQueueShift();
                        }, 200);
                    })
                    .catch(() => {});
            } else {
                this.logger.debug(JSON.stringify(this.params));
            }
        }

        /**
         *
         * @param iface
         * @param device
         */
        paramsetQueuePush(iface, device) {
            if (device && device.PARAMSETS) {
                device.PARAMSETS.forEach((paramset) => {
                    const name = this.paramsetName(iface, device, paramset);
                    if (!this.paramsetDescriptions[name]) {
                        this.paramsetQueue.push({
                            iface,
                            name,
                            address: device.ADDRESS,
                            paramset,
                        });
                    }
                });
            }

            clearTimeout(this.getParamsetTimeout);
            this.getParamsetTimeout = setTimeout(() => {
                this.paramsetQueueShift();
            }, 1000);
        }

        /**
         *
         */
        paramsetQueueShift() {
            this.logger.debug('paramsetQueueShift');
            if (!this.paramsetPending) {
                this.paramsetPending = true;
            }

            const item = this.paramsetQueue.shift();
            if (item) {
                const {iface, name, address, paramset} = item;

                if (this.paramsetDescriptions[name]) {
                    //this.logger.trace('paramset', name, 'already known');
                    this.paramsetPending = false;
                    clearTimeout(this.getParamsetTimeout);
                    setImmediate(() => this.paramsetQueueShift());
                } else {
                    this.methodCall(iface, 'getParamsetDescription', [address, paramset])
                        .then((res) => {
                            //this.logger.trace('paramsetDescription', name);
                            this.newParamsetDescriptionCount += 1;
                            this.newParamsetDescription = true;
                            this.paramsetDescriptions[name] = res;
                            if (this.newParamsetDescriptionCount >= 30) {
                                this.newParamsetDescription = false;
                                this.newParamsetDescriptionCount = 0;
                                this.saveParamsets();
                            }
                        })
                        .catch((error) => this.logger.error(error))
                        .then(() => {
                            this.paramsetPending = false;
                            clearTimeout(this.getParamsetTimeout);
                            this.getParamsetTimeout = setTimeout(() => {
                                this.paramsetQueueShift();
                            }, 200);
                        })
                        .catch(() => {});
                }
            } else {
                this.paramsetPending = false;
                if (this.newParamsetDescription) {
                    this.newParamsetDescription = false;
                    this.saveParamsets();
                }

                this.paramsQueueShift();
            }
        }

        /**
         *
         * @param iface
         * @param device
         * @param paramset
         * @param param
         * @returns {*}
         */
        getParamsetDescription(iface, device, paramset, parameter) {
            const name = this.paramsetName(iface, device, paramset);
            if (this.paramsetDescriptions[name]) {
                if (parameter) {
                    return this.paramsetDescriptions[name][parameter];
                }

                return this.paramsetDescriptions[name];
            }

            this.paramsetQueuePush(iface, device);
            return {};
        }

        /**
         *
         * @param iface
         * @param device
         */
        newDevice(iface, device) {
            if (!this.metadata.devices[iface]) {
                this.metadata.devices[iface] = {};
            }

            if (!this.metadata.types[iface]) {
                this.metadata.types[iface] = {};
            }

            if (this.metadata.devices[iface][device.ADDRESS]) {
                this.logger.trace('newDevice (already known)', iface, device.ADDRESS);
            } else {
                this.logger.debug('newDevice', iface, device.ADDRESS);
            }

            this.metadata.devices[iface][device.ADDRESS] = device;

            if (!device.TYPE) {
                // TODO rethink.
                throw new Error('device type undefined: ' + JSON.stringify(device));
            }

            if (
                this.metadata.types[iface][device.TYPE] &&
                !this.metadata.types[iface][device.TYPE].includes(device.ADDRESS)
            ) {
                this.metadata.types[iface][device.TYPE].push(device.ADDRESS);
            } else {
                this.metadata.types[iface][device.TYPE] = [device.ADDRESS];
            }

            if (device.TYPE === 'MULTI_MODE_INPUT_TRANSMITTER') {
                //this.paramsQueuePush(iface, device);
            }

            this.paramsetQueuePush(iface, device);
        }

        /**
         *
         * @param iface
         * @param device
         */
        deleteDevice(iface, device) {
            this.logger.debug('deleteDevice', iface, device);
            delete this.metadata.devices[iface][device];
        }

        /**
         *
         * @param iface
         * @returns {Array}
         */
        listDevices(iface) {
            const result = [];
            if (this.metadata.devices[iface]) {
                Object.keys(this.metadata.devices[iface]).forEach((addr) => {
                    const dev = this.metadata.devices[iface][addr];
                    // The CCU's own virtual remote control (HmIP-RCV-1, type HmIP-RCV-50) is listed
                    // like any other device. It was left out since CCU3 firmware 3.43.15 (2019),
                    // whose hmipserver failed on an answer that held it; current hmipservers do
                    // not, and without it every init made hmipserver log a handleIDMigration
                    // warning and send the whole virtual remote again with newDevices (task 13).

                    if (dev.TYPE === 'MULTI_MODE_INPUT_TRANSMITTER') {
                        //this.paramsQueuePush(iface, dev);
                    }

                    this.paramsetQueuePush(iface, this.metadata.devices[iface][addr]);
                    result.push(this.listDevicesAnswer(iface, this.metadata.devices[iface][addr]));
                });
            }

            return result;
        }

        /**
         *
         * @param iface
         * @param device
         * @returns {*}
         */
        listDevicesAnswer(iface, device) {
            switch (iface) {
                case 'HmIP-RF':
                // fallthrough by intention
                case 'VirtualDevices': {
                    const d = {
                        ADDRESS: device.ADDRESS,
                        VERSION: device.VERSION,
                        AES_ACTIVE: device.AES_ACTIVE,
                        CHILDREN: device.CHILDREN,
                        DIRECTION: device.DIRECTION,
                        FIRMWARE: device.FIRMWARE,
                        FLAGS: device.FLAGS,
                        GROUP: device.GROUP,
                        INDEX: device.INDEX,
                        INTERFACE: device.INTERFACE,
                        LINK_SOURCE_ROLES: device.LINK_SOURCE_ROLES,
                        LINK_TARGET_ROLES: device.LINK_TARGET_ROLES,
                        PARAMSETS: device.PARAMSETS,
                        PARENT: device.PARENT,
                        PARENT_TYPE: device.PARENT_TYPE,
                        RF_ADDRESS: device.RF_ADDRESS,
                        ROAMING: device.ROAMING,
                        RX_MODE: device.RX_MODE,
                        TEAM: device.TEAM,
                        TEAM_CHANNELS: device.TEAM_CHANNELS,
                        TEAM_TAG: device.TEAM_TAG,
                        TYPE: device.TYPE,
                    };
                    Object.keys(d).forEach((k) => {
                        if (typeof d[k] === 'undefined') {
                            delete d[k];
                        }

                        if (d[k] === '') {
                            // Würgaround https://github.com/eq-3/occu/issues/83
                            delete d[k];
                        }
                    });

                    return d;
                }

                default:
                    return {ADDRESS: device.ADDRESS, VERSION: device.VERSION};
            }
        }

        /**
         *
         * @param idInit
         * @returns {*}
         */
        getIfaceFromIdInit(idInit) {
            if (typeof idInit !== 'string') {
                return null;
            }

            if (idInit === 'CUxD') {
                return idInit;
            }

            const match = idInit.match(/^nr_[\da-zA-Z]{6}_([a-zA-Z-]+)$/);
            return match && this.ifaceTypes[match[1]] ? match[1] : null;
        }

        /**
         * B-32: the interface a callback call belongs to, or null with a debug line when the
         * first parameter is not one of our own init ids. Anything on the system can connect
         * to the callback ports on the loopback; such a call is answered, never thrown on.
         * @param {string} method
         * @param {Array} parameters
         * @returns {string|null}
         */
        rpcIface(method, parameters) {
            const [idInit] = parameters;
            const iface = this.getIfaceFromIdInit(idInit);
            if (!iface) {
                this.logger.debug('rpc <', method, 'unknown interface id', JSON.stringify(idInit));
            }

            return iface;
        }

        /**
         * B-32: what a callback call is answered with when it cannot be handled.
         * @param {string} method
         * @returns {Array|string}
         */
        rpcDefaultAnswer(method) {
            if (method === 'system.listMethods') {
                return Object.keys(this.rpcMethods);
            }

            if (method === 'listDevices' || method === 'system.multicall') {
                return [];
            }

            return '';
        }

        /**
         * B-32: run a callback handler so that a throw inside it is logged and answered
         * instead of ending the process (the RPC servers call us from an event emitter,
         * so an exception there is uncaught). The callback is answered exactly once.
         * @param {string} method the key in rpcMethods
         * @param {*} err
         * @param {Array} parameters
         * @param {function} callback
         */
        callRpcMethod(method, err, parameters, callback) {
            let answered = false;
            const answer = (error, result) => {
                if (!answered) {
                    answered = true;
                    callback(error, result);
                }
            };

            try {
                this.rpcMethods[method](err, parameters, answer);
            } catch (error) {
                this.logger.error(
                    'rpc <',
                    method,
                    'failed:',
                    error && error.message ? error.message : String(error),
                    JSON.stringify(parameters),
                );
                answer(null, this.rpcDefaultAnswer(method === 'eventSingle' ? 'event' : method));
            }
        }

        get rpcMethods() {
            return {
                'system.listMethods': (_, parameters, callback) => {
                    const iface = this.rpcIface('system.listMethods', parameters);
                    const res = Object.keys(this.rpcMethods);
                    if (iface) {
                        this.lastEvent[iface] = now();
                        this.setIfaceStatus(iface, true);
                    }

                    this.logger.debug('    >', iface, 'system.listMethods', JSON.stringify(res));
                    callback(null, res);
                },
                setReadyConfig: (_, parameters, callback) => {
                    const iface = this.rpcIface('setReadyConfig', parameters);
                    this.logger.debug('    >', iface, 'setReadyConfig ""');
                    callback(null, '');
                },
                updateDevice: (_, parameters, callback) => {
                    const iface = this.rpcIface('updateDevice', parameters);
                    this.logger.debug('    >', iface, 'updateDevice ""');
                    callback(null, '');
                    if (iface) {
                        this.deviceCallback(iface);
                    }
                },
                replaceDevice: (_, parameters, callback) => {
                    const iface = this.rpcIface('replaceDevice', parameters);
                    this.logger.debug('    >', iface, 'replaceDevice ""');
                    callback(null, '');
                    if (iface) {
                        this.deviceCallback(iface);
                    }
                },
                readdedDevice: (_, parameters, callback) => {
                    const iface = this.rpcIface('readdedDevice', parameters);
                    this.logger.debug('    >', iface, 'readdedDevice ""');
                    callback(null, '');
                    if (iface) {
                        this.deviceCallback(iface);
                    }
                },
                newDevices: (_, parameters, callback) => {
                    const [, devices] = parameters;
                    const iface = this.rpcIface('newDevices', parameters);

                    let changed = false;
                    if (iface && Array.isArray(devices)) {
                        devices.forEach((device) => {
                            if (device && typeof device.ADDRESS === 'string' && device.TYPE) {
                                this.newDevice(iface, device);
                                changed = true;
                            } else {
                                this.logger.warn(
                                    'newDevices',
                                    iface,
                                    'skipping malformed entry',
                                    JSON.stringify(device),
                                );
                            }
                        });
                    }

                    this.logger.debug('    >', iface, 'newDevices ""');
                    callback(null, '');

                    if (changed) {
                        this.saveMetadata();
                    }

                    if (iface) {
                        this.deviceCallback(iface);
                    }
                },
                deleteDevices: (_, parameters, callback) => {
                    const [, devices] = parameters;
                    const iface = this.rpcIface('deleteDevices', parameters);

                    let changed = false;
                    if (iface && Array.isArray(devices) && this.metadata.devices[iface]) {
                        devices.forEach((device) => {
                            if (typeof device === 'string' && this.metadata.devices[iface][device]) {
                                this.deleteDevice(iface, device);
                                changed = true;
                            }
                        });
                    }

                    this.logger.debug('    >', iface, 'deleteDevices ""');
                    callback(null, '');

                    if (changed) {
                        this.saveMetadata();
                    }

                    if (iface) {
                        this.deviceCallback(iface);
                    }
                },
                listDevices: (_, parameters, callback) => {
                    const iface = this.rpcIface('listDevices', parameters);
                    let res = [];
                    if (iface) {
                        this.lastEvent[iface] = now();
                        this.setIfaceStatus(iface, true);
                        res = this.listDevices(iface) || [];
                    }

                    this.logger.debug('    >', iface, 'listDevices', JSON.stringify(res));
                    callback(null, res);
                },
                event: (_, parameters, callback) => {
                    const iface = this.rpcIface('event', parameters);
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(parameters);
                    callback(null, '');
                },
                eventSingle: (_, parameters, callback) => {
                    const iface = this.rpcIface('event', parameters);
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(parameters);

                    if (iface && parameters[2] !== 'PONG') {
                        if (this.rxCounters[iface]) {
                            this.rxCounters[iface] += 1;
                        } else {
                            this.rxCounters[iface] = 1;
                        }
                    }

                    callback(null, '');
                },
                'system.multicall': (_, parameters, callback) => {
                    const result = [];
                    let iface;

                    const queue = [];
                    let working;
                    let direction;
                    let pong = true;
                    if (isIterable(parameters[0])) {
                        parameters[0].forEach((call) => {
                            if (call && call.methodName === 'event') {
                                if (isIterable(call.params)) {
                                    queue.push(call);
                                    const [idInit, , datapoint, value] = call.params;
                                    if (datapoint !== 'PONG') {
                                        pong = false;
                                    }

                                    if (datapoint === 'WORKING' || datapoint === 'WORKING_SLATS') {
                                        working = value;
                                    } else if (datapoint === 'PROCESS') {
                                        working = Boolean(value);
                                    } else if (datapoint === 'DIRECTION') {
                                        direction = value;
                                    } else if (datapoint === 'ACTIVITY_STATE') {
                                        if (value === 3) {
                                            direction = 0;
                                        } else if (value === 0) {
                                            direction = 3;
                                        } else {
                                            direction = value;
                                        }
                                    }

                                    iface = this.getIfaceFromIdInit(idInit) || iface;
                                } else {
                                    this.logger.debug(
                                        'rpc <',
                                        'event',
                                        'params not iterable',
                                        JSON.stringify(call.params),
                                    );
                                }

                                result.push('');
                            } else if (
                                call &&
                                call.methodName !== 'system.multicall' &&
                                this.rpcMethods[call.methodName]
                            ) {
                                pong = false;
                                if (isIterable(call.params)) {
                                    let answered = false;
                                    this.callRpcMethod(call.methodName, null, call.params, (_, res) => {
                                        answered = true;
                                        result.push(res);
                                    });
                                    if (!answered) {
                                        result.push(this.rpcDefaultAnswer(call.methodName));
                                    }
                                } else {
                                    this.logger.error(
                                        'rpc <',
                                        call.methodName,
                                        'params not iterable',
                                        JSON.stringify(call.params),
                                    );
                                    result.push(this.rpcDefaultAnswer(call.methodName));
                                }
                            } else {
                                // B-32: an unknown or nested method keeps the answer's shape
                                result.push('');
                            }
                        });
                        queue.forEach((call) => {
                            this.publishEvent(call.params, working, direction);
                        });
                    }

                    this.logger.debug('    >', iface, 'system.multicall', JSON.stringify(result));

                    if (!pong && iface) {
                        if (this.rxCounters[iface]) {
                            this.rxCounters[iface] += 1;
                        } else {
                            this.rxCounters[iface] = 1;
                        }
                    }

                    callback(null, result);
                },
            };
        }

        /**
         * Subscribe to variable changes and register a callback
         * @param {string} name
         * @param {function} callback
         * @returns {number|null} subscription id
         */
        subscribeSysvar(filter, callback) {
            if (typeof callback === 'function') {
                const id = this.idSysvarCallback;
                this.idSysvarCallback += 1;
                this.logger.debug('subscribeSysvar', id, JSON.stringify(filter));
                this.sysvarCallbacks[id] = {filter, callback};
                return id;
            }

            this.logger.error('subscribeSysvar called without callback');
            return null;
        }

        /**
         * Remove a subscription to variable changes
         * @param {number} id subscription id
         * @returns {boolean}
         */
        unsubscribeSysvar(id) {
            if (this.sysvarCallbacks[id]) {
                this.logger.trace('unsubscribeSysvar', id);
                delete this.sysvarCallbacks[id];
                return true;
            }

            this.logger.error('unsubscribeSysvar called for unknown callback', id);
            return false;
        }

        /**
         * Subscribe to program changes and register a callback
         * @param {string} name
         * @param {function} callback
         * @returns {number|null} subscription id
         */
        subscribeProgram(name, callback) {
            if (typeof callback === 'function') {
                const id = this.idProgramCallback;
                this.idProgramCallback += 1;
                const filter = {name};
                this.logger.debug('subscribeProgram', JSON.stringify(filter));
                this.programCallbacks[id] = {filter, callback};
                return id;
            }

            this.logger.error('subscribeProgram called without callback');
            return null;
        }

        /**
         * Remove a subscription to program changes
         * @param {number} id subscription id
         * @returns {boolean}
         */
        unsubscribeProgram(id) {
            if (this.programCallbacks[id]) {
                this.logger.trace('unsubscribeProgram', id);
                delete this.programCallbacks[id];
                return true;
            }

            this.logger.error('unsubscribeProgram called for unknown callback', id);
            return false;
        }

        /**
         *
         * @param filter
         * @param callback
         * @returns {*}
         */
        subscribe(filter, callback) {
            if (typeof callback !== 'function') {
                this.logger.error('subscribe called without callback');
                return null;
            }

            filter = filter || {};

            if (typeof filter.interface !== 'undefined') {
                filter.iface = filter.interface;
                delete filter.interface;
            }

            const validFilterProperties = new Set([
                'change',
                'cache',
                'stable',
                'uncertain',
                'iface',
                'device',
                'deviceType',
                'deviceName',
                'channel',
                'channelType',
                'channelName',
                'channelIndex',
                'datapoint',
                'datapointName',
                'room',
                'function',
                'rooms',
                'functions',
            ]);

            const propertiesArray = Object.keys(filter);

            for (let i = 0, {length} = propertiesArray; i < length; i++) {
                if (!validFilterProperties.has(propertiesArray[i])) {
                    this.logger.error('subscribe called with invalid filter property ' + propertiesArray[i]);
                    return null;
                }
            }

            const id = this.idCallback;
            this.idCallback += 1;

            //this.logger.trace('subscribe', id, JSON.stringify(filter));
            this.callbacks[id] = {filter, callback};

            if (filter.cache && this.cachedValuesReceived) {
                Object.keys(this.values).forEach((dp) => {
                    const message = {...this.values[dp]};
                    message.cache = true;
                    message.change = false;
                    if (!this.callbackBlacklists[message.datapointName]) {
                        this.callbackBlacklists[message.datapointName] = new Set();
                    }

                    if (!this.callbackWhitelists[message.datapointName]) {
                        this.callbackWhitelists[message.datapointName] = new Set();
                    }

                    this.callCallback(message, id);
                });
            }

            return id;
        }

        /**
         *
         * @param id
         * @returns {boolean}
         */
        unsubscribe(id) {
            if (this.callbacks[id]) {
                this.logger.trace('unsubscribe', id);
                delete this.callbacks[id];

                Object.keys(this.callbackBlacklists).forEach((dp) => {
                    this.callbackBlacklists[dp].delete(id);
                });

                Object.keys(this.callbackWhitelists).forEach((dp) => {
                    this.callbackWhitelists[dp].delete(id);
                });

                return true;
            }

            this.logger.error('unsubscribe called for unknown callback', id);
            return false;
        }

        /**
         *
         * @param topic
         * @param msg
         * @returns {*}
         */
        topicReplace(topic, message) {
            return topicReplace(topic, message);
        }

        /**
         *
         * @param iface
         * @param channel
         * @param datapoint
         * @param payload
         * @param additions
         * @returns {*}
         */
        createMessage(iface, channel, datapoint, payload, additions) {
            return createMessage(this, iface, channel, datapoint, payload, additions);
        }

        /**
         *
         * @param params
         * @param working
         * @param direction
         */
        publishEvent(parameters, working, direction) {
            const [idInit, channel, datapoint, payload] = parameters;
            const iface = this.getIfaceFromIdInit(idInit);

            if (!iface || typeof channel !== 'string' || typeof datapoint !== 'string') {
                // B-32: not one of our interfaces, or not an event's shape - nothing to publish
                this.logger.debug('rpc <', 'event', 'ignored', JSON.stringify(parameters));
                return;
            }

            this.lastEvent[iface] = now();
            this.livenessEvent(iface);
            if (this.hadTimeout.has(iface)) {
                this.setIfaceStatus(iface, true);
            }

            if (channel.includes('CENTRAL') && datapoint === 'PONG') {
                this.logger.debug('    < ' + iface + ' PONG ' + payload);
                return;
            }

            //this.logger.trace('publishEvent', JSON.stringify(params));

            const message = this.createMessage(iface, channel, datapoint, payload, {
                cache: false,
                uncertain: false,
                working,
                direction,
            });

            let waitForWorking = false;

            if (message.channelType && !working) {
                if (
                    message.datapoint === 'STATE' &&
                    message.channelType.match(/SIGNAL|SWITCH|RAINDETECTOR_HEAT|ALARMACTUATOR/)
                ) {
                    waitForWorking = true;
                } else if (message.datapoint === 'ARMSTATE' && message.channelType === 'ARMING') {
                    waitForWorking = true;
                } else if (
                    message.datapoint.startsWith('LEVEL') &&
                    message.channelType.match(/DIMMER|DUAL_WHITE|BLIND|SHUTTER|JALOUSIE|WINMATIC|KEYMATIC/)
                ) {
                    waitForWorking = true;
                }
            }

            if (waitForWorking) {
                clearTimeout(this.workingTimeout[message.datapointName]);
                this.workingTimeout[message.datapointName] = setTimeout(() => {
                    const datapointNamePrefix = iface + '.' + channel + '.';

                    if (
                        this.values[datapointNamePrefix + 'WORKING'] ||
                        this.values[datapointNamePrefix + 'WORKING_SLATS']
                    ) {
                        message.working =
                            this.values[datapointNamePrefix + 'WORKING'] &&
                            this.values[datapointNamePrefix + 'WORKING'].value;
                        message.working =
                            message.working ||
                            (this.values[datapointNamePrefix + 'WORKING_SLATS'] &&
                                this.values[datapointNamePrefix + 'WORKING_SLATS'].value);
                        message.working = Boolean(message.working);
                    } else if (this.values[datapointNamePrefix + 'PROCESS']) {
                        message.working = Boolean(this.values[datapointNamePrefix + 'PROCESS'].value);
                    }

                    if (this.values[datapointNamePrefix + 'DIRECTION']) {
                        message.direction = this.values[datapointNamePrefix + 'DIRECTION'].value;
                    } else if (this.values[datapointNamePrefix + 'ACTIVITY_STATE']) {
                        const activityState = this.values[datapointNamePrefix + 'ACTIVITY_STATE'].value;
                        if (activityState === 0) {
                            message.direction = 3;
                        } else if (activityState === 3) {
                            message.direction = 0;
                        } else {
                            message.direction = activityState;
                        }
                    }

                    message.stable = !message.working;
                    this.values[message.datapointName] = message;
                    this.callCallbacks(message);
                }, 300);
            } else {
                this.values[message.datapointName] = message;
                this.callCallbacks(message);
            }
        }

        /**
         * Call a subscription callback if filters match
         * @param msg
         * @param id
         * @returns {boolean}
         */
        callCallback(message, id) {
            const {filter, callback} = this.callbacks[id];
            //this.logger.trace('filter', JSON.stringify(filter));

            let match = true;
            let matchCache;
            let matchChange;
            let matchStable;

            // Checked before the attribute loop below: that loop may break
            // early for a whitelisted datapoint, and this decision has to be
            // made for every message regardless of key order. Only present in
            // the filter when a node opted in, so existing subscriptions keep
            // receiving values the ReGa could not timestamp (#96).
            if (filter && filter.uncertain === false && message.uncertain) {
                return false;
            }

            if (filter) {
                const arrayAttr = Object.keys(filter);

                for (let i = 0, {length} = arrayAttr; match && i < length; i++) {
                    const attr = arrayAttr[i];

                    if (attr === 'cache') {
                        // if filter.cache==false - Drop messages with msg.cache==true
                        if (!filter.cache && message.cache) {
                            //this.logger.trace('cb mismatch cache ' + id + ' ' + filter.cache + ' ' + msg.cache);
                            return false;
                        }

                        matchCache = true;
                        continue;
                    }

                    if (attr === 'change') {
                        // if filter.change==true - Drop messages with msg.change==false - except msg.cache==true && filter.cache==true
                        if (filter.change && !message.change && !(filter.cache && message.cache)) {
                            //this.logger.trace('cb mismatch change ' + id + ' ' + filter.change + ' ' + msg.change + ' ' + msg.cache);
                            return false;
                        }

                        matchChange = true;
                        continue;
                    }

                    if (attr === 'stable') {
                        // if filter.stable==true - Drop messages with msg.stable==false
                        if (filter.stable && !message.stable) {
                            //this.logger.trace('cb mismatch stable ' + id + ' ' + filter.stable + ' ' + msg.stable);
                            return false;
                        }

                        matchStable = true;
                        continue;
                    }

                    if (attr === 'uncertain') {
                        // already decided above, and not a value to compare
                        continue;
                    }

                    if (this.callbackWhitelists[message.datapointName].has(id)) {
                        if (matchCache && matchChange && matchStable) {
                            break;
                        }

                        continue;
                    }

                    if (filter[attr] === '') {
                        // TODO rethink
                        continue;
                    }

                    if (attr === 'channelIndex' && typeof filter[attr] !== 'undefined') {
                        filter[attr] = Number.parseInt(filter[attr], 10);
                    }

                    if (Array.isArray(message[attr])) {
                        if (filter[attr] instanceof RegExp) {
                            match = false;
                            this.logger.trace('cb test regex array', id, attr, filter[attr], message[attr]);
                            message[attr].forEach((item) => {
                                if (filter[attr].test(item)) {
                                    match = true;
                                }
                            });
                        } else if (!message[attr].includes(filter[attr])) {
                            this.logger.trace('cb mismatch array', id, attr, filter[attr], message[attr]);
                            match = false;
                        }
                    } else if (filter[attr] instanceof RegExp) {
                        if (!filter[attr].test(message[attr])) {
                            this.logger.trace('cb mismatch regex', id, attr, filter[attr], message[attr]);
                            match = false;
                        }
                    } else if (filter[attr] !== message[attr]) {
                        this.logger.trace(
                            'cb mismatch misc ' + id + ' ' + attr + ' ' + filter[attr] + ' ' + message[attr],
                        );
                        match = false;
                    }
                }
            }

            if (match) {
                //this.logger.trace('callCallback ' + id + ' ' + msg.datapointName + ' ' + msg.value);
                callback(RED.util.cloneMessage(message));
                this.callbackWhitelists[message.datapointName].add(id);
            } else {
                //this.logger.trace('add to blacklist ' + id + ' ' + msg.datapointName);
                this.callbackBlacklists[message.datapointName].add(id);
            }

            return match;
        }

        /**
         * Apply msg to callCallback() for all (not blacklisted) callbacks
         * @param msg
         */
        callCallbacks(message) {
            //this.logger.trace('callCallbacks', this.callbacks.length, JSON.stringify({datapointName: msg.datapointName, value: msg.value, cache: msg.cache, change: msg.change, stable: msg.stable}));
            if (!this.callbackBlacklists[message.datapointName]) {
                this.callbackBlacklists[message.datapointName] = new Set();
            }

            if (!this.callbackWhitelists[message.datapointName]) {
                this.callbackWhitelists[message.datapointName] = new Set();
            }

            Object.keys(this.callbacks).forEach((key) => {
                if (this.callbackBlacklists[message.datapointName].has(key)) {
                    //this.logger.trace('blacklistet ' + key + ' ' + msg.datapointName);
                    return;
                }

                this.callCallback(message, key);
            });
        }

        /**
         * Call a RPC method on an interface process
         * @param iface
         * @param method
         * @param params
         * @returns {Promise<any>}
         */
        methodCall(iface, method, parameters, {quiet = false} = {}) {
            return new Promise((resolve, reject) => {
                if (this.clients[iface]) {
                    this.logger.debug('rpc >', iface, method, JSON.stringify(parameters));
                    this.clients[iface].methodCall(method, parameters, (err, res) => {
                        if (err) {
                            this.logger[quiet ? 'debug' : 'error']('    <', iface, method, err);
                            this.closeClient(iface);
                            // a closed node creates no new client (it would reconnect forever)
                            if (!this.closing) {
                                this.createClient(iface, {quiet});
                            }

                            reject(err);
                        } else if (res && res.faultCode) {
                            this.logger[quiet ? 'debug' : 'error']('    <', iface, method, JSON.stringify(res));
                            const fault = new Error(res.faultString);
                            fault.faultCode = res.faultCode;
                            fault.faultString = res.faultString;
                            reject(fault);
                        } else {
                            this.logger.debug('    <', iface, method, JSON.stringify(res));
                            resolve(res);
                        }
                    });
                    if (['setValue', 'putParamset', 'activateLinkParamset'].includes(method)) {
                        if (this.txCounters[iface]) {
                            this.txCounters[iface] += 1;
                        } else {
                            this.txCounters[iface] = 1;
                        }
                    }
                } else if (this.ifaceTypes[iface]) {
                    this.logger.debug('defering methodCall ' + iface + ' ' + method + ' ' + JSON.stringify(parameters));
                    if (this.methodCallQueue[iface]) {
                        this.methodCallQueue[iface].push([method, parameters, resolve, reject]);
                    } else {
                        this.methodCallQueue[iface] = [[method, parameters, resolve, reject]];
                    }
                } else {
                    reject(
                        new Error(
                            'unknown interface ' +
                                iface +
                                ' ' +
                                Object.keys(this.clients) +
                                ' ' +
                                Object.keys(this.ifaceTypes),
                        ),
                    );
                }
            });
        }

        /**
         * Call setValue on interface process. Queues all calls
         * @param iface
         * @param address
         * @param datapoint
         * @param value
         * @param burst
         * @param force
         * @returns {Promise<any>}
         */
        setValueQueued(iface, address, datapoint, value, burst, force) {
            return new Promise((resolve, reject) => {
                this.setValueQueue = this.setValueQueue.filter((element) => {
                    return element.iface !== iface || element.address !== address || element.datapoint !== datapoint;
                });
                const datapointName = iface + '.' + address + '.' + datapoint;
                const currentValue = this.values[datapointName] && this.values[datapointName].value;
                const cache = this.values[datapointName] && this.values[datapointName].cache;
                // B-19: a cached value that is the echo of our own last write does not
                // prove the actuator is there - a blind moved by hand keeps its control
                // channel's set point (#151). Only a value from another source dedupes:
                // one that differs from what we wrote last, or one reported before it.
                const lastWrite = this.lastWrite[datapointName];
                const cachedTs = this.values[datapointName] && this.values[datapointName].ts;
                const ownEcho = Boolean(lastWrite) && lastWrite.value === currentValue && cachedTs > lastWrite.ts;
                if (force || value !== currentValue || cache || ownEcho || datapoint.startsWith('PRESS_')) {
                    this.setValueQueue.push({iface, address, datapoint, value, burst, resolve, reject});
                    this.setValueShiftQueue();
                } else {
                    setTimeout(() => {
                        resolve();
                    }, 100);
                }
            });
        }

        /**
         *
         */
        setValueShiftQueue() {
            if (this.setValuePending || this.setValueQueue.length === 0) {
                return;
            }

            this.setValuePending = true;
            const {iface, address, datapoint, value, burst, resolve, reject} = this.setValueQueue.shift();
            let timeout;

            this.setValuePendingTimeout = setTimeout(() => {
                timeout = true;
                reject(new Error('setValueQueued timeout'));
                this.setValuePending = false;
                this.setValueShiftQueue();
            }, this.queueTimeout);

            this.setValue(iface, address, datapoint, value, burst)
                .then(() => {
                    if (!timeout) {
                        resolve();
                    }
                })
                .catch((error) => {
                    if (!timeout) {
                        reject(error);
                    }
                })
                .finally(() => {
                    clearTimeout(this.setValuePendingTimeout);
                    if (!timeout) {
                        this.setValuePending = false;
                        setTimeout(() => {
                            this.setValueShiftQueue();
                        }, this.queuePause);
                    }
                });
        }

        /**
         * Call setValue on interface process. Defers/overwrites calls to the same datapoint
         * @param iface
         * @param address
         * @param datapoint
         * @param value
         * @param burst
         * @returns {Promise<any>}
         */
        setValue(iface, address, datapoint, value, burst) {
            this.lastWrite[iface + '.' + address + '.' + datapoint] = {value, ts: now()};
            const device = this.metadata.devices[iface] && this.metadata.devices[iface][address];
            const description = this.paramsetDescriptions[this.paramsetName(iface, device, 'VALUES')];
            const combined = combinedParameterValue(datapoint, value, description);
            if (combined !== null) {
                // HmIP actuators accept but ignore a lone LEVEL_2 write; the CCU
                // itself writes COMBINED_PARAMETER instead (#136 #154 #175)
                this.logger.debug('setValue', datapoint, value, '-> COMBINED_PARAMETER', combined);
                datapoint = 'COMBINED_PARAMETER';
                value = combined;
            }

            return new Promise((resolve, reject) => {
                const id = `${iface}.${address}.${datapoint}`;
                value = this.paramCast(iface, address, 'VALUES', datapoint, value);
                const parameters = [address, datapoint, value];
                if (iface === 'BidCos-RF' && burst) {
                    parameters.push(burst);
                }

                if (this.setValueTimers[id]) {
                    if (this.setValueCache[id] && typeof this.setValueCache[id].reject === 'function') {
                        this.setValueCache[id].reject(new Error('overwritten'));
                    }

                    this.setValueCache[id] = {params: parameters, resolve, reject};
                    this.logger.debug('deferred', id);
                } else {
                    if (iface !== 'BidCos-Wired') {
                        this.setValueTimers[id] = setTimeout(() => {
                            delete this.setValueTimers[id];
                            this.setValueDeferred(id);
                        }, this.setValueThrottle);
                    }

                    this.methodCall(iface, 'setValue', parameters)
                        .then(resolve)
                        .catch((error) => {
                            this.logger.error('rpc >', iface, 'setValue', JSON.stringify(parameters), '<', error);
                            reject(error);
                        });
                }
            });
        }

        /**
         *
         * @param id
         * @returns {Promise<any | never>}
         */
        setValueDeferred(id) {
            if (this.setValueCache[id]) {
                this.logger.debug('setValueDeferred', id, this.setValueCache[id].params);
                const [iface] = id.split('.');
                const {params, resolve, reject} = this.setValueCache[id];
                delete this.setValueCache[id];
                return this.methodCall(iface, 'setValue', params)
                    .then(resolve)
                    .catch((error) => {
                        this.logger.error('rpc >', iface, 'setValue', JSON.stringify(params), '<', error);
                        reject(error);
                    });
            }
        }

        /**
         * Cast a param to type given by corresponding paramsetDescription
         * @param iface
         * @param address
         * @param psName
         * @param datapoint
         * @param value
         * @returns {*}
         */
        paramCast(iface, address, psName, datapoint, value) {
            const device = this.metadata.devices[iface] && this.metadata.devices[iface][address];
            const psKey = this.paramsetName(iface, device, psName);
            const description = this.paramsetDescriptions[psKey] && this.paramsetDescriptions[psKey][datapoint];
            if (!description) {
                this.logger.warn('unknown paramsetDescription ', psKey, datapoint);
            }

            return castValue(value, description);
        }

        /**
         * Execute a ReGaHss script
         * @param script
         * @returns {Promise<any>}
         */
        script(script) {
            return new Promise((resolve, reject) => {
                if (this.metaMode) {
                    reject(this.regaMissingError('HM-Script and ReGaHSS scripts'));
                    return;
                }

                execToCallback(this.rega.exec(script), (err, payload, objects) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({payload, objects});
                    }
                });
            });
        }
    }

    RED.nodes.registerType('ccu-connection', CcuConnectionNode, {
        credentials: {
            password: {type: 'password'},
            metaToken: {type: 'password'},
        },
    });
};
