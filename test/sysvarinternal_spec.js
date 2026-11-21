/* #184: the internal system variables (the ones the CCU creates for devices, homematic-rega >= 2.1.0
   lists them with `internal: true`) only with the connection node's "Include internal system
   variables"; off by default. The alarm and service messages (40, 41, internal as well) are always
   there, as before. */

const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeConnection = require('../nodes/ccu-connection.js');
const nodeSysvar = require('../nodes/ccu-sysvar.js');
const {removeFiles, hmSimOptions, simPorts, connectionNode} = require('./utils');

helper.init(require.resolve('node-red'));

const RAIN = 'svHmIPRainCounterToday_1290_1';

function flow(regaInternal) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'localhost',
            host: 'localhost',
            regaEnabled: true,
            ...(regaInternal === undefined ? {} : {regaInternal}),
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
            rpcXmlPort: '2048',
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

        await wait(50);
    }

    return Boolean(predicate());
}

describe('internal system variables (#184)', function () {
    this.timeout(20000);
    let hmSim;

    before(async () => {
        removeFiles();
        hmSim = new HmSim(hmSimOptions());
        await new Promise((resolve) => helper.startServer(resolve));
        await hmSim.whenReady();
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        hmSim.close();
        await new Promise((resolve) => helper.stopServer(resolve));
        removeFiles();
    });

    async function start(regaInternal) {
        const f = flow(regaInternal);
        Object.assign(connectionNode(f), simPorts(hmSim));
        await new Promise((resolve) => helper.load([nodeConnection, nodeSysvar], f, resolve));
        const nc = helper.getNode('nc');
        (await until(() => nc.hasRegaVariables === true, 15000)).should.be.true();
        return nc;
    }

    it('off by default: the internal ones are left out, the alarm and service messages stay', async () => {
        const nc = await start();
        nc.regaInternal.should.be.false();
        Object.keys(nc.sysvar).should.containDeep(['Alarmmeldungen', 'Servicemeldungen', 'Anwesenheit']);
        should(nc.sysvar[RAIN]).be.undefined();
        nc.sysvar.Servicemeldungen.value.should.equal(5);
    });

    it('on: the internal ones are listed and polled like the others', async () => {
        const nc = await start(true);
        nc.regaInternal.should.be.true();
        should(nc.sysvar[RAIN]).be.ok();
        nc.sysvar[RAIN].should.have.properties({id: 1301, value: 1.5, unit: 'mm'});
        Object.keys(nc.sysvar).should.containDeep(['Alarmmeldungen', 'Servicemeldungen', 'Anwesenheit']);
    });

    it('the filter: a variable without the field (homematic-rega < 2.1.0) is kept', async () => {
        const nc = await start(false);
        nc.regaVariableWanted({id: 7}).should.be.true();
        nc.regaVariableWanted({id: 7, internal: false}).should.be.true();
        nc.regaVariableWanted({id: 7, internal: true}).should.be.false();
        nc.regaVariableWanted({id: 40, internal: true}).should.be.true();
        nc.regaVariableWanted({id: 41, internal: true}).should.be.true();
    });
});
