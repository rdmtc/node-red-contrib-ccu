/* task 5 (#27): TLS and authentication on the wire, for a CCU on the network.
   - the XML-RPC clients speak TLS to the CCU's 4xxxx ports and send the
     username and password as HTTP basic auth on every call, the init
     included; an untrusted certificate is refused unless "ignore invalid
     TLS certificates" is on;
   - a local connection uses neither; BIN-RPC has no TLS.
   A fake CCU-Jack stands in: XML-RPC over https with a self-signed
   certificate, refusing calls without the right credentials - its port is
   configurable, the other interfaces' TLS ports are fixed. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const {execFileSync} = require('child_process');
const should = require('should');
const helper = require('node-red-node-test-helper');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const USER = 'Admin';
const PASSWORD = 'secret1';
const BASIC = 'Basic ' + Buffer.from(USER + ':' + PASSWORD).toString('base64');
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** a self-signed certificate for 127.0.0.1, made with openssl into a scratch dir; null without openssl */
function makeCertificate() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-tls-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    try {
        execFileSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-keyout',
                key,
                '-out',
                cert,
                '-days',
                '2',
                '-subj',
                '/CN=ccu-under-test',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
            ],
            {stdio: 'ignore'},
        );
    } catch {
        return null;
    }

    return {dir, key: fs.readFileSync(key), cert: fs.readFileSync(cert)};
}

/** the fake CCU-Jack: XML-RPC over https on a free port, every call needs the credentials */
function fakeJack(tls) {
    const state = {port: null, calls: [], unauthorized: 0};
    const answer = (method) =>
        method === 'listDevices'
            ? '<array><data></data></array>'
            : method === 'system.listMethods'
              ? '<array><data><value><string>init</string></value></data></array>'
              : '<string></string>';
    const server = https.createServer({key: tls.key, cert: tls.cert}, (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            const method = (body.match(/<methodName>([^<]*)<\/methodName>/) || [])[1] || '?';
            const call = {
                method,
                path: req.url,
                authorization: req.headers.authorization,
                encrypted: req.socket.encrypted,
            };
            state.calls.push(call);
            if (call.authorization !== BASIC) {
                state.unauthorized += 1;
                res.writeHead(401, {'WWW-Authenticate': 'Basic realm="CCU"', 'Content-Type': 'text/html'});
                res.end('<html><body>401 - Unauthorized</body></html>');
                return;
            }

            res.writeHead(200, {'Content-Type': 'text/xml'});
            res.end(
                '<?xml version="1.0"?><methodResponse><params><param><value>' +
                    answer(method) +
                    '</value></param></params></methodResponse>',
            );
        });
    });
    state.listen = () =>
        new Promise((resolve) => {
            server.listen(0, HOST, () => {
                state.port = server.address().port;
                resolve(state.port);
            });
        });
    state.close = () => new Promise((resolve) => server.close(() => resolve()));
    return state;
}

/** a remote CCU (127.0.0.1 is remote here: nothing listens on 32001 and there is no InterfacesList.xml) */
function flow(extra = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'tls',
            host: HOST,
            regaEnabled: false,
            bcrfEnabled: false,
            iprfEnabled: false,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            jackEnabled: false,
            regaPoll: false,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            rpcBinPort: '2127',
            rpcXmlPort: '2128',
            ...extra,
        },
    ];
}

function load(flowJson, credentials) {
    return new Promise((resolve) => helper.load([nodeConnection], flowJson, credentials, resolve));
}

function logs(id, level) {
    const levels = helper.log();
    return levels.args
        .map((a) => a[0])
        .filter((l) => l && l.id === id && (level === undefined || l.level === levels[level]))
        .map((l) => String(l.msg));
}

