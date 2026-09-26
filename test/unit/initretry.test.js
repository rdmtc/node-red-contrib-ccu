const {test, describe, beforeEach, afterEach, mock} = require('node:test');
const assert = require('node:assert/strict');

const {InitRetry, retryDelay, isFault, isRefused, describeError} = require('../../nodes/lib/initretry.js');
const statusHelper = require('../../nodes/lib/status.js');

/* task 11: a failed init is retried with backoff 2, 4, 8, 16 s, then every 30 s,
   quietly while the interface process does not answer. */

function refused() {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:2010');
    error.code = 'ECONNREFUSED';
    error.syscall = 'connect';
    return error;
}

function fault(code, string) {
    const error = new Error(string);
    error.faultCode = code;
    error.faultString = string;
    return error;
}

function recorder() {
    const lines = [];
    const logger = {};
    for (const level of ['debug', 'info', 'warn', 'error']) {
        logger[level] = (message) => lines.push({level, message});
    }

    return {lines, logger};
}

/** let the attempt's promise chain settle (no timers involved) */
async function settle() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

describe('retryDelay', () => {
    test('1, 2, 4, 8 s, then every 15 s (task 12)', () => {
        assert.deepEqual(
            [1, 2, 3, 4, 5, 6, 20].map((n) => retryDelay(n)),
            [1000, 2000, 4000, 8000, 15000, 15000, 15000],
        );
    });
});

describe('isFault and describeError', () => {
    test('a refused connection is no fault', () => {
        assert.equal(isFault(refused()), false);
        assert.equal(describeError(refused()), 'connect ECONNREFUSED');
    });

    test('a fault answer is a fault', () => {
        assert.equal(isFault(fault(-1, 'Failure')), true);
        assert.equal(describeError(fault(-1, 'Failure')), 'fault -1 Failure');
    });

    test('isRefused: ECONNREFUSED by code or message only', () => {
        assert.equal(isRefused(refused()), true);
        assert.equal(isRefused(new Error('connect ECONNREFUSED 127.0.0.1:2010')), true);
        assert.equal(isRefused(Object.assign(new Error('x'), {code: 'ECONNRESET'})), false);
        assert.equal(isRefused(fault(-1, 'Failure')), false);
        assert.equal(isRefused(undefined), false);
    });

    test('an error without code names its message', () => {
        assert.equal(describeError(new Error('socket hang up')), 'socket hang up');
        assert.equal(describeError(null), 'unknown error');
    });

    test('an aggregate connect error without syscall', () => {
        const error = new AggregateError([], '');
        error.code = 'ECONNREFUSED';
        assert.equal(describeError(error), 'connect ECONNREFUSED');
    });
});

