/* #177, #144: the signal node's COLOR_BEHAVIOUR and the display node's HmIP-WRCD, end to end.
   A fake hmipserver has an HmIP-BSL 2.0.2 and one with 1.0.2, an HmIPW-WRC6 and an HmIP-WRCD;
   their descriptions come from the shipped paramsets.json (nothing is asked of the interface).
   The editor's channel lists name the new channels, and the commands arrive as one
   putParamset (signal) and one setValue of COMBINED_PARAMETER (display). */

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeSignal = require('../nodes/ccu-signal.js');
const nodeDisplay = require('../nodes/ccu-display.js');
const {userDir, freePorts} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
/** the fake hmipserver's port, from the OS in before() */
let HMIP_PORT = 0;
const IFACE = 'HmIP-RF';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(userDir(), f),
);
const PARAMSETS_SCRATCH = path.join(userDir(), 'nrccu-signaldisplay-paramsets.json');
const VENDORED = path.join(__dirname, '..', 'paramsets.json');

function removeCache() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** a device with one channel, as listDevices has it */
function device(address, type, firmware, version, index, channelType) {
    return [
        {
            ADDRESS: address,
            TYPE: type,
            VERSION: version,
            FIRMWARE: firmware,
            PARAMSETS: ['MASTER'],
            CHILDREN: [address + ':' + index],
        },
        {
            ADDRESS: address + ':' + index,
            TYPE: channelType,
            PARENT: address,
            PARENT_TYPE: type,
            VERSION: version,
            INDEX: index,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ];
}

const LIST = [
    ...device('BSL00000000002', 'HmIP-BSL', '2.0.2', 2, 8, 'DIMMER_VIRTUAL_RECEIVER'),
    ...device('BSL00000000001', 'HmIP-BSL', '1.0.2', 1, 8, 'DIMMER_VIRTUAL_RECEIVER'),
    ...device('WRC00000000006', 'HmIPW-WRC6', '1.0.8', 1, 7, 'OPTICAL_SIGNAL_RECEIVER'),
    ...device('WRCD0000000001', 'HmIP-WRCD', '1.4.6', 3, 3, 'ACOUSTIC_DISPLAY_RECEIVER'),
];

/** the fake hmipserver: init, listDevices, the writes recorded */
function fakeHmipServer() {
    const state = {setValues: [], putParamsets: [], descriptions: []};
    const server = xmlrpc.createServer({host: HOST, port: HMIP_PORT});
    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        callback(null, '');
        if (id) {
            const u = new URL(url);
            const client = xmlrpc.createClient({host: u.hostname, port: Number(u.port), path: '/'});
            setTimeout(() => client.methodCall('newDevices', [id, LIST], () => {}), 50);
        }
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('listDevices', (err, params, callback) => callback(null, LIST));
    server.on('getParamsetDescription', (err, params, callback) => {
        state.descriptions.push(params);
        callback(null, {});
    });
    server.on('putParamset', (err, params, callback) => {
        state.putParamsets.push(params);
        callback(null, '');
    });
    server.on('setValue', (err, params, callback) => {
        state.setValues.push(params);
        callback(null, '');
    });
    server.on('ping', (err, params, callback) => callback(null, true));
    state.close = () => new Promise((resolve) => server.close(resolve));
    return state;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (predicate()) {
            return true;
        }

        await wait(25);
    }

    return Boolean(predicate());
}

const signal = (id, channel, more) => ({
    id,
    type: 'ccu-signal',
    ccuConfig: 'nc',
    iface: IFACE,
    channel,
    channelType: 'BSL_DIMMER_VIRTUAL_RECEIVER',
    dimmerColor: '4',
    dimmerLevel: 50,
    rampTimeUnit: 'S',
    rampTimeValue: 0,
    rampTimeValueType: 'num',
    durationUnit: 'M',
    durationValue: 31,
    durationValueType: 'num',
    ...more,
});

function flow() {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'signaldisplay',
            host: HOST,
            regaEnabled: false,
            bcrfEnabled: false,
            iprfEnabled: true,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            iprfPort: String(HMIP_PORT),
        },
        // a flow of before the option: no colorBehaviour
        signal('bsl2', 'BSL00000000002:8'),
        signal('bsl2blink', 'BSL00000000002:8', {colorBehaviour: '3'}),
        signal('bsl1', 'BSL00000000001:8', {colorBehaviour: '3'}),
        signal('wrc6', 'WRC00000000006:7', {channelType: 'OPTICAL_SIGNAL_RECEIVER', colorBehaviour: '8'}),
        {
            id: 'wrcd',
            type: 'ccu-display',
            ccuConfig: 'nc',
            iface: IFACE,
            channel: 'WRCD0000000001:3',
            channelType: 'HmIP-WRCD',
            line1: 'Küche',
            wrcdIcon1: '2',
            wrcdAlign1: 'LEFT',
            wrcdColor1: 'BLACK',
            wrcdBackground1: 'WHITE',
            line2: '21,5 °C',
            wrcdIcon2: '0',
            wrcdAlign2: 'CENTER',
            wrcdColor2: 'WHITE',
            wrcdBackground2: 'BLACK',
            disable3: true,
            disable4: true,
            disable5: true,
            wrcdSound: '6',
            wrcdRepeat: '1',
            wrcdInterval: '10',
        },
    ];
}

