/* task 2 (#156, #161): party mode on an HmIP thermostat is written atomically.
   A write to PARTY_TIME_START, PARTY_TIME_END or PARTY_SET_POINT_TEMPERATURE
   through the value nodes goes out as one putParamset on VALUES with all
   three - the current values of the other two from our own last write, the
   value cache, or a getParamset read - never as a lone setValue, which makes
   the device reset the other two. Any other datapoint of the channel still
   goes out as setValue. A fake hmipserver stands in. */

const fs = require('fs');
const os = require('os');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeSetValue = require('../nodes/ccu-set-value.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'HmIP-RF';
const DEVICE = '000A1709AE37B4';
const CHANNEL = DEVICE + ':1';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
// fetched paramset descriptions would be saved into the vendored paramsets.json (B-34)
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-party-paramsets.json');

function removeCache() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

const VALUES_DESCRIPTION = {
    PARTY_MODE: {TYPE: 'BOOL', OPERATIONS: 5, ID: 'PARTY_MODE'},
    PARTY_SET_POINT_TEMPERATURE: {TYPE: 'FLOAT', MIN: 4.5, MAX: 30.5, OPERATIONS: 5, ID: 'PARTY_SET_POINT_TEMPERATURE'},
    PARTY_TIME_END: {TYPE: 'STRING', OPERATIONS: 7, ID: 'PARTY_TIME_END'},
    PARTY_TIME_START: {TYPE: 'STRING', OPERATIONS: 7, ID: 'PARTY_TIME_START'},
    SET_POINT_TEMPERATURE: {TYPE: 'FLOAT', MIN: 4.5, MAX: 30.5, OPERATIONS: 7, ID: 'SET_POINT_TEMPERATURE'},
};

function flow() {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'party',
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
            rpcBinPort: '2157',
            rpcXmlPort: '2158',
        },
        {id: 'sv', type: 'ccu-set-value', ccuConfig: 'nc', iface: '', channel: '', datapoint: '', wires: [[]]},
    ];
}

