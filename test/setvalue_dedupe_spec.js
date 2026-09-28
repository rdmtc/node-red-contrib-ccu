/* B-19 (#151): the queued write's dedupe compared the new value with the
   value cache, and the cache of a control channel (HmIP-FROLL/BROLL :4,
   status in :3) holds the echo of our own last write for good - a blind
   moved by hand reports no new set point there, so the same set point could
   never be sent again. Now a cached value that is the echo of our own last
   write does not dedupe, and the value node has a force option (also via
   msg.config), as set-value has it; set-value's own pre-check no longer
   drops a forced write. A fake rfd records what is written; the cache is
   set by hand as the device would through its events. */

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const binrpc = require('binrpc');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeValue = require('../nodes/ccu-value.js');
const nodeSetValue = require('../nodes/ccu-set-value.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'BidCos-RF';
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const BLIND = 'B19BLIND01';

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** the device table as the cache would hold it: a blind with a status (:3) and a control (:4) channel */
function writeDeviceCache() {
    const channel = (index, type) => ({
        ADDRESS: BLIND + ':' + index,
        TYPE: type,
        PARENT: BLIND,
        PARENT_TYPE: 'HmIP-FROLL',
        PARAMSETS: ['VALUES'],
        INDEX: index,
    });
    fs.writeFileSync(
        CACHE_FILES[0],
        JSON.stringify({
            devices: {
                [IFACE]: {
                    [BLIND]: {
                        ADDRESS: BLIND,
                        TYPE: 'HmIP-FROLL',
                        PARAMSETS: ['MASTER'],
                        CHILDREN: [BLIND + ':3', BLIND + ':4'],
                    },
                    [BLIND + ':3']: channel(3, 'BLIND_TRANSMITTER'),
                    [BLIND + ':4']: channel(4, 'BLIND_VIRTUAL_RECEIVER'),
                },
            },
            types: {[IFACE]: {'HmIP-FROLL': [BLIND]}},
        }),
    );
}

function flow({valueForce = false, setValueForce = false} = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'dedupe',
            host: HOST,
            regaEnabled: false,
            bcrfEnabled: true,
            bcrfBinRpc: true,
            iprfEnabled: false,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            rpcBinPort: '2097',
            rpcXmlPort: '2098',
        },
        {
            id: 'nv',
            type: 'ccu-value',
            name: 'blind',
            iface: IFACE,
            channel: BLIND + ':4',
            datapoint: 'LEVEL',
            ccuConfig: 'nc',
            queue: true,
            force: valueForce,
            start: false,
            change: false,
            cache: false,
            topic: '',
            wires: [[]],
        },
        {
            id: 'nsv',
            type: 'ccu-set-value',
            name: 'set',
            iface: IFACE,
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
            channel: BLIND + ':4',
            channelRx: 'str',
            channelName: '',
            channelNameRx: 'str',
            channelType: '',
            channelTypeRx: 'str',
            datapoint: 'LEVEL',
            datapointRx: 'str',
            force: setValueForce,
            ccuConfig: 'nc',
        },
    ];
}

