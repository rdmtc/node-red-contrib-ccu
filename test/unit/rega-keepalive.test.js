const {test, describe, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {Rega} = require('homematic-rega');

/* B-18 (RedMatic #601): on a CCU the connection node talks to ReGaHSS itself on 8183
   (isLocal, since 4.3.0). ReGaHSS answers HTTP/1.1 without Connection: close and
   sends FIN 0.4-7 ms after the response; Node's http.globalAgent pools the socket
   (keepAlive: true since Node 19) and the next request on it - setVariable followed
   by regaPoll, or getRegaVariables followed by getRegaPrograms - died with
   "socket hang up". homematic-rega >= 2.0.1 uses an agent without keep-alive; this
   guards the dependency floor against a future bump. */
describe('homematic-rega against a ReGaHSS-like server (B-18)', () => {
    let server;
    let port;
    const connections = [];

    before(async () => {
        server = http.createServer((req, res) => {
            connections.push(req.headers.connection);
            req.resume();
            req.on('end', () => {
                res.end('[]<xml><exec>/rega.exe</exec></xml>');
                setImmediate(() => req.socket.destroy());
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    after(() => {
        server.closeAllConnections();
        server.close();
    });

    test('the poll pair after a write goes through without keep-alive', async () => {
        const rega = new Rega({host: '127.0.0.1', port: port, translate: false});
        assert.notEqual(rega.agent, http.globalAgent);
        assert.equal(rega.agent.keepAlive, false);
        for (let i = 0; i < 10; i++) {
            await rega.exec('dom.GetObject(1234).State(1);');
            await rega.getVariables();
            await rega.getPrograms();
        }
        assert.equal(connections.length, 30);
        assert.ok(connections.every((c) => c === 'close'));
    });
});
