/* Pairing with an openccu-lite system from the connection node's dialog (FakeBox stands in for
   the system):
   - the admin routes: a request, the code, the approval with the token and the pinned
     certificate, a rejection, an expiry, a withdrawal, a missing address;
   - lib/pairing.js on its own: what is refused at once (no address, the system Node-RED runs on,
     occulite-client missing), what the probe finds (a CCU, nothing, an untrusted certificate,
     pairing switched off), a request nobody polls any more, the token handed out once;
   - the connection with the pinned certificate: the metadata api and lite-rpc over TLS accept
     exactly that one, with "ignore invalid certificates" off; another fingerprint is refused. */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const should = require('should');
const helper = require('node-red-node-test-helper');
const {FakeBox} = require('occulite-client/testing');

const nodeConnection = require('../nodes/ccu-connection.js');
const lite = require('../nodes/lib/lite.js');
const metaProvider = require('../nodes/lib/metaprovider.js');
const {Pairings, addressOf, settingsOf, describeError, ACCESS, APP} = require('../nodes/lib/pairing.js');
const {userDir} = require('./utils');

helper.init(require.resolve('node-red'));

const TOKEN = 'olt_pairing';
const REMOTE = '192.0.2.10';
const CACHE_FILES = [REMOTE, '127.0.0.1']
    .flatMap((host) => [
        `ccu_${host}.json`,
        `ccu_rega_${host}.json`,
        `ccu_values_${host}.json`,
        `ccu_lite_${host}.json`,
    ])
    .map((f) => path.join(userDir(), f));

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

/** the error a call throws */
function refusal(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    throw new Error('not refused');
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await predicate()) {
            return true;
        }

        await wait(30);
    }

    return Boolean(await predicate());
}

/** a self-signed certificate for 127.0.0.1, made with openssl into a scratch dir; null without openssl */
function makeCertificate() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-pair-'));
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
                '/CN=system-under-test',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
            ],
            {stdio: 'ignore'},
        );
    } catch {
        fs.rmSync(dir, {recursive: true, force: true});
        return null;
    }

    const pair = {key: fs.readFileSync(key), cert: fs.readFileSync(cert)};
    fs.rmSync(dir, {recursive: true, force: true});
    return {...pair, fingerprint256: new crypto.X509Certificate(pair.cert).fingerprint256};
}

/** the system's lighttpd in front of the FakeBox: https with the self-signed certificate */
function tlsFront(target, certificate) {
    const server = https.createServer({key: certificate.key, cert: certificate.cert}, (req, res) => {
        const upstream = http.request(target + req.url, {method: req.method, headers: req.headers}, (answer) => {
            res.writeHead(answer.statusCode, answer.headers);
            answer.pipe(res);
        });
        upstream.on('error', () => res.destroy());
        res.on('close', () => upstream.destroy());
        req.pipe(upstream);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port}));
    });
}

function connectionFlow(extra = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'pairing',
            host: REMOTE,
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
            rpcBinPort: '2167',
            rpcXmlPort: '2168',
            ...extra,
        },
    ];
}

function load(flowJson, credentials) {
    return new Promise((resolve) => helper.load([nodeConnection], flowJson, credentials || {}, resolve));
}

/** the only pending request on the fake, once the program revealed its half */
function pendingOn(fake) {
    const entry = [...fake.pairings.entries()].find(([, p]) => p.clientNonce && p.state === 'pending');
    return entry ? entry[0] : undefined;
}

async function poll(id, until_ = (view) => view.state !== 'probing' && view.state !== 'requesting') {
    let view;
    await until(async () => {
        const res = await helper.request().get('/ccu/pair/' + id);
        view = res.body;
        return res.status !== 200 || until_(view);
    }, 10000);
    return view;
}

