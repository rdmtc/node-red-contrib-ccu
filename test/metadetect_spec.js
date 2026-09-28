/* B-28: a metadata api detection that decides nothing at start (a refused
   connection, a timeout - the box busy or still starting) used to leave the
   connection in ReGa mode for good: the only re-detection ran from rare
   error paths, at most every five minutes. Now the detection is repeated
   after 1, 2, 4, 8 s, then every 15 s, and the failing ReGa poll asks for a
   re-detection as well. A CCU's 404 is still a conclusive "no" and is not
   asked again. */

const fs = require('fs');
const http = require('http');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const META_PORT = 2078;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const HOUSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'openccu-lite', 'valid-house.json')));

function removeCache() {
    for (const file of CACHE_FILES) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

function flow({regaPoll = false} = {}) {
    return [
        {
            id: 'nc',
            type: 'ccu-connection',
            name: 'detect',
            host: HOST,
            metaPort: String(META_PORT),
            regaEnabled: true,
            bcrfEnabled: false,
            iprfEnabled: false,
            virtEnabled: false,
            bcwiEnabled: false,
            cuxdEnabled: false,
            regaPoll,
            regaInterval: '30',
            rpcPingTimeout: '60',
            rpcInitAddress: HOST,
            rpcServerHost: HOST,
            rpcBinPort: '2077',
            rpcXmlPort: '2079',
        },
    ];
}

/** a fake openccu-lite (`ccu: false`) or a CCU answering 404 (`ccu: true`) on META_PORT */
function fakeBox({ccu = false} = {}) {
    const clients = new Set();
    const server = http.createServer((request_, res) => {
        const [pathname] = request_.url.split('?');
        if (ccu) {
            res.writeHead(404, {'content-type': 'text/html'}).end('<html>404</html>');
        } else if (pathname === '/api/meta/v1/version') {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(
                JSON.stringify({api: 'meta', version: 1, format: 1, revision: HOUSE.revision, implementation: 'fake'}),
            );
        } else if (pathname === '/api/meta/v1/snapshot') {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(HOUSE));
        } else if (pathname === '/api/meta/v1/events/sse') {
            request_.on('close', () => clients.delete(res));
            res.writeHead(200, {'content-type': 'text/event-stream'});
            res.write(': hello\n\n');
            clients.add(res);
        } else {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((resolve) => {
        server.listen(META_PORT, HOST, () =>
            resolve({
                close: () =>
                    new Promise((done) => {
                        for (const client of clients) {
                            client.end();
                        }

                        server.closeAllConnections();
                        server.close(done);
                    }),
            }),
        );
    });
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

function load(nodes, flowJson) {
    return new Promise((resolve) => helper.load(nodes, flowJson, resolve));
}

function infos(id) {
    const {INFO} = helper.log();
    return helper
        .log()
        .args.map((a) => a[0])
        .filter((l) => l && l.id === id && l.level === INFO)
        .map((l) => l.msg);
}

describe('metadata api detection at start (B-28)', function () {
    this.timeout(20000);
    let box;

    before((done) => {
        removeCache();
        helper.startServer(done);
    });

    afterEach(async () => {
        await helper.unload();
        if (box) {
            await box.close();
            box = null;
        }

        removeCache();
    });

    after((done) => {
        helper.stopServer(done);
    });

    it('a refused detection at start is repeated, and the box is taken as openccu-lite once it answers', async () => {
        await load([nodeConnection], flow());
        const nc = helper.getNode('nc');

        // up to 7 s: on a machine where a connect to a closed port hangs (WSL, mirrored
        // networking) the first detection ends with its 5 s timeout instead of a refusal
        (
            await until(() => infos('nc').some((m) => m.startsWith('meta api detection inconclusive')), 7000)
        ).should.be.true();
        nc.metaMode.should.be.false();
        should(nc.metaRedetectTimeout).be.ok();
        infos('nc')
            .find((m) => m.startsWith('meta api detection inconclusive'))
            .should.match(/(ECONNREFUSED|timeout).*detecting again in 1 s$/);

        // the box comes up: the second or third attempt (1 s, 2 s) finds it
        box = await fakeBox();
        const started = Date.now();
        (await until(() => nc.metaMode, 5000)).should.be.true();
        (Date.now() - started).should.be.below(3500);
        (await until(() => nc.channelNames && Object.keys(nc.channelNames).length > 0, 3000)).should.be.true();
        infos('nc')
            .some((m) => m.startsWith('openccu-lite detected'))
            .should.be.true();
        infos('nc')
            .some((m) => /^meta api detected after [23] attempts$/.test(m))
            .should.be.true();
        should(nc.metaRedetectTimeout).be.null();
        should(nc.clients.ReGaHSS).be.undefined();
    });

    it("a CCU's 404 is conclusive: no re-detection is armed", async () => {
        box = await fakeBox({ccu: true});
        await load([nodeConnection], flow());
        const nc = helper.getNode('nc');
        await wait(500);
        nc.metaMode.should.be.false();
        should(nc.metaRedetectTimeout).not.be.ok();
        infos('nc')
            .some((m) => m.startsWith('meta api detection inconclusive'))
            .should.be.false();
    });

    it('a failing ReGa poll asks for a re-detection', async () => {
        box = await fakeBox({ccu: true});
        await load([nodeConnection], flow());
        const nc = helper.getNode('nc');
        await wait(300);
        let rechecks = 0;
        nc.recheckMeta = () => {
            rechecks += 1;
        };

        nc.getRegaVariables = () => Promise.reject(new Error('xml in rega response missing'));
        nc.getRegaPrograms = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8183'));
        nc.regaPollEnabled = false;
        nc.regaPoll();
        (await until(() => rechecks >= 2, 2000)).should.be.true();
    });

    it('the re-detection stops with the node', async () => {
        await load([nodeConnection], flow());
        const nc = helper.getNode('nc');
        (await until(() => nc.metaRedetectTimeout, 7000)).should.be.ok();
        await helper.unload();
        should(nc.metaRedetectTimeout).be.null();
        nc.cancelRegaPoll.should.be.true();
    });
});
