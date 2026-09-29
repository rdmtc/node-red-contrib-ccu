/* task 5 (#27): which connections get TLS and credentials - lib/transport.js */

const test = require('node:test');
const assert = require('node:assert/strict');

const {resolveTransport} = require('../../nodes/lib/transport.js');

const messages = (t) => t.notes.map((n) => n.level + ': ' + n.message);

test('a remote connection with TLS and authentication gets both, insecure as configured', () => {
    const t = resolveTransport({isLocal: false, tls: true, authentication: true, inSecure: true});
    assert.deepEqual(
        {tls: t.tls, auth: t.auth, inSecure: t.inSecure, bcrfBinRpc: t.bcrfBinRpc},
        {tls: true, auth: true, inSecure: true, bcrfBinRpc: false},
    );
    assert.deepEqual(t.notes, []);
});

test('a remote connection without either stays plain and silent', () => {
    const t = resolveTransport({isLocal: false});
    assert.deepEqual(
        {tls: t.tls, auth: t.auth, inSecure: t.inSecure, bcrfBinRpc: t.bcrfBinRpc},
        {tls: false, auth: false, inSecure: false, bcrfBinRpc: false},
    );
    assert.deepEqual(t.notes, []);
});

test('insecure means nothing without TLS', () => {
    const t = resolveTransport({isLocal: false, tls: false, inSecure: true});
    assert.equal(t.inSecure, false);
});

test('authentication without TLS is allowed and warned about once', () => {
    const t = resolveTransport({isLocal: false, tls: false, authentication: true});
    assert.equal(t.auth, true);
    assert.equal(t.tls, false);
    assert.deepEqual(messages(t), ['warn: authentication without TLS: the credentials are sent in plain text']);
});

test('a local connection uses neither, whatever the dialog says, and says so once', () => {
    const t = resolveTransport({isLocal: true, tls: true, authentication: true, inSecure: true, bcrfBinRpc: true});
    assert.deepEqual(
        {tls: t.tls, auth: t.auth, inSecure: t.inSecure, bcrfBinRpc: t.bcrfBinRpc},
        {tls: false, auth: false, inSecure: false, bcrfBinRpc: false},
    );
    assert.deepEqual(messages(t), [
        'info: local connection: TLS and authentication are not used, the interface processes are reached directly',
    ]);
});

test('a local connection without either logs nothing', () => {
    assert.deepEqual(resolveTransport({isLocal: true}).notes, []);
});

test('BIN-RPC for BidCos-RF has no TLS: with TLS on it becomes XML-RPC over TLS', () => {
    const t = resolveTransport({isLocal: false, tls: true, bcrfBinRpc: true});
    assert.equal(t.bcrfBinRpc, false);
    assert.equal(t.tls, true);
    assert.deepEqual(messages(t), [
        'warn: BidCos-RF: BIN-RPC has no TLS - using XML-RPC over TLS (port 42001) instead',
    ]);
});

test('BIN-RPC for BidCos-RF carries no credentials: kept, with a warning', () => {
    const t = resolveTransport({isLocal: false, authentication: true, bcrfBinRpc: true});
    assert.equal(t.bcrfBinRpc, true);
    assert.deepEqual(messages(t), [
        'warn: BidCos-RF: BIN-RPC carries no credentials - the CCU refuses it while authentication is on',
        'warn: authentication without TLS: the credentials are sent in plain text',
    ]);
});

test('BIN-RPC for BidCos-RF without TLS or authentication is kept quietly', () => {
    const t = resolveTransport({isLocal: false, bcrfBinRpc: true});
    assert.equal(t.bcrfBinRpc, true);
    assert.deepEqual(t.notes, []);
});