function until(condition, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            if (condition()) {
                resolve();
            } else if (Date.now() - started > timeout) {
                reject(new Error('timeout waiting for ' + condition.toString()));
            } else {
                setTimeout(tick, 50);
            }
        };
        tick();
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TLS and authentication for a CCU on the network (task 5, #27)', function () {
    this.timeout(20000);

    let tls;
    let jack;

    before(function (done) {
        removeCache();
        tls = makeCertificate();
        if (!tls) {
            console.log('      (no openssl - the wire checks are skipped)');
        }

        helper.startServer(done);
    });

    beforeEach(async function () {
        if (!tls) {
            return;
        }

        jack = fakeJack(tls);
        await jack.listen();
    });

    afterEach(async () => {
        await helper.unload();
        if (jack) {
            await jack.close();
            jack = null;
        }

        removeCache();
    });

    after((done) => {
        if (tls) {
            fs.rmSync(tls.dir, {recursive: true, force: true});
        }

        helper.stopServer(done);
    });

    it('with TLS on the interfaces get the 4xxxx ports, the ReGa 48181, the metadata api 443', async () => {
        await load(flow({tls: true, authentication: true, username: USER}), {nc: {password: PASSWORD}});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['BidCos-RF'].port.should.equal(42001);
        nc.ifaceTypes['BidCos-RF'].protocol.should.equal('http');
        nc.ifaceTypes['BidCos-Wired'].port.should.equal(42000);
        nc.ifaceTypes['HmIP-RF'].port.should.equal(42010);
        nc.ifaceTypes.VirtualDevices.port.should.equal(49292);
        nc.ifaceTypes['CCU-Jack'].port.should.equal(2122);
        for (const iface of ['BidCos-RF', 'BidCos-Wired', 'HmIP-RF', 'VirtualDevices', 'CCU-Jack']) {
            nc.ifaceTypes[iface].tls.should.equal(true, iface);
            nc.ifaceTypes[iface].auth.should.equal(true, iface);
            nc.ifaceTypes[iface].user.should.equal(USER, iface);
            nc.ifaceTypes[iface].pass.should.equal(PASSWORD, iface);
        }

        nc.rega.tls.should.equal(true);
        nc.rega.port.should.equal(48181);
        nc.rega.username.should.equal(USER);
        nc.metaPort.should.equal(443);
        nc.tlsEnabled.should.equal(true);
        logs('nc', 'WARN').should.deepEqual([]);
    });

    it('without TLS the plain ports, and the credentials only when authentication is on', async () => {
        await load(flow({tls: false, authentication: false, username: USER}), {nc: {password: PASSWORD}});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['BidCos-RF'].port.should.equal(2001);
        nc.ifaceTypes['HmIP-RF'].port.should.equal(2010);
        nc.ifaceTypes.VirtualDevices.port.should.equal(9292);
        nc.ifaceTypes['CCU-Jack'].port.should.equal(2121);
        should(nc.ifaceTypes['HmIP-RF'].user).be.undefined();
        should(nc.ifaceTypes['HmIP-RF'].pass).be.undefined();
        nc.rega.port.should.equal(8181);
        should(nc.rega.username).be.undefined();
        nc.metaPort.should.equal(80);
    });

    it('authentication without TLS is warned about once', async () => {
        await load(flow({tls: false, authentication: true, username: USER}), {nc: {password: PASSWORD}});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['HmIP-RF'].auth.should.equal(true);
        logs('nc', 'WARN').should.deepEqual(['authentication without TLS: the credentials are sent in plain text']);
    });

    it('BidCos-RF asked for over BIN-RPC goes XML-RPC when TLS is on: BIN-RPC has none', async () => {
        await load(flow({tls: true, bcrfBinRpc: true}), {});
        const nc = helper.getNode('nc');
        nc.ifaceTypes['BidCos-RF'].protocol.should.equal('http');
        nc.ifaceTypes['BidCos-RF'].port.should.equal(42001);
        logs('nc', 'WARN').should.deepEqual([
            'BidCos-RF: BIN-RPC has no TLS - using XML-RPC over TLS (port 42001) instead',
        ]);
    });

    it('the init reaches the CCU over TLS with the credentials, and the interface connects', async function () {
        if (!tls) {
            this.skip();
        }

        await load(
            flow({
                jackEnabled: true,
                jackPort: String(jack.port),
                tls: true,
                inSecure: true,
                authentication: true,
                username: USER,
            }),
            {nc: {password: PASSWORD}},
        );
        const nc = helper.getNode('nc');
        await until(() => jack.calls.some((c) => c.method === 'init'));
        const init = jack.calls.find((c) => c.method === 'init');
        init.encrypted.should.equal(true);
        init.path.should.equal('/RPC3');
        init.authorization.should.equal(BASIC);
        jack.unauthorized.should.equal(0);
        await until(() => nc.ifaceStatus['CCU-Jack'] === true);
        logs('nc', 'INFO').should.containEql('rpc client CCU-Jack xmlrpc/tls 127.0.0.1:' + jack.port + '/RPC3');
        logs('nc', 'ERROR').should.deepEqual([]);
    });

    it('without the credentials the CCU refuses the init and the interface stays disconnected', async function () {
        if (!tls) {
            this.skip();
        }

        await load(flow({jackEnabled: true, jackPort: String(jack.port), tls: true, inSecure: true}), {});
        const nc = helper.getNode('nc');
        await until(() => jack.unauthorized > 0);
        should(jack.calls.find((c) => c.method === 'init').authorization).be.undefined();
        // the 401 is a transport error to the retry (task 11): a warning once, then quiet retries.
        // The reason is the XML parser's complaint about lighttpd's HTML body, not the status - the
        // client library reports only a 404 by status (a homematic-xmlrpc item)
        await until(() => logs('nc', 'WARN').some((l) => /^CCU-Jack not reachable yet \(/.test(l)));
        await sleep(300);
        should(nc.ifaceStatus['CCU-Jack']).not.equal(true);
        logs('nc', 'INFO').should.not.matchAny(/^CCU-Jack connected/);
    });

    it('an untrusted certificate is refused unless invalid certificates are ignored', async function () {
        if (!tls) {
            this.skip();
        }

        await load(
            flow({
                jackEnabled: true,
                jackPort: String(jack.port),
                tls: true,
                inSecure: false,
                authentication: true,
                username: USER,
            }),
            {nc: {password: PASSWORD}},
        );
        const nc = helper.getNode('nc');
        await until(() => logs('nc', 'WARN').some((l) => /^CCU-Jack not reachable yet \(/.test(l)));
        logs('nc', 'WARN').should.matchAny(/SELF_SIGNED|self.signed|UNABLE_TO_VERIFY|certificate/i);
        jack.calls.should.deepEqual([]);
        should(nc.ifaceStatus['CCU-Jack']).not.equal(true);
    });
});
