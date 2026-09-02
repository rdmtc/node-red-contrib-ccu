const {test} = require('node:test');
const assert = require('node:assert/strict');

const {castValue} = require('../../nodes/lib/cast.js');

test('BOOL: string "false" becomes false', () => {
    assert.equal(castValue('false', {TYPE: 'BOOL'}), false);
});

test('BOOL: string "0" becomes false', () => {
    assert.equal(castValue('0', {TYPE: 'BOOL'}), false);
});

test('BOOL: string "1" becomes true', () => {
    assert.equal(castValue('1', {TYPE: 'BOOL'}), true);
});

test('BOOL: non-numeric string becomes true', () => {
    assert.equal(castValue('on', {TYPE: 'BOOL'}), true);
});

test('BOOL: booleans pass through', () => {
    assert.equal(castValue(true, {TYPE: 'BOOL'}), true);
    assert.equal(castValue(false, {TYPE: 'BOOL'}), false);
});

test('ACTION casts like BOOL', () => {
    assert.equal(castValue('false', {TYPE: 'ACTION'}), false);
    assert.equal(castValue(1, {TYPE: 'ACTION'}), true);
});

test('FLOAT: wraps in explicitDouble', () => {
    assert.deepEqual(castValue('1.5', {TYPE: 'FLOAT'}), {explicitDouble: 1.5});
    assert.deepEqual(castValue(0.25, {TYPE: 'FLOAT'}), {explicitDouble: 0.25});
});

test('FLOAT: unparseable becomes 0', () => {
    assert.deepEqual(castValue('nope', {TYPE: 'FLOAT'}), {explicitDouble: 0});
});

test('FLOAT: no MIN/MAX clamping (issue #74 decision)', () => {
    assert.deepEqual(castValue(2, {TYPE: 'FLOAT', MIN: 0, MAX: 1}), {explicitDouble: 2});
});

test('ENUM: known string becomes its index', () => {
    assert.equal(castValue('TRIGGERED', {TYPE: 'ENUM', ENUM: ['IDLE', 'TRIGGERED']}), 1);
});

test('ENUM: numeric string falls through to integer parse', () => {
    assert.equal(castValue('2', {TYPE: 'ENUM', ENUM: ['A', 'B', 'C']}), 2);
});

test('ENUM: unknown non-numeric string parses to 0', () => {
    assert.equal(castValue('nope', {TYPE: 'ENUM', ENUM: ['A', 'B']}), 0);
});

test('INTEGER: numeric string parses', () => {
    assert.equal(castValue('5', {TYPE: 'INTEGER'}), 5);
});

test('INTEGER: boolean becomes 0/1', () => {
    assert.equal(castValue(true, {TYPE: 'INTEGER'}), 1);
    assert.equal(castValue(false, {TYPE: 'INTEGER'}), 0);
});

test('INTEGER: unparseable becomes 0', () => {
    assert.equal(castValue('x', {TYPE: 'INTEGER'}), 0);
});

test('STRING: numbers are stringified', () => {
    assert.equal(castValue(5, {TYPE: 'STRING'}), '5');
});

test('unknown TYPE passes value through', () => {
    assert.equal(castValue('x', {TYPE: 'SPECIAL?'}), 'x');
});

test('missing description: numbers are stringified, rest passes through', () => {
    assert.equal(castValue(1.5, undefined), '1.5');
    assert.equal(castValue('x', undefined), 'x');
    assert.equal(castValue(true, undefined), true);
});

const {castSysvar} = require('../../nodes/lib/cast.js');

test('sysvar boolean: enum name resolves then booleanizes', () => {
    assert.equal(castSysvar('ist wahr', {valueType: 'boolean', enum: ['ist falsch', 'ist wahr']}), true);
    assert.equal(castSysvar('ist falsch', {valueType: 'boolean', enum: ['ist falsch', 'ist wahr']}), false);
});

test('sysvar boolean: plain values booleanize', () => {
    assert.equal(castSysvar(1, {valueType: 'boolean', enum: []}), true);
    assert.equal(castSysvar(0, {valueType: 'boolean', enum: []}), false);
});

test('sysvar string: quoted for the rega script', () => {
    assert.equal(castSysvar('abc', {valueType: 'string', enum: []}), '"abc"');
});

test('sysvar number: enum name becomes index, strings parse, junk becomes 0', () => {
    assert.equal(castSysvar('TRIGGERED', {valueType: 'number', enum: ['IDLE', 'TRIGGERED']}), 1);
    assert.equal(castSysvar('2.5', {valueType: 'number', enum: []}), 2.5);
    assert.equal(castSysvar('junk', {valueType: 'number', enum: []}), 0);
});
