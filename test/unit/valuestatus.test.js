const {test} = require('node:test');
const assert = require('node:assert/strict');

const {valueStatus, formatValueStatus, relativeTime} = require('../../nodes/lib/valuestatus.js');

const T0 = 1_700_000_000_000;

test('relativeTime: seconds, minutes, hours, days', () => {
    assert.equal(relativeTime(T0, T0), '0s');
    assert.equal(relativeTime(T0 - 5000, T0), '5s');
    assert.equal(relativeTime(T0 - 90_000, T0), '1m');
    assert.equal(relativeTime(T0 - 3 * 3600_000, T0), '3h');
    assert.equal(relativeTime(T0 - 50 * 3600_000, T0), '2d');
});

test('relativeTime: a timestamp in the future does not go negative', () => {
    assert.equal(relativeTime(T0 + 10_000, T0), '0s');
});

test('formatValueStatus appends the age', () => {
    assert.equal(formatValueStatus(21.5, T0 - 60_000, T0), '21.5 (1m)');
    assert.equal(formatValueStatus(true, T0, T0), 'true (0s)');
});

test('formatValueStatus without a timestamp shows the value alone', () => {
    assert.equal(formatValueStatus('on', 0, T0), 'on');
    assert.equal(formatValueStatus('on', undefined, T0), 'on');
});

test('formatValueStatus truncates long text', () => {
    const long = 'x'.repeat(80);
    const out = formatValueStatus(long, undefined, T0);
    assert.equal(out.length, 45);
    assert.ok(out.endsWith('…'));
});

test('valueStatus renders through the node status', () => {
    const seen = [];
    const node = {status: (s) => seen.push(s)};
    const status = valueStatus(node, {now: () => T0});
    status.set(42, T0 - 120_000);
    status.stop();
    assert.deepEqual(seen, [{fill: 'green', shape: 'ring', text: '42 (2m)'}]);
});

test('valueStatus without a timestamp still renders and schedules nothing', () => {
    const seen = [];
    const node = {status: (s) => seen.push(s)};
    const status = valueStatus(node, {now: () => T0});
    status.set('idle');
    assert.equal(seen[0].text, 'idle');
    status.clear();
    status.stop();
});
