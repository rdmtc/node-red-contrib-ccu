/* global describe, it, after, before, afterEach */
/* eslint-disable no-template-curly-in-string, no-unused-vars, unicorn/filename-case */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeSysvar = require('../nodes/ccu-sysvar.js');
const nodePoll = require('../nodes/ccu-poll.js');
const nodeScript = require('../nodes/ccu-script.js');
const nodeProgram = require('../nodes/ccu-program.js');
const nodeConnection = require('../nodes/ccu-connection.js');
const {removeFiles, hmSimOptions} = require('./utils');

helper.init(require.resolve('node-red'));

const flow1 = [
    {
        id: 'nv',
        type: 'ccu-sysvar',
        name: 'Anwesenheit',
        ccuConfig: 'nc',
        topic: 'ReGaHSS/${Name}',
        change: false,
        cache: true,

        wires: [
            ['nh']
        ]
    },
    {
        id: 'nh',
        type: 'helper'
    },
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'localhost',
        host: 'localhost',
        regaEnabled: true,
        bcrfEnabled: false,
        iprfEnabled: false,
        virtEnabled: false,
        bcwiEnabled: false,
        cuxdEnabled: false,
        regaPoll: false,
        regaInterval: '30',
        rpcPingTimeout: '60',
        rpcInitAddress: '127.0.0.1',
        rpcServerHost: '127.0.0.1',
        rpcBinPort: '2047',
        rpcXmlPort: '2048'
    },
    {
        id: 'np',
        type: 'ccu-poll',
        ccuConfig: 'nc'
    }
];
const flow2 = [
    {
        id: 'nv',
        type: 'ccu-sysvar',
        name: 'Anwesenheit',
        ccuConfig: 'nc',
        topic: 'ReGaHSS/${Name}',
        change: true,
        cache: false,

        wires: [
            ['nh']
        ]
    },
    {
        id: 'nh',
        type: 'helper'
    },
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'localhost',
        host: 'localhost',
        regaEnabled: true,
        bcrfEnabled: false,
        iprfEnabled: false,
        virtEnabled: false,
        bcwiEnabled: false,
        cuxdEnabled: false,
        regaPoll: false,
        regaInterval: '30',
        rpcPingTimeout: '60',
        rpcInitAddress: '127.0.0.1',
        rpcServerHost: '127.0.0.1',
        rpcBinPort: '2047',
        rpcXmlPort: '2048'
    },
    {
        id: 'np',
        type: 'ccu-poll',
        ccuConfig: 'nc'
    }
];
const flow3 = [
    {
        id: 'nv',
        type: 'ccu-sysvar',
        name: 'Anwesenheit',
        ccuConfig: 'nc',
        topic: 'ReGaHSS/${Name}',
        change: true,
        cache: true,

        wires: [
            ['nh']
        ]
    },
    {
        id: 'nh',
        type: 'helper'
    },
    {
        id: 'ns',
        type: 'ccu-script',
        name: 'script',
        script: '',
        ccuConfig: 'nc',
        topic: '${CCU}/${Interface}',
        wires: [
            []
        ]
    },
    {
        id: 'npr',
        type: 'ccu-program',
        name: 'Anwesend',
        ccuConfig: 'nc',
        topic: 'ReGaHSS/${Name}',
        wires: [
            ['nh']
        ]
    },
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'localhost',
        host: 'localhost',
        regaEnabled: true,
        bcrfEnabled: false,
        iprfEnabled: false,
        virtEnabled: false,
        bcwiEnabled: false,
        cuxdEnabled: false,
        regaPoll: true,
        regaInterval: '5',
        rpcPingTimeout: '60',
        rpcInitAddress: '127.0.0.1',
        rpcServerHost: '127.0.0.1',
        rpcBinPort: '2047',
        rpcXmlPort: '2048'
    },
    {
        id: 'np',
        type: 'ccu-poll',
        ccuConfig: 'nc'
    }
];

