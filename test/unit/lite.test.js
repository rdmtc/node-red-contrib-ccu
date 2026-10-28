const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {
    tierAwareTransport,
    translateError,
    readAddonToken,
    liteValue,
    LiteConnection,
} = require('../../nodes/lib/lite.js');

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

    test("occulite-client's own OccuLiteError (its kind in `code`): fault, forbidden, another kind, a system error", () => {
        const {OccuLiteError} = require('occulite-client');
        const fault = translateError(new OccuLiteError('rpc-fault', 'Failure', {faultCode: -1, method: 'setValue'}));
        assert.equal(fault.faultCode, -1);
        assert.equal(fault.faultString, 'Failure');
        assert.equal(fault.message, 'Failure');
        const refused = translateError(new OccuLiteError('forbidden', 'no', {scope: 'rpc:admin'}));
        assert.equal(refused.kind, 'forbidden');
        assert.match(refused.message, /needs rpc:admin/);
        assert.equal(translateError(new OccuLiteError('timeout', 'slow')).kind, 'timeout');
        const system = Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'});
        assert.equal(translateError(system), system);
    });

    test('no token file means no token', () => {
        assert.equal(readAddonToken('/nonexistent/nrccu-token'), undefined);
    });
});

describe("liteValue (B-41): homematic-xmlrpc's explicitDouble as lite-rpc's double", () => {
    test('the top level: {double} where the system announces json_double, the plain number otherwise', () => {
        const parameters = ['HEQ0176198:3', 'LEVEL', {explicitDouble: 0.85}];
        assert.deepEqual(liteValue(parameters, true), ['HEQ0176198:3', 'LEVEL', {double: 0.85}]);
        assert.deepEqual(liteValue(parameters, false), ['HEQ0176198:3', 'LEVEL', 0.85]);
        assert.deepEqual(liteValue(['X:1', 'LEVEL', {explicitDouble: 1}], true), ['X:1', 'LEVEL', {double: 1}]);
        assert.deepEqual(liteValue(['X:1', 'LEVEL', {explicitDouble: 0}], false), ['X:1', 'LEVEL', 0]);
    });

    test('inside a paramset: only the FLOATs change, an INTEGER, a string, a bool stay', () => {
        const parameters = ['001A58A9A23FB5:9', 'VALUES', {LEVEL: {explicitDouble: 0}, COLOR: 0, NAME: 'x', ON: true}];
        assert.deepEqual(liteValue(parameters, true), [
            '001A58A9A23FB5:9',
            'VALUES',
            {LEVEL: {double: 0}, COLOR: 0, NAME: 'x', ON: true},
        ]);
    });

    test("inside a multicall's calls", () => {
        const parameters = [
            [
                {methodName: 'setValue', params: ['A:1', 'LEVEL', {explicitDouble: 0.5}]},
                {methodName: 'putParamset', params: ['A:2', 'VALUES', {LEVEL_2: {explicitDouble: 0.25}}]},
            ],
        ];
        assert.deepEqual(liteValue(parameters, true), [
            [
                {methodName: 'setValue', params: ['A:1', 'LEVEL', {double: 0.5}]},
                {methodName: 'putParamset', params: ['A:2', 'VALUES', {LEVEL_2: {double: 0.25}}]},
            ],
        ]);
    });

    test('a struct with explicitDouble beside other members, null and the input itself are left alone', () => {
        const struct = {explicitDouble: 1, other: 2};
        assert.deepEqual(liteValue([struct, null, undefined], true), [{explicitDouble: 1, other: 2}, null, undefined]);
        const input = ['A:1', 'LEVEL', {explicitDouble: 0.5}];
        liteValue(input, true);
        assert.deepEqual(input, ['A:1', 'LEVEL', {explicitDouble: 0.5}]);
    });

    test('LiteConnection.call hands the translated parameters to the client', async () => {
        for (const [capabilities, expected] of [
            [{json_double: true}, {double: 0.85}],
            [{}, 0.85],
        ]) {
            const seen = [];
            const connection = new LiteConnection({interfaces: ['BidCos-Wired']});
            connection.box = {
                capabilities,
                call: (iface, method, parameters) => {
                    seen.push([iface, method, parameters]);
                    return Promise.resolve('');
                },
            };
            await connection.call('BidCos-Wired', 'setValue', ['HEQ0176198:3', 'LEVEL', {explicitDouble: 0.85}]);
            assert.deepEqual(seen, [['BidCos-Wired', 'setValue', ['HEQ0176198:3', 'LEVEL', expected]]]);
        }
    });
});
