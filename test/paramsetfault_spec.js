/* B-36: a device deleted while Node-RED was not running stays in the cache
   files (the device table, the values cache) until the interface process
   says so. Its paramset descriptions were then asked for again and again,
   every "Invalid device" fault recreated the RPC client and was logged
   twice, without the address. Here, on hm-simulator 1.x with the lab
   fixture and its ReGa mock:
   - the start prunes metadata.types and the values cache against the
     device table; deleteDevices prunes the description queue, the type
     list and the values of the device and its channels;
   - a refused description is asked for once per address and paramset,
     with one warn line naming both, and the client is kept;
   - methodCall tells a fault from a transport error: only the latter
     replaces the client.
   The addresses of the "deleted" devices are made up. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim.js');
const lab = require('hm-simulator/data/fixtures/lab-2026-09.json');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const IFACE = 'HmIP-RF';
const [TABLE_FILE, REGA_FILE, VALUES_FILE] = [
    'ccu_127.0.0.1.json',
    'ccu_rega_127.0.0.1.json',
    'ccu_values_127.0.0.1.json',
].map((f) => path.join(__dirname, '..', f));
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-paramsetfault-paramsets.json');

// a remote deleted from the CCU while Node-RED was down (made-up address, a firmware no
// paramsets.json knows, so its descriptions are missing and would be fetched)
const STALE = '0000000000DEAD';
// the lab fixture's HmIP-BBL, which the simulator knows
const REAL = '00000000000004';

function removeFiles() {
    for (const file of [TABLE_FILE, REGA_FILE, VALUES_FILE, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function staleDevice(address) {
    const children = [0, 1, 2].map((i) => address + ':' + i);
    const entries = {
        [address]: {
            ADDRESS: address,
            TYPE: 'HmIP-WRC2',
            FIRMWARE: '9.9.9',
            VERSION: 99,
            PARAMSETS: ['MASTER', 'SERVICE'],
            CHILDREN: children,
        },
    };
    children.forEach((c, i) => {
        entries[c] = {
            ADDRESS: c,
            TYPE: i === 0 ? 'MAINTENANCE' : 'KEY_TRANSCEIVER',
            PARENT: address,
            PARENT_TYPE: 'HmIP-WRC2',
            INDEX: i,
            FIRMWARE: '9.9.9',
            VERSION: 99,
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
        };
    });
    return entries;
}

/** the simulator's own HmIP device table as the connection would have cached it */
function realTable() {
    const table = {};
    lab.devices.hmip.devices
        .filter((d) => d.ADDRESS === REAL || d.PARENT === REAL)
        .forEach((d) => {
            table[d.ADDRESS] = structuredClone(d);
        });
    return table;
}

function flow(regaEnabled) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'b36',
            host: HOST,
            regaEnabled,
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
            rpcBinPort: '2137',
            rpcXmlPort: '2138',
        },
    ];
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

function lines(id, level) {
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === helper.log()[level])
        .map((l) => String(l.msg));
}

