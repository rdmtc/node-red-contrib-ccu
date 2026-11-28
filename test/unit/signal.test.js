/* #177: the signal node sends COLOR_BEHAVIOUR to the channels that have it (an HmIP-BSL
   with firmware 2.x, OPTICAL_SIGNAL_RECEIVER), and nothing new to the others. The
   descriptions are the shipped ones. */

const {test} = require('node:test');
const assert = require('node:assert/strict');

const paramsets = require('../../paramsets.json');
const {
    COLOR_BEHAVIOURS,
    colorBehaviourValue,
    hasColorBehaviour,
    normalizeList,
    signalCommand,
} = require('../../nodes/lib/signal.js');
const signalNode = require('../../nodes/ccu-signal.js');

const BSL1 = paramsets['HmIP-RF/HmIP-BSL/1.0.2/1/DIMMER_VIRTUAL_RECEIVER/VALUES'];
const BSL2 = paramsets['HmIP-RF/HmIP-BSL/2.0.2/2/DIMMER_VIRTUAL_RECEIVER/VALUES'];
const WRC6 = paramsets['HmIP-RF/HmIPW-WRC6/1.0.8/1/OPTICAL_SIGNAL_RECEIVER/VALUES'];

const bsl = (more) => ({
    channelType: 'BSL_DIMMER_VIRTUAL_RECEIVER',
    dimmerLevel: 50,
    dimmerColor: '4',
    rampTimeUnit: 'S',
    rampTimeValue: '0',
    durationUnit: 'M',
    durationValue: '31',
    ...more,
});

test('the list is the devices own', () => {
    assert.deepEqual(BSL2.COLOR_BEHAVIOUR.VALUE_LIST, COLOR_BEHAVIOURS);
    assert.deepEqual(WRC6.COLOR_BEHAVIOUR.VALUE_LIST, COLOR_BEHAVIOURS);
});

test('a BSL 2.x gets COLOR_BEHAVIOUR, ON when the node has no setting (a flow of before)', () => {
    assert.deepEqual(signalCommand(bsl(), BSL2), {
        paramset: {
            LEVEL: 0.5,
            RAMP_TIME_UNIT: 'S',
            RAMP_TIME_VALUE: 0,
            DURATION_UNIT: 'M',
            DURATION_VALUE: 31,
            COLOR: 4,
            COLOR_BEHAVIOUR: 1,
        },
    });
});

test('a BSL 1.x gets exactly what it got before', () => {
    assert.deepEqual(signalCommand(bsl({colorBehaviour: 3}), BSL1), {
        paramset: {
            LEVEL: 0.5,
            RAMP_TIME_UNIT: 'S',
            RAMP_TIME_VALUE: 0,
            DURATION_UNIT: 'M',
            DURATION_VALUE: 31,
            COLOR: 4,
        },
    });
});

test('a BSL whose description is not known gets none: it may be a 1.x', () => {
    assert.equal('COLOR_BEHAVIOUR' in signalCommand(bsl(), undefined).paramset, false);
    assert.equal('COLOR_BEHAVIOUR' in signalCommand(bsl(), {}).paramset, false);
});

test('the setting: a number, a number as text (the editor), a name in any case', () => {
    assert.equal(signalCommand(bsl({colorBehaviour: 4}), BSL2).paramset.COLOR_BEHAVIOUR, 4);
    assert.equal(signalCommand(bsl({colorBehaviour: '10'}), BSL2).paramset.COLOR_BEHAVIOUR, 10);
    assert.equal(signalCommand(bsl({colorBehaviour: 'BLINKING_FAST'}), BSL2).paramset.COLOR_BEHAVIOUR, 4);
    assert.equal(signalCommand(bsl({colorBehaviour: ' flash_slow '}), BSL2).paramset.COLOR_BEHAVIOUR, 5);
    assert.equal(signalCommand(bsl({colorBehaviour: 0}), BSL2).paramset.COLOR_BEHAVIOUR, 0);
    assert.equal(signalCommand(bsl({colorBehaviour: 'OFF'}), BSL2).paramset.COLOR_BEHAVIOUR, 0);
    assert.equal(signalCommand(bsl({colorBehaviour: ''}), BSL2).paramset.COLOR_BEHAVIOUR, 1);
    assert.equal(signalCommand(bsl({colorBehaviour: null}), BSL2).paramset.COLOR_BEHAVIOUR, 1);
});