describe('regahss flow1', () => {
    let hmSim;
    let nh;
    let nv;
    let np;
    let ns;

    afterEach(function (done) {
        this.timeout(3000);
        setTimeout(() => {
            done();
        }, 2000);
    });

    before(function (done) {
        this.timeout(12000);
        hmSim = new HmSim(hmSimOptions());
        helper.startServer(() => {
            helper.load([nodeConnection, nodeSysvar, nodePoll], flow1, () => {
                nh = helper.getNode('nh');
                nv = helper.getNode('nv');
                np = helper.getNode('np');
                done();
            });
        });
    });

    after(function (done) {
        this.timeout(7000);
        helper.unload().then(() => {
            hmSim.close();
            helper.stopServer(() => {
                removeFiles();
                done();
            });
        });
    });

    describe('node ccu-sysvar', () => {
        it('should send message on start', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({topic: 'ReGaHSS/Anwesenheit',
                    payload: false,
                    ccu: 'localhost',
                    iface: 'ReGaHSS',
                    type: 'SYSVAR',
                    name: 'Anwesenheit',
                    info: 'Anwesenheit',
                    value: false,
                    valueType: 'boolean',
                    valueEnum: 'nicht anwesend',
                    unit: '',
                    enum: ['nicht anwesend', 'anwesend'],
                    id: 950,
                    cache: true,
                    change: false
                });
                done();
            });
        });

        it('should send message after receive with change', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: true,
                    value: true,
                    valuePrevious: false,
                    valueEnum: 'anwesend',
                    valueEnumPrevious: 'nicht anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            nv.receive({payload: true});
        });
    });

    describe('node ccu-sysvar and ccu-poll', () => {
        it('should send message after poll with change', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: false,
                    value: false,
                    valuePrevious: true,
                    valueEnum: 'nicht anwesend',
                    valueEnumPrevious: 'anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].val = false;
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
            np.receive({});
        });

        it('should send message after poll with unchanged', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: false,
                    value: false,
                    valuePrevious: false,
                    valueEnum: 'nicht anwesend',
                    valueEnumPrevious: 'nicht anwesend',
                    cache: false,
                    change: false
                });
                done();
            });
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
            np.receive({});
        });
    });
});

describe('regahss flow2', () => {
    let hmSim;
    let nh;
    let nv;
    let np;

    afterEach(function (done) {
        this.timeout(3000);
        setTimeout(() => {
            done();
        }, 2000);
    });

    before(done => {
        hmSim = new HmSim(hmSimOptions());
        helper.startServer(() => {
            helper.load([nodeConnection, nodeSysvar, nodePoll], flow2, () => {
                nh = helper.getNode('nh');
                nv = helper.getNode('nv');
                np = helper.getNode('np');
                done();
            });
        });
    });

    after(function (done) {
        this.timeout(7000);
        helper.unload().then(() => {
            hmSim.close();
            helper.stopServer(() => {
                removeFiles();
                done();
            });
        });
    });

    describe('node ccu-sysvar', () => {
        it('should not send message on start', function (done) {
            this.timeout(30000);
            function unexcpectedMessage(message) {
                nh.removeListener('input', unexcpectedMessage);
                done(new Error('unexpected msg received'));
            }

            nh.on('input', unexcpectedMessage);
            setTimeout(() => {
                nh.removeListener('input', unexcpectedMessage);
                done();
            }, 3000);
        });

        it('should send message after receive with change', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: true,
                    value: true,
                    valuePrevious: false,
                    valueEnum: 'anwesend',
                    valueEnumPrevious: 'nicht anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            nv.receive({payload: true});
        });
    });

    describe('node ccu-sysvar and ccu-poll', () => {
        it('should send message after poll with change', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: false,
                    value: false,
                    valuePrevious: true,
                    valueEnum: 'nicht anwesend',
                    valueEnumPrevious: 'anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].val = false;
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
            np.receive({});
        });

        it('should not send message after poll with unchanged', function (done) {
            this.timeout(30000);
            function unexcpectedMessage() {
                done(new Error('unexpected msg received'));
            }

            nh.once('input', unexcpectedMessage);
            setTimeout(() => {
                nh.removeListener('input', unexcpectedMessage);
                done();
            }, 3000);
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
            np.receive({});
        });
    });
});

