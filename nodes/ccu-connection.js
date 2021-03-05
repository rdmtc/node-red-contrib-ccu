const os = require('os');
const dns = require('dns');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const promiseFinally = require('promise.prototype.finally');

promiseFinally.shim();

const base62 = require('buffer-base62').toBase62;
const stringSimilarity = require('string-similarity');
const nextport = require('nextport');
const hmDiscover = require('hm-discover');
const Rega = require('homematic-rega');
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const pkg = require(path.join(__dirname, '..', 'package.json'));

/**
 * check if an object is iterable
 * @link https://stackoverflow.com/a/37837872
 * @param obj
 * @returns {boolean}
 */
function isIterable(object) {
    // eslint-disable-next-line eqeqeq, no-eq-null
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
            nextport(start, port => {
                if (port) {
                    ccu.network.ports.push(port);
                    resolve();
                } else {
                    reject();
                }
            });
        });
    }

    hmDiscover(res => {
        ccu.network.discover = res;
    });

    const networkInterfaces = os.networkInterfaces();
    Object.keys(networkInterfaces).forEach(name => {
        networkInterfaces[name].forEach(addr => {
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
                    Object.keys(config.ifaceTypes).forEach(iface => {
                        object[iface] = {
                            enabled: Boolean(config.ifaceTypes[iface].enabled),
                            connected: Boolean(config.ifaceStatus[iface])
                        };
                    });
                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                case 'channels': {
                    const devices = config.metadata.devices[request.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach(addr => {
                            if (addr.match(/:\d+$/)) {
                                const psKey = config.paramsetName(request.query.iface, devices[addr], 'VALUES');
                                if (config.paramsetDescriptions[psKey]) {
                                    object[addr] = {
                                        name: config.channelNames[addr],
                                        datapoints: Object.keys(config.paramsetDescriptions[psKey]),
                                        rxMode: devices[devices[addr].PARENT] && devices[devices[addr].PARENT].RX_MODE
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

                        Object.keys(devices).forEach(addr => {
                            if (addr.match(/:\d+$/)) {
                                const psKey = config.paramsetName(iface, devices[addr], 'VALUES');
                                if (config.paramsetDescriptions[psKey]) {
                                    const devID = devices[addr].PARENT;
                                    const dps = [];
                                    const chName = config.channelNames[addr];

                                    Object.keys(config.paramsetDescriptions[psKey]).forEach(dp => {
                                        dps.push({
                                            id: iface + '.' + addr + '.' + dp,
                                            iface,
                                            channel: (chName) ? addr + ' ' + chName : addr,
                                            label: dp,
                                            icon: 'fa fa-tag fa-fw',
                                            class: request.query.classDp
                                        });
                                    });
                                    dps.sort((a, b) => a.label.localeCompare(b.label));
                                    const channel = {
                                        id: iface + '.' + addr,
                                        iface,
                                        label: (chName) ? chName + '  (' + addr + ')' : addr,
                                        children: dps,
                                        rooms: config.channelRooms[addr],
                                        functions: config.channelFunctions[addr],
                                        icon: 'fa fa-tags fa-fw',
                                        class: request.query.classCh
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
                                    label: (config.channelNames[devID]) ? config.channelNames[devID] + '  (' + devID + ')' : devID,
                                    type: devices[devID].TYPE,
                                    iface,
                                    icon: 'fa fa-archive fa-fw',
                                    channels: {},
                                    children: []
                                };
                            }

                            object[devID].channels[chID] = channel;
                            object[devID].children.push(channel);
                        });
                    } else {
                        Object.keys(config.metadata.devices).forEach(iface => {
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

                case 'rooms':
                    res.status(200).send(JSON.stringify({
                        rooms: config.rooms
                    }));
                    break;

                case 'functions':
                    res.status(200).send(JSON.stringify({
                        functions: config.functions
                    }));
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
                        Object.keys(devices).forEach(addr => {
                            if ([
                                'SIGNAL_CHIME',
                                'SIGNAL_LED',
                                'ALARM_SWITCH_VIRTUAL_RECEIVER'
                            ].includes(devices[addr].TYPE)) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].TYPE,
                                    deviceType: devices[addr].PARENT_TYPE
                                };
                            }

                            if ([
                                'HmIP-MP3P',
                                'HmIP-BSL'
                            ].includes(devices[addr].PARENT_TYPE) && [
                                'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER',
                                'DIMMER_VIRTUAL_RECEIVER'
                            ].includes(devices[addr].TYPE)) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].TYPE,
                                    deviceType: devices[addr].PARENT_TYPE
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
                        Object.keys(devices).forEach(addr => {
                            if (
                                (addr.endsWith(':3') && devices[addr].PARENT_TYPE.match(/HM-Dis-EP-WM55/)) ||
                                ((addr.endsWith(':1') || addr.endsWith(':2')) && devices[addr].PARENT_TYPE.match(/HM-Dis-WM55/))
                            ) {
                                object[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].PARENT_TYPE
                                };
                            }
                        });
                    }

                    res.status(200).send(JSON.stringify(object));
                    break;
                }

                default:
                    res.status(200).send(JSON.stringify({
                        channelNames: config.channelNames,
                        metadata: config.metadata,
                        paramsetDescriptions: config.paramsetDescriptions,
                        rooms: config.rooms,
                        functions: config.functions,
                        sysvar: config.sysvar,
                        program: config.program,
                        channelRooms: config.channelRooms,
                        channelFunctions: config.channelFunctions,
                        enabledIfaces: config.enabledIfaces
                    }));
            }
        } else {
            ccu.network.ports = [];
            const start = 2040 + Math.floor(Math.random() * 50);
            findport(start).then(() => findport(ccu.network.ports[0] + 1)).then(() => {
                res.status(200).send(JSON.stringify(ccu.network));
            });
        }
    });

    /**
     *
     * @returns {number}
     */
    function now() {
        return (new Date()).getTime();
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

        return new Promise(resolve => {
            if (/^([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])\\.([01]?\d?\d|2[0-4]\d|25[0-5])$/g.test(host)) {
                resolve(unifyLoopback(host));
            } else if (/^([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4}))*::([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4}))*|([\dA-Fa-f]{1,4})((?::[\dA-Fa-f]{1,4})){7}$/g.test(host)) {
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

            this.logger.debug('ccu-connection', config.host);

            this.checkDuplicateConfig(config);

            this.isLocal = false;
            if (config.host.startsWith('127.') || config.host === 'localhost') {
                try {
                    const rfdConf = fs.readFileSync('/etc/lighttpd/conf.d/proxy.conf').toString();
                    if (rfdConf.match(/"port"\s+=>\s+32001/)) {
                        this.logger.info('local connection on ccu >= v3.41 detected');
                        this.isLocal = true;
                    }
                } catch {}
            }

            this.ifaceTypes = {
                ReGaHSS: {
                    conf: 'rega',
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 31999 : 1999,
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    init: false,
                    ping: false
                },
                'BidCos-RF': {
                    conf: 'bcrf',
                    rpc: (this.isLocal || config.bcrfBinRpc) ? binrpc : xmlrpc,
                    port: this.isLocal ? 32001 : (config.tls ? 42001 : 2001),
                    protocol: (this.isLocal || config.bcrfBinRpc) ? 'binrpc' : 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true
                },
                'BidCos-Wired': {
                    conf: 'bcwi',
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 32000 : (config.tls ? 42000 : 2000),
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true
                },
                'HmIP-RF': {
                    conf: 'iprf',
                    rpc: xmlrpc,
                    port: this.isLocal ? 32010 : (config.tls ? 42010 : 2010),
                    protocol: 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: true, // Todo https://github.com/eq-3/occu/issues/42 - should be fixed, but isn't
                    pingTimeout: 600 // Overwrites ccu-connection config
                },
                VirtualDevices: {
                    conf: 'virt',
                    rpc: xmlrpc,
                    port: this.isLocal ? 39292 : (config.tls ? 49292 : 9292),
                    path: 'groups',
                    protocol: 'http',
                    auth: config.authentication,
                    user: config.username,
                    pass: config.password,
                    tls: config.tls,
                    inSecure: config.inSecure,
                    init: true,
                    ping: false // Todo ?
                },
                CUxD: {
                    conf: 'cuxd',
                    rpc: binrpc,
                    port: 8701,
                    protocol: 'binrpc',
                    init: true,
                    ping: true
                }
            };

            this.name = config.name;
            this.host = config.host;
            this.users = {};

            this.globalContext = this.context().global;
            this.contextStore = config.contextStore;

            if (ccu.network.listen.includes(config.rpcServerHost)) {
                this.rpcServerHost = config.rpcServerHost;
            } else {
                this.rpcServerHost = stringSimilarity.findBestMatch(config.rpcServerHost, ccu.network.listen).bestMatch.target;
                this.logger.error('Local address ' + config.rpcServerHost + ' not available. Using ' + this.rpcServerHost + ' instead.');
            }

            this.rpcInitAddress = config.rpcInitAddress || this.rpcServerHost;
            this.rpcBinPort = Number.parseInt(config.rpcBinPort, 10);
            this.rpcXmlPort = Number.parseInt(config.rpcXmlPort, 10);
            this.rpcPingTimeout = Number.parseInt(config.rpcPingTimeout, 10) || 60;
            this.rpcPingTimer = {};
            this.ifaceStatus = {};
            this.serverError = {};
            this.queueTimeout = Number.parseInt(config.queueTimeout, 10) || 5000;
            this.queuePause = Number.parseInt(config.queuePause, 10) || 0;

            this.methodCallQueue = {};

            this.regaEnabled = config.regaEnabled;
            this.regaPollEnabled = config.regaPoll;
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
            this.setValueQueue = [];

            this.lastEvent = {};
            this.rxCounters = {};
            this.txCounters = {};

            this.metadataFile = path.join(RED.settings.userDir || path.join(__dirname, '..'), 'ccu_' + this.host + '.json');
            this.regadataFile = path.join(RED.settings.userDir || path.join(__dirname, '..'), 'ccu_rega_' + this.host + '.json');
            this.valuesFile = path.join(RED.settings.userDir || path.join(__dirname, '..'), 'ccu_values_' + this.host + '.json');

            this.loadMetadata();
            this.loadRegadata();
            this.loadValues();

            this.setContext();

            this.rega = new Rega({
                host: this.host,
                port: this.isLocal ? 8183 : (config.tls ? 48181 : 8181),
                tls: config.tls,
                inSecure: config.inSecure,
                auth: config.authentication,
                user: config.username,
                pass: config.password
            });

            this.enabledIfaces = [];
            Object.keys(this.ifaceTypes).forEach(iface => {
                const enabled = config[this.ifaceTypes[iface].conf + 'Enabled'];
                if (enabled) {
                    this.enabledIfaces.push(iface);
                    this.ifaceStatus[iface] = null;
                }
            });

            if (config.regaEnabled) {
                this.getRegaData()
                    .then(() => {
                        this.regaPoll();
                        this.initIfaces(config);
                    });
            } else {
                this.initIfaces(config);
            }

            this.stats(true);

            this.on('close', this.destructor);
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
                }
            };
        }

        /**
         *
         * @param config
         */
        checkDuplicateConfig(config) {
            resolveHost(config.host).then(myAddr => {
                RED.nodes.eachNode(n => {
                    if (n.type === this.type && n.id !== this.id) {
                        resolveHost(n.host).then(addr => {
                            if (myAddr === addr) {
                                this.logger.error('ccu-connection node ' + n.name + ' (' + n.id + ') is configured to connect to the same ccu. this leads to problems - only one ccu-connection node per ccu should exist!');
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
                this.globalContext.set('ccu-' + this.host.replace(/\./g, '_'), {
                    values: this.values,
                    sysvar: this.sysvar,
                    program: this.program
                }, this.contextStore);
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
            delete node.users[node.id];
            return done();
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
                if (RED.settings.logging[firstLogger] && RED.settings.logging[firstLogger].level !== 'debug' && RED.settings.logging[firstLogger].level !== 'trace') {
                    return;
                }
            }

            this.statsInterval = setInterval(() => {
                this.logger.debug('stats rpc rx: ' + JSON.stringify(this.rxCounters) + ' tx: ' + JSON.stringify(this.txCounters));
                this.logger.debug('stats rpc subscribers ' + Object.keys(this.callbacks).length);
                this.logger.debug('stats rega subscribers ' + (Object.keys(this.programCallbacks).length + Object.keys(this.sysvarCallbacks).length));
            }, 60000);
        }

        /**
         *
         * @param iface
         * @param connected
         */
        setIfaceStatus(iface, connected) {
            if (this.ifaceStatus[iface] !== connected) {
                if (iface === 'ReGaHSS') {
                    this.logger.info('Interface', iface, connected ? 'connected' : 'disconnected');
                } else {
                    this.logger.info('Interface', iface, connected ? (this.ifaceTypes[iface].protocol + ' port ' + this.ifaceTypes[iface].port + ' connected') : 'disconnected');
                }

                this.ifaceStatus[iface] = !this.serverError[iface] && connected;
                Object.keys(this.users).forEach(id => {
                    if (typeof this.users[id].setStatus === 'function') {
                        this.users[id].setStatus({ifaceStatus: this.ifaceStatus});
                    }
                });
            }
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveMetadata() {
            return new Promise(resolve => {
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
            return new Promise(resolve => {
                fs.writeFileSync(this.regadataFile, JSON.stringify({
                    channelNames: this.channelNames,
                    regaIdChannel: this.regaIdChannel,
                    regaChannels: this.regaChannels,
                    channelRooms: this.channelRooms,
                    channelFunctions: this.channelFunctions,
                    groups: this.groups,
                    sysvar: this.sysvar,
                    program: this.program
                }));
                this.logger.info('regadata saved to', this.regadataFile);
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveValues() {
            return new Promise(resolve => {
                fs.writeFileSync(this.valuesFile, JSON.stringify({
                    values: this.values
                }));
                this.logger.info('values saved to', this.valuesFile);
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadMetadata() {
            return new Promise(resolve => {
                try {
                    this.metadata = JSON.parse(fs.readFileSync(this.metadataFile));
                    this.logger.info('metadata loaded from', this.metadataFile);
                    resolve();
                } catch {
                    this.logger.warn('metadata new empty');
                    this.metadata = {
                        devices: {},
                        types: {}
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
            return new Promise(resolve => {
                try {
                    const regadata = JSON.parse(fs.readFileSync(this.regadataFile));
                    this.logger.info('regadata loaded from', this.regadataFile);
                    this.channelNames = regadata.channelNames;
                    this.regaIdChannel = regadata.regaIdChannel;
                    this.regaChannels = regadata.regaChannels;
                    this.channelRooms = regadata.channelRooms;
                    this.channelFunctions = regadata.channelFunctions;
                    this.groups = regadata.groups;
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
                    this.logger.error('error loading regadata ' + error.message);
                    resolve();
                }
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadValues() {
            return new Promise(resolve => {
                try {
                    const {values} = JSON.parse(fs.readFileSync(this.valuesFile));
                    this.logger.info('values loaded from', this.valuesFile);

                    /* eslint-disable-next-line guard-for-in */
                    for (const datapointName in values) {
                        this.values[datapointName] = {...values[datapointName], cache: true, change: false, uncertain: true};
                    }

                    resolve();
                } catch (error) {
                    this.logger.error('error loading values ' + error.message);
                    resolve();
                }
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        saveParamsets() {
            return new Promise(resolve => {
                fs.writeFileSync(this.paramsetFile, JSON.stringify(this.paramsetDescriptions, null, '  '));
                this.logger.info('paramsets saved to', this.paramsetFile, (this.paramsetDescriptions ? Object.keys(this.paramsetDescriptions).length : 0));
                resolve();
            });
        }

        /**
         *
         * @returns {Promise<any>}
         */
        loadParamsets() {
            return new Promise(resolve => {
                const load = file => {
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
            this.stats(false);

            this.logger.debug('clear regaPollTimeout');
            this.cancelRegaPoll = true;
            clearTimeout(this.regaPollTimeout);

            Object.keys(this.rpcPingTimer).forEach(iface => {
                this.logger.debug('clear rpcPingTimer', iface);
                clearTimeout(this.rpcPingTimer[iface]);
            });

            this.saveRegadata();
            this.saveValues();

            this.rpcClose()
                .then(() => {
                    this.logger.info('rpc close done');
                    done();
                }).catch(error => {
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
            return new Promise(resolve => {
                this.logger.debug('virtualdevices get groups');
                this.rega.exec(`
                    var stdoutGroups;
                    var stderrGroups;
                    system.Exec("cat /etc/config/groups.gson", &stdoutGroups, &stderrGroups);
                `, (err, stdout, objects) => {
                    if (!err && objects && objects.stderrGroups === 'null') {
                        try {
                            const {groups} = JSON.parse(objects.stdoutGroups);
                            groups.forEach(group => {
                                this.groups[group.id] = group;
                            });
                        } catch {}
                    }

                    resolve();
                });
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
                .catch(this.logger.error);
        }

        /**
         *
         * @returns {Promise<any>}
         */
        getRegaValues() {
            return new Promise((resolve, reject) => {
                this.logger.info('rega getValues');
                this.rega.getValues((err, res) => {
                    if (err) {
                        reject(new Error('rega getValues ' + err.message));
                    } else {
                        const d = new Date();
                        res.forEach(dp => {
                            const ts = (new Date(dp.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime();
                            const [iface, channel, datapoint] = dp.name.split('.');
                            if (this.enabledIfaces.includes(iface) && datapoint) {
                                if (['RSSI_DEVICE', 'RSSI_PEER'].includes(datapoint)) {
                                    dp.value -= 256;
                                }

                                const message = this.createMessage(iface, channel, datapoint, dp.value, {cache: true, change: false, working: false, uncertain: dp.ts === '1970-01-01 01:00:00', ts, lc: ts});
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
                this.rega.getChannels((err, res) => {
                    if (err) {
                        reject(new Error('rega getChannels ' + err.message));
                    } else {
                        if (res.length > 0) {
                            this.regaChannels = [];
                            this.regaIdChannel = {};
                            this.channelNames = {};
                        }

                        res.forEach(ch => {
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
                this.rega.getRooms((err, res) => {
                    if (err) {
                        reject(new Error('rega getRooms ' + err.message));
                    } else {
                        this.rooms = [];
                        if (res.length > 0) {
                            this.channelRooms = {};
                        }

                        res.forEach(room => {
                            this.rooms.push(room.name);
                            room.channels.forEach(chId => {
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
                this.rega.getFunctions((err, res) => {
                    if (err) {
                        reject(new Error('rega getFunctions ' + err.message));
                    } else {
                        this.functions = [];
                        if (res.length > 0) {
                            this.channelFunctions = {};
                        }

                        res.forEach(func => {
                            this.functions.push(func.name);
                            func.channels.forEach(chId => {
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
                const program = this.program[name];
                if (program) {
                    const script = `dom.GetObject(${program.id}).Active(${active});`;
                    this.logger.debug('rega programActive', name, script);
                    this.rega.exec(script + '\n', err => {
                        if (err) {
                            reject(err);
                        } else {
                            Object.assign(program, {
                                active
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
                const program = this.program[name];
                if (program) {
                    const d = new Date();
                    const script = `dom.GetObject(${program.id}).ProgramExecute();`;
                    this.logger.debug('rega programExecute', name, script);
                    this.rega.exec(script + `\nvar lastExecTime = dom.GetObject(${program.id}).ProgramLastExecuteTime();\n`, (err, res, objects) => {
                        if (err) {
                            reject(err);
                        } else {
                            program.ts = (new Date(objects.lastExecTime + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime();
                            resolve(program);
                        }
                    });
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
                    switch (sysvar.valueType) {
                        case 'boolean':
                            if (typeof value === 'string') {
                                if (sysvar.enum.includes(value)) {
                                    value = sysvar.enum.indexOf(value);
                                }
                            }

                            value = Boolean(value);
                            break;
                        case 'string':
                            value = '"' + value + '"';
                            break;
                        default:
                            if (typeof value === 'string') {
                                if (sysvar.enum.includes(value)) {
                                    value = sysvar.enum.indexOf(value);
                                }
                            }

                            value = Number.parseFloat(value) || 0;
                            break;
                    }

                    const script = `dom.GetObject(${sysvar.id}).State(${value});`;
                    this.logger.debug('setVariable', name, script);
                    this.rega.exec(script + '\n', err => {
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
            if (this.regaPollPending) {
                this.logger.warn('rega poll already pending');
            } else {
                this.regaPollPending = true;
                clearTimeout(this.regaPollTimeout);
                this.getRegaVariables()
                    .catch(error => this.logger.error('getRegaVariables', error))
                    .then(() => this.getRegaPrograms())
                    .catch(error => this.logger.error('getRegaPrograms', error))
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
                    });
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
                    cache: isNew
                };
                if (sysvar.channel) {
                    const channel = this.regaIdChannel[sysvar.channel];
                    const iface = this.findIface(channel);
                    const device = this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].PARENT;
                    Object.assign(this.sysvar[sysvar.name], {
                        device,
                        deviceName: this.channelNames[device],
                        deviceType: this.metadata.devices[iface] && this.metadata.devices[iface][device] && this.metadata.devices[iface][device].TYPE,
                        channel,
                        channelName: this.channelNames[channel],
                        channelType: this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].TYPE,
                        channelIndex: channel && Number.parseInt(channel.split(':')[1], 10),
                        rooms: this.channelRooms[channel],
                        room: this.channelRooms[channel] && this.channelRooms[channel].length === 1 ? this.channelRooms[channel][0] : undefined,
                        functions: this.channelFunctions[channel],
                        function: this.channelFunctions[channel] && this.channelFunctions[channel].length === 1 ? this.channelFunctions[channel][0] : undefined
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
                    lc: this.sysvar[sysvar.name].value !== sysvar.val && !isNew ? sysvar.ts : this.sysvar[sysvar.name].lc,
                    lcPrevious: this.sysvar[sysvar.name].lc,
                    change: isNew ? false : this.sysvar[sysvar.name].value !== sysvar.val,
                    cache: isNew
                });

                Object.keys(this.sysvarCallbacks).forEach(key => {
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
        getRegaVariables() {
            return new Promise((resolve, reject) => {
                this.logger.debug('getRegaVariables');
                this.rega.getVariables((err, res) => {
                    if (err) {
                        reject(err);
                        this.hadTimeout.add('ReGaHSS');
                        this.setIfaceStatus('ReGaHSS', false);
                    } else {
                        const d = new Date();
                        res.forEach(sysvar => {
                            //this.logger.trace(JSON.stringify(sysvar));
                            sysvar.ts = sysvar.ts ? (new Date(sysvar.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime() : d.getTime();
                            this.updateRegaVariable(sysvar);
                        });
                        if (!this.hasRegaVariables) {
                            this.hasRegaVariables = true;
                            Object.keys(this.setVariableQueueTimeout).forEach(name => clearTimeout(this.setVariableQueueTimeout[name]));
                            Object.keys(this.setVariableQueue).reduce((p, name) =>
                                p.then(_ => this.setVariable(name, this.setVariableQueue[name])),
                            Promise.resolve()
                            );
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
                this.rega.getPrograms((err, res) => {
                    if (err) {
                        reject(err);
                        this.hadTimeout.add('ReGaHSS');
                        this.setIfaceStatus('ReGaHSS', false);
                    } else if (res && Array.isArray(res)) {
                        const d = new Date();
                        res.forEach(prg => {
                            prg.type = 'PROGRAM';
                            prg.ts = (new Date(prg.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime();
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
                                    tsPrevious: this.program[prg.name].ts
                                };
                                Object.keys(this.programCallbacks).forEach(key => {
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
            Object.keys(this.ifaceTypes).forEach(iface => {
                const enabled = config[this.ifaceTypes[iface].conf + 'Enabled'];
                this.ifaceTypes[iface].enabled = enabled;
                if (enabled) {
                    this.createClient(iface)
                        .then(() => {
                            if (this.ifaceTypes[iface].init) {
                                return this.rpcInit(iface).then(() => {
                                    this.setIfaceStatus(iface, true);
                                }).catch(error => {
                                    this.logger.error('init', iface, error);
                                    this.hadTimeout.add(iface);
                                    this.setIfaceStatus(iface, false);
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
        createClient(iface) {
            return new Promise(resolve => {
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

                this.logger.debug('rpc client created', iface, JSON.stringify(clientOptions));
                if (this.methodCallQueue[iface]) {
                    this.methodCallQueue[iface].forEach(c => {
                        this.methodCall(iface, c[0], c[1])
                            .then(c[2])
                            .catch(c[3]);
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
        rpcInit(iface) {
            return new Promise((resolve, reject) => {
                const initUrl = this.rpcServer(iface);
                const hash = base62(crypto.createHash('sha1').update(initUrl).digest()).slice(0, 6);
                const initId = 'nr_' + hash + '_' + iface;
                this.lastEvent[iface] = now();

                this.logger.info('init ' + iface + ' ' + initUrl + ' ' + initId);
                this.methodCall(iface, 'init', [initUrl, initId])
                    .then(() => {
                        if (iface === 'CUxD') {
                            this.getDevices(iface).then(() => resolve(iface)).catch(() => resolve(iface));
                        } else if (['BidCos-RF', 'BidCos-Wired', 'HmIP-RF'].includes(iface)) {
                            this.methodCall(iface, 'getLinks', []).then(res => {
                                this.links[iface] = res;
                                resolve(iface);
                            }).catch(() => resolve(iface));
                        } else {
                            resolve(iface);
                        }
                    }).catch(error => reject(error)).finally(() => {
                        if (this.ifaceTypes[iface].ping) {
                            this.rpcCheckInit(iface);
                        }
                    });
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
                this.links[iface].forEach(link => {
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
                this.methodCall(iface, 'listDevices', []).then(devices => {
                    if (!this.metadata.devices[iface]) {
                        this.metadata.devices[iface] = {};
                    }

                    const knownDevices = [];
                    let change = false;
                    devices.forEach(device => {
                        knownDevices.push(device.ADDRESS);
                        if (!this.metadata.devices[iface][device.ADDRESS]) {
                            this.newDevice(iface, device);
                            change = true;
                        }
                    });

                    Object.keys(this.metadata.devices[iface]).forEach(addr => {
                        if (!knownDevices.includes(addr)) {
                            this.deleteDevice(iface, addr);
                            change = true;
                        }
                    });

                    if (change) {
                        this.saveMetadata();
                    }

                    resolve();
                }).catch(reject);
            });
        }

        /**
         *
         * @param iface
         */
        rpcCheckInit(iface) {
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
                this.rpcInit(iface).catch(error => this.logger.error(error.message));
                return;
            }

            if (elapsed >= (pingTimeout / 2)) {
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
            Object.keys(this.clients).forEach(iface => {
                if (this.ifaceTypes[iface].init) {
                    this.logger.debug('queue de-init ' + iface + ' ' + this.initUrl(iface));
                    calls.push(() => {
                        return new Promise(resolve => {
                            this.logger.debug('de-init ' + iface + ' ' + this.initUrl(iface));
                            this.methodCall(iface, 'init', [this.initUrl(iface), ''])
                                .then(() => {
                                    this.logger.info('de-init ' + iface + ' ' + this.initUrl(iface) + ' done');
                                    resolve();
                                })
                                .catch(error => {
                                    this.logger.error('de-init ' + iface + ' ' + this.initUrl(iface) + ' failed ' + error);
                                    resolve();
                                });
                        });
                    });
                }
            });

            this.logger.debug('queue binrpc server closing');
            calls.push(() => {
                return new Promise(resolve => {
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
                return new Promise(resolve => {
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
            const port = (protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort);
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
            const port = (protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort);
            if (!this.servers[protocol]) {
                this.servers[protocol] = rpc.createServer({host: this.rpcServerHost, port}, () => {
                    // Todo homematic-xmlrpc and binrpc module: clarify onListening callback params
                    this.logger.info(protocol === 'binrpc' ? 'binrpc' : 'xmlrpc', 'server listening on', url);
                    this.serverError[iface] = null;
                });

                // Todo homematic-xmlrpc and binrpc module: emit error event on server object to eliminate access to httpServer/server
                this.servers[protocol][protocol === 'binrpc' ? 'server' : 'httpServer'].on('error', err => {
                    this.logger.error('binrpc ' + err.message);
                    this.serverError[iface] = err.message;
                });

                Object.keys(this.rpcMethods).forEach(method => {
                    this.servers[protocol].on(method, (err, parameters, callback) => {
                        if (err) {
                            this.logger.error('rpc <', protocol, method, err);
                        }

                        this.logger.debug('rpc <', protocol, method, JSON.stringify(parameters));
                        if (method === 'event') {
                            method = 'eventSingle';
                        }

                        if (isIterable(parameters)) {
                            this.rpcMethods[method](err, parameters, callback);
                        } else {
                            this.logger.error('rpc <', protocol, 'method', method, 'params not iterable', JSON.stringify(parameters));
                            callback(null, '');
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
                paramset
            });
        }

        paramsQueueShift() {
            const item = this.paramsQueue.shift();
            if (item) {
                const {iface, address, paramset} = item;
                this.methodCall(iface, 'getParamset', [address, paramset])
                    .then(res => {
                        this.params[paramset][address] = res;
                    })
                    .catch(error => this.logger.error(error))
                    .then(() => {
                        clearTimeout(this.getParamsTimeout);
                        this.getParamsTimeout = setTimeout(() => {
                            this.paramsQueueShift();
                        }, 200);
                    }).catch(() => {});
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
                device.PARAMSETS.forEach(paramset => {
                    const name = this.paramsetName(iface, device, paramset);
                    if (!this.paramsetDescriptions[name]) {
                        this.paramsetQueue.push({
                            iface,
                            name,
                            address: device.ADDRESS,
                            paramset
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
                        .then(res => {
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
                        .catch(error => this.logger.error(error))
                        .then(() => {
                            this.paramsetPending = false;
                            clearTimeout(this.getParamsetTimeout);
                            this.getParamsetTimeout = setTimeout(() => {
                                this.paramsetQueueShift();
                            }, 200);
                        }).catch(() => {});
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

            if (this.metadata.types[iface][device.TYPE] && !this.metadata.types[iface][device.TYPE].includes(device.ADDRESS)) {
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
                Object.keys(this.metadata.devices[iface]).forEach(addr => {
                    const dev = this.metadata.devices[iface][addr];
                    if (dev.TYPE === 'HmIP-RCV-50' || dev.PARENT_TYPE === 'HmIP-RCV-50') {
                        // Würgaround for Firmware 3.43.15
                        return;
                    }

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
                case 'VirtualDevices':
                    const d = { // eslint-disable-line no-case-declarations
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
                        TYPE: device.TYPE
                    };
                    Object.keys(d).forEach(k => {
                        if (typeof d[k] === 'undefined') {
                            delete d[k];
                        }

                        if (d[k] === '') {
                            // Würgaround https://github.com/eq-3/occu/issues/83
                            delete d[k];
                        }
                    });

                    return d;
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
            if (idInit === 'CUxD') {
                return idInit;
            }

            const match = idInit.match(/^nr_[\da-zA-Z]{6}_([a-zA-Z-]+)$/);
            return match && match[1];
        }

        get rpcMethods() {
            return {
                'system.listMethods': (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.lastEvent[iface] = now();
                    this.setIfaceStatus(iface, true);
                    const res = Object.keys(this.rpcMethods);
                    this.logger.debug('    >', iface, 'system.listMethods', JSON.stringify(res));
                    callback(null, res);
                },
                setReadyConfig: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'setReadyConfig ""');
                    callback(null, '');
                },
                updateDevice: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'updateDevice ""');
                    callback(null, '');
                },
                replaceDevice: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'replaceDevice ""');
                    callback(null, '');
                },
                readdedDevice: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'readdedDevice ""');
                    callback(null, '');
                },
                newDevices: (_, parameters, callback) => {
                    const [idInit, devices] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);

                    devices.forEach(device => {
                        this.newDevice(iface, device);
                    });

                    this.logger.debug('    >', iface, 'newDevices ""');
                    callback(null, '');

                    this.saveMetadata();
                },
                deleteDevices: (_, parameters, callback) => {
                    const [idInit, devices] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);

                    devices.forEach(device => {
                        this.deleteDevice(iface, device);
                    });

                    this.logger.debug('    >', iface, 'deleteDevices ""');
                    callback(null, '');

                    this.saveMetadata();
                },
                listDevices: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.lastEvent[iface] = now();
                    this.setIfaceStatus(iface, true);
                    const res = this.listDevices(iface) || [];
                    this.logger.debug('    >', iface, 'listDevices', JSON.stringify(res));
                    callback(null, res);
                },
                event: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(parameters);
                    callback(null, '');
                },
                eventSingle: (_, parameters, callback) => {
                    const [idInit] = parameters;
                    const iface = this.getIfaceFromIdInit(idInit);
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(parameters);

                    if (parameters[2] !== 'PONG') {
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
                        parameters[0].forEach(call => {
                            if (call && call.methodName === 'event') {
                                queue.push(call);
                                if (isIterable(call.params)) {
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

                                    iface = this.getIfaceFromIdInit(idInit);
                                }

                                result.push('');
                            } else if (call && this.rpcMethods[call.methodName]) {
                                pong = false;
                                if (isIterable(call.params)) {
                                    this.rpcMethods[call.methodName](call.methodName, call.params, (_, res) => result.push(res));
                                } else {
                                    this.logger.error('rpc <', call.methodName, 'params not iterable', JSON.stringify(call.params));
                                }
                            }
                        });
                        queue.forEach(call => {
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
                }
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
                'functions'
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
                Object.keys(this.values).forEach(dp => {
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

                Object.keys(this.callbackBlacklists).forEach(dp => {
                    this.callbackBlacklists[dp].delete(id);
                });

                Object.keys(this.callbackWhitelists).forEach(dp => {
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
            if (!topic || typeof message !== 'object') {
                return topic;
            }

            const messageLower = {};
            Object.keys(message).forEach(k => {
                messageLower[k.toLowerCase()] = message[k];
            });

            const match = topic.match(/\${[^}]+}/g);
            if (match) {
                match.forEach(v => {
                    const key = v.substr(2, v.length - 3);
                    const rx = new RegExp('\\${' + key + '}', 'g');
                    let rkey = key.toLowerCase();
                    if (rkey === 'interface') {
                        rkey = 'iface';
                    }

                    topic = topic.replace(rx, typeof messageLower[rkey] === 'undefined' ? '' : messageLower[rkey]);
                });
            }

            return topic;
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
            const datapointName = iface + '.' + channel + '.' + datapoint;
            if (!this.values[datapointName]) {
                this.values[datapointName] = {};
            }

            const device = this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].PARENT;
            const ts = now();
            let change = false;

            const valueStable = (additions && additions.working) ? this.values[datapointName].valueStable : payload;

            let description = {};
            if (this.metadata.devices[iface] && this.metadata.devices[iface][channel]) {
                description = this.getParamsetDescription(iface, this.metadata.devices[iface][channel], 'VALUES', datapoint) || {};
            }

            if (
                description.TYPE === 'ACTION' ||
                this.values[datapointName].cache ||
                this.values[datapointName].payload !== payload ||
                this.values[datapointName].valueStable !== valueStable
            ) {
                change = true;
            }

            this.logger.trace('createMessage', channel, datapoint, payload, 'change=' + change);

            const message = {topic: '',
                payload,
                ccu: this.host,
                iface,
                device,
                deviceName: this.channelNames[device],
                deviceType: this.metadata.devices[iface] && this.metadata.devices[iface][device] && this.metadata.devices[iface][device].TYPE,
                channel,
                channelName: this.channelNames[channel],
                channelType: this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].TYPE,
                channelIndex: channel && Number.parseInt(channel.split(':')[1], 10),
                datapoint,
                datapointName,
                datapointType: description.TYPE,
                datapointMin: description.MIN,
                datapointMax: description.MAX,
                datapointEnum: description.ENUM,
                datapointDefault: description.DEFAULT,
                datapointControl: description.CONTROL,
                value: payload,
                valuePrevious: this.values[datapointName].value,
                valueEnum: description.ENUM ? description.ENUM[Number(payload)] : undefined,
                valueStable,
                rooms: this.channelRooms[channel] || [],
                room: this.channelRooms[channel] && this.channelRooms[channel].length > 0 ? this.channelRooms[channel][0] : undefined,
                functions: this.channelFunctions[channel] || [],
                function: this.channelFunctions[channel] && this.channelFunctions[channel].length > 0 ? this.channelFunctions[channel][0] : undefined,
                ts,
                tsPrevious: this.values[datapointName].ts,
                lc: change ? ts : this.values[datapointName].lc,
                change, ...additions};

            message.stable = !message.working;

            return message;
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

            this.lastEvent[iface] = now();
            if (this.hadTimeout.has(iface)) {
                this.setIfaceStatus(iface, true);
            }

            if (channel.includes('CENTRAL') && datapoint === 'PONG') {
                this.logger.debug('    < ' + iface + ' PONG ' + payload);
                return;
            }

            //this.logger.trace('publishEvent', JSON.stringify(params));

            const message = this.createMessage(iface, channel, datapoint, payload, {cache: false, uncertain: false, working, direction});

            let waitForWorking = false;

            if (message.channelType && !working) {
                if (message.datapoint === 'STATE' && message.channelType.match(/SIGNAL|SWITCH|RAINDETECTOR_HEAT|ALARMACTUATOR/)) {
                    waitForWorking = true;
                } else if (message.datapoint === 'ARMSTATE' && message.channelType === 'ARMING') {
                    waitForWorking = true;
                } else if (message.datapoint.startsWith('LEVEL') && message.channelType.match(/DIMMER|DUAL_WHITE|BLIND|SHUTTER|JALOUSIE|WINMATIC|KEYMATIC/)) {
                    waitForWorking = true;
                }
            }

            if (waitForWorking) {
                clearTimeout(this.workingTimeout[message.datapointName]);
                this.workingTimeout[message.datapointName] = setTimeout(() => {
                    const datapointNamePrefix = iface + '.' + channel + '.';

                    if (this.values[datapointNamePrefix + 'WORKING'] || this.values[datapointNamePrefix + 'WORKING_SLATS']) {
                        message.working = this.values[datapointNamePrefix + 'WORKING'] && this.values[datapointNamePrefix + 'WORKING'].value;
                        message.working = message.working || (this.values[datapointNamePrefix + 'WORKING_SLATS'] && this.values[datapointNamePrefix + 'WORKING_SLATS'].value);
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

            if (filter) {
                const arrayAttr = Object.keys(filter);

                for (let i = 0, {length} = arrayAttr; match && (i < length); i++) {
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
                        if ((filter.change && !message.change) && !(filter.cache && message.cache)) {
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

                    if (this.callbackWhitelists[message.datapointName].has(id)) {
                        if (matchCache && matchChange && matchStable) {
                            break;
                        }

                        continue;
                    }

                    if (filter[attr] === '') { // TODO rethink
                        continue;
                    }

                    if (attr === 'channelIndex' && typeof filter[attr] !== 'undefined') {
                        filter[attr] = Number.parseInt(filter[attr], 10);
                    }

                    if (Array.isArray(message[attr])) {
                        if (filter[attr] instanceof RegExp) {
                            match = false;
                            this.logger.trace('cb test regex array', id, attr, filter[attr], message[attr]);
                            message[attr].forEach(item => {
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
                        this.logger.trace('cb mismatch misc ' + id + ' ' + attr + ' ' + filter[attr] + ' ' + message[attr]);
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

            Object.keys(this.callbacks).forEach(key => {
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
        methodCall(iface, method, parameters) {
            return new Promise((resolve, reject) => {
                if (this.clients[iface]) {
                    this.logger.debug('rpc >', iface, method, JSON.stringify(parameters));
                    this.clients[iface].methodCall(method, parameters, (err, res) => {
                        if (err) {
                            this.logger.error('    <', iface, method, err);
                            delete this.clients[iface];
                            this.createClient(iface);
                            reject(err);
                        } else if (res && res.faultCode) {
                            this.logger.error('    <', iface, method, JSON.stringify(res));
                            reject(new Error(res.faultString));
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
                    reject(new Error('unknown interface ' + iface + ' ' + Object.keys(this.clients) + ' ' + Object.keys(this.ifaceTypes)));
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
                this.setValueQueue = this.setValueQueue.filter(element => {
                    return element.iface !== iface || element.address !== address || element.datapoint !== datapoint;
                });
                const datapointName = iface + '.' + address + '.' + datapoint;
                const currentValue = this.values[datapointName] && this.values[datapointName].value;
                const cache = this.values[datapointName] && this.values[datapointName].cache;
                if (force || (value !== currentValue) || cache || datapoint.startsWith('PRESS_')) {
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
                .catch(error => {
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

                    this.methodCall(iface, 'setValue', parameters).then(resolve).catch(error => {
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
                return this.methodCall(iface, 'setValue', params).then(resolve).catch(error => {
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
            const paramset = this.paramsetDescriptions[psKey] && this.paramsetDescriptions[psKey][datapoint];
            if (paramset) {
                switch (paramset.TYPE) {
                    case 'ACTION':
                    // Fallthrough by intention
                    case 'BOOL':
                        if (value === 'false') {
                            value = false;
                        } else if (!isNaN(value)) { // Make sure that the string "0" gets casted to boolean false
                            value = Number(value);
                        }

                        value = Boolean(value);
                        break;
                    case 'FLOAT':
                        value = Number.parseFloat(value) || 0;
                        /* Todo: rethink, deactivate boundary check for now (https://github.com/rdmtc/node-red-contrib-ccu/issues/74)
                        if (typeof paramset.MIN !== 'undefined' && value < paramset.MIN) {
                            value = paramset.MIN;
                        } else if (typeof paramset.MAX !== 'undefined' && value > paramset.MAX) {
                            value = paramset.MAX;
                        }
                        */
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
                        if (typeof value === 'boolean') {
                            value = Number(value);
                        } else {
                            value = Number.parseInt(value, 10) || 0;
                        }
                        /* Todo: rethink, deactivate boundary check for now (https://github.com/rdmtc/node-red-contrib-ccu/issues/74)
                        if (typeof paramset.MIN !== 'undefined' && value < paramset.MIN) {
                            value = paramset.MIN;
                        } else if (typeof paramset.MAX !== 'undefined' && value > paramset.MAX) {
                            value = paramset.MAX;
                        }
                        */

                        break;
                    case 'STRING':
                        value = String(value);
                        break;
                    default:
                }
            } else {
                this.logger.warn('unknown paramsetDescription ', psKey, datapoint);
                // Fallback: use string for numbers, this should work for double and integer datapoints
                if (typeof value === 'number') {
                    value = String(value);
                }
            }

            return value;
        }

        /**
         * Execute a ReGaHss script
         * @param script
         * @returns {Promise<any>}
         */
        script(script) {
            return new Promise((resolve, reject) => {
                this.rega.exec(script, (err, payload, objects) => {
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

    });
};