test('a setting the device does not have is an error, nothing is sent', () => {
    for (const value of ['SPARKLE', 13, -1, 1.5, '1.5', {}, true]) {
        assert.throws(() => signalCommand(bsl({colorBehaviour: value}), BSL2), /colorBehaviour .* unknown/);
    }
});

test('colorBehaviourValue goes by the channel list where there is one', () => {
    assert.equal(colorBehaviourValue('B', ['A', 'B']), 1);
    assert.throws(() => colorBehaviourValue(2, ['A', 'B']));
    assert.equal(colorBehaviourValue('BILLOW_FAST', []), 10);
    assert.equal(colorBehaviourValue(undefined), 1);
});

test('OPTICAL_SIGNAL_RECEIVER: the same command, COLOR_BEHAVIOUR also without a description', () => {
    const config = bsl({channelType: 'OPTICAL_SIGNAL_RECEIVER', colorBehaviour: '2'});
    assert.equal(signalCommand(config, WRC6).paramset.COLOR_BEHAVIOUR, 2);
    assert.equal(signalCommand(config, undefined).paramset.COLOR_BEHAVIOUR, 2);
    assert.deepEqual(Object.keys(signalCommand(config, WRC6).paramset).sort(), [
        'COLOR',
        'COLOR_BEHAVIOUR',
        'DURATION_UNIT',
        'DURATION_VALUE',
        'LEVEL',
        'RAMP_TIME_UNIT',
        'RAMP_TIME_VALUE',
    ]);
    // every datapoint sent is a writable one of the channel
    for (const [description, type] of [
        [BSL2, 'BSL_DIMMER_VIRTUAL_RECEIVER'],
        [WRC6, 'OPTICAL_SIGNAL_RECEIVER'],
    ]) {
        for (const name of Object.keys(signalCommand(bsl({channelType: type}), description).paramset)) {
            assert.equal(description[name].OPERATIONS & 2, 2, name);
        }
    }
});

test('hasColorBehaviour: a description decides, a read-only datapoint does not count', () => {
    assert.equal(hasColorBehaviour('BSL_DIMMER_VIRTUAL_RECEIVER', BSL2), true);
    assert.equal(hasColorBehaviour('BSL_DIMMER_VIRTUAL_RECEIVER', BSL1), false);
    assert.equal(hasColorBehaviour('OPTICAL_SIGNAL_RECEIVER', {LEVEL: {}}), false);
    assert.equal(hasColorBehaviour('OPTICAL_SIGNAL_RECEIVER', {COLOR_BEHAVIOUR: {OPERATIONS: 5}}), false);
});

