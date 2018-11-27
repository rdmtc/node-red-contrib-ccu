const os = require('os');
const path = require('path');
const fs = require('fs');

const stringSimilarity = require('string-similarity');
const nextport = require('nextport');
const hmDiscover = require('hm-discover');
const Rega = require('homematic-rega');
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const pkg = require(path.join(__dirname, '..', 'package.json'));

// https://stackoverflow.com/a/37837872
function isIterable(obj) {
    // eslint-disable-next-line eqeqeq, no-eq-null
    return obj != null && typeof obj[Symbol.iterator] === 'function';
}

module.exports = function (RED) {
    RED.log.info('node-red-contrib-ccu version: ' + pkg.version);

    const ccu = {network: {listen: [], ports: []}};

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

    RED.httpAdmin.get('/ccu', (req, res) => {
        if (req.query.config && req.query.config !== '_ADD_') {
            const config = RED.nodes.getNode(req.query.config);
            if (!config) {
                res.status(500).send(JSON.stringify({}));
                return;
            }
            const obj = {};

            switch (req.query.type) {
                case 'ifaces': {
                    Object.keys(config.ifaceTypes).forEach(iface => {
                        obj[iface] = {
                            enabled: Boolean(config.ifaceTypes[iface].enabled),
                            connected: Boolean(config.ifaceStatus[iface])
                        };
                    });
                    res.status(200).send(JSON.stringify(obj));
                    break;
                }
                case 'channels': {
                    const devices = config.metadata.devices[req.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach(addr => {
                            if (addr.match(/:\d+$/)) {
                                const psKey = config.paramsetName(req.query.iface, devices[addr], 'VALUES');
                                if (config.paramsetDescriptions[psKey]) {
                                    obj[addr] = {
                                        name: config.channelNames[addr],
                                        datapoints: Object.keys(config.paramsetDescriptions[psKey])
                                    };
                                }
                            }
                        });
                    }
                    res.status(200).send(JSON.stringify(obj));
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
                    const devices = config.metadata.devices[req.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach(addr => {
                            if (['SIGNAL_CHIME', 'SIGNAL_LED'].includes(devices[addr].TYPE)) {
                                obj[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].TYPE
                                };
                            }
                        });
                    }
                    res.status(200).send(JSON.stringify(obj));
                    break;
                }

                case 'display': {
                    const devices = config.metadata.devices[req.query.iface];
                    if (devices) {
                        Object.keys(devices).forEach(addr => {
                            if (
                                (addr.endsWith(':3') && devices[addr].PARENT_TYPE.match(/HM-Dis-EP-WM55/)) ||
                                ((addr.endsWith(':1') || addr.endsWith(':2')) && devices[addr].PARENT_TYPE.match(/HM-Dis-WM55/))
                            ) {
                                obj[addr] = {
                                    name: config.channelNames[addr],
                                    type: devices[addr].PARENT_TYPE
                                };
                            }
                        });
                    }
                    res.status(200).send(JSON.stringify(obj));
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
                        channelFunctions: config.channelFunctions
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

    function now() {
        return (new Date()).getTime();
    }

    class CcuConnectionNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.logger.debug('ccu-connection', config.host);

            this.isLocal = false;
            if (config.host === '127.0.0.1' || config.host === 'localhost') {
                try {
                    const rfdConf = fs.readFileSync('/etc/lighttpd/conf.d/proxy.conf').toString();
                    if (rfdConf.match(/"port"\s+=>\s+32001/)) {
                        this.logger.info('local connection on ccu >= v3.41 detected');
                        this.isLocal = true;
                    }
                } catch (error) {}
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
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 32001 : 2001,
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    init: true,
                    ping: true
                },
                'BidCos-Wired': {
                    conf: 'bcwi',
                    rpc: this.isLocal ? binrpc : xmlrpc,
                    port: this.isLocal ? 32000 : 2000,
                    protocol: this.isLocal ? 'binrpc' : 'http',
                    init: true,
                    ping: true
                },
                'HmIP-RF': {
                    conf: 'iprf',
                    rpc: xmlrpc,
                    port: this.isLocal ? 32010 : 2010,
                    protocol: 'http',
                    init: true,
                    ping: true, // Todo https://github.com/eq-3/occu/issues/42 - should be fixed, but isn't
                    pingTimeout: 600 // Overwrites ccu-connection config
                },
                VirtualDevices: {
                    conf: 'virt',
                    rpc: xmlrpc,
                    port: this.isLocal ? 39292 : 9292,
                    path: '/groups',
                    protocol: 'http',
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
            this.rpcBinPort = parseInt(config.rpcBinPort, 10);
            this.rpcXmlPort = parseInt(config.rpcXmlPort, 10);
            this.rpcPingTimeout = parseInt(config.rpcPingTimeout, 10) || 60;
            this.rpcPingTimer = {};
            this.ifaceStatus = {};

            this.methodCallQueue = {};

            this.regaEnabled = config.regaEnabled;
            this.regaPollEnabled = config.regaPoll;
            this.regaInterval = parseInt(config.regaInterval, 10);

            this.enabledIfaces = [];

            this.clients = {};
            this.servers = {};

            this.newParamsetDescriptionCount = 0;
            this.paramsetQueue = [];
            this.paramsetFile = path.join(RED.settings.userDir, 'ccu_paramsets_v2.json');
            this.loadParamsets();

            this.callbacks = {};
            this.idCallback = 0;

            this.sysvarCallbacks = {};
            this.idSysvarCallback = 0;

            this.programCallbacks = {};
            this.idProgramCallback = 0;

            this.channelNames = {};
            this.regaIdChannel = {};
            this.regaChannels = [];
            this.channelRooms = {};
            this.channelFunctions = {};

            this.sysvar = {};
            this.program = {};

            this.values = {};
            this.links = {};

            this.workingTimeout = {};

            this.setValueThrottle = 500;
            this.setValueTimers = {};
            this.setValueCache = {};

            this.lastEvent = {};
            this.rxCounters = {};
            this.txCounters = {};

            this.metadataFile = path.join(RED.settings.userDir, 'ccu_' + this.host + '.json');
            this.loadMetadata();

            this.setContext();

            this.rega = new Rega({
                host: this.host,
                port: this.isLocal ? 8183 : 8181
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

            this.on('close', this.destructor);
        }

        get logger() {
            return {
                trace: (...args) => {
                    this.trace(args.join(' ').substr(0, 300));
                },
                debug: (...args) => {
                    this.debug(args.join(' ').substr(0, 300));
                },
                info: (...args) => {
                    this.log(args.join(' ').substr(0, 300));
                },
                warn: (...args) => {
                    this.warn(args.join(' ').substr(0, 300));
                },
                error: (...args) => {
                    this.error(args.join(' ').substr(0, 300));
                }
            };
        }

        setContext() {
            if (this.contextStore) {
                this.globalContext.set('ccu-' + this.host, {
                    values: this.values,
                    sysvar: this.sysvar,
                    program: this.program
                }, this.contextStore);
            }
        }

        register(node) {
            this.users[node.id] = node;
        }

        deregister(node, done) {
            delete node.users[node.id];
            return done();
        }

        setIfaceStatus(iface, connected) {
            if (this.ifaceStatus[iface] !== connected) {
                if (typeof this.ifaceStatus[iface] !== 'undefined') {
                    this.logger.info(iface, connected ? (this.ifaceTypes[iface].protocol + ' port ' + this.ifaceTypes[iface].port + ' connected') : 'disconnected');
                }
                this.ifaceStatus[iface] = connected;
                Object.keys(this.users).forEach(id => {
                    if (typeof this.users[id].setStatus === 'function') {
                        this.users[id].setStatus({ifaceStatus: this.ifaceStatus});
                    }
                });
            }
        }

        saveMetadata() {
            return new Promise(resolve => {
                fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata));
                this.logger.info('metadata saved to', this.metadataFile);
                resolve();
            });
        }

        loadMetadata() {
            return new Promise(resolve => {
                try {
                    this.metadata = JSON.parse(fs.readFileSync(this.metadataFile));
                    this.logger.info('metadata loaded from', this.metadataFile);
                    resolve();
                } catch (err) {
                    this.logger.info('metadata new empty');
                    this.metadata = {
                        devices: {},
                        types: {}
                    };
                    resolve();
                }
            });
        }

        saveParamsets() {
            return new Promise(resolve => {
                fs.writeFileSync(this.paramsetFile, JSON.stringify(this.paramsetDescriptions, null, '  '));
                this.logger.info('paramsets saved to', this.paramsetFile, (this.paramsetDescriptions ? Object.keys(this.paramsetDescriptions).length : 0));
                resolve();
            });
        }

        loadParamsets() {
            return new Promise(resolve => {
                const load = file => {
                    try {
                        this.paramsetDescriptions = JSON.parse(fs.readFileSync(file));
                        this.logger.info('paramsets loaded from', file);
                    } catch (err) {
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

        destructor(done) {
            this.logger.debug('ccu-connection destructor');

            this.logger.debug('clear regaPollTimeout');
            this.cancelRegaPoll = true;
            clearTimeout(this.regaPollTimeout);

            Object.keys(this.rpcPingTimer).forEach(iface => {
                this.logger.debug('clear rpcPingTimer', iface);
                clearTimeout(this.rpcPingTimer[iface]);
            });

            this.rpcClose()
                .then(() => {
                    this.logger.debug('rpc close done');
                    done();
                }).catch(err => {
                    this.logger.error(err);
                    done();
                });

            this.setContext();
        }

        getEntry(data, key, val) {
            if (!data) {
                return {};
            }
            for (let i = 0; i < data.length; i++) {
                if (data[i][key] === val) {
                    return data[i];
                }
            }
        }

        getRegaData() {
            return this.getRegaChannels()
                .then(() => this.getRegaRooms())
                .then(() => this.getRegaFunctions())
                .then(() => this.getRegaValues())
                .catch(this.logger.error);
        }

        getRegaValues() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getValues');
                this.rega.getValues((err, res) => {
                    if (err) {
                        reject(err);
                    } else {
                        const d = new Date();
                        res.forEach(dp => {
                            const ts = (new Date(dp.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime();
                            const [iface, channel, datapoint] = dp.name.split('.');
                            if (datapoint && !datapoint.startsWith('PRESS_')) {
                                const msg = this.createMessage(iface, channel, datapoint, dp.value, {cache: true, ts, lc: ts});
                                this.callCallbacks(msg);
                            }
                        });
                        this.cachedValuesReceived = true;
                        resolve();
                    }
                });
            });
        }

        getRegaChannels() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getChannels');
                this.rega.getChannels((err, res) => {
                    if (err) {
                        reject(err);
                    } else {
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

        getRegaRooms() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getRooms');
                this.rega.getRooms((err, res) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.rooms = [];
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

        getRegaFunctions() {
            return new Promise((resolve, reject) => {
                this.logger.debug('rega getFunctions');
                this.rega.getFunctions((err, res) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.functions = [];
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
                const sysvar = this.sysvar[name];
                if (sysvar) {
                    switch (sysvar.valueType) {
                        case 'boolean':
                            if (typeof value === 'string') {
                                if (sysvar.enum.indexOf(value) !== -1) {
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
                                if (sysvar.enum.indexOf(value) !== -1) {
                                    value = sysvar.enum.indexOf(value);
                                }
                            }
                            value = parseFloat(value) || 0;
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
            this.logger.trace('regaPoll');
            if (this.regaPollPending) {
                this.logger.warn('rega poll already pending');
            } else {
                this.regaPollPending = true;
                clearTimeout(this.regaPollTimeout);
                this.getRegaVariables()
                    .catch(err => this.logger.error('getRegaVariables', err))
                    .then(() => this.getRegaPrograms())
                    .catch(err => this.logger.error('getRegaPrograms', err))
                    .then(() => {
                        if (this.regaInterval && this.regaPollEnabled && !this.cancelRegaPoll) {
                            this.logger.trace('rega next poll in', this.regaInterval, 'seconds');
                            this.regaPollTimeout = setTimeout(() => {
                                this.regaPoll();
                            }, this.regaInterval * 1000);
                        }
                        this.regaPollPending = false;
                    });
            }
        }

        findIface(channel) {
            let found;
            Object.keys(this.metadata.devices).forEach(iface => {
                if (!found) {
                    if (this.metadata.devices[iface][channel]) {
                        found = iface;
                    }
                }
            });
            return found;
        }

        findChannel(name) {
            let found;
            Object.keys(this.channelNames).forEach(n => {
                if (!found) {
                    if (this.channelNames[n] === name) {
                        found = n;
                    }
                }
            });
            return found;
        }

        updateRegaVariable(sysvar) {
            this.logger.trace('updateRegaVariable', JSON.stringify(sysvar));
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
                    value: sysvar.value,
                    valueType: sysvar.type,
                    valueEnum: sysvar.enum[Number(sysvar.val)],
                    unit: sysvar.unit,
                    ts: sysvar.ts,
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
                        channelIndex: channel && parseInt(channel.split(':')[1], 10),
                        rooms: this.channelRooms[channel],
                        room: this.channelRooms[channel] && this.channelRooms[channel].length === 1 ? this.channelRooms[channel][0] : undefined,
                        functions: this.channelFunctions[channel],
                        function: this.channelFunctions[channel] && this.channelFunctions[channel].length === 1 ? this.channelFunctions[channel][0] : undefined
                    });
                }
            }
            if (isNew || this.sysvar[sysvar.name].ts !== sysvar.ts) {
                Object.assign(this.sysvar[sysvar.name], {
                    payload: sysvar.val,
                    value: sysvar.val,
                    valueEnum: this.sysvar[sysvar.name].enum[Number(sysvar.val)],
                    valuePrevious: this.sysvar[sysvar.name].value,
                    valueEnumPrevious: this.sysvar[sysvar.name].valueEnum,
                    ts: sysvar.ts,
                    tsPrevious: this.sysvar[sysvar.name].ts,
                    lc: sysvar.ts,
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
                    this.logger.trace('match', match, JSON.stringify(filter), 'name:' + sysvar.name + ' cache:' + this.sysvar[sysvar.name].cache + ' change:' + this.sysvar[sysvar.name].change);
                    if (match) {
                        callback(this.sysvar[sysvar.name]);
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
                        this.setIfaceStatus('ReGaHSS', false);
                    } else {
                        const d = new Date();
                        res.forEach(sysvar => {
                            this.logger.trace(JSON.stringify(sysvar));
                            sysvar.ts = sysvar.ts ? (new Date(sysvar.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime() : d.getTime();
                            this.updateRegaVariable(sysvar);
                        });
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
                        this.setIfaceStatus('ReGaHSS', false);
                    } else {
                        const d = new Date();
                        res.forEach(prg => {
                            prg.type = 'PROGRAM';
                            prg.ts = (new Date(prg.ts + ' UTC+' + (d.getTimezoneOffset() / -60))).getTime();
                            if (!this.program[prg.name]) {
                                this.program[prg.name] = {};
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
                        this.setIfaceStatus('ReGaHSS', true);
                    }
                });
            });
        }

        initIfaces(config) {
            Object.keys(this.ifaceTypes).forEach(iface => {
                const enabled = config[this.ifaceTypes[iface].conf + 'Enabled'];
                this.ifaceTypes[iface].enabled = enabled;
                if (enabled) {
                    this.enabledIfaces.push(iface);
                    this.setIfaceStatus(iface, false);
                    this.createClient(iface)
                        .then(() => {
                            if (this.ifaceTypes[iface].init) {
                                return this.rpcInit(iface);
                            }
                        })
                        .catch(() => {});
                }
            });
            this.logger.info('Interfaces:', this.enabledIfaces.join(', '));
        }

        createClient(iface) {
            return new Promise(resolve => {
                const {rpc, port, path, protocol} = this.ifaceTypes[iface];
                const clientOptions = {};
                if (path) {
                    clientOptions.url = protocol + '://' + this.host + ':' + port + '/' + path;
                } else {
                    clientOptions.host = this.host;
                    clientOptions.port = port;
                }
                this.clients[iface] = rpc.createClient(clientOptions);
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

        rpcInit(iface) {
            return new Promise((resolve, reject) => {
                const initUrl = this.rpcServer(iface);
                this.methodCall(iface, 'init', [initUrl, 'nr_' + (Math.round(Math.random() * 65535)).toString(16) + '_' + iface])
                    .then(() => {
                        this.lastEvent[iface] = now();
                        this.setIfaceStatus(iface, true);
                        if (this.ifaceTypes[iface].ping) {
                            this.rpcCheckInit(iface);
                        }
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
                    }).catch(err => reject(err));
            });
        }

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

        rpcCheckInit(iface) {
            if (!this.metadata.devices[iface] || !Object.keys(this.metadata.devices[iface]).length > 0) {
                return;
            }
            clearTimeout(this.rpcPingTimer[iface]);
            const pingTimeout = this.ifaceTypes[iface].pingTimeout || this.rpcPingTimeout;
            const elapsed = Math.round((now() - this.lastEvent[iface]) / 1000);
            this.logger.debug('rpcCheckInit', iface, elapsed, pingTimeout);
            if (elapsed > pingTimeout) {
                this.setIfaceStatus(iface, false);
                this.logger.warn('ping timeout', iface, elapsed);
                this.rpcInit(iface);
                return;
            }
            if (elapsed >= (pingTimeout / 2)) {
                this.logger.trace('ping', iface, elapsed);
                this.methodCall(iface, 'ping', ['nr']);
            }
            this.rpcPingTimer[iface] = setTimeout(() => {
                this.rpcCheckInit(iface);
            }, pingTimeout * 250);
        }

        rpcClose() {
            this.logger.debug('rpcClose');
            const calls = [];
            Object.keys(this.clients).forEach(iface => {
                if (this.ifaceTypes[iface].init) {
                    calls.push(this.methodCall(iface, 'init', [this.initUrl(iface), '']));
                }
            });

            calls.push(new Promise((resolve, reject) => {
                this.logger.debug('binrpc server closing');
                let timeout;
                if (this.servers.binrpc && this.servers.binrpc.server) {
                    timeout = setTimeout(() => {
                        reject(new Error('binrpc server close timeout'));
                    }, 1000);
                    this.servers.binrpc.server.close(() => {
                        clearTimeout(timeout);
                        this.logger.info('binrpc server closed');
                        resolve();
                    });
                } else {
                    clearTimeout(timeout);
                    resolve();
                }
            }));

            calls.push(new Promise((resolve, reject) => {
                let timeout;
                if (this.servers.http && this.servers.http.close) {
                    timeout = setTimeout(() => {
                        delete this.servers.http;
                        reject(new Error('xmlrpc server close timeout'));
                    }, 1000);
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
            }));

            return Promise.all(calls);
        }

        initUrl(iface) {
            const {protocol} = this.ifaceTypes[iface];
            const port = (protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort);
            return protocol + '://' + (this.rpcInitAddress || this.rpcServerHost) + ':' + port;
        }

        rpcServer(iface) {
            const url = this.initUrl(iface);
            const {rpc, protocol} = this.ifaceTypes[iface];
            const port = (protocol === 'binrpc' ? this.rpcBinPort : this.rpcXmlPort);
            if (!this.servers[protocol]) {
                this.servers[protocol] = rpc.createServer({host: this.rpcServerHost, port});
                this.logger.info(protocol === 'binrpc' ? 'binrpc' : 'xmlrpc', 'server listening on', url);
                Object.keys(this.rpcMethods).forEach(method => {
                    this.servers[protocol].on(method, (err, params, callback) => {
                        if (err) {
                            this.logger.error('rpc <', iface, method, err);
                        }
                        this.logger.debug('rpc <', iface, method, JSON.stringify(params));
                        if (method === 'event') {
                            method = 'eventSingle';
                        }
                        if (isIterable(params)) {
                            this.rpcMethods[method](err, params, callback);
                        } else {
                            this.logger.error('rpc <', protocol, 'method', method, 'params not iterable', JSON.stringify(params));
                        }
                    });
                });
                this.servers[protocol].on('NotFound', (method, params) => {
                    this.logger.error('rpc <', protocol, 'method', method, 'not found:', JSON.stringify(params));
                });
            }
            return url;
        }

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
                return [iface, d.TYPE, d.FIRMWARE, d.VERSION, cType, paramset].join('/');
            }
        }

        paramsetQueuePush(iface, device) {
            if (device.PARAMSETS) {
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
                clearTimeout(this.getParamsetTimeout);
                this.getParamsetTimeout = setTimeout(() => {
                    this.paramsetQueueShift();
                }, 1000);
            }
        }

        paramsetQueueShift() {
            if (!this.paramsetPending) {
                this.paramsetPending = true;
            }

            const item = this.paramsetQueue.shift();
            if (item) {
                const {iface, name, address, paramset} = item;

                if (this.paramsetDescriptions[name]) {
                    this.logger.trace('paramset', name, 'already known');
                    this.paramsetPending = false;
                    clearTimeout(this.getParamsetTimeout);
                    setImmediate(() => this.paramsetQueueShift());
                } else {
                    this.methodCall(iface, 'getParamsetDescription', [address, paramset])
                        .then(res => {
                            this.logger.trace('paramsetDescription', name);
                            this.newParamsetDescriptionCount += 1;
                            this.newParamsetDescription = true;
                            this.paramsetDescriptions[name] = res;
                            if (this.newParamsetDescriptionCount >= 30) {
                                this.newParamsetDescription = false;
                                this.newParamsetDescriptionCount = 0;
                                this.saveParamsets();
                            }
                        })
                        .catch(err => this.logger.error(err))
                        .then(() => {
                            this.paramsetPending = false;
                            clearTimeout(this.getParamsetTimeout);
                            this.getParamsetTimeout = setTimeout(() => {
                                this.paramsetQueueShift();
                            }, 200);
                        });
                }
            } else {
                this.paramsetPending = false;
                if (this.newParamsetDescription) {
                    this.newParamsetDescription = false;
                    this.saveParamsets();
                }
            }
        }

        getParamsetDescription(iface, device, paramset, param) {
            const name = this.paramsetName(iface, device, paramset);
            if (this.paramsetDescriptions[name]) {
                if (param) {
                    return this.paramsetDescriptions[name][param];
                }
                return this.paramsetDescriptions[name];
            }
            this.paramsetQueuePush(iface, device);
            return {};
        }

        newDevice(iface, device) {
            this.logger.debug('newDevice', iface, device.ADDRESS);
            if (!this.metadata.devices[iface]) {
                this.metadata.devices[iface] = {};
            }
            if (!this.metadata.types[iface]) {
                this.metadata.types[iface] = {};
            }
            this.metadata.devices[iface][device.ADDRESS] = device;

            if (!device.TYPE) {
                throw new Error('device type undefined: ' + JSON.stringify(device));
            }

            if (this.metadata.types[iface][device.TYPE] && this.metadata.types[iface][device.TYPE].indexOf(device.ADDRESS) === -1) {
                this.metadata.types[iface][device.TYPE].push(device.ADDRESS);
            } else {
                this.metadata.types[iface][device.TYPE] = [device.ADDRESS];
            }
            this.paramsetQueuePush(iface, device);
        }

        deleteDevice(iface, device) {
            this.logger.debug('deleteDevice', iface, device);
            delete this.metadata.devices[iface][device];
        }

        listDevices(iface) {
            const result = [];
            if (this.metadata.devices[iface]) {
                Object.keys(this.metadata.devices[iface]).forEach(addr => {
                    this.paramsetQueuePush(iface, this.metadata.devices[iface][addr]);
                    result.push(this.listDevicesAnswer(iface, this.metadata.devices[iface][addr]));
                });
            }
            return result;
        }

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
                    // Würgaround https://github.com/eq-3/occu/issues/83
                    Object.keys(d).forEach(k => {
                        if (!d[k]) {
                            delete d[k];
                        }
                    });
                    return d;
                default:
                    return {ADDRESS: device.ADDRESS, VERSION: device.VERSION};
            }
        }

        get rpcMethods() {
            return {
                'system.listMethods': (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    const res = Object.keys(this.rpcMethods);
                    this.logger.debug('    >', iface, 'system.listMethods', JSON.stringify(res));
                    callback(null, res);
                },
                setReadyConfig: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'setReadyConfig ""');
                    callback(null, '');
                },
                updateDevice: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'updateDevice ""');
                    callback(null, '');
                },
                replaceDevice: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'replaceDevice ""');
                    callback(null, '');
                },
                readdedDevice: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'readdedDevice ""');
                    callback(null, '');
                },
                newDevices: (_, params, callback) => {
                    const [idInit, devices] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');

                    devices.forEach(device => {
                        this.newDevice(iface, device);
                    });

                    this.logger.debug('    >', iface, 'newDevices ""');
                    callback(null, '');

                    this.saveMetadata();
                },
                deleteDevices: (_, params, callback) => {
                    const [idInit, devices] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');

                    devices.forEach(device => {
                        this.deleteDevice(iface, device);
                    });

                    this.logger.debug('    >', iface, 'deleteDevices ""');
                    callback(null, '');

                    this.saveMetadata();
                },
                listDevices: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    const res = this.listDevices(iface) || [];
                    this.logger.debug('    >', iface, 'listDevices', JSON.stringify(res));
                    callback(null, res);
                },
                event: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(params);
                    callback(null, '');
                },
                eventSingle: (_, params, callback) => {
                    const [idInit] = params;
                    const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                    this.logger.debug('    >', iface, 'event ""');
                    this.publishEvent(params);

                    if (params[2] !== 'PONG') {
                        if (this.rxCounters[iface]) {
                            this.rxCounters[iface] += 1;
                        } else {
                            this.rxCounters[iface] = 1;
                        }
                    }
                    callback(null, '');
                },
                'system.multicall': (_, params, callback) => {
                    const result = [];
                    let iface;

                    const queue = [];
                    let working;
                    let direction;
                    let pong = true;
                    params[0].forEach(call => {
                        if (call.methodName === 'event') {
                            queue.push(call);
                            const [idInit, , datapoint, value] = call.params;
                            if (datapoint !== 'PONG') {
                                pong = false;
                            }

                            if (datapoint === 'WORKING') {
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
                            iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');
                            result.push('');
                        } else if (this.rpcMethods[call.methodName]) {
                            pong = false;
                            if (isIterable(call.params)) {
                                this.rpcMethods[call.methodName](call.params || [], res => result.push(res));
                            } else {
                                this.logger.error('rpc <', call.methodName, 'params not iterable', JSON.stringify(call.params));
                            }
                        }
                    });
                    queue.forEach(call => {
                        this.publishEvent(call.params, working, direction);
                    });
                    this.logger.debug('    >', iface, 'system.multicall', JSON.stringify(result));

                    if (!pong) {
                        if (this.rxCounters[iface]) {
                            this.rxCounters[iface] += 1;
                        } else {
                            this.rxCounters[iface] = 1;
                        }
                    }

                    callback(null, '');
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
                this.logger.debug('unsubscribeSysvar', id);
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
                this.logger.debug('unsubscribeProgram', id);
                delete this.programCallbacks[id];
                return true;
            }
            this.logger.error('unsubscribeProgram called for unknown callback', id);
            return false;
        }

        subscribe(filter, callback) {
            if (typeof callback === 'function') {
                const id = this.idCallback;
                this.idCallback += 1;
                filter = filter || {};
                this.logger.debug('subscribe', JSON.stringify(filter));
                this.callbacks[id] = {filter, callback};

                // TODO: if this.cachedValuesReceived generate message on new subscription

                return id;
            }
            this.logger.error('subscribe called without callback');
            return null;
        }

        unsubscribe(id) {
            if (this.callbacks[id]) {
                this.logger.debug('unsubscribe', id);
                delete this.callbacks[id];
                return true;
            }
            this.logger.error('unsubscribe called for unknown callback', id);
            return false;
        }

        topicReplace(topic, msg) {
            if (!topic || typeof msg !== 'object') {
                return topic;
            }
            const msgLower = {};
            Object.keys(msg).forEach(k => {
                msgLower[k.toLowerCase()] = msg[k];
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
                    topic = topic.replace(rx, msgLower[rkey] || '');
                });
            }

            return topic;
        }

        createMessage(iface, channel, datapoint, payload, additions) {
            const datapointName = iface + '.' + channel + '.' + datapoint;
            if (!this.values[datapointName]) {
                this.values[datapointName] = {};
            }

            const device = this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].PARENT;
            const ts = now();
            let change = false;

            let description = {};
            if (this.metadata.devices[iface] && this.metadata.devices[iface][channel]) {
                description = this.getParamsetDescription(iface, this.metadata.devices[iface][channel], 'VALUES', datapoint) || {};
            }

            if (description.TYPE === 'ACTION' || this.values[datapointName].payload !== payload) {
                change = true;
            }

            const msg = Object.assign({
                topic: '',
                payload,
                ccu: this.host,
                iface,
                device,
                deviceName: this.channelNames[device],
                deviceType: this.metadata.devices[iface] && this.metadata.devices[iface][device] && this.metadata.devices[iface][device].TYPE,
                channel,
                channelName: this.channelNames[channel],
                channelType: this.metadata.devices[iface] && this.metadata.devices[iface][channel] && this.metadata.devices[iface][channel].TYPE,
                channelIndex: channel && parseInt(channel.split(':')[1], 10),
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
                rooms: this.channelRooms[channel] || [],
                room: this.channelRooms[channel] && this.channelRooms[channel].length === 1 ? this.channelRooms[channel][0] : undefined,
                functions: this.channelFunctions[channel] || [],
                function: this.channelFunctions[channel] && this.channelFunctions[channel].length === 1 ? this.channelFunctions[channel][0] : undefined,
                ts,
                tsPrevious: this.values[datapointName].ts,
                lc: change ? ts : this.values[datapointName].lc,
                change
            }, additions);

            this.values[datapointName] = msg;
            return msg;
        }

        publishEvent(params, working, direction) {
            const [idInit, channel, datapoint, payload] = params;
            const iface = idInit.replace(/^nr_[0-9a-f]*_?/, '');

            this.lastEvent[iface] = now();
            this.setIfaceStatus(iface, true);

            if (channel.includes('CENTRAL') && datapoint === 'PONG') {
                this.logger.debug('    < ' + iface + ' PONG ' + payload);
                return;
            }

            this.logger.debug('publishEvent', JSON.stringify(params));

            const msg = this.createMessage(iface, channel, datapoint, payload, {cache: false, working, direction});

            if (msg.channelType && msg.channelType.match(/BLIND|DIMMER/) && msg.datapoint === 'LEVEL' && !working) {
                clearTimeout(this.workingTimeout[msg.datapointName]);
                this.workingTimeout[msg.datapointName] = setTimeout(() => {
                    const datapointNamePrefix = iface + '.' + channel + '.';
                    if (this.values[datapointNamePrefix + 'WORKING']) {
                        msg.working = this.values[datapointNamePrefix + 'WORKING'].value;
                    } else if (this.values[datapointNamePrefix + 'PROCESS']) {
                        msg.working = Boolean(this.values[datapointNamePrefix + 'PROCESS'].value);
                    }
                    if (this.values[datapointNamePrefix + 'DIRECTION']) {
                        msg.direction = this.values[datapointNamePrefix + 'DIRECTION'].value;
                    } else if (this.values[datapointNamePrefix + 'ACTIVITY_STATE']) {
                        const activityState = this.values[datapointNamePrefix + 'ACTIVITY_STATE'].value;
                        if (activityState === 0) {
                            msg.direction = 3;
                        } else if (activityState === 3) {
                            msg.direction = 0;
                        } else {
                            msg.direction = activityState;
                        }
                    }
                    this.callCallbacks(msg);
                }, 300);
            } else {
                this.callCallbacks(msg);
            }
        }

        callCallbacks(msg) {
            this.logger.trace('callCallbacks', this.callbacks.length, JSON.stringify(msg));
            Object.keys(this.callbacks).forEach(key => {
                const {filter, callback} = this.callbacks[key];

                let match = true;
                if (filter) {
                    this.logger.trace('filter', JSON.stringify(filter));
                    Object.keys(filter).forEach(attr => {
                        if (filter[attr] === '') {
                            return;
                        }
                        if (attr === 'cache') {
                            if (!filter.cache && msg.cache) {
                                match = false;
                            }
                        } else if (attr === 'change') {
                            if (filter.change && !msg.change) {
                                match = false;
                            }
                        } else if (typeof msg[attr] === 'object') {
                            if (filter[attr] instanceof RegExp) {
                                match = false;
                                msg[attr].forEach(item => {
                                    if (filter[attr].test(item)) {
                                        match = true;
                                    }
                                });
                            } else if (msg[attr].indexOf(filter[attr]) === -1) {
                                match = false;
                            }
                        } else if ((filter[attr] instanceof RegExp) && !filter[attr].test(msg[attr])) {
                            match = false;
                        } else if ((typeof filter[attr] === 'string') && (filter[attr] !== msg[attr])) {
                            match = false;
                        }
                    });
                }
                this.logger.trace('match', match);
                if (match) {
                    callback(msg);
                }
            });
        }

        methodCall(iface, method, params) {
            return new Promise((resolve, reject) => {
                if (this.clients[iface]) {
                    this.logger.debug('rpc >', iface, method, JSON.stringify(params));
                    this.clients[iface].methodCall(method, params, (err, res) => {
                        if (err) {
                            this.logger.error('    <', iface, method, err);
                            reject(err);
                        } else if (res && res.faultCode) {
                            this.logger.debug('    <', iface, method, JSON.stringify(res));
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
                    this.logger.debug('defering methodCall ' + iface + ' ' + method + ' ' + JSON.stringify(params));
                    if (this.methodCallQueue[iface]) {
                        this.methodCallQueue[iface].push([method, params, resolve, reject]);
                    } else {
                        this.methodCallQueue[iface] = [[method, params, resolve, reject]];
                    }
                } else {
                    reject(new Error('unknown interface ' + iface + ' ' + Object.keys(this.clients) + ' ' + Object.keys(this.ifaceTypes)));
                }
            });
        }

        setValue(iface, address, datapoint, value, burst) {
            const id = `${iface}.${address}.${datapoint}`;
            value = this.paramCast(iface, address, 'VALUES', datapoint, value);
            const params = [address, datapoint, value];
            if (iface === 'BidCos-RF' && burst) {
                params.push(burst);
            }

            if (this.setValueTimers[id]) {
                // Return new Promise(resolve => {
                this.setValueCache[id] = params;
                this.logger.debug('deferred', id);
                //    Resolve();
                // });
            } else {
                this.setValueTimers[id] = setTimeout(() => {
                    delete this.setValueTimers[id];
                    this.setValueDeferred(id);
                }, this.setValueThrottle);

                return new Promise((resolve, reject) => {
                    this.methodCall(iface, 'setValue', params).then(resolve).catch(err => {
                        this.logger.error('rpc >', iface, 'setValue', JSON.stringify(params), '<', err);
                        reject(err);
                    });
                });
            }
            return new Promise(resolve => resolve());
        }

        setValueDeferred(id) {
            if (this.setValueCache[id]) {
                this.logger.debug('setValueDeferred', id, this.setValueCache[id]);
                const [iface] = id.split('.');
                const params = this.setValueCache[id];
                delete this.setValueCache[id];
                return this.methodCall(iface, 'setValue', params).catch(err => {
                    this.logger.error('rpc >', iface, 'setValue', JSON.stringify(params), '<', err);
                });
            }
        }

        paramCast(iface, address, psName, datapoint, value) {
            const device = this.metadata.devices[iface] && this.metadata.devices[iface][address];
            const psKey = this.paramsetName(iface, device, psName);
            const paramset = this.paramsetDescriptions[psKey] && this.paramsetDescriptions[psKey][datapoint];
            if (paramset) {
                switch (paramset.TYPE) {
                    case 'ACTION':
                    // eslint-disable-line no-fallthrough
                    case 'BOOL':
                        if (value === 'false') {
                            value = false;
                        } else if (!isNaN(value)) { // Make sure that the string "0" gets casted to boolean false
                            value = Number(value);
                        }
                        value = Boolean(value);
                        break;
                    case 'FLOAT':
                        value = parseFloat(value) || 0;
                        if (typeof paramset.MIN !== 'undefined' && value < paramset.MIN) {
                            value = paramset.MIN;
                        } else if (typeof paramset.MAX !== 'undefined' && value > paramset.MAX) {
                            value = paramset.MAX;
                        }
                        value = {explicitDouble: value};
                        break;
                    case 'ENUM':
                        if (typeof value === 'string') {
                            if (paramset.ENUM && (paramset.ENUM.indexOf(value) !== -1)) {
                                value = paramset.ENUM.indexOf(value);
                            }
                        }
                    // eslint-disable-line no-fallthrough
                    case 'INTEGER':
                        if (typeof value === 'boolean') {
                            value = Number(value);
                        } else {
                            value = parseInt(value, 10) || 0;
                        }
                        if (typeof paramset.MIN !== 'undefined' && value < paramset.MIN) {
                            value = paramset.MIN;
                        } else if (typeof paramset.MAX !== 'undefined' && value > paramset.MAX) {
                            value = paramset.MAX;
                        }
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