describe('InitRetry', () => {
    let now;
    let attempts;
    let available;
    let answer;
    let states;
    let log;
    let retry;

    beforeEach(() => {
        mock.timers.enable({apis: ['setTimeout']});
        now = 0;
        attempts = [];
        available = false;
        answer = null;
        states = [];
        log = recorder();
        retry = new InitRetry({
            iface: 'HmIP-RF',
            logger: log.logger,
            onState: (state) => states.push(state),
            attempt: () => {
                attempts.push(now);
                if (answer) {
                    return Promise.reject(answer);
                }

                return available ? Promise.resolve() : Promise.reject(refused());
            },
        });
    });

    afterEach(() => {
        retry.stop();
        mock.timers.reset();
    });

    async function tick(ms) {
        now += ms;
        mock.timers.tick(ms);
        await settle();
    }

    test('attempts at 1, 2, 4, 8, 15, 15 s against a refusing server', async () => {
        retry.failed(refused());
        for (const step of [1000, 2000, 4000, 8000, 15000, 15000]) {
            await tick(step - 1);
            const before = attempts.length;
            await tick(1);
            assert.equal(attempts.length, before + 1, 'attempt after ' + step + ' ms');
        }

        assert.deepEqual(attempts, [1000, 3000, 7000, 15000, 30000, 45000]);
    });

    test('succeeds within one backoff step after the server appears', async () => {
        retry.failed(refused());
        await tick(1000);
        await tick(2000);
        available = true;
        assert.equal(retry.pending, true);
        await tick(4000);
        assert.equal(retry.pending, false);
        assert.deepEqual(states, ['waiting', 'waiting', 'waiting', 'connected']);
        assert.equal(retry.failures, 0);
    });

    test('the log at the start: one info line while nothing listens, then debug, info on success', async () => {
        retry.failed(refused());
        await tick(1000);
        await tick(2000);
        available = true;
        await tick(4000);
        const levels = log.lines.map((l) => l.level);
        assert.deepEqual(levels, ['info', 'debug', 'debug', 'info']);
        assert.equal(
            log.lines[0].message,
            'HmIP-RF not listening yet (connect ECONNREFUSED), waiting for it - retrying in 1 s',
        );
        assert.equal(log.lines[3].message, 'HmIP-RF connected after 4 attempts');
    });

    test('another transport error at the start is a warning', async () => {
        const reset = Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'});
        retry.failed(reset);
        assert.deepEqual(
            log.lines.map((l) => l.level),
            ['warn'],
        );
        assert.equal(log.lines[0].message, 'HmIP-RF not reachable yet (connect ECONNRESET), retrying');
    });

    test('the backoff resets after a success, and a refusal after it is a warning', async () => {
        retry.failed(refused());
        await tick(1000);
        await tick(2000);
        available = true;
        await tick(4000);
        attempts.length = 0;
        available = false;
        retry.failed(refused());
        await tick(1000);
        assert.deepEqual(attempts, [8000]);
        // the process went away after it was connected: that is worth a warning, once
        assert.equal(log.lines.filter((l) => l.level === 'warn').length, 1);
        assert.equal(log.lines.filter((l) => l.level === 'info' && l.message.includes('not listening yet')).length, 1);
    });

    test('stop() cancels the timer, and a late answer changes nothing', async () => {
        retry.failed(refused());
        assert.equal(retry.pending, true);
        retry.stop();
        assert.equal(retry.pending, false);
        await tick(60000);
        assert.deepEqual(attempts, []);
        retry.failed(refused());
        retry.succeeded();
        assert.equal(retry.pending, false);
        assert.deepEqual(states, ['waiting']);
    });

    test('a fault answer is an error, once per fault, and the state is failed', async () => {
        answer = fault(-1, 'Failure');
        retry.failed(answer);
        await tick(1000);
        await tick(2000);
        const errors = log.lines.filter((l) => l.level === 'error');
        assert.equal(errors.length, 1);
        assert.equal(errors[0].message, 'init HmIP-RF failed: fault -1 Failure, retrying in 1 s');
        assert.deepEqual(states, ['failed', 'failed', 'failed']);
        assert.equal(attempts.length, 2);
    });

    test('a first init that succeeds logs nothing and reports connected', () => {
        retry.succeeded();
        assert.deepEqual(log.lines, []);
        assert.deepEqual(states, ['connected']);
    });
});

describe('status helper: waiting', () => {
    function node(iface) {
        const n = {iface, shown: []};
        n.status = (s) => n.shown.push(s);
        return n;
    }

    test('an interface node shows waiting as a yellow ring, then connected', () => {
        const n = node('HmIP-RF');
        statusHelper(n, {ifaceStatus: {'HmIP-RF': false}, ifaceWaiting: {'HmIP-RF': true}});
        statusHelper(n, {ifaceStatus: {'HmIP-RF': true}, ifaceWaiting: {}});
        assert.deepEqual(n.shown, [
            {fill: 'yellow', shape: 'ring', text: 'waiting'},
            {fill: 'green', shape: 'dot', text: 'connected'},
        ]);
    });

    test('a node without interface shows waiting while nothing is connected', () => {
        const n = node('');
        statusHelper(n, {ifaceStatus: {'HmIP-RF': false, 'BidCos-RF': false}, ifaceWaiting: {'HmIP-RF': true}});
        statusHelper(n, {ifaceStatus: {'HmIP-RF': false, 'BidCos-RF': true}, ifaceWaiting: {'HmIP-RF': true}});
        assert.deepEqual(n.shown, [
            {fill: 'yellow', shape: 'ring', text: 'waiting'},
            {fill: 'yellow', shape: 'dot', text: 'partly connected'},
        ]);
    });

    test('not waiting stays disconnected (red)', () => {
        const n = node('HmIP-RF');
        statusHelper(n, {ifaceStatus: {'HmIP-RF': false}});
        assert.deepEqual(n.shown, [{fill: 'red', shape: 'dot', text: 'disconnected'}]);
    });
});