describe('stale cache entries and refused paramset descriptions (B-36)', function () {
    this.timeout(30000);
    let sim;
    let nc;
    let calls;

    async function start({cache, values, regaValues} = {}) {
        removeFiles();
        if (cache) {
            fs.writeFileSync(TABLE_FILE, JSON.stringify(cache));
        }

        if (values) {
            fs.writeFileSync(VALUES_FILE, JSON.stringify({values}));
        }

        sim = new HmSim({
            // only the blind actuator: the whole fixture's descriptions take minutes at 200 ms each
            devices: {hmip: {devices: Object.values(realTable())}},
            paramsetDescriptions: lab.paramsetDescriptions,
            behaviorPath: false,
            rega: regaValues ? {port: 8181, values: regaValues} : undefined,
            config: {listenAddress: HOST, xmlrpcListenPort: 2010},
        });
        await sim.whenReady();

        await load([nodeConnection], flow(Boolean(regaValues)));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        nc.valuesPruneDelay = 500;
        // count what the connection asks for (the description queue starts a second after the
        // first push, so nothing it fetches is missed)
        calls = [];
        const {methodCall} = nc;
        nc.methodCall = function (iface, method, parameters, options) {
            calls.push({iface, method, parameters});
            return methodCall.call(this, iface, method, parameters, options);
        };

        (await until(() => nc.ifaceStatus[IFACE], 5000)).should.be.true();
    }

    /** how often the HmIP-RF client was built: createClient logs it, at info or (quiet) at debug */
    function created() {
        return helper
            .log()
            .args.map((a) => a[0])
            .filter((l) => l && l.id === 'nc' && String(l.msg).startsWith('rpc client ' + IFACE + ' ')).length;
    }

    function descriptionCalls(address) {
        return calls.filter(
            (c) =>
                c.method === 'getParamsetDescription' &&
                (c.parameters[0] === address || c.parameters[0].startsWith(address + ':')),
        );
    }

    function faultWarns(address) {
        return lines('nc', 'WARN').filter((m) => m.startsWith('getParamsetDescription ' + IFACE + ' ' + address));
    }

    before((done) => {
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        if (sim) {
            await sim.close();
            sim = null;
        }

        removeFiles();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a device deleted while Node-RED was down: the start prunes types and values, deleteDevices the rest; no client is recreated', async () => {
        const devices = {...realTable(), ...staleDevice(STALE)};
        const cache = {
            devices: {[IFACE]: devices},
            types: {
                [IFACE]: {
                    'HmIP-BBL': [REAL],
                    'HmIP-WRC2': [STALE],
                    // an earlier deleted device whose address only the type list kept
                    'HmIP-SWDO': ['0000000000BEEF'],
                },
            },
        };
        const values = {
            [IFACE + '.' + REAL + ':4.LEVEL']: {payload: 0.5, value: 0.5, ts: 1},
            [IFACE + '.' + STALE + ':1.PRESS_SHORT']: {payload: true, value: true, ts: 1},
            [IFACE + '.' + STALE + ':0.UNREACH']: {payload: false, value: false, ts: 1},
            // a device the table forgot long ago, still in the values cache (the production finding)
            [IFACE + '.0000000000BEEF:1.STATE']: {payload: false, value: false, ts: 1},
        };
        await start({cache, values});

        // the start prune: the long-gone device left types and values at once
        should(nc.metadata.types[IFACE]['HmIP-SWDO']).be.undefined();
        should(nc.values[IFACE + '.0000000000BEEF:1.STATE']).be.undefined();
        lines('nc', 'INFO')
            .some((m) => m.startsWith('values cache: dropped 1 values'))
            .should.be.true();

        // hmipserver's deleteDevices (the simulator diffs our listDevices answer) removes the stale remote.
        // It deletes and re-adds the blind actuator as well, as hmipserver does with every device at an
        // init (eq-3/occu#45) - that one keeps its cached value
        (await until(() => !nc.metadata.devices[IFACE][STALE], 5000)).should.be.true();
        (await until(() => !nc.metadata.devices[IFACE][STALE + ':2'], 2000)).should.be.true();
        (await until(() => nc.metadata.devices[IFACE][REAL + ':4'], 2000)).should.be.true();
        should(nc.metadata.types[IFACE]['HmIP-WRC2']).be.undefined();
        nc.metadata.types[IFACE]['HmIP-BBL'].should.deepEqual([REAL]);
        nc.paramsetQueue.filter((item) => item.address.startsWith(STALE)).length.should.equal(0);
        (
            await until(() => Object.keys(nc.values).filter((dp) => dp.includes(STALE)).length === 0, 3000)
        ).should.be.true();
        nc.values.should.have.property(IFACE + '.' + REAL + ':4.LEVEL');
        lines('nc', 'INFO')
            .some((m) => m.startsWith('values cache: dropped 2 values'))
            .should.be.true();

        // the queue drains; the stale remote got at most one call per address and paramset
        (await until(() => nc.paramsetQueue.length === 0 && !nc.paramsetPending, 10000)).should.be.true();
        const asked = descriptionCalls(STALE).map((c) => c.parameters.join('/'));
        new Set(asked).size.should.equal(asked.length);
        faultWarns(STALE).length.should.be.belowOrEqual(asked.length);
        // nothing the stale entry caused replaced the HmIP-RF client: built once, at the start
        created().should.equal(1);

        // and the files say the same
        const saved = Object.keys(JSON.parse(fs.readFileSync(VALUES_FILE)).values);
        saved.should.containEql(IFACE + '.' + REAL + ':4.LEVEL');
        saved.filter((dp) => dp.includes(STALE) || dp.includes('BEEF')).length.should.equal(0);
        JSON.stringify(JSON.parse(fs.readFileSync(TABLE_FILE))).should.not.containEql(STALE);
    });

    it('a refused description is asked for once per address and paramset, with one warn line, and the client stays', async () => {
        await start();
        (await until(() => nc.paramsetQueue.length === 0 && !nc.paramsetPending, 10000)).should.be.true();
        const client = nc.clients[IFACE];
        const before = created();

        // a device in the table the interface does not know - every event of it looks its description up.
        // hmipserver answers -2 Invalid device for it (checked on 3.89.11); hm-simulator 1.3.1 answers
        // an empty string for an unknown address, so the fault is injected
        sim.injectFault({iface: 'hmip', method: 'getParamsetDescription', times: Infinity, fault: 'unknownInstance'});
        Object.assign(nc.metadata.devices[IFACE], staleDevice(STALE));
        for (let i = 0; i < 5; i++) {
            nc.getParamsetDescription(IFACE, nc.metadata.devices[IFACE][STALE + ':1'], 'VALUES', 'PRESS_SHORT');
            nc.getParamsetDescription(IFACE, nc.metadata.devices[IFACE][STALE + ':2'], 'VALUES', 'PRESS_SHORT');
            nc.getParamsetDescription(IFACE, nc.metadata.devices[IFACE][STALE], 'MASTER');
            await wait(300);
        }

        (await until(() => nc.paramsetQueue.length === 0 && !nc.paramsetPending, 10000)).should.be.true();
        // :1 and :2 share their description keys, so only one of them is asked: the device's
        // MASTER and SERVICE plus one channel's MASTER, VALUES and LINK - once each
        const asked = descriptionCalls(STALE).map((c) => c.parameters.join('/'));
        asked.length.should.equal(5);
        new Set(asked).size.should.equal(5);
        const warns = faultWarns(STALE);
        warns.length.should.equal(5);
        warns[0].should.match(
            /^getParamsetDescription HmIP-RF 0000000000DEAD(:\d)? (MASTER|SERVICE|VALUES|LINK) fault -2 /,
        );
        // nothing at error level about it (the old double "< HmIP-RF getParamsetDescription Error: ..." lines)
        lines('nc', 'ERROR')
            .filter((m) => m.includes('getParamsetDescription'))
            .length.should.equal(0);
        nc.clients[IFACE].should.equal(client);
        created().should.equal(before);

        // more lookups ask nothing
        nc.getParamsetDescription(IFACE, nc.metadata.devices[IFACE][STALE + ':1'], 'VALUES', 'PRESS_SHORT');
        await wait(1500);
        descriptionCalls(STALE).length.should.equal(5);

        // the device paired anew (newDevices) is asked again
        nc.newDevice(IFACE, {...nc.metadata.devices[IFACE][STALE + ':1'], VERSION: 100});
        await wait(1500);
        descriptionCalls(STALE).length.should.be.above(5);
    });

    it('methodCall: a fault keeps the client and logs one line with the arguments, a transport error replaces it', async () => {
        await start();
        const client = nc.clients[IFACE];
        const before = created();

        sim.injectFault({iface: 'hmip', method: 'getParamsetDescription', fault: 'unknownInstance'});
        const fault = await nc.methodCall(IFACE, 'getParamsetDescription', [STALE + ':1', 'VALUES']).then(
            () => null,
            (error) => error,
        );
        should(fault).be.ok();
        fault.faultCode.should.equal(-2);
        fault.faultString.should.equal('Invalid device');
        nc.clients[IFACE].should.equal(client);
        created().should.equal(before);
        const faultLines = lines('nc', 'ERROR').filter((m) => m.includes(STALE));
        faultLines.length.should.equal(1);
        faultLines[0].should.equal(
            '    < HmIP-RF getParamsetDescription ["' + STALE + ':1","VALUES"] fault -2 Invalid device',
        );

        sim.injectFault({iface: 'hmip', method: 'getVersion', closeSocket: true});
        const transport = await nc.methodCall(IFACE, 'getVersion', []).then(
            () => null,
            (error) => error,
        );
        should(transport).be.ok();
        should(transport.faultCode).be.undefined();
        created().should.equal(before + 1);
        nc.clients[IFACE].should.not.equal(client);
    });

    it("ReGa's values of a device no longer in the table leave the values cache and its file again", async () => {
        const cache = {devices: {[IFACE]: realTable()}, types: {[IFACE]: {'HmIP-BBL': [REAL]}}};
        await start({
            cache,
            regaValues: [
                {name: IFACE + '.' + REAL + ':4.LEVEL', value: 0.25, ts: '2026-01-01 12:00:00'},
                {name: IFACE + '.' + STALE + ':1.PRESS_SHORT', value: false, ts: '2026-01-01 12:00:00'},
                {name: IFACE + '.' + STALE + ':0.UNREACH', value: false, ts: '2026-01-01 12:00:00'},
            ],
        });
        (await until(() => nc.cachedValuesReceived, 10000)).should.be.true();
        // ReGa still reports the deleted remote's datapoints; the prune follows a moment later
        (
            await until(() => Object.keys(nc.values).filter((dp) => dp.includes(STALE)).length === 0, 3000)
        ).should.be.true();
        Object.keys(nc.values).should.containEql(IFACE + '.' + REAL + ':4.LEVEL');
        lines('nc', 'INFO')
            .some((m) => m.startsWith('values cache: dropped 2 values'))
            .should.be.true();
        const saved = Object.keys(JSON.parse(fs.readFileSync(VALUES_FILE)).values);
        saved.should.containEql(IFACE + '.' + REAL + ':4.LEVEL');
        saved.filter((dp) => dp.includes(STALE)).length.should.equal(0);
    });
});
