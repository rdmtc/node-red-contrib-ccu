/* Fewer writes to the persistent storage (an SD card on a CCU):
   - the names file is not rewritten when a re-read of the names brought nothing new, and the
     device table is not rewritten at a start that found it as it was;
   - the values file is written at stop, and at the next start (a redeploy) not again while the
     interval has not passed; with the interval 0 never while running;
   - fetched paramset descriptions the file holds as they are already do not rewrite it, and the
     shipped file is not copied into the userDir before something is to be added to it.
   hm-simulator with the ReGa and HmIP-RF stands in. */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeConnection = require('../nodes/ccu-connection.js');
const {removeFiles, hmSimOptions, simPorts, userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const VALUES = path.join(userDir(), 'ccu_values_localhost.json');
const REGA = path.join(userDir(), 'ccu_rega_localhost.json');
const METADATA = path.join(userDir(), 'ccu_localhost.json');
const PARAMSETS = path.join(userDir(), 'nrccu-writes-paramsets.json');

function flow(sim, extra = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'writes',
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
            ...simPorts(sim),
            ...extra,
        },
    ];
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

function lines(level) {
    const levels = {INFO: helper.log().INFO, WARN: helper.log().WARN, DEBUG: helper.log().DEBUG};
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === 'nc' && l.level === levels[level])
        .map((l) => String(l.msg));
}

const saved = (what) => lines('INFO').filter((l) => l.startsWith(what + ' saved to')).length;
const mtime = (file) => fs.statSync(file).mtimeMs;

describe('fewer writes to the persistent storage', function () {
    this.timeout(30000);
    let sim;
    let nc;

    async function start(extra) {
        await new Promise((resolve) => helper.load([nodeConnection], flow(sim, extra), resolve));
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS;
        (
            await until(() => nc.cachedValuesReceived && nc.ifaceStatus['HmIP-RF'] && nc.firstRegaPollDone, 15000)
        ).should.be.true();
        // the device table's debounced write
        await wait(1300);
    }

    function clean() {
        removeFiles();
        try {
            fs.unlinkSync(PARAMSETS);
        } catch {}
    }

    before(async () => {
        clean();
        sim = new HmSim(hmSimOptions());
        await sim.whenReady();
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
        clean();
    });

    after((done) => {
        sim.close();
        helper.stopServer(done);
    });

    it('the names re-read with nothing new and a start with the same device table write nothing', async () => {
        await start();
        await nc.refreshRegaData();
        const regaTime = mtime(REGA);
        const before = saved('regadata');
        await nc.refreshRegaData();
        await nc.refreshRegaData();
        saved('regadata').should.equal(before);
        mtime(REGA).should.equal(regaTime);
        lines('DEBUG')
            .some((l) => l === 'regadata unchanged, not written')
            .should.be.true();

        // a redeploy: the stop writes nothing new into the names and the device table, the start
        // finds both as they are
        const metadataTime = mtime(METADATA);
        await helper.unload();
        helper.log().resetHistory();
        await start();
        saved('regadata').should.equal(0);
        saved('metadata').should.equal(0);
        mtime(REGA).should.equal(regaTime);
        mtime(METADATA).should.equal(metadataTime);
    });

    it('the values file: written at the first start, not again at the start of a redeploy', async () => {
        await start();
        saved('values').should.equal(1);
        await helper.unload();
        const stopTime = mtime(VALUES);
        helper.log().resetHistory();
        await start();
        await wait(300);
        saved('values').should.equal(0);
        mtime(VALUES).should.equal(stopTime);
        // a resync while running waits for the interval as well
        await nc.saveValues();
        saved('values').should.equal(0);
        should(nc.valuesSaveTimer).be.ok();
    });

    it('the values file with the interval 0: never while running, at stop', async () => {
        await start({valuesSaveInterval: '0'});
        nc.valuesSaveInterval.should.equal(0);
        saved('values').should.equal(0);
        fs.existsSync(VALUES).should.be.false();
        await helper.unload();
        // the stop writes it
        fs.existsSync(VALUES).should.be.true();
        JSON.parse(fs.readFileSync(VALUES)).should.have.property('values');
    });

    it('the values file when the interval has passed: written while running', async () => {
        await start({valuesSaveInterval: '1'});
        saved('values').should.equal(1);
        // the file as written an hour ago
        const old = (Date.now() - 3600000) / 1000;
        fs.utimesSync(VALUES, old, old);
        await nc.saveValues();
        saved('values').should.equal(2);
    });

    it('paramsets: the shipped file is not copied, descriptions the file holds do not rewrite it', async () => {
        await start();
        // the test's file stands in for <userDir>/paramsets.json: none yet, the shipped one is read
        fs.existsSync(PARAMSETS).should.be.false();
        const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'paramsets.json')));
        const name = Object.keys(shipped)[0];
        nc.paramsetNew = {[name]: shipped[name]};
        await nc.saveParamsets();
        fs.existsSync(PARAMSETS).should.be.false();
        Object.keys(nc.paramsetNew).length.should.equal(0);

        // a new one: the whole set is written, with it
        nc.paramsetNew = {'HmIP-RF/TEST-WRITES/1.0.0/1/SWITCH/VALUES': {STATE: {TYPE: 'BOOL', ID: 'STATE'}}};
        await nc.saveParamsets();
        const file = JSON.parse(fs.readFileSync(PARAMSETS));
        file.should.have.property('HmIP-RF/TEST-WRITES/1.0.0/1/SWITCH/VALUES');
        file.should.have.property(name);
        const written = mtime(PARAMSETS);

        // the same once more: no write
        nc.paramsetNew = {'HmIP-RF/TEST-WRITES/1.0.0/1/SWITCH/VALUES': {STATE: {TYPE: 'BOOL', ID: 'STATE'}}};
        await nc.saveParamsets();
        mtime(PARAMSETS).should.equal(written);
    });
});
