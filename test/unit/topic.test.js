const {test} = require('node:test');
const assert = require('node:assert/strict');

const {topicReplace} = require('../../nodes/lib/topic.js');

test('replaces placeholders from message properties', () => {
    assert.equal(
        topicReplace('${CCU}/${channel}/${datapoint}', {ccu: 'ccu3', channel: 'ABC:1', datapoint: 'STATE'}),
        'ccu3/ABC:1/STATE',
    );
});

test('placeholder matching is case-insensitive', () => {
    assert.equal(topicReplace('${ChAnNeL}', {channel: 'x'}), 'x');
});

test('${Interface} is an alias for iface', () => {
    assert.equal(topicReplace('${Interface}', {iface: 'HmIP-RF'}), 'HmIP-RF');
});

test('unknown placeholders become empty string', () => {
    assert.equal(topicReplace('a/${nope}/b', {}), 'a//b');
});

test('repeated placeholders are all replaced', () => {
    assert.equal(topicReplace('${x}/${x}', {x: '1'}), '1/1');
});

test('empty topic and non-object message pass through', () => {
    assert.equal(topicReplace('', {a: 1}), '');
    assert.equal(topicReplace('${a}', 'not-an-object'), '${a}');
});

test('falsy-but-defined values are inserted (0, false)', () => {
    assert.equal(topicReplace('${a}/${b}', {a: 0, b: false}), '0/false');
});