/** a fake rfd: accepts init, records every setValue */
function fakeRfd() {
    const writes = [];
    const server = binrpc.createServer({host: HOST, port: 2001});
    server.on('init', (err, params, callback) => callback(null, ''));
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('ping', (err, params, callback) => callback(null, true));
    server.on('setValue', (err, params, callback) => {
        writes.push(params);
        callback(null, '');
    });
    server.on('NotFound', () => {});
    return {writes, close: () => server.close()};
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

/** what an event from the device leaves in the value cache */
function cached(nc, value, extra = {}) {
    nc.values[IFACE + '.' + BLIND + ':4.LEVEL'] = {
        value,
        cache: false,
        uncertain: false,
        ts: Date.now(),
        datapointName: IFACE + '.' + BLIND + ':4.LEVEL',
        ...extra,
    };
}

/** the write the fake rfd recorded, its value as a number */
function written(rfd, index) {
    const [address, datapoint, value] = rfd.writes[index];
    return [address, datapoint, Number(value)];
}

describe('queued writes and the value cache (B-19)', function () {
    this.timeout(20000);
    let rfd;
    let nc;

    async function start(options) {
        removeCache();
        writeDeviceCache();
        rfd = fakeRfd();
        await load([nodeConnection, nodeValue, nodeSetValue], flow(options));
        nc = helper.getNode('nc');
        (await until(() => nc.ifaceStatus[IFACE], 5000)).should.be.true();
        // the throttle would defer a second write to the same datapoint
        nc.setValueThrottle = 1;
        nc.queuePause = 1;
        // the control channel's VALUES description, as getParamsetDescription would cache it
        const channel = nc.metadata.devices[IFACE][BLIND + ':4'];
        nc.paramsetDescriptions[nc.paramsetName(IFACE, channel, 'VALUES')] = {
            LEVEL: {TYPE: 'FLOAT', MIN: 0, MAX: 1, DEFAULT: 0, OPERATIONS: 7, FLAGS: 1, UNIT: '100%', ID: 'LEVEL'},
        };
    }

    before((done) => {
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        await rfd.close();
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it("a value the cache knows from another source is not sent again (today's dedupe)", async () => {
        await start();
        cached(nc, 1);
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 1, false);
        rfd.writes.length.should.equal(0);
    });

    it('the echo of our own write does not dedupe: the set point goes out again after manual operation', async () => {
        await start();
        cached(nc, 0.3);
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 1, false);
        rfd.writes.length.should.equal(1);
        written(rfd, 0).should.deepEqual([BLIND + ':4', 'LEVEL', 1]);
        // the control channel echoes our set point ...
        await wait(5);
        cached(nc, 1);
        // ... the blind is moved by hand (the status channel :3 changes, :4 keeps 1) and the flow sends 1 again
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 1, false);
        rfd.writes.length.should.equal(2);
        // and again - the echo stays the echo until another source reports
        await wait(5);
        cached(nc, 1);
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 1, false);
        rfd.writes.length.should.equal(3);
        // someone else moves it to 0.5 and the channel reports it: 0.5 dedupes, it is not our echo
        cached(nc, 0.5);
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 0.5, false);
        rfd.writes.length.should.equal(3);
        // a different set point always goes out
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 0.8, false);
        rfd.writes.length.should.equal(4);
        written(rfd, 3)[2].should.equal(0.8);
    });

    it('force sends regardless of the cache', async () => {
        await start();
        cached(nc, 1);
        await nc.setValueQueued(IFACE, BLIND + ':4', 'LEVEL', 1, false, true);
        rfd.writes.length.should.equal(1);
    });

    it('the value node: force in the configuration and through msg.config', async () => {
        await start({valueForce: true});
        const nv = helper.getNode('nv');
        cached(nc, 1);
        nv.receive({payload: 1});
        (await until(() => rfd.writes.length === 1, 2000)).should.be.true();
        // the same message with force switched off for this message dedupes
        nv.receive({payload: 1, config: {force: false}});
        await wait(400);
        rfd.writes.length.should.equal(1);
    });

    it('the value node without force: the dedupe against another source still holds, our echo does not', async () => {
        await start();
        const nv = helper.getNode('nv');
        cached(nc, 1);
        nv.receive({payload: 1});
        await wait(400);
        rfd.writes.length.should.equal(0);
        nv.receive({payload: 1, config: {force: true}});
        (await until(() => rfd.writes.length === 1, 2000)).should.be.true();
        // the echo of that write arrives, later the blind is moved by hand
        await wait(5);
        cached(nc, 1);
        nv.receive({payload: 1});
        (await until(() => rfd.writes.length === 2, 2000)).should.be.true();
    });

    it('the set-value node: a forced write is no longer dropped by its own pre-check', async () => {
        await start({setValueForce: true});
        const nsv = helper.getNode('nsv');
        cached(nc, 1);
        nsv.receive({payload: 1});
        (await until(() => rfd.writes.length === 1, 2000)).should.be.true();
        written(rfd, 0).should.deepEqual([BLIND + ':4', 'LEVEL', 1]);
    });

    it('the set-value node without force still dedupes against another source', async () => {
        await start();
        const nsv = helper.getNode('nsv');
        cached(nc, 1);
        nsv.receive({payload: 1});
        await wait(400);
        rfd.writes.length.should.equal(0);
        // it does address the datapoint: a different value goes out
        nsv.receive({payload: 0.2});
        (await until(() => rfd.writes.length === 1, 2000)).should.be.true();
        written(rfd, 0).should.deepEqual([BLIND + ':4', 'LEVEL', 0.2]);
    });
});
