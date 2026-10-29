/* task 28: the paramset descriptions in memory are those of the device types present.
   - at start the descriptions of the cached device table's types come from the file, nothing
     else is held (the vendored file has ~2,800 keys);
   - a device whose type the file knows is not asked of the interface, one it does not know is
     fetched - and the fetched description lands in the file beside all the others (the file on
     disk keeps its complete format);
   - an obsolete ccu_paramsets_v2.json in the userDir is removed at start.
   A fake hmipserver stands in. */

const fs = require('fs');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');
const {userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'HmIP-RF';
const HMIP_PORT = 2167;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(userDir(), f),
);
const PARAMSETS_SCRATCH = path.join(userDir(), 'nrccu-paramsets-paramsets.json');
const OBSOLETE = path.join(userDir(), 'ccu_paramsets_v2.json');
const VENDORED = path.join(__dirname, '..', 'paramsets.json');

// a type the vendored file knows, with its firmware and version (18 keys there)
const KNOWN = {address: 'DEV0000SWDO', type: 'HmIP-SWDO-I', firmware: '1.14.0', version: 1};
const KNOWN_VALUES = 'HmIP-RF/HmIP-SWDO-I/1.14.0/1/SHUTTER_CONTACT/VALUES';
// a made-up one
const UNKNOWN = {address: 'DEV0000T9XX', type: 'HmIP-T9', firmware: '1.0.0', version: 1};

function removeFiles() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH, OBSOLETE]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow() {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'paramsets',
            host: HOST,
            iprfPort: String(HMIP_PORT),
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
            rpcBinPort: '2168',
            rpcXmlPort: '2169',
        },
    ];
}

function entries({address, type, firmware, version}, channelType) {
    return [
        {
            ADDRESS: address,
            TYPE: type,
            VERSION: version,
            FIRMWARE: firmware,
            PARAMSETS: ['MASTER'],
            CHILDREN: [address + ':1'],
        },
        {
            ADDRESS: address + ':1',
            TYPE: channelType,
            PARENT: address,
            PARENT_TYPE: type,
            VERSION: version,
            FIRMWARE: firmware,
            INDEX: 1,
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ];
}

/** the fake hmipserver: init, listDevices from `list`, getParamsetDescription counted */
function fakeHmipServer(list) {
    const state = {list, descriptions: [], callback: null, id: null};
    const server = xmlrpc.createServer({host: HOST, port: HMIP_PORT});
    const send = (method, params) =>
        new Promise((resolve) => {
            if (!state.callback) {
                resolve(false);
                return;
            }

            const url = new URL(state.callback);
            const client = xmlrpc.createClient({host: url.hostname, port: Number(url.port), path: '/'});
            client.methodCall(method, params, (err, res) => resolve(err ? null : res));
        });
    // like hmipserver: after an init it asks the client for its listDevices and sends newDevices
    // for every entry of its own list the answer does not hold
    state.readBack = async () => {
        const answer = (await send('listDevices', [state.id])) || [];
        const known = new Set(answer.map((d) => d.ADDRESS + '/' + d.VERSION));
        const missing = state.list.filter((d) => !known.has(d.ADDRESS + '/' + d.VERSION));
        if (missing.length > 0) {
            await send('newDevices', [state.id, missing]);
        }
    };
    server.on('init', (err, params, callback) => {
        const [url, id] = params;
        if (id) {
            state.callback = url;
            state.id = id;
            setTimeout(() => state.readBack(), 50);
        }

        callback(null, '');
    });
    server.on('getLinks', (err, params, callback) => callback(null, []));
    server.on('listDevices', (err, params, callback) => callback(null, state.list));
    server.on('getParamsetDescription', (err, params, callback) => {
        state.descriptions.push(params);
        callback(null, params[1] === 'VALUES' ? {STATE: {TYPE: 'BOOL', OPERATIONS: 7, ID: 'STATE'}} : {});
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

function infos(id) {
    const {INFO} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === INFO)
        .map((l) => String(l.msg));
}

describe('paramset descriptions in memory for the device types present (task 28)', function () {
    this.timeout(30000);
    let hmip;
    let nc;

    async function start(list, cache, obsolete) {
        removeFiles();
        if (cache) {
            fs.writeFileSync(CACHE_FILES[0], JSON.stringify(cache));
        }

        if (obsolete) {
            fs.writeFileSync(OBSOLETE, '{}');
        }

        // the scratch file stands in for <userDir>/paramsets.json: the vendored content, as a
        // first start copies it there
        fs.copyFileSync(VENDORED, PARAMSETS_SCRATCH);
        hmip = fakeHmipServer(list);
        await load([nodeConnection], flow());
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus[IFACE], 5000)).should.be.true();
    }

    before((done) => {
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        await hmip.close();
        removeFiles();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a known type comes from the file, an unknown one from the interface; the file keeps every description', async () => {
        await start([...entries(KNOWN, 'SHUTTER_CONTACT'), ...entries(UNKNOWN, 'SWITCH_VIRTUAL_RECEIVER')]);
        (
            await until(() => nc.metadata.devices[IFACE] && nc.metadata.devices[IFACE][UNKNOWN.address + ':1'], 5000)
        ).should.be.true();
        // the unknown type's three descriptions are fetched, the queue drains
        (
            await until(
                () => hmip.descriptions.length >= 3 && nc.paramsetQueue.length === 0 && !nc.paramsetPending,
                10000,
            )
        ).should.be.true();
        await wait(300);
        hmip.descriptions
            .every(([address]) => address.startsWith(UNKNOWN.address))
            .should.be.true('the known type was asked of the interface: ' + JSON.stringify(hmip.descriptions));
        // the known type's descriptions are in memory from the file, with their real content
        nc.paramsetDescriptions[KNOWN_VALUES].should.have.property('STATE');
        const unknownValues = nc.paramsetName(IFACE, nc.metadata.devices[IFACE][UNKNOWN.address + ':1'], 'VALUES');
        nc.paramsetDescriptions[unknownValues].should.have.property('STATE');
        // the memory holds the present types only, not the file's ~2,800 keys
        Object.keys(nc.paramsetDescriptions).length.should.be.below(40);
        // the file keeps them all, and gained the fetched ones
        (await until(() => Object.keys(nc.paramsetNew).length === 0, 10000)).should.be.true();
        const file = JSON.parse(fs.readFileSync(PARAMSETS_SCRATCH));
        Object.keys(file).length.should.be.above(2000);
        file.should.have.property(unknownValues);
        file[KNOWN_VALUES].should.have.property('STATE');
    });

    it('at start the cached device table decides what is loaded; the obsolete ccu_paramsets_v2.json goes', async () => {
        const table = {};
        for (const entry of entries(KNOWN, 'SHUTTER_CONTACT')) {
            table[entry.ADDRESS] = entry;
        }

        await start(
            entries(KNOWN, 'SHUTTER_CONTACT'),
            {devices: {[IFACE]: table}, types: {[IFACE]: {[KNOWN.type]: [KNOWN.address]}}},
            true,
        );
        // loaded at construction, from the userDir's file (the vendored one, copied there)
        nc.paramsetDescriptions[KNOWN_VALUES].should.have.property('STATE');
        Object.keys(nc.paramsetDescriptions).length.should.be.below(40);
        fs.existsSync(OBSOLETE).should.be.false();
        infos('nc')
            .some((m) => m.startsWith('removed the obsolete'))
            .should.be.true();
        infos('nc')
            .some((m) => m.startsWith('paramsets loaded from'))
            .should.be.true();
        // nothing is asked of the interface for it
        await wait(1500);
        hmip.descriptions.length.should.equal(0);
    });
});
