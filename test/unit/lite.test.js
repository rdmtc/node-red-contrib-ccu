const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {tierAwareTransport, translateError, readAddonToken} = require('../../nodes/lib/lite.js');

/* task 14: the pieces of the lite-rpc module that need no system. */

function fakeTransport(status, body) {
    return {
        request: () => Promise.resolve({status, headers: {}, body}),
        stream: () => Promise.resolve({status: 200, chunks: []}),
    };
}

describe('tierAwareTransport (occulite-client B-3)', () => {
    test('a token with a higher tier gets rpc:read spelled out in the auth state', async () => {
        const transport = tierAwareTransport(fakeTransport(200, JSON.stringify({scopes: ['meta:read', 'rpc:admin']})));
        const response = await transport.request('GET', 'http://box/api/auth/v1/state', {});
        assert.deepEqual(JSON.parse(response.body).scopes, ['meta:read', 'rpc:admin', 'rpc:read']);
    });

    test('a token with rpc:read, or without any rpc tier, is left as it is', async () => {
        for (const scopes of [['rpc:read', 'rpc:admin'], ['meta:read'], ['*']]) {
            const transport = tierAwareTransport(fakeTransport(200, JSON.stringify({scopes})));
            const response = await transport.request('GET', 'http://box/api/auth/v1/state', {});
            assert.deepEqual(JSON.parse(response.body).scopes, scopes);
        }
    });

    test('other routes, other statuses and a body that is not JSON pass through', async () => {
        const other = tierAwareTransport(fakeTransport(200, JSON.stringify({scopes: ['rpc:admin']})));
        assert.deepEqual(JSON.parse((await other.request('GET', 'http://box/api/meta/v1/version', {})).body).scopes, [
            'rpc:admin',
        ]);
        const refused = tierAwareTransport(fakeTransport(401, '{"error":"unauthenticated"}'));
        assert.equal((await refused.request('GET', 'http://box/api/auth/v1/state', {})).status, 401);
        const html = tierAwareTransport(fakeTransport(200, '<html>'));
        assert.equal((await html.request('GET', 'http://box/api/auth/v1/state', {})).body, '<html>');
    });
});

describe('translateError and readAddonToken', () => {
    test('a fault keeps its code and string', () => {
        const fault = translateError(
            Object.assign(new Error('x'), {
                kind: 'rpc-fault',
                faultCode: -5,
                faultString: 'Invalid parameter or value',
            }),
        );
        assert.equal(fault.faultCode, -5);
        assert.equal(fault.faultString, 'Invalid parameter or value');
    });

    test('a refused scope names it, another kind keeps its kind, a string becomes an Error', () => {
        assert.match(
            translateError(Object.assign(new Error('f'), {kind: 'forbidden', scope: 'rpc:operate'})).message,
            /needs rpc:operate/,
        );
        assert.equal(translateError(Object.assign(new Error('t'), {kind: 'unreachable'})).kind, 'unreachable');
        assert.equal(translateError('boom').message, 'boom');
    });

    test('no token file means no token', () => {
        assert.equal(readAddonToken('/nonexistent/nrccu-token'), undefined);
    });
});
