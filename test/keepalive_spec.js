/* task: the XML-RPC callback server keeps an idle keep-alive connection open longer than
   hmipserver's HTTP client pool does (1200 s). Node's default closed one after 5 s; hmipserver
   sends the next event on a pooled connection without checking it, so at the idle boundary the
   event went out onto a socket this side was closing ("Connection reset", one event lost, a few
   times a day on a production system). Here: the server's bound is above the pool's, and a
   connection idle for longer than Node's old 5 s default still serves the next call. */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
require('should');
const helper = require('node-red-node-test-helper');
const xmlrpc = require('homematic-xmlrpc');

const nodeConnection = require('../nodes/ccu-connection.js');

helper.init(require.resolve('node-red'));

const HOST = '127.0.0.1';
const XML_PORT = 2069;
const FAKE_PORT = 2010;
const CACHE_FILES = ['ccu_127.0.0.1.json', 'ccu_rega_127.0.0.1.json', 'ccu_values_127.0.0.1.json'].map((f) =>
    path.join(__dirname, '..', f),
);
const PARAMSETS_SCRATCH = path.join(os.tmpdir(), 'nrccu-keepalive-paramsets.json');

function removeCache() {
    for (const file of [...CACHE_FILES, PARAMSETS_SCRATCH]) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
}

const flow = [
    {
        id: 'nc',
        type: 'ccu-connection',
        name: 'keepalive',
        host: HOST,
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
        rpcBinPort: '2066',
        rpcXmlPort: String(XML_PORT),
    },
];

/** a fake hmipserver on its XML-RPC port that accepts init */
function fakeServer(port) {
    const server = xmlrpc.createServer({host: HOST, port});
    server.on('init', (err, params, callback) => callback(null, ''));
    server.on('ping', (err, params, callback) => callback(null, true));
    return {close: () => server.close()};
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

const REQUEST =
    '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName><params><param><value>x</value></param></params></methodCall>';

/** one request on an open socket, resolved with the HTTP status line and headers, rejected on a close */
function request(socket) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const onData = (d) => {
            buf += d.toString();
            const m = buf.match(/^HTTP\/1\.1 (\d+)[^\r\n]*\r\n([\s\S]*?)\r\n\r\n/);
            if (!m) {
                return;
            }

            const headers = m[2];
            const length = Number((headers.match(/content-length:\s*(\d+)/i) || [])[1] || 0);
            if (buf.length >= m[0].length + length) {
                cleanup();
                resolve({status: Number(m[1]), headers});
            }
        };

        const onClose = () => {
            cleanup();
            reject(new Error('the server closed the connection'));
        };

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('no answer'));
        }, 5000);
        const cleanup = () => {
            clearTimeout(timer);
            socket.removeListener('data', onData);
            socket.removeListener('close', onClose);
            socket.removeListener('error', onClose);
        };

        socket.on('data', onData);
        socket.on('close', onClose);
        socket.on('error', onClose);
        socket.write(
            'POST / HTTP/1.1\r\nHost: ' +
                HOST +
                '\r\nContent-Type: text/xml\r\nConnection: keep-alive\r\nContent-Length: ' +
                Buffer.byteLength(REQUEST) +
                '\r\n\r\n' +
                REQUEST,
        );
    });
}

describe('the XML-RPC callback server keeps idle keep-alive connections open', function () {
    this.timeout(30000);
    let fake;
    let nc;

    before(async () => {
        removeCache();
        await new Promise((resolve) => helper.startServer(resolve));
        fake = fakeServer(FAKE_PORT);
        await load([nodeConnection], flow);
        nc = helper.getNode('nc');
        nc.paramsetFile = PARAMSETS_SCRATCH;
        (await until(() => nc.ifaceStatus['HmIP-RF'], 5000)).should.be.true();
    });

    after(async () => {
        await helper.unload();
        await fake.close();
        await new Promise((resolve) => helper.stopServer(resolve));
        removeCache();
    });

    it("the server's idle bound is above hmipserver's client pool (1200 s), the header bound above it", () => {
        const server = nc.servers.http.httpServer;
        server.keepAliveTimeout.should.be.above(1200 * 1000);
        server.headersTimeout.should.be.above(server.keepAliveTimeout);
    });

    it('a connection idle for longer than the old 5 s default still serves the next call', async () => {
        const socket = net.connect({host: HOST, port: XML_PORT});
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('error', reject);
        });
        try {
            const first = await request(socket);
            first.status.should.equal(200);
            first.headers.should.match(/keep-alive: timeout=1300/i);
            await wait(6500);
            const second = await request(socket);
            second.status.should.equal(200);
        } finally {
            socket.destroy();
        }
    });
});