describe('signal and display nodes: HmIP-BSL 2.x, OPTICAL_SIGNAL_RECEIVER, HmIP-WRCD (#177, #144)', function () {
    this.timeout(30000);
    let hmip;
    let nc;

    before(async () => {
        [HMIP_PORT] = await freePorts(1);
        await new Promise((resolve) => helper.startServer(resolve));
        removeCache();
        // the scratch file stands in for <userDir>/paramsets.json: the vendored content
        fs.copyFileSync(VENDORED, PARAMSETS_SCRATCH);
        hmip = fakeHmipServer();
        await new Promise((resolve) => helper.load([nodeConnection, nodeSignal, nodeDisplay], flow(), resolve));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        const known = (address) => {
            const channel = nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE][address];
            return Boolean(channel && nc.paramsetDescriptions[nc.paramsetName(IFACE, channel, 'VALUES')]);
        };
        (
            await until(
                () =>
                    nc.ifaceStatus[IFACE] &&
                    ['BSL00000000002:8', 'BSL00000000001:8', 'WRC00000000006:7', 'WRCD0000000001:3'].every(known),
                10000,
            )
        ).should.be.true();
    });

    after(async () => {
        await helper.unload();
        await hmip.close();
        removeCache();
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    beforeEach(() => {
        hmip.putParamsets.length = 0;
        hmip.setValues.length = 0;
    });

    it('the shipped file describes all four devices: nothing is asked of the interface', () => {
        hmip.descriptions.should.eql([]);
        nc.paramsetDescriptions['HmIP-RF/HmIP-BSL/2.0.2/2/DIMMER_VIRTUAL_RECEIVER/VALUES'].should.have.property(
            'COLOR_BEHAVIOUR',
        );
    });

    it("the signal editor's channel list has the BSL and the OPTICAL_SIGNAL_RECEIVER channels", async () => {
        const {text} = await helper.request().get(`/ccu?config=nc&type=signal&iface=${IFACE}`).expect(200);
        JSON.parse(text).should.eql({
            'BSL00000000002:8': {type: 'DIMMER_VIRTUAL_RECEIVER', deviceType: 'HmIP-BSL'},
            'BSL00000000001:8': {type: 'DIMMER_VIRTUAL_RECEIVER', deviceType: 'HmIP-BSL'},
            'WRC00000000006:7': {type: 'OPTICAL_SIGNAL_RECEIVER', deviceType: 'HmIPW-WRC6'},
        });
    });

    it("the display editor's channel list has the HmIP-WRCD's channel 3", async () => {
        const {text} = await helper.request().get(`/ccu?config=nc&type=display&iface=${IFACE}`).expect(200);
        JSON.parse(text).should.eql({'WRCD0000000001:3': {type: 'HmIP-WRCD'}});
    });

    it('a BSL 2.0.2 gets COLOR_BEHAVIOUR in the one putParamset: ON for a flow of before, the setting otherwise', async () => {
        helper.getNode('bsl2').receive({});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        hmip.putParamsets[0].should.eql([
            'BSL00000000002:8',
            'VALUES',
            {
                LEVEL: 0.5,
                RAMP_TIME_UNIT: 'S',
                RAMP_TIME_VALUE: 0,
                DURATION_UNIT: 'M',
                DURATION_VALUE: 31,
                COLOR: 4,
                COLOR_BEHAVIOUR: 1,
            },
        ]);
        helper.getNode('bsl2blink').receive({});
        (await until(() => hmip.putParamsets.length === 2, 5000)).should.be.true();
        hmip.putParamsets[1][2].COLOR_BEHAVIOUR.should.equal(3);
        helper.getNode('bsl2blink').receive({config: {colorBehaviour: 'BILLOW_FAST', dimmerColor: 1}});
        (await until(() => hmip.putParamsets.length === 3, 5000)).should.be.true();
        hmip.putParamsets[2][2].should.have.properties({COLOR_BEHAVIOUR: 10, COLOR: 1});
        hmip.setValues.should.eql([]);
    });

    it('a BSL 1.0.2 gets what it got before, whatever the node is set to', async () => {
        helper.getNode('bsl1').receive({});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        hmip.putParamsets[0].should.eql([
            'BSL00000000001:8',
            'VALUES',
            {LEVEL: 0.5, RAMP_TIME_UNIT: 'S', RAMP_TIME_VALUE: 0, DURATION_UNIT: 'M', DURATION_VALUE: 31, COLOR: 4},
        ]);
    });

    it('an OPTICAL_SIGNAL_RECEIVER takes the same command', async () => {
        helper.getNode('wrc6').receive({});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        hmip.putParamsets[0][0].should.equal('WRC00000000006:7');
        hmip.putParamsets[0][2].should.have.properties({COLOR: 4, COLOR_BEHAVIOUR: 8, LEVEL: 0.5});
    });

    it('the HmIP-WRCD gets its lines and the sound in one setValue of COMBINED_PARAMETER', async () => {
        helper.getNode('wrcd').receive({});
        (await until(() => hmip.setValues.length === 1, 5000)).should.be.true();
        hmip.setValues[0].should.eql([
            'WRCD0000000001:3',
            'COMBINED_PARAMETER',
            '{DDBC=WHITE,DDTC=BLACK,DDI=2,DDA=LEFT,DDS=K³che,DDID=1},' +
                '{DDBC=BLACK,DDTC=WHITE,DDI=0,DDA=CENTER,DDS=21.5 C,DDID=2,DDC=true},{R=1,IN=10,ANS=6}',
        ]);
        await wait(600);
        helper.getNode('wrcd').receive({line1: 'Bad', icon1: 'FLAME', disable2: true, config: {wrcdSound: ''}});
        (await until(() => hmip.setValues.length === 2, 5000)).should.be.true();
        hmip.setValues[1][2].should.equal('{DDBC=WHITE,DDTC=BLACK,DDI=23,DDA=LEFT,DDS=Bad,DDID=1,DDC=true}');
        hmip.putParamsets.should.eql([]);
    });
});