describe('pairing with an openccu-lite system', function () {
    this.timeout(30000);
    let fake;
    let fakeUrl;
    let fakePort;

    before(async () => {
        removeCache();
        fake = new FakeBox({token: TOKEN, interfaces: ['HmIP-RF'], meta: {revision: 1, objects: {}, enums: {}}});
        fakeUrl = await fake.start();
        fakePort = new URL(fakeUrl).port;
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
        removeCache();
    });

    after(async () => {
        await fake.stop();
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    describe('the admin routes', () => {
        beforeEach(async () => {
            await load(connectionFlow());
        });

        it('a request shows the code of the system, the approval hands over the token once', async () => {
            const started = await helper
                .request()
                .post('/ccu/pair')
                .send({host: '127.0.0.1', port: fakePort})
                .expect(202);
            started.body.id.should.match(/^[\da-f]{24}$/);

            const waiting = await poll(started.body.id);
            waiting.state.should.equal('waiting');
            waiting.url.should.equal(fakeUrl.replace(/\/$/, ''));
            const fakeId = pendingOn(fake);
            should(fakeId).be.ok();
            waiting.code.should.equal(fake.pairingCode(fakeId));
            const asked = fake.pairings.get(fakeId);
            asked.app.should.equal(APP);
            asked.access.should.deepEqual(ACCESS);
            should(waiting.token).be.undefined();

            fake.approve(fakeId);
            const token = fake.pairings.get(fakeId).token;
            const approved = await poll(started.body.id, (view) => view.state === 'approved');
            approved.should.containDeep({state: 'approved', token, tls: false, port: fakePort, fingerprint256: ''});
            approved.name.should.equal(APP + '-fake');

            // the token is handed out once
            await helper
                .request()
                .get('/ccu/pair/' + started.body.id)
                .expect(404);
        });

        it('a rejection on the system: the dialog says so', async () => {
            const {body} = await helper.request().post('/ccu/pair').send({host: '127.0.0.1', port: fakePort});
            await poll(body.id);
            fake.pairings.get(pendingOn(fake)).state = 'rejected';
            const view = await poll(body.id, (v) => v.state === 'failed');
            view.should.containDeep({state: 'failed', error: 'rejected'});
            view.message.should.match(/rejected the request/);
            should(view.token).be.undefined();
        });

        it('nobody approves within five minutes: expired', async () => {
            const {body} = await helper.request().post('/ccu/pair').send({host: '127.0.0.1', port: fakePort});
            await poll(body.id);
            const fakeId = pendingOn(fake);
            fake.pairings.get(fakeId).state = 'expired';
            const view = await poll(body.id, (v) => v.state === 'failed');
            view.should.containDeep({state: 'failed', error: 'expired'});
            fake.pairings.delete(fakeId);
        });

        it('the dialog withdraws its request: gone on the system too', async () => {
            const {body} = await helper.request().post('/ccu/pair').send({host: '127.0.0.1', port: fakePort});
            await poll(body.id);
            const fakeId = pendingOn(fake);
            should(fakeId).be.ok();
            await helper
                .request()
                .delete('/ccu/pair/' + body.id)
                .expect(204);
            (await until(() => !fake.pairings.has(fakeId), 5000)).should.be.true();
            await helper
                .request()
                .get('/ccu/pair/' + body.id)
                .expect(404);
            // withdrawing again is no error
            await helper
                .request()
                .delete('/ccu/pair/' + body.id)
                .expect(204);
        });

        it('without an address: refused at once', async () => {
            const res = await helper.request().post('/ccu/pair').send({host: ' '}).expect(400);
            res.body.should.containDeep({error: 'host'});
            const empty = await helper.request().post('/ccu/pair').expect(400);
            empty.body.error.should.equal('host');
        });

        it('a CCU at the address: not an openccu-lite, nothing asked', async () => {
            const ccuWebUi = http.createServer((req, res) =>
                res.writeHead(200, {'content-type': 'text/html'}).end('<html></html>'),
            );
            await new Promise((resolve) => ccuWebUi.listen(0, '127.0.0.1', resolve));
            try {
                const {body} = await helper
                    .request()
                    .post('/ccu/pair')
                    .send({host: '127.0.0.1', port: ccuWebUi.address().port});
                const view = await poll(body.id);
                view.should.containDeep({state: 'failed', error: 'not-openccu-lite'});
                view.message.should.match(/not an openccu-lite system/);
            } finally {
                ccuWebUi.close();
            }
        });
    });

    describe('over https, and the connection with the pinned certificate', () => {
        let certificate;
        let front;

        before(async function () {
            certificate = makeCertificate();
            if (!certificate) {
                console.log('      (no openssl - the TLS checks are skipped)');
                this.skip();
            }

            front = await tlsFront(fakeUrl.replace(/\/$/, ''), certificate);
        });

        after(() => {
            if (front) {
                front.server.closeAllConnections();
                front.server.close();
            }
        });

        it('pairing over https returns the certificate the code was bound to, and TLS for the node', async () => {
            await load(connectionFlow());
            const {body} = await helper
                .request()
                .post('/ccu/pair')
                .send({host: '127.0.0.1', tls: 'true', port: String(front.port)})
                .expect(202);
            const waiting = await poll(body.id);
            waiting.state.should.equal('waiting');
            waiting.url.should.equal('https://127.0.0.1:' + front.port);
            fake.approve(pendingOn(fake));
            const approved = await poll(body.id, (view) => view.state === 'approved');
            approved.should.containDeep({
                state: 'approved',
                tls: true,
                port: String(front.port),
                fingerprint256: certificate.fingerprint256,
            });
        });

        it('the pinned certificate: metadata api and lite-rpc over TLS without "ignore invalid certificates"', async () => {
            await load(
                connectionFlow({
                    host: '127.0.0.1',
                    metaPort: String(front.port),
                    tls: true,
                    inSecure: false,
                    iprfEnabled: true,
                    regaEnabled: true,
                }),
                {nc: {metaToken: TOKEN, fingerprint256: certificate.fingerprint256}},
            );
            const nc = helper.getNode('nc');
            nc.fingerprint256.should.equal(certificate.fingerprint256);
            nc.inSecure.should.be.false();
            (
                await until(
                    () => nc.metaMode && nc.ifaceStatus.Metadata === true && nc.ifaceStatus['HmIP-RF'] === true,
                    15000,
                )
            ).should.be.true();
            should(nc.lite).be.ok();
            nc.lite.options.fingerprint256.should.equal(certificate.fingerprint256);
        });

        it('another certificate than the pinned one: refused before the token goes out', async () => {
            // another first byte than the certificate's own (a fresh one per run starts with AA: once in 256)
            const other =
                (certificate.fingerprint256.startsWith('AA:') ? 'BB:' : 'AA:') + certificate.fingerprint256.slice(3);
            const outcome = await metaProvider.detectOutcome({
                host: '127.0.0.1',
                port: front.port,
                tls: true,
                insecure: true,
                fingerprint256: other,
            });
            should(outcome.info).be.null();
            outcome.reason.should.match(/another certificate than the one pinned/);

            const right = await metaProvider.detectOutcome({
                host: '127.0.0.1',
                port: front.port,
                tls: true,
                fingerprint256: certificate.fingerprint256.toLowerCase(),
            });
            right.info.api.should.equal('meta');

            // a name instead of an address: the pin decides, not the name in the certificate
            const byName = await metaProvider.detectOutcome({
                host: 'localhost',
                port: front.port,
                tls: true,
                fingerprint256: certificate.fingerprint256,
            });
            byName.info.api.should.equal('meta');
        });

        it('the pin waits no longer than the timeout for a handshake', async () => {
            const silent = require('net').createServer(() => {});
            await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
            try {
                const outcome = await metaProvider.detectOutcome({
                    host: '127.0.0.1',
                    port: silent.address().port,
                    tls: true,
                    fingerprint256: certificate.fingerprint256,
                    timeout: 200,
                });
                outcome.inconclusive.should.be.true();
                outcome.reason.should.equal('timeout');
            } finally {
                silent.close();
            }
        });

        it('without TLS a pinned fingerprint is not used', async () => {
            await load(connectionFlow(), {nc: {fingerprint256: certificate.fingerprint256}});
            helper.getNode('nc').fingerprint256.should.equal('');
        });
    });

    describe('lib/pairing.js', () => {
        const silent = {info() {}, warn() {}};
        const view = async (pairings, id, done = (v) => v.state !== 'probing' && v.state !== 'requesting') => {
            let result;
            await until(() => {
                const request = pairings.requests.get(id);
                return request && done(request);
            }, 5000);
            result = pairings.get(id);
            return result;
        };

        const probeAnswer = (answer) => () => ({probe: async () => answer, pair: async () => should.fail()});

        it('the address the probe starts from, and the node settings of the URL', () => {
            addressOf({host: '192.168.1.20'}).should.equal('192.168.1.20');
            addressOf({host: ' system.local ', tls: true}).should.equal('https://system.local');
            addressOf({host: '192.168.1.20', port: '8080'}).should.equal('http://192.168.1.20:8080');
            addressOf({host: '192.168.1.20', tls: true, port: 8443}).should.equal('https://192.168.1.20:8443');
            addressOf({host: 'fd00::1', tls: true}).should.equal('https://[fd00::1]');
            addressOf({host: '[fd00::1]', port: '0'}).should.equal('[fd00::1]');
            settingsOf('https://192.168.1.20').should.deepEqual({tls: true, port: ''});
            settingsOf('http://192.168.1.20:8080').should.deepEqual({tls: false, port: '8080'});
        });

        it('the dialog words for occulite-client errors', () => {
            const occuLiteError = (code, message) => Object.assign(new Error(message), {name: 'OccuLiteError', code});
            describeError(occuLiteError('pairing-off', 'x')).error.should.equal('pairing-off');
            describeError(occuLiteError('not-local', 'x')).message.should.match(/local networks/);
            describeError(occuLiteError('limit', 'x')).message.should.match(/ten minutes/);
            describeError(occuLiteError('http-500', 'HTTP 500')).should.deepEqual({
                error: 'http-500',
                message: 'Pairing failed: HTTP 500',
            });
            describeError(Object.assign(new Error('t'), {kind: 'timeout'})).error.should.equal('timeout');
            describeError(new Error('boom')).should.deepEqual({error: 'failed', message: 'Pairing failed: boom'});
            describeError(undefined).should.deepEqual({error: 'failed', message: 'Pairing failed: undefined'});
        });

        it('refused at once: no address, the system Node-RED runs on, occulite-client missing', () => {
            let probed = false;
            const modules = () => ({probe: () => (probed = true), pair: () => (probed = true)});
            const local = new Pairings({load: modules, isLocal: (host) => host === '127.0.0.1', logger: silent});
            should(
                ((error) => error.status === 400 && error.code === 'host')(refusal(() => local.start({host: ''}))),
            ).be.true();
            should(((error) => error.status === 400)(refusal(() => local.start({})))).be.true();
            should(
                ((error) => error.status === 409 && error.code === 'local' && /configures itself/.test(error.message))(
                    refusal(() => local.start({host: ' 127.0.0.1 '})),
                ),
            ).be.true();
            probed.should.be.false();
            local.requests.size.should.equal(0);

            const missing = new Pairings({
                load: () => {
                    throw new Error('occulite-client cannot be loaded');
                },
                isLocal: () => false,
                logger: silent,
            });
            should(
                ((error) => error.status === 500 && error.code === 'unavailable')(
                    refusal(() => missing.start({host: '192.0.2.1'})),
                ),
            ).be.true();
        });

        it('what the probe finds: a CCU, nothing, an untrusted certificate, pairing switched off', async () => {
            const cases = [
                [{kind: 'ccu', reachable: true}, 'not-openccu-lite', /A CCU pairs no programs/],
                [
                    {kind: 'unreachable', reachable: false, reason: 'refused'},
                    'unreachable',
                    /does not answer \(refused\)/,
                ],
                [{kind: 'unreachable', reachable: false}, 'unreachable', /^The system does not answer\.$/],
                [{kind: 'unreachable', reachable: true, reason: 'certificate'}, 'unreachable', /certificate/],
                [
                    {kind: 'openccu-lite', url: 'http://x', info: {capabilities: {pairing: false}}},
                    'pairing-off',
                    /switched off/,
                ],
            ];
            for (const [answer, error, message] of cases) {
                const pairings = new Pairings({load: probeAnswer(answer), isLocal: () => false, logger: silent});
                const id = pairings.start({host: '192.0.2.1'});
                const result = await view(pairings, id);
                result.state.should.equal('failed');
                result.error.should.equal(error);
                result.message.should.match(message);
                // a settled request is gone once the dialog saw it
                should(pairings.get(id)).be.undefined();
            }
        });

        it('an approval without a certificate (plain HTTP), the default logger and instance', async () => {
            let asked;
            const pairings = new Pairings({
                load: () => ({
                    probe: async () => ({kind: 'openccu-lite', url: 'http://192.0.2.1', info: {}}),
                    pair: async (options) => {
                        asked = options;
                        options.onCode('012345');
                        return {token: 'olt_x', name: 'node-red-contrib-ccu-host', scopes: ['rpc:admin']};
                    },
                }),
                isLocal: () => false,
                appVersion: '9.9.9',
            });
            const id = pairings.start({host: '192.0.2.1'});
            const result = await view(pairings, id, (r) => r.state === 'approved');
            result.should.deepEqual({
                state: 'approved',
                code: '012345',
                url: 'http://192.0.2.1',
                name: 'node-red-contrib-ccu-host',
                fingerprint256: '',
                tls: false,
                port: '',
                token: 'olt_x',
            });
            asked.should.containDeep({app: APP, appVersion: '9.9.9', instance: os.hostname(), access: ACCESS});
            should(asked.signal).be.ok();
        });

        it('a pairing error of another kind, and one with occulite-client missing at run time', async () => {
            const pairings = new Pairings({
                load: () => ({
                    probe: async () => ({kind: 'openccu-lite', url: 'http://192.0.2.1'}),
                    pair: async () => {
                        throw new Error('boom');
                    },
                }),
                isLocal: () => false,
                logger: silent,
            });
            const id = pairings.start({host: '192.0.2.1'});
            const result = await view(pairings, id);
            result.should.containDeep({state: 'failed', error: 'failed', message: 'Pairing failed: boom'});
        });

        it('the probe itself fails: the address is named in the log', async () => {
            const warned = [];
            const pairings = new Pairings({
                load: () => ({
                    probe: async () => {
                        throw new Error('probe broke');
                    },
                    pair: async () => should.fail(),
                }),
                isLocal: () => false,
                logger: {info() {}, warn: (line) => warned.push(line)},
            });
            const id = pairings.start({host: '192.0.2.1'});
            const result = await view(pairings, id);
            result.should.containDeep({state: 'failed', error: 'failed', message: 'Pairing failed: probe broke'});
            warned.should.deepEqual(['pairing with 192.0.2.1 failed: Pairing failed: probe broke']);
        });

        it('a request nobody polls any more is withdrawn; a polled one is not', async () => {
            let signal;
            const hanging = () => ({
                probe: async () => ({kind: 'openccu-lite', url: 'http://192.0.2.1'}),
                pair: (options) =>
                    new Promise((resolve, reject) => {
                        signal = options.signal;
                        options.onCode('111111');
                        options.signal.addEventListener('abort', () =>
                            reject(Object.assign(new Error('aborted'), {name: 'OccuLiteError', code: 'aborted'})),
                        );
                    }),
            });
            const pairings = new Pairings({load: hanging, isLocal: () => false, logger: silent, abandonAfter: 120});
            const id = pairings.start({host: '192.0.2.1'});
            // polled: kept
            for (let i = 0; i < 6; i++) {
                await wait(50);
                pairings.get(id).state.should.equal('waiting');
            }

            // not polled: withdrawn, and the pairing aborted
            (await until(() => !pairings.requests.has(id), 2000)).should.be.true();
            signal.aborted.should.be.true();
            should(pairings.get(id)).be.undefined();
        });

        it('a settled request nobody fetches is dropped after a while; cancel and close', async () => {
            const pairings = new Pairings({
                load: probeAnswer({kind: 'ccu'}),
                isLocal: () => false,
                logger: silent,
                keepFor: 50,
            });
            const id = pairings.start({host: '192.0.2.1'});
            (await until(() => !pairings.requests.has(id), 2000)).should.be.true();
            pairings.cancel('nothing').should.be.false();

            const hanging = new Pairings({
                load: () => ({
                    probe: (address, options) =>
                        new Promise((resolve, reject) =>
                            options.signal.addEventListener('abort', () =>
                                reject(Object.assign(new Error('aborted'), {name: 'OccuLiteError', code: 'aborted'})),
                            ),
                        ),
                    pair: async () => should.fail(),
                }),
                isLocal: () => false,
                logger: silent,
            });
            hanging.start({host: '192.0.2.1'});
            hanging.start({host: '192.0.2.2'});
            hanging.requests.size.should.equal(2);
            hanging.close();
            hanging.requests.size.should.equal(0);
        });

        it('the occulite-client loader offers pair and probe', () => {
            const modules = lite.load();
            modules.pair.should.be.a.Function();
            modules.probe.should.be.a.Function();
        });

        it("lite-rpc's certificate trust: the pin wins, then ignore invalid, then Node's store", () => {
            lite.trustOf({fingerprint256: 'AB:CD', insecure: true}).should.deepEqual({fingerprint256: 'AB:CD'});
            lite.trustOf({insecure: true}).should.deepEqual({insecure: true});
            lite.trustOf({}).should.deepEqual({});
        });
    });
});
