/* global describe, it, after, before, afterEach */
/* eslint-disable no-template-curly-in-string, no-unused-vars, unicorn/filename-case */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeRpcEvent = require('../nodes/ccu-rpc-event.js');
const nodeRpc = require('../nodes/ccu-rpc.js');
const nodeValue = require('../nodes/ccu-value.js');
const nodeSetValue = require('../nodes/ccu-set-value.js');
const nodeGetValue = require('../nodes/ccu-get-value.js');
const nodeDisplay = require('../nodes/ccu-display.js');
const nodeSignal = require('../nodes/ccu-signal.js');
const nodeSwitch = require('../nodes/ccu-switch.js');
const nodeMqtt = require('../nodes/ccu-mqtt.js');
const nodeConnection = require('../nodes/ccu-connection.js');
const {removeFiles, hmSimOptions} = require('./utils');

helper.init(require.resolve('node-red'));

const flow1 = [
    {
        id: 'ne',
        type: 'ccu-rpc-event',
        name: '',
        iface: '',
        ccuConfig: 'nc',
        rooms: '',
        roomsRx: 'str',
        functions: '',
        functionsRx: 'str',
        device: '',
        deviceRx: 'str',
        deviceName: '',
        deviceNameRx: 'str',
        deviceType: '',
        deviceTypeRx: 'str',
        channel: '',
        channelRx: 'str',
        channelName: '',
        channelNameRx: 'str',
        channelType: '',
        channelTypeRx: 'str',
        datapoint: '',
        datapointRx: 'str',
        change: false,
        working: false,
        cache: true,
        topic: '${CCU}/${Interface}/${channelName}/${datapoint}',
        wires: [
            [
                'nh'
            ]
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
        bcrfEnabled: true,
        bcrfBinRpc: true,
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
        id: 'nv',
        type: 'ccu-value',
        name: '',
        iface: 'HmIP-RF',
        channel: '00131709AE37B4:3 Test-WGC:3',
        datapoint: 'STATE',
        mode: '',
        start: true,
        change: true,
        cache: false,
        queue: true,
        on: 0,
        onType: 'undefined',
        ramp: 0,
        rampType: 'undefined',
        working: false,
        ccuConfig: 'nc',
        topic: '${CCU}/${Interface}/${channel}/${datapoint}',
        wires: [
            [
                'nh'
            ]
        ]
    }
];

describe('rpc flow1', () => {
    let hmSim;
    let nc;
    let nh;
    let nv;
    let ne;

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
            helper.load([nodeConnection, nodeRpcEvent, nodeValue], flow1, () => {
                nc = helper.getNode('nc');
                nh = helper.getNode('nh');
                nv = helper.getNode('nv');
                ne = helper.getNode('ne');
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

    describe('node rpc-event', () => {
        it('should send msg on BidCos-RF/HM-RCV-50:1/PRESS_SHORT event', function (done) {
            this.timeout(10000);
            nh.once('input', msg => {
                msg.should.have.properties({
                    topic: 'localhost/BidCos-RF/HM-RCV-50:1/PRESS_SHORT',
                    payload: true,
                    ccu: 'localhost',
                    iface: 'BidCos-RF',
                    device: 'BidCoS-RF',
                    deviceName: 'HM-RCV-50',
                    deviceType: 'HM-RCV-50',
                    channel: 'BidCoS-RF:1',
                    channelName: 'HM-RCV-50:1',
                    channelType: 'VIRTUAL_KEY',
                    channelIndex: 1,
                    datapoint: 'PRESS_SHORT',
                    datapointName: 'BidCos-RF.BidCoS-RF:1.PRESS_SHORT',
                    datapointType: 'ACTION',
                    datapointMin: false,
                    datapointMax: true,
                    datapointDefault: false,
                    datapointControl: 'BUTTON.SHORT',
                    value: true,
                    valueStable: true,
                    rooms: ['Schlafzimmer', 'Kinderzimmer 1'],
                    room: 'Schlafzimmer',
                    functions: ['Taster', 'Zentrale'],
                    function: 'Taster',
                    change: true,
                    cache: false,
                    stable: true
                });
                done();
            });
            hmSim.api.emit('setValue', 'rfd', 'BidCoS-RF:1', 'PRESS_SHORT', true);
        });
        it('should send msg on HmIP-RF/Test-WGC:1/PRESS_SHORT event', function (done) {
            this.timeout(10000);
            nh.once('input', msg => {
                msg.should.have.properties({
                    topic: 'localhost/HmIP-RF/Test-WGC:1/PRESS_SHORT',
                    payload: true,
                    ccu: 'localhost',
                    iface: 'HmIP-RF',
                    device: '00131709AE37B4',
                    deviceName: 'Test-WGC',
                    deviceType: 'HmIP-WGC',
                    channel: '00131709AE37B4:1',
                    channelName: 'Test-WGC:1',
                    channelType: 'KEY_TRANSCEIVER',
                    channelIndex: 1,
                    datapoint: 'PRESS_SHORT',
                    datapointName: 'HmIP-RF.00131709AE37B4:1.PRESS_SHORT',
                    datapointType: 'ACTION',
                    datapointMin: false,
                    datapointMax: true,
                    datapointDefault: false,
                    datapointControl: 'BUTTON_NO_FUNCTION.SHORT',
                    value: true,
                    valueStable: true,
                    rooms: ['Garage'],
                    room: 'Garage',
                    functions: ['Taster'],
                    function: 'Taster',
                    change: true,
                    cache: false,
                    stable: true
                });
                done();
            });
            hmSim.api.emit('setValue', 'hmip', '00131709AE37B4:1', 'PRESS_SHORT', true);
        });
    });

    describe('node rpc-value', () => {
        it('should set HmIP-RF/Test-WGC:3/STATE to true', function (done) {
            this.timeout(10000);
            function handler(msg) {
                if (msg.topic === 'localhost/HmIP-RF/Test-WGC:3/STATE') {
                    msg.should.have.properties({topic: 'localhost/HmIP-RF/Test-WGC:3/STATE',
                        payload: true,
                        ccu: 'localhost',
                        iface: 'HmIP-RF',
                        device: '00131709AE37B4',
                        deviceName: 'Test-WGC',
                        deviceType: 'HmIP-WGC',
                        channel: '00131709AE37B4:3',
                        channelName: 'Test-WGC:3',
                        channelType: 'SWITCH_VIRTUAL_RECEIVER',
                        channelIndex: 3,
                        datapoint: 'STATE',
                        datapointName: 'HmIP-RF.00131709AE37B4:3.STATE',
                        datapointType: 'BOOL',
                        datapointMin: false,
                        datapointMax: true,
                        datapointDefault: false,
                        datapointControl: 'SWITCH.STATE',
                        value: true,
                        rooms: ['Garage'],
                        room: 'Garage',
                        functions: ['Verschluss'],
                        function: 'Verschluss',
                        change: true,
                        cache: false
                    });
                    nh.removeListener('input', handler);
                    done();
                }
            }

            nh.on('input', handler);
            nv.receive({payload: true});
        });

        it('should set HmIP-RF/Test-WGC:3/STATE to false', function (done) {
            this.timeout(10000);
            function handler(msg) {
                if (msg.topic === 'localhost/HmIP-RF/Test-WGC:3/STATE') {
                    msg.should.have.properties({topic: 'localhost/HmIP-RF/Test-WGC:3/STATE',
                        payload: false,
                        ccu: 'localhost',
                        iface: 'HmIP-RF',
                        device: '00131709AE37B4',
                        deviceName: 'Test-WGC',
                        deviceType: 'HmIP-WGC',
                        channel: '00131709AE37B4:3',
                        channelName: 'Test-WGC:3',
                        channelType: 'SWITCH_VIRTUAL_RECEIVER',
                        channelIndex: 3,
                        datapoint: 'STATE',
                        datapointName: 'HmIP-RF.00131709AE37B4:3.STATE',
                        datapointType: 'BOOL',
                        datapointMin: false,
                        datapointMax: true,
                        datapointDefault: false,
                        datapointControl: 'SWITCH.STATE',
                        value: false,
                        valuePrevious: true,
                        rooms: ['Garage'],
                        room: 'Garage',
                        functions: ['Verschluss'],
                        function: 'Verschluss',
                        change: true,
                        cache: false
                    });
                    nh.removeListener('input', handler);
                    done();
                }
            }

            nh.on('input', handler);
            nv.receive({payload: false});
        });
    });
});
