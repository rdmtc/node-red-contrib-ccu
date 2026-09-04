const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {isLocalCcu, listeningPorts} = require('../../nodes/lib/localccu.js');

/* Real /proc/net/tcp lines from a CCU3 on firmware 3.89.8: rfd's direct
   BINRPC port 32001 (0x7D01) and the ReGa 31999 (0x7CFF) are listening, and
   /etc/lighttpd/conf.d/proxy.conf there is a bare include - which is why the
   old config grep never detected a local connection (B-4). */
const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
const CCU_TCP =
    HEADER +
    '   0: 00000000:7CFF 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 10593 1 baa53840 100 0 0 10 0\n' +
    '   1: 00000000:7D01 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 10591 1 baa53200 100 0 0 10 0\n' +
    '   2: 00000000:07D1 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 10592 1 baa53201 100 0 0 10 0\n';

/* A plain host: only the proxied ports, nothing on 3xxxx. */
const REMOTE_TCP =
    HEADER +
    '   0: 00000000:07D1 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 10591 1 baa53200 100 0 0 10 0\n' +
    '   1: 0100007F:1F40 0100007F:C001 01 00000000:00000000 00:00000000 00000000     0        0 10594 1 baa53202 100 0 0 10 0\n';

function tempFile(content) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-')), 'tcp');
    fs.writeFileSync(file, content);
    return file;
}

test('listeningPorts reads listening sockets only', () => {
    const ports = listeningPorts([tempFile(REMOTE_TCP)]);
    assert.ok(ports.has(2001), '2001 is listening');
    // 0x1F40 = 8000 is an established connection, state 01
    assert.equal(ports.has(8000), false);
});

test('listeningPorts parses the hex port', () => {
    const ports = listeningPorts([tempFile(CCU_TCP)]);
    assert.deepEqual(
        [...ports].sort((a, b) => a - b),
        [2001, 31999, 32001],
    );
});

test('listeningPorts tolerates a missing /proc', () => {
    assert.equal(listeningPorts(['/definitely/not/here']).size, 0);
});

test('local when the host is loopback and the direct port is open', () => {
    const files = [tempFile(CCU_TCP)];
    assert.equal(isLocalCcu('localhost', {files}), true);
    assert.equal(isLocalCcu('127.0.0.1', {files}), true);
    assert.equal(isLocalCcu('::1', {files}), true);
});

test('not local for a remote host, even with the ports open', () => {
    const files = [tempFile(CCU_TCP)];
    assert.equal(isLocalCcu('ccu.example', {files}), false);
    assert.equal(isLocalCcu('192.168.1.10', {files}), false);
});

test('not local when nothing listens on the direct ports', () => {
    assert.equal(isLocalCcu('localhost', {files: [tempFile(REMOTE_TCP)]}), false);
});

test('not local without /proc (Windows, macOS)', () => {
    assert.equal(isLocalCcu('localhost', {files: ['/definitely/not/here']}), false);
});

test('an empty host is not local', () => {
    assert.equal(isLocalCcu('', {files: [tempFile(CCU_TCP)]}), false);
    assert.equal(isLocalCcu(undefined, {files: [tempFile(CCU_TCP)]}), false);
});