test('the other channel types send what they sent before', () => {
    assert.deepEqual(signalCommand({channelType: 'SIGNAL_CHIME', volume: 50, repeat: 2, chime: '1,3'}), {
        datapoint: 'SUBMIT',
        value: [0.5, 2, 108000, '1', '3'],
    });
    assert.deepEqual(signalCommand({channelType: 'SIGNAL_LED', repeat: 1, led: '17,33'}), {
        datapoint: 'SUBMIT',
        value: ['1', 1, 108000, '17', '33'],
    });
    assert.deepEqual(
        signalCommand({
            channelType: 'ALARM_SWITCH_VIRTUAL_RECEIVER',
            acousticAlarmSelection: 'EVENT',
            opticalAlarmSelection: 'DOUBLE_FLASHING_REPEATING',
            durationUnit: 'S',
            durationValue: 'x',
        }),
        {
            paramset: {
                ACOUSTIC_ALARM_SELECTION: 'EVENT',
                DURATION_UNIT: 'S',
                DURATION_VALUE: 0,
                OPTICAL_ALARM_SELECTION: 'DOUBLE_FLASHING_REPEATING',
            },
        },
    );
    assert.deepEqual(
        signalCommand({
            channelType: 'DIMMER_VIRTUAL_RECEIVER',
            dimmerLevel: 100,
            rampTimeUnit: 'S',
            rampTimeValue: 1,
            durationUnit: 'S',
            durationValue: 5,
            repetitions: 2,
            dimmerList: [{color: '4', ontime: '6'}, 2],
            colorBehaviour: 3,
        }),
        {
            paramset: {
                LEVEL: 1,
                RAMP_TIME_UNIT: 'S',
                RAMP_TIME_VALUE: 1,
                DURATION_UNIT: 'S',
                DURATION_VALUE: 5,
                REPETITIONS: 2,
                OUTPUT_SELECT_SIZE: 2,
                COLOR_LIST_1: 4,
                ON_TIME_LIST_1: 6,
                COLOR_LIST_2: 2,
                ON_TIME_LIST_2: Number.NaN,
            },
        },
    );
    assert.deepEqual(
        signalCommand({
            channelType: 'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER',
            soundLevel: 30,
            rampTimeUnit: 'S',
            rampTimeValue: 0,
            durationUnit: 'S',
            durationValue: 10,
            repetitions: 0,
            soundList: [1, {sound: '2'}],
        }),
        {
            paramset: {
                LEVEL: 0.3,
                RAMP_TIME_UNIT: 'S',
                RAMP_TIME_VALUE: 0,
                DURATION_UNIT: 'S',
                DURATION_VALUE: 10,
                REPETITIONS: 0,
                OUTPUT_SELECT_SIZE: 2,
                SOUNDFILE_LIST_1: 1,
                SOUNDFILE_LIST_2: 2,
            },
        },
    );
    assert.throws(() => signalCommand({channelType: 'NOPE'}), /channelType NOPE unknown/);
    assert.deepEqual(normalizeList('x', 'color'), []);
});

/** the node on a fake runtime and connection */
function load(config, ccu) {
    let Node;
    const handlers = {};
    const RED = {
        nodes: {
            createNode(node) {
                node.on = (event, handler) => {
                    handlers[event] = handler;
                };
                node.debug = () => {};
                node.error = () => {};
            },
            getNode: () => ccu,
            registerType(name, constructor) {
                Node = constructor;
            },
        },
        util: {getMessageProperty: (message, property) => message[property]},
    };
    signalNode(RED);
    const node = new Node(config);
    const input = (message) =>
        new Promise((resolve) => {
            handlers.input(message, () => {}, resolve);
        });
    return {node, input};
}

function fakeCcu(firmware) {
    const calls = [];
    const version = firmware === '2.0.2' ? 2 : 1;
    const ccu = {
        calls,
        register() {},
        metadata: {
            devices: {
                'HmIP-RF': {
                    BSL0001: {ADDRESS: 'BSL0001', TYPE: 'HmIP-BSL', FIRMWARE: firmware, VERSION: version},
                    'BSL0001:8': {ADDRESS: 'BSL0001:8', TYPE: 'DIMMER_VIRTUAL_RECEIVER', PARENT: 'BSL0001'},
                },
            },
        },
        paramsetDescriptions: paramsets,
        paramsetName(iface, device, paramset) {
            const d = this.metadata.devices[iface][device.PARENT];
            return [iface, d.TYPE, d.FIRMWARE, d.VERSION, device.TYPE, paramset].join('/');
        },
        methodCall(iface, method, parameters) {
            calls.push([iface, method, parameters]);
            return Promise.resolve();
        },
        setValue(...parameters) {
            calls.push(['setValue', ...parameters]);
            return Promise.resolve();
        },
    };
    return ccu;
}