describe('regahss flow3', () => {
    let hmSim;
    let nh;
    let nv;
    let np;
    let npr;
    let ns;

    afterEach(function (done) {
        this.timeout(3000);
        setTimeout(() => {
            done();
        }, 2000);
    });

    before(done => {
        hmSim = new HmSim(hmSimOptions());
        helper.startServer(() => {
            helper.load([nodeConnection, nodeSysvar, nodePoll, nodeScript, nodeProgram], flow3, () => {
                nh = helper.getNode('nh');
                nv = helper.getNode('nv');
                np = helper.getNode('np');
                npr = helper.getNode('npr');
                ns = helper.getNode('ns');
                done();
            });
        });
    });

    after(function (done) {
        this.timeout(7000);
        helper.unload().then(() => {
            hmSim.close();
            helper.stopServer(() => {
                removeFiles();
                done();
            });
        });
    });

    describe('node ccu-sysvar', () => {
        it('should send message on start', function (done) {
            this.timeout(30000);
            nh.once('input', message => {
                message.should.have.properties({topic: 'ReGaHSS/Anwesenheit',
                    payload: false,
                    ccu: 'localhost',
                    iface: 'ReGaHSS',
                    type: 'SYSVAR',
                    name: 'Anwesenheit',
                    info: 'Anwesenheit',
                    value: false,
                    valueType: 'boolean',
                    valueEnum: 'nicht anwesend',
                    unit: '',
                    enum: ['nicht anwesend', 'anwesend'],
                    id: 950,
                    cache: true,
                    change: false
                });
                done();
            });
        });
        it('should send message with change', function (done) {
            this.timeout(10000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: true,
                    value: true,
                    valuePrevious: false,
                    valueEnum: 'anwesend',
                    valueEnumPrevious: 'nicht anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].val = true;
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
        });
        it('should send message with change', function (done) {
            this.timeout(10000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: false,
                    value: false,
                    valuePrevious: true,
                    valueEnum: 'nicht anwesend',
                    valueEnumPrevious: 'anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            hmSim.regaSim.variables.forEach((v, i) => {
                if (v.name === 'Anwesenheit') {
                    hmSim.regaSim.variables[i].val = false;
                    hmSim.regaSim.variables[i].ts = hmSim.regaSim.ts();
                }
            });
        });
    });

    describe('node ccu-sysvar and ccu-script', () => {
        it('should send message with change', function (done) {
            this.timeout(10000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: true,
                    value: true,
                    valuePrevious: false,
                    valueEnum: 'anwesend',
                    valueEnumPrevious: 'nicht anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            ns.receive({payload: 'dom.GetObject(950).State(true);'});
        });
        it('should send message with change', function (done) {
            this.timeout(10000);
            nh.once('input', message => {
                message.should.have.properties({
                    payload: false,
                    value: false,
                    valuePrevious: true,
                    valueEnum: 'nicht anwesend',
                    valueEnumPrevious: 'anwesend',
                    cache: false,
                    change: true
                });
                done();
            });
            ns.receive({payload: 'dom.GetObject(950).State(false);'});
        });
    });
    describe('node ccu-program', () => {
        it('should execute on incoming msg', function (done) {
            this.timeout(10000);
            nh.once('input', message => {
                message.should.have.properties({
                    id: 2329,
                    ccu: 'localhost',
                    iface: 'ReGaHSS',
                    type: 'PROGRAM',
                    name: 'Anwesend',
                    payload: true,
                    value: true,
                    active: true,
                    topic: 'ReGaHSS/Anwesend'
                });
                done();
            });
            npr.receive({payload: ''});
        });
    });
});