/** the fake hmipserver on 2010 with one eTRV: init, listDevices, the descriptions, get/putParamset, setValue */
function fakeHmipServer() {
    const state = {
        inits: [],
        setValues: [],
        putParamsets: [],
        getParamsets: 0,
        // what the device holds now, answered by getParamset
        device: {
            PARTY_MODE: false,
            PARTY_SET_POINT_TEMPERATURE: 18,
            PARTY_TIME_END: '2000_01_01 00:00',
            PARTY_TIME_START: '2000_01_01 00:00',
            SET_POINT_TEMPERATURE: 21,
        },
    };
    // an eTRV-2 whose VALUES description is in the vendored paramsets.json
    // (HmIP-RF/HmIP-eTRV-2/1.8.0/3/HEATING_CLIMATECONTROL_TRANSCEIVER/VALUES)
    const list = [
        {
            ADDRESS: DEVICE,
            TYPE: 'HmIP-eTRV-2',
            VERSION: 3,
            FIRMWARE: '1.8.0',
            PARAMSETS: ['MASTER'],
            CHILDREN: [CHANNEL],
        },
        {
            ADDRESS: CHANNEL,
            TYPE: 'HEATING_CLIMATECONTROL_TRANSCEIVER',
            PARENT: DEVICE,
            PARENT_TYPE: 'HmIP-eTRV-2',
            VERSION: 3,
            INDEX: 1,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ];
    const server = xmlrpc.createServer({host: HOST, port: 2010});
    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        state.inits.push(params);
        callback(null, '');
        if (id) {
            // like hmipserver: the device list comes as newDevices after the init
            const u = new URL(url);
            const client = xmlrpc.createClient({host: u.hostname, port: Number(u.port), path: '/'});
            setTimeout(() => client.methodCall('newDevices', [id, list], () => {}), 50);
        }
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('listDevices', (err, params, callback) => callback(null, list));
    server.on('getParamsetDescription', (err, params, callback) =>
        callback(null, params[1] === 'VALUES' && params[0] === CHANNEL ? VALUES_DESCRIPTION : {}),
    );
    server.on('getParamset', (err, params, callback) => {
        state.getParamsets += 1;
        callback(null, params[0] === CHANNEL && params[1] === 'VALUES' ? state.device : {});
    });
    server.on('putParamset', (err, params, callback) => {
        state.putParamsets.push(params);
        Object.assign(state.device, params[2]);
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

function load(nodes, flowJson) {
    return new Promise((resolve) => helper.load(nodes, flowJson, resolve));
}

describe('party mode on an HmIP thermostat is written atomically (task 2, #156, #161)', function () {
    this.timeout(30000);
    let hmip;
    let nc;
    let sv;

    before((done) => {
        helper.startServer(done);
    });

    beforeEach(async () => {
        removeCache();
        hmip = fakeHmipServer();
        await load([nodeConnection, nodeSetValue], flow());
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        sv = helper.getNode('sv');
        (
            await until(
                () =>
                    nc.ifaceStatus[IFACE] &&
                    nc.metadata.devices[IFACE] &&
                    nc.metadata.devices[IFACE][CHANNEL] &&
                    nc.getParamsetDescription(IFACE, nc.metadata.devices[IFACE][CHANNEL], 'VALUES', 'PARTY_TIME_START'),
                8000,
            )
        ).should.be.true();
    });

    afterEach(async () => {
        await helper.unload();
        await hmip.close();
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a write to one party datapoint goes out as one putParamset with all three, read from the device when the cache is empty', async () => {
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_TIME_START', payload: '2026_12_24 18:00'});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        const [address, paramset, values] = hmip.putParamsets[0];
        address.should.equal(CHANNEL);
        paramset.should.equal('VALUES');
        values.should.deepEqual({
            PARTY_TIME_START: '2026_12_24 18:00',
            PARTY_TIME_END: '2000_01_01 00:00',
            PARTY_SET_POINT_TEMPERATURE: 18,
        });
        hmip.getParamsets.should.equal(1);
        hmip.setValues.should.deepEqual([]);
    });

    it('the second and third write carry the first ones along: our own last write wins over a stale cache', async () => {
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_TIME_START', payload: '2026_12_24 18:00'});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_TIME_END', payload: '2026_12_26 10:00'});
        (await until(() => hmip.putParamsets.length === 2, 5000)).should.be.true();
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_SET_POINT_TEMPERATURE', payload: 21.5});
        (await until(() => hmip.putParamsets.length === 3, 5000)).should.be.true();
        hmip.putParamsets[2][2].should.deepEqual({
            PARTY_TIME_START: '2026_12_24 18:00',
            PARTY_TIME_END: '2026_12_26 10:00',
            PARTY_SET_POINT_TEMPERATURE: 21.5,
        });
        // the device was read once, for the first write; the others knew the values from our writes
        hmip.getParamsets.should.equal(1);
        hmip.setValues.should.deepEqual([]);
    });

    it('a Date or an ISO string for a party time is written in the device format', async () => {
        const start = new Date(2026, 11, 24, 18, 0);
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_TIME_START', payload: start});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        hmip.putParamsets[0][2].PARTY_TIME_START.should.equal('2026_12_24 18:00');
        sv.receive({
            iface: IFACE,
            channel: CHANNEL,
            datapoint: 'PARTY_TIME_END',
            payload: new Date(2026, 11, 26, 10, 0).toISOString(),
        });
        (await until(() => hmip.putParamsets.length === 2, 5000)).should.be.true();
        hmip.putParamsets[1][2].PARTY_TIME_END.should.equal('2026_12_26 10:00');
    });

    it('the cached values reported by the device are used, so no read is needed', async () => {
        nc.values[IFACE + '.' + CHANNEL + '.PARTY_TIME_END'] = {value: '2026_12_26 10:00', ts: Date.now()};
        nc.values[IFACE + '.' + CHANNEL + '.PARTY_SET_POINT_TEMPERATURE'] = {value: 20, ts: Date.now()};
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'PARTY_TIME_START', payload: '2026_12_24 18:00'});
        (await until(() => hmip.putParamsets.length === 1, 5000)).should.be.true();
        hmip.putParamsets[0][2].should.deepEqual({
            PARTY_TIME_START: '2026_12_24 18:00',
            PARTY_TIME_END: '2026_12_26 10:00',
            PARTY_SET_POINT_TEMPERATURE: 20,
        });
        hmip.getParamsets.should.equal(0);
    });

    it('any other datapoint of the channel still goes out as setValue', async () => {
        sv.receive({iface: IFACE, channel: CHANNEL, datapoint: 'SET_POINT_TEMPERATURE', payload: 22});
        (await until(() => hmip.setValues.length === 1, 5000)).should.be.true();
        hmip.setValues[0][0].should.equal(CHANNEL);
        hmip.setValues[0][1].should.equal('SET_POINT_TEMPERATURE');
        hmip.putParamsets.should.deepEqual([]);
    });
});
