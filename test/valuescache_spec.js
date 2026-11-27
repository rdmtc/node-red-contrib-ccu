/* task 36: the connection node's values cache file. An old file (the whole message per datapoint)
   is read, the cached message carries the names, rooms and types of the metadata and regadata
   files, the file written at stop keeps only the value fields, and the next start builds the same
   message from it. No interface is enabled: only the cache files are involved. All data is made up. */

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');

const nodeConnection = require('../nodes/ccu-connection.js');
const {SAVED_FIELDS} = require('../nodes/lib/message.js');
const {userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.36';
const FILES = {
    metadata: path.join(userDir(), 'ccu_' + HOST + '.json'),
    regadata: path.join(userDir(), 'ccu_rega_' + HOST + '.json'),
    values: path.join(userDir(), 'ccu_values_' + HOST + '.json'),
};
const NAME = 'HmIP-RF.NRCC360000001:1.STATE';

const flow = [
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'values cache',
        host: HOST,
        regaEnabled: false,
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
    },
];

function removeFiles() {
    for (const file of Object.values(FILES)) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function writeMetadata() {
    fs.writeFileSync(
        FILES.metadata,
        JSON.stringify({
            devices: {
                'HmIP-RF': {
                    NRCC360000001: {ADDRESS: 'NRCC360000001', TYPE: 'HmIP-NRCC36', FIRMWARE: '1.0.0', VERSION: 1},
                    'NRCC360000001:1': {
                        ADDRESS: 'NRCC360000001:1',
                        PARENT: 'NRCC360000001',
                        TYPE: 'SWITCH_VIRTUAL_RECEIVER',
                    },
                },
            },
            types: {},
        }),
    );
    fs.writeFileSync(
        FILES.regadata,
        JSON.stringify({
            channelNames: {NRCC360000001: 'Testaktor', 'NRCC360000001:1': 'Testaktor Licht'},
            regaIdChannel: {},
            regaChannels: {},
            channelRooms: {'NRCC360000001:1': ['Testraum']},
            channelFunctions: {'NRCC360000001:1': ['Testlicht']},
            rooms: [],
            functions: [],
            groups: {},
        }),
    );
}

/** an entry as 4.14 wrote it: the whole message, its names from the time of its event */
const OLD_ENTRY = {
    topic: '',
    payload: true,
    ccu: HOST,
    iface: 'HmIP-RF',
    device: 'NRCC360000001',
    deviceName: 'Alter Name',
    deviceType: 'HmIP-NRCC36',
    channel: 'NRCC360000001:1',
    channelName: 'Alter Kanalname',
    channelType: 'SWITCH_VIRTUAL_RECEIVER',
    channelIndex: 1,
    datapoint: 'STATE',
    datapointName: NAME,
    value: true,
    valuePrevious: false,
    valueStable: true,
    rooms: [],
    functions: [],
    ts: 1700000000000,
    tsPrevious: 1690000000000,
    lc: 1700000000000,
    change: true,
    cache: false,
    uncertain: false,
    working: false,
    stable: true,
};

function load() {
    return new Promise((resolve) => helper.load([nodeConnection], flow, resolve));
}

describe('values cache file (task 36)', function () {
    this.timeout(20000);

    before(() => new Promise((resolve) => helper.startServer(resolve)));
    after(() => new Promise((resolve) => helper.stopServer(resolve)));
    beforeEach(() => {
        removeFiles();
        writeMetadata();
    });
    afterEach(async () => {
        await helper.unload();
        removeFiles();
    });

    it('reads the old format, writes the short one, and restores the same message from it', async () => {
        fs.writeFileSync(FILES.values, JSON.stringify({values: {[NAME]: OLD_ENTRY}}));
        await load();
        let nc = helper.getNode('nc');
        const first = nc.values[NAME];
        first.value.should.equal(true);
        first.payload.should.equal(true);
        first.valuePrevious.should.equal(false);
        first.ts.should.equal(1700000000000);
        first.tsPrevious.should.equal(1690000000000);
        first.cache.should.equal(true);
        first.change.should.equal(false);
        first.uncertain.should.equal(true);
        first.stable.should.equal(true);
        // the names of now, not the ones frozen at the datapoint's last event
        first.deviceName.should.equal('Testaktor');
        first.channelName.should.equal('Testaktor Licht');
        first.rooms.should.deepEqual(['Testraum']);
        first.room.should.equal('Testraum');
        first.function.should.equal('Testlicht');
        first.channelType.should.equal('SWITCH_VIRTUAL_RECEIVER');

        // a filter by name finds the cached value
        nc.cachedValuesReceived = true;
        const replayed = [];
        nc.subscribe({cache: true, channelName: 'Testaktor Licht', datapoint: 'STATE'}, (m) => replayed.push(m));
        replayed.length.should.equal(1);
        replayed[0].value.should.equal(true);

        await helper.unload();
        const written = JSON.parse(fs.readFileSync(FILES.values, 'utf8'));
        written.format.should.equal(2);
        written.values[NAME].should.deepEqual({
            value: true,
            ts: 1700000000000,
            lc: 1700000000000,
            valuePrevious: false,
            tsPrevious: 1690000000000,
            working: false,
        });
        for (const key of Object.keys(written.values[NAME])) {
            SAVED_FIELDS.should.containEql(key);
        }

        fs.readFileSync(FILES.values, 'utf8').should.not.containEql('\n');

        await load();
        nc = helper.getNode('nc');
        JSON.parse(JSON.stringify(nc.values[NAME])).should.deepEqual(JSON.parse(JSON.stringify(first)));
    });

    it('starts without a values file', async () => {
        await load();
        helper.getNode('nc').values.should.deepEqual({});
    });

    it('a broken values file starts empty', async () => {
        fs.writeFileSync(FILES.values, '{"values": ');
        await load();
        helper.getNode('nc').values.should.deepEqual({});
    });
});
