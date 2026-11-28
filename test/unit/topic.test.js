const {test} = require('node:test');
const assert = require('node:assert/strict');

const {topicReplace, parseTopicAddress} = require('../../nodes/lib/topic.js');

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

/* task 6 (#39): the address in an incoming topic, dots or slashes */

test('parseTopicAddress: the dotted input form as before', () => {
    assert.deepEqual(parseTopicAddress('BidCos-RF.OEQ1868878:1.STATE'), {
        iface: 'BidCos-RF',
        channel: 'OEQ1868878:1',
        datapoint: 'STATE',
    });
});

test('parseTopicAddress: the emitted default shape with the CCU part, and without it', () => {
    assert.deepEqual(parseTopicAddress('ccu3/HmIP-RF/000DD8A9931617:3/LEVEL'), {
        iface: 'HmIP-RF',
        channel: '000DD8A9931617:3',
        datapoint: 'LEVEL',
    });
    assert.deepEqual(parseTopicAddress('hm/HmIP-RF/000DD8A9931617:3/LEVEL'), {
        iface: 'HmIP-RF',
        channel: '000DD8A9931617:3',
        datapoint: 'LEVEL',
    });
    assert.deepEqual(parseTopicAddress('HmIP-RF/000DD8A9931617:3/LEVEL'), {
        iface: 'HmIP-RF',
        channel: '000DD8A9931617:3',
        datapoint: 'LEVEL',
    });
});

test('parseTopicAddress: too few slash segments, an empty or missing topic give nothing', () => {
    assert.deepEqual(parseTopicAddress('hm/STATE'), {});
    assert.deepEqual(parseTopicAddress(''), {iface: '', channel: undefined, datapoint: undefined});
    assert.deepEqual(parseTopicAddress(undefined), {iface: '', channel: undefined, datapoint: undefined});
});

/* the editor's default topics, as the README's table states them */

test('default topics: sysvar hm/status/sysvar/${Name}, program hm/status/program/${Name}', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const defaultTopic = (node) => {
        const html = fs.readFileSync(path.join(__dirname, '../../nodes', node + '.html'), 'utf8');
        return /topic:\s*\{value:\s*'([^']*)'\}/.exec(html)[1];
    };

    assert.equal(defaultTopic('ccu-sysvar'), 'hm/status/sysvar/${Name}');
    assert.equal(defaultTopic('ccu-program'), 'hm/status/program/${Name}');
    const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
    assert.match(readme, /\| sysvar +\| `hm\/status\/sysvar\/\$\{Name\}` +\|/);
    assert.match(readme, /\| program +\| `hm\/status\/program\/\$\{Name\}` +\|/);
});
