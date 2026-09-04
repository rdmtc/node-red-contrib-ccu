const {test} = require('node:test');
const assert = require('node:assert/strict');

const {castValue, enumList} = require('../../nodes/lib/cast.js');

/* The CCU returns enum names in VALUE_LIST. The old code read description.ENUM,
   which no interface process sends, so casting by name never worked (B-3). */

const CONTROL_MODE = {
    TYPE: 'ENUM',
    MIN: 0,
    MAX: 3,
    VALUE_LIST: ['AUTO-MODE', 'MANU-MODE', 'PARTY-MODE', 'BOOST-MODE'],
};

test('enumList reads VALUE_LIST', () => {
    assert.deepEqual(enumList(CONTROL_MODE), CONTROL_MODE.VALUE_LIST);
});

test('enumList falls back to ENUM for hand-written data', () => {
    assert.deepEqual(enumList({ENUM: ['a', 'b']}), ['a', 'b']);
});

test('enumList tolerates missing and non-array values', () => {
    assert.equal(enumList(undefined), undefined);
    assert.equal(enumList({}), undefined);
    assert.equal(enumList({VALUE_LIST: 'nope'}), undefined);
});

test('ENUM: a name from VALUE_LIST becomes its index', () => {
    assert.equal(castValue('BOOST-MODE', CONTROL_MODE), 3);
    assert.equal(castValue('AUTO-MODE', CONTROL_MODE), 0);
});

test('ENUM: an unknown name falls back to the numeric cast', () => {
    assert.equal(castValue('NOPE', CONTROL_MODE), 0);
});

test('ENUM: numbers pass through the INTEGER branch', () => {
    assert.equal(castValue(2, CONTROL_MODE), 2);
    assert.equal(castValue('2', CONTROL_MODE), 2);
});

test('clamp is off by default (#74)', () => {
    assert.equal(castValue(99, {TYPE: 'INTEGER', MIN: 0, MAX: 3}), 99);
    assert.deepEqual(castValue(9.5, {TYPE: 'FLOAT', MIN: 0, MAX: 1}), {explicitDouble: 9.5});
});

test('clamp limits INTEGER and FLOAT to MIN/MAX', () => {
    const opts = {clamp: true};
    assert.equal(castValue(99, {TYPE: 'INTEGER', MIN: 0, MAX: 3}, opts), 3);
    assert.equal(castValue(-5, {TYPE: 'INTEGER', MIN: 0, MAX: 3}, opts), 0);
    assert.deepEqual(castValue(9.5, {TYPE: 'FLOAT', MIN: 0, MAX: 1}, opts), {explicitDouble: 1});
    assert.deepEqual(castValue(-1, {TYPE: 'FLOAT', MIN: 0, MAX: 1}, opts), {explicitDouble: 0});
});

test('clamp leaves values inside the range alone', () => {
    const opts = {clamp: true};
    assert.equal(castValue(2, {TYPE: 'INTEGER', MIN: 0, MAX: 3}, opts), 2);
    assert.deepEqual(castValue(0.5, {TYPE: 'FLOAT', MIN: 0, MAX: 1}, opts), {explicitDouble: 0.5});
});

test('clamp tolerates a description without MIN/MAX', () => {
    assert.equal(castValue(99, {TYPE: 'INTEGER'}, {clamp: true}), 99);
});

test('clamp: an unparseable number becomes 0 rather than NaN', () => {
    // the mqtt node's own copy produced NaN here, which XML-RPC cannot encode
    assert.equal(castValue('junk', {TYPE: 'INTEGER', MIN: 0, MAX: 3}, {clamp: true}), 0);
});
