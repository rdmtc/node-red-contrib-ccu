const {test} = require('node:test');
const assert = require('node:assert/strict');

const {effectiveConfig, configCacheKey} = require('../../nodes/lib/dynconfig.js');

const FLAT = {flat: true};

test('flat: message fills empty keys', () => {
    const config = {iface: '', channel: '', datapoint: 'STATE'};
    const {config: effective, dynamic} = effectiveConfig(
        config,
        {iface: 'HmIP-RF', channel: 'ABC:1'},
        ['iface', 'channel', 'datapoint'],
        FLAT,
    );
    assert.equal(effective.iface, 'HmIP-RF');
    assert.equal(effective.channel, 'ABC:1');
    assert.equal(effective.datapoint, 'STATE');
    assert.equal(dynamic, true);
});

test('flat: configured values win over the message', () => {
    const {config} = effectiveConfig({channel: 'CONFIGURED:1'}, {channel: 'FROM_MSG:1'}, ['channel'], FLAT);
    assert.equal(config.channel, 'CONFIGURED:1');
});

test('flat is opt-in: without it top-level properties are ignored', () => {
    const {config, dynamic} = effectiveConfig({channel: ''}, {channel: 'FROM_MSG:1'}, ['channel']);
    assert.equal(config.channel, '');
    assert.equal(dynamic, false);
});

test('the stored config is never mutated (#133)', () => {
    const stored = {rooms: '', functions: ''};
    effectiveConfig(stored, {rooms: 'Kitchen'}, ['rooms', 'functions'], FLAT);
    assert.equal(stored.rooms, '');
});

test('a second message is not shadowed by the first (#133)', () => {
    const stored = {rooms: ''};
    const first = effectiveConfig(stored, {rooms: 'Kitchen'}, ['rooms'], FLAT);
    const second = effectiveConfig(stored, {rooms: 'Bedroom'}, ['rooms'], FLAT);
    assert.equal(first.config.rooms, 'Kitchen');
    assert.equal(second.config.rooms, 'Bedroom');
});

test('flat: keys absent from the message stay untouched', () => {
    const {config, dynamic} = effectiveConfig({channel: ''}, {payload: 1}, ['channel'], FLAT);
    assert.equal(config.channel, '');
    assert.equal(dynamic, false);
});

test('flat: an explicitly falsy message value is still taken', () => {
    const {config, dynamic} = effectiveConfig({channelIndex: ''}, {channelIndex: 0}, ['channelIndex'], FLAT);
    assert.equal(config.channelIndex, 0);
    assert.equal(dynamic, true);
});

test('msg.config overrides a configured value', () => {
    const {config, dynamic} = effectiveConfig({dimmerLevel: 100}, {config: {dimmerLevel: 30}}, ['dimmerLevel']);
    assert.equal(config.dimmerLevel, 30);
    assert.equal(dynamic, true);
});

test('msg.config wins over a flat property', () => {
    const {config} = effectiveConfig(
        {channel: ''},
        {channel: 'FLAT:1', config: {channel: 'OVERRIDE:1'}},
        ['channel'],
        FLAT,
    );
    assert.equal(config.channel, 'OVERRIDE:1');
});

test('msg.config carries lists through unchanged (#148)', () => {
    const list = [{sound: 1}, {sound: 2}];
    const {config} = effectiveConfig({soundList: []}, {config: {soundList: list}}, ['soundList']);
    assert.deepEqual(config.soundList, list);
});

test('msg.config keys outside the allow list are ignored', () => {
    const {config, dynamic} = effectiveConfig({a: 1}, {config: {b: 2, ccuConfig: 'evil'}}, ['a']);
    assert.deepEqual(config, {a: 1});
    assert.equal(dynamic, false);
});

test('msg.config may set a value to something falsy', () => {
    const {config} = effectiveConfig({dimmerLevel: 100}, {config: {dimmerLevel: 0}}, ['dimmerLevel']);
    assert.equal(config.dimmerLevel, 0);
});

test('a non-object msg.config is ignored', () => {
    assert.deepEqual(effectiveConfig({a: 1}, {config: 'nope'}, ['a']).config, {a: 1});
    assert.deepEqual(effectiveConfig({a: 1}, {config: ['nope']}, ['a']).config, {a: 1});
    assert.deepEqual(effectiveConfig({a: 1}, {config: null}, ['a']).config, {a: 1});
});

test('a missing message is tolerated', () => {
    const {config, dynamic} = effectiveConfig({a: 1}, undefined, ['a'], FLAT);
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