const nodeConfig = (more) => ({
    ccuConfig: 'nc',
    iface: 'HmIP-RF',
    channel: 'BSL0001:8',
    ...bsl({durationValueType: 'num', rampTimeValueType: 'num'}),
    ...more,
});

test('the node: one putParamset with COLOR_BEHAVIOUR for the BSL 2.0.2, the message can set it', async () => {
    const ccu = fakeCcu('2.0.2');
    const {input} = load(nodeConfig({colorBehaviour: '2'}), ccu);
    assert.equal(await input({}), undefined);
    assert.equal(await input({config: {colorBehaviour: 'FLASH_FAST', dimmerColor: 2}}), undefined);
    assert.equal(ccu.calls.length, 2);
    const [iface, method, [channel, paramset, values]] = ccu.calls[0];
    assert.deepEqual([iface, method, channel, paramset], ['HmIP-RF', 'putParamset', 'BSL0001:8', 'VALUES']);
    assert.equal(values.COLOR_BEHAVIOUR, 2);
    assert.equal(values.COLOR, 4);
    assert.equal(ccu.calls[1][2][2].COLOR_BEHAVIOUR, 7);
    assert.equal(ccu.calls[1][2][2].COLOR, 2);
});

test('the node: a BSL 1.0.2 and a channel the device table does not have get none', async () => {
    const ccu = fakeCcu('1.0.2');
    const {input} = load(nodeConfig({colorBehaviour: '2'}), ccu);
    await input({});
    await input({config: {channel: 'GONE0001:8'}});
    await input({config: {iface: 'BidCos-RF'}});
    assert.equal(ccu.calls.length, 3);
    for (const call of ccu.calls) {
        assert.equal('COLOR_BEHAVIOUR' in call[2][2], false);
    }
});

test('the node: an unknown setting is the message error, nothing is sent; SUBMIT goes through setValue', async () => {
    const ccu = fakeCcu('2.0.2');
    const {input} = load(nodeConfig(), ccu);
    const error = await input({config: {colorBehaviour: 'SPARKLE'}});
    assert.match(error.message, /colorBehaviour SPARKLE unknown/);
    assert.equal(ccu.calls.length, 0);
    await input({config: {channelType: 'SIGNAL_LED', iface: 'BidCos-RF', channel: 'OU0001:1', led: '17', repeat: 1}});
    assert.deepEqual(ccu.calls, [['setValue', 'BidCos-RF', 'OU0001:1', 'SUBMIT', ['1', 1, 108000, '17']]]);
});

test('the editor offers the behaviour for both channel types, with texts in both languages', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const nodes = path.join(__dirname, '..', '..', 'nodes');
    const html = fs.readFileSync(path.join(nodes, 'ccu-signal.html'), 'utf8');
    assert.match(html, /colorBehaviour: \{value: 1\}/);
    assert.match(html, /<option value="OPTICAL_SIGNAL_RECEIVER">/);
    const row = html.match(/<div class="([^"]+)">\s*<label for="node-input-colorBehaviour">/)[1];
    assert.ok(row.includes('BSL_DIMMER_VIRTUAL_RECEIVER') && row.includes('OPTICAL_SIGNAL_RECEIVER'));
    const select = html.match(/<select id="node-input-colorBehaviour"[\s\S]*?<\/select>/)[0];
    const values = [...select.matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(
        [...values].sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
    assert.equal(values[0], 1, 'the default is the first entry');
    const keys = [...html.matchAll(/data-i18n="ccu-signal\.([A-Za-z]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length >= 14);
    for (const lang of ['de', 'en-US']) {
        const texts = JSON.parse(fs.readFileSync(path.join(nodes, 'locales', lang, 'ccu-signal.json'), 'utf8'));
        for (const key of keys) {
            assert.ok(texts['ccu-signal'][key], `${lang}: ${key}`);
        }

        const help = fs.readFileSync(path.join(nodes, 'locales', lang, 'ccu-signal.html'), 'utf8');
        assert.match(help, /<code>colorBehaviour<\/code>/);
    }
});
