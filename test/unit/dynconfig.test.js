const {test} = require('node:test');
const assert = require('node:assert/strict');

const {effectiveConfig, configCacheKey} = require('../../nodes/lib/dynconfig.js');

test('message fills empty keys', () => {
    const config = {iface: '', channel: '', datapoint: 'STATE'};
    const {config: effective, dynamic} = effectiveConfig(config, {iface: 'HmIP-RF', channel: 'ABC:1'}, [
        'iface',
        'channel',
        'datapoint',
    ]);
    assert.equal(effective.iface, 'HmIP-RF');
    assert.equal(effective.channel, 'ABC:1');
    assert.equal(effective.datapoint, 'STATE');
    assert.equal(dynamic, true);
});

test('configured values win over the message', () => {
    const {config} = effectiveConfig({channel: 'CONFIGURED:1'}, {channel: 'FROM_MSG:1'}, ['channel']);
    assert.equal(config.channel, 'CONFIGURED:1');
});

test('the stored config is never mutated (#133)', () => {
    const stored = {rooms: '', functions: ''};
    effectiveConfig(stored, {rooms: 'Kitchen'}, ['rooms', 'functions']);
    assert.equal(stored.rooms, '');
});

test('a second message is not shadowed by the first (#133)', () => {
    const stored = {rooms: ''};
    const first = effectiveConfig(stored, {rooms: 'Kitchen'}, ['rooms']);
    const second = effectiveConfig(stored, {rooms: 'Bedroom'}, ['rooms']);
    assert.equal(first.config.rooms, 'Kitchen');
    assert.equal(second.config.rooms, 'Bedroom');
});

test('keys absent from the message stay untouched', () => {
    const {config, dynamic} = effectiveConfig({channel: ''}, {payload: 1}, ['channel']);
    assert.equal(config.channel, '');
    assert.equal(dynamic, false);
});

test('an explicitly falsy message value is still taken', () => {
    const {config, dynamic} = effectiveConfig({channelIndex: ''}, {channelIndex: 0}, ['channelIndex']);
    assert.equal(config.channelIndex, 0);
    assert.equal(dynamic, true);
});

test('a missing message is tolerated', () => {
    const {config, dynamic} = effectiveConfig({a: 1}, undefined, ['a']);
    assert.deepEqual(config, {a: 1});
    assert.equal(dynamic, false);
});

test('cache key distinguishes different filters', () => {
    const keys = ['rooms', 'functions'];
    assert.notEqual(configCacheKey({rooms: 'Kitchen'}, keys), configCacheKey({rooms: 'Bedroom'}, keys));
});

test('cache key is stable for equal filters', () => {
    const keys = ['rooms', 'functions'];
    assert.equal(
        configCacheKey({rooms: 'Kitchen', functions: undefined}, keys),
        configCacheKey({rooms: 'Kitchen'}, keys),
    );
});

test('cache key does not confuse adjacent values', () => {
    const keys = ['a', 'b'];
    assert.notEqual(configCacheKey({a: 'x', b: 'y'}, keys), configCacheKey({a: 'xy', b: ''}, keys));
});
