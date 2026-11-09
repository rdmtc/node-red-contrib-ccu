const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {translateError, readAddonToken, liteValue, LiteConnection} = require('../../nodes/lib/lite.js');

/* task 14: the pieces of the lite-rpc module that need no system. */

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
        const parameters = ['JEQ0000001:3', 'LEVEL', {explicitDouble: 0.85}];
        assert.deepEqual(liteValue(parameters, true), ['JEQ0000001:3', 'LEVEL', {double: 0.85}]);
        assert.deepEqual(liteValue(parameters, false), ['JEQ0000001:3', 'LEVEL', 0.85]);
        assert.deepEqual(liteValue(['X:1', 'LEVEL', {explicitDouble: 1}], true), ['X:1', 'LEVEL', {double: 1}]);
        assert.deepEqual(liteValue(['X:1', 'LEVEL', {explicitDouble: 0}], false), ['X:1', 'LEVEL', 0]);
    });

    test('inside a paramset: only the FLOATs change, an INTEGER, a string, a bool stay', () => {
        const parameters = ['0000000000ABCD:9', 'VALUES', {LEVEL: {explicitDouble: 0}, COLOR: 0, NAME: 'x', ON: true}];
        assert.deepEqual(liteValue(parameters, true), [
            '0000000000ABCD:9',
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
            await connection.call('BidCos-Wired', 'setValue', ['JEQ0000001:3', 'LEVEL', {explicitDouble: 0.85}]);
            assert.deepEqual(seen, [['BidCos-Wired', 'setValue', ['JEQ0000001:3', 'LEVEL', expected]]]);
        }
    });
});

describe('LiteConnection: a failed connect is tried again with a new client', () => {
    const occuLiteError = (code) => Object.assign(new Error(code + ' happened'), {name: 'OccuLiteError', code});

    /** a client whose ready() answers what `outcomes` says, one per client */
    function clients(outcomes) {
        const made = [];
        const createClient = (options) => {
            const outcome = outcomes[made.length];
            const box = {
                options,
                closed: false,
                values: new Map(),
                on: () => () => {},
                ready: () => (outcome ? Promise.reject(outcome) : Promise.resolve()),
                close() {
                    this.closed = true;
                },
            };
            made.push(box);
            return box;
        };

        return {made, createClient};
    }

    function connection(createClient, extra = {}) {
        const lines = [];
        const logger = {debug: (l) => lines.push(['debug', l]), warn: (l) => lines.push(['warn', l])};
        const seen = [];
        const lite = new LiteConnection({
            url: 'http://box',
            token: 't',
            interfaces: ['HmIP-RF'],
            initId: (iface) => 'nr_x_' + iface,
            onCallback() {},
            onInterface() {},
            onStatus() {},
            logger,
            createClient,
            retryMin: 10,
            retryMax: 20,
            onBox: (box) => seen.push(box),
            ...extra,
        });
        return {lite, lines, seen};
    }

    test('unreachable twice, then connected: three clients, the old ones closed, warned once', async () => {
        const {made, createClient} = clients([occuLiteError('unreachable'), occuLiteError('timeout'), null]);
        const {lite, lines, seen} = connection(createClient, {meta: true});
        await lite.start();
        assert.equal(made.length, 3);
        assert.deepEqual(seen, made);
        assert.equal(made[0].closed, true);
        assert.equal(made[1].closed, true);
        assert.equal(made[2].closed, false);
        assert.equal(lite.box, made[2]);
        assert.equal(made[2].options.meta, true);
        assert.equal(lite.ready, true);
        assert.deepEqual(
            lines.map((l) => l[0]),
            ['warn', 'debug'],
        );
        assert.match(lines[0][1], /^lite-rpc: unreachable happened - connecting again in 0\.01 s$/);
        lite.close();
    });

    test('a rejection without a message is said as it is', async () => {
        const {made, createClient} = clients(['socket hang up', null]);
        const {lite, lines} = connection(createClient);
        await lite.start();
        assert.equal(made.length, 2);
        assert.match(lines[0][1], /^lite-rpc: socket hang up - connecting again/);
        lite.close();
    });

    test('a refused credential or a system that is not openccu-lite rejects at once', async () => {
        for (const code of ['unauthenticated', 'forbidden', 'unsupported']) {
            const {made, createClient} = clients([occuLiteError(code)]);
            const {lite} = connection(createClient);
            await assert.rejects(lite.start(), new RegExp(code));
            assert.equal(made.length, 1);
            assert.equal(made[0].options.meta, false);
        }
    });

    test('closed while waiting: no new client', async () => {
        const {made, createClient} = clients([occuLiteError('unreachable'), null]);
        const {lite} = connection(createClient, {retryMin: 200});
        const started = lite.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        lite.close();
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(made.length, 1);
        assert.equal(lite.retryTimeout, null);
        // the promise stays pending: nobody waits on a closed connection
        let settled = false;
        started.then(
            () => (settled = true),
            () => (settled = true),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(settled, false);
    });

    test('closed while connecting: the rejection reaches the caller', async () => {
        let fail;
        const createClient = () => ({
            on: () => () => {},
            ready: () => new Promise((resolve, reject) => (fail = reject)),
            close() {},
        });
        const {lite} = connection(createClient);
        const started = lite.start();
        lite.close();
        fail(occuLiteError('unreachable'));
        await assert.rejects(started, /unreachable/);
    });
});
