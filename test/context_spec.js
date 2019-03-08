/* global describe, it, after, before, afterEach */
/* eslint-disable no-template-curly-in-string, no-unused-vars, unicorn/filename-case */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeGetValue = require('../nodes/ccu-get-value.js');
const nodeSwitch = require('../nodes/ccu-switch.js');
const nodeConnection = require('../nodes/ccu-connection.js');
const {removeFiles, hmSimOptions} = require('./utils');

helper.init(require.resolve('node-red'));

const flow1 = [
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'localhost',
        host: 'localhost',
        regaEnabled: true,
        bcrfEnabled: false,
        iprfEnabled: true,
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
        id: 'ns',
        type: 'ccu-switch',
        name: 'switch',
        ccuConfig: 'nc',
        iface: 'HmIP-RF',
        channel: '00131709AE37B4:3 Test-WGC:3',
        sysvar: 'Alarmmeldungen',
        sysvarProperty: 'value',
        datapoint: 'STATE',
        datapointProperty: 'value',
        property: 'payload',
        propertyType: 'msg',
        rules: [
            {
                t: 'true'
            },
            {
                t: 'else'
            }
        ],
        checkall: 'true',
        repair: false,
        outputs: 2,
        wires: [
            [
                'nhtrue'
            ],
            [
                'nhfalse'
            ]
        ]
    },
    {
        id: 'nhtrue',
        type: 'helper'

    },
    {
        id: 'nhfalse',
        type: 'helper'

    },
    {
        id: 'nh',
        type: 'helper'
    },
    {
        id: 'ng',
        type: 'ccu-get-value',
        name: 'getvalue',
        ccuConfig: 'nc',
        iface: 'HmIP-RF',
        channel: '00131709AE37B4:3 Test-WGC:3',
        sysvar: 'Alarmmeldungen',
        sysvarProperty: 'value',
        datapoint: 'STATE',
        datapointProperty: 'value',
        setProp: 'payload',
        setPropType: 'msg',
        wires: [
            [
                'nh'
            ]
        ]
    }
];

describe('context flow1', () => {
    let hmSim;
    let nc;
    let ng;
    let nh;
    let nhtrue;
    let nhfalse;
    let ns;

    afterEach(function (done) {
        this.timeout(3000);
        setTimeout(() => {
            done();
        }, 2000);
    });

    before(function (done) {
        this.timeout(7000);
        hmSim = new HmSim(hmSimOptions());
        helper.startServer(() => {
            helper.load([nodeConnection, nodeSwitch, nodeGetValue], flow1, () => {
                nc = helper.getNode('nc');
                nhtrue = helper.getNode('nhtrue');
                nhfalse = helper.getNode('nhfalse');
                ns = helper.getNode('ns');
                nh = helper.getNode('nh');
                ng = helper.getNode('ng');
                setTimeout(() => {
                    done();
                }, 5000);
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

    describe('node switch', () => {
        it('should send msg to second output if HmIP-RF/Test-WGC:3/STATE is not true', function (done) {
            this.timeout(10000);
            nhfalse.once('input', () => {
                done();
            });
            ns.receive({});
        });

        it('should send msg to first output if HmIP-RF/Test-WGC:3/STATE is true', function (done) {
            this.timeout(10000);
            nhtrue.once('input', () => {
                done();
            });
            hmSim.api.emit('setValue', 'hmip', '00131709AE37B4:3', 'STATE', true);

            setTimeout(() => {
                ns.receive({});
            }, 500);
        });
    });

    describe('node get value', () => {
        it('should send value of if HmIP-RF/Test-WGC:3/STATE', function (done) {
            this.timeout(10000);
            nh.once('input', msg => {
                msg.payload.should.equal(false);
                done();
            });
            hmSim.api.emit('setValue', 'hmip', '00131709AE37B4:3', 'STATE', false);

            setTimeout(() => {
                ng.receive({});
            }, 500);
        });
        it('should send value of if HmIP-RF/Test-WGC:3/STATE', function (done) {
            this.timeout(10000);
            nh.once('input', msg => {
                msg.payload.should.equal(true);
                done();
            });
            hmSim.api.emit('setValue', 'hmip', '00131709AE37B4:3', 'STATE', true);

            setTimeout(() => {
                ng.receive({});
            }, 500);
        });
    });
});
