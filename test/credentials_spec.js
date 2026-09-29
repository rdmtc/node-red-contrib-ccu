/* B-31: the CCU password and the openccu-lite token are Node-RED credentials
   (flows_cred.json, encrypted, never exported), not properties of the config
   node in flows.json. A flow written before 4.4.6 still carries them as
   plain properties: they are used once, moved into the credentials, and the
   node warns; the editor's defaults no longer know them, so the next deploy
   drops them from flows.json. */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '192.0.2.10';
const CACHE_FILES = [`ccu_${HOST}.json`, `ccu_rega_${HOST}.json`, `ccu_values_${HOST}.json`].map((f) =>
    path.join(__dirname, '..', f),
);

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** a remote CCU with authentication; nothing is contacted (every interface off) */
function flow(extra = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'creds',
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
            rpcBinPort: '2107',
            rpcXmlPort: '2108',
            tls: true,
            authentication: true,
            username: 'Admin',
            ...extra,
        },
    ];
}

function load(nodes, flowJson, credentials) {
    return new Promise((resolve) => helper.load(nodes, flowJson, credentials, resolve));
}

function warns(id) {
    const {WARN} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === WARN)
        .map((l) => l.msg);
}

describe('password and token in the credentials (B-31)', function () {
    this.timeout(20000);

    before((done) => {
        removeCache();
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('the editor keeps neither in the flow: not in defaults, both declared as credentials', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'ccu-connection.html'), 'utf8');
        const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
        const defaults = script.match(/defaults:\s*{([\s\S]*?)\n {8}},/)[1];
        defaults.should.not.match(/^\s*password:/m);
        defaults.should.not.match(/^\s*metaToken:/m);
        defaults.should.match(/^\s*username:/m);
        const credentials = script.match(/credentials:\s*{([\s\S]*?)\n {8}},/)[1];
        credentials.should.match(/password:\s*{type: 'password'}/);
        credentials.should.match(/metaToken:\s*{type: 'password'}/);
    });

    it('the runtime takes both from the credentials', async () => {
        await load([nodeConnection], flow(), {nc: {password: 'secret1', metaToken: 'olt_secret'}});
        const nc = helper.getNode('nc');
        nc.credentials.password.should.equal('secret1');
        nc.ifaceTypes['HmIP-RF'].pass.should.equal('secret1');
        nc.ifaceTypes['HmIP-RF'].user.should.equal('Admin');
        nc.ifaceTypes['BidCos-RF'].pass.should.equal('secret1');
        nc.rega.password.should.equal('secret1');
        nc.metaToken.should.equal('olt_secret');
        warns('nc').should.deepEqual([]);
    });

    it('a flow from before 4.4.6 with both in plain text: used once, moved into the credentials, one warning', async () => {
        await load([nodeConnection], flow({password: 'plain1', metaToken: 'olt_plain'}), {});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['HmIP-RF'].pass.should.equal('plain1');
        nc.rega.password.should.equal('plain1');
        nc.metaToken.should.equal('olt_plain');
        const moved = helper._RED.nodes.getCredentials('nc');
        moved.password.should.equal('plain1');
        moved.metaToken.should.equal('olt_plain');
        warns('nc').length.should.equal(1);
        warns('nc')[0].should.match(
            /^the password and metaToken of this connection came from the flow in plain text - moved into the credentials/,
        );
    });

    it('a credential wins over a leftover plain property, nothing is moved', async () => {
        await load([nodeConnection], flow({password: 'old'}), {nc: {password: 'new1'}});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['HmIP-RF'].pass.should.equal('new1');
        warns('nc').should.deepEqual([]);
    });

    it('without authentication the password is not handed to the ReGa client', async () => {
        await load([nodeConnection], flow({authentication: false}), {nc: {password: 'secret1'}});
        const nc = helper.getNode('nc');
        should(nc.rega.password).be.undefined();
        // task 5: nor to the interface clients - credentials go out only with authentication on
        should(nc.ifaceTypes['HmIP-RF'].pass).be.undefined();
        nc.credentials.password.should.equal('secret1');
    });
});
