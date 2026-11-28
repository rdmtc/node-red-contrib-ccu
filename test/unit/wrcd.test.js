/* #144: the HmIP-WRCD in the display node - five lines and a sound in one write of
   COMBINED_PARAMETER, in the text the CCU's own program dialog writes. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const paramsets = require('../../paramsets.json');
const {ICONS, SOUNDS, wrcdText, wrcdCommand} = require('../../nodes/lib/wrcd.js');
const displayNode = require('../../nodes/ccu-display.js');

const NODES = path.join(__dirname, '..', '..', 'nodes');
const VALUES = paramsets['HmIP-RF/HmIP-WRCD/1.4.6/3/ACOUSTIC_DISPLAY_RECEIVER/VALUES'];

test('the icons and sounds are the entries of the channel description', () => {
    assert.deepEqual(ICONS, VALUES.DISPLAY_DATA_ICON.VALUE_LIST);
    assert.deepEqual(SOUNDS, VALUES.ACOUSTIC_NOTIFICATION_SELECTION.VALUE_LIST);
    assert.deepEqual(VALUES.DISPLAY_DATA_ALIGNMENT.VALUE_LIST, ['LEFT', 'CENTER', 'RIGHT']);
    assert.deepEqual(VALUES.DISPLAY_DATA_TEXT_COLOR.VALUE_LIST, ['WHITE', 'BLACK']);
    assert.equal(VALUES.DISPLAY_DATA_ID.MAX, 5);
    assert.equal(VALUES.COMBINED_PARAMETER.OPERATIONS & 2, 2);
});

test('one line: the defaults are black on white, centred, no icon; the commit is in it', () => {
    assert.equal(
        wrcdCommand({1: {text: 'Hello'}}),
        '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=CENTER,DDS=Hello,DDID=1,DDC=true}',
    );
});

test('several lines: one block each in the order of the display, the commit only in the last', () => {
    assert.equal(
        wrcdCommand({
            5: {text: 'five', align: 'right'},
            2: {text: 'two', icon: 'LAMP_ON', color: 'white', background: 'black'},
        }),
        '{DDBC=BLACK,DDTC=WHITE,DDI=2,DDA=CENTER,DDS=two,DDID=2},' +
            '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=RIGHT,DDS=five,DDID=5,DDC=true}',
    );
});

test('a line that is not given is not sent; lines beyond the fifth do not exist', () => {
    assert.equal(wrcdCommand({3: undefined, 6: {text: 'six'}, 0: {text: 'zero'}}), '');
    assert.equal(wrcdCommand(undefined), '');
    assert.equal(wrcdCommand({}, {}), '');
});

test('an empty line is sent empty (it clears the line), an icon alone as well', () => {
    assert.equal(wrcdCommand({1: {}}), '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=CENTER,DDS=,DDID=1,DDC=true}');
    assert.equal(
        wrcdCommand({1: {text: null, icon: 30}}),
        '{DDBC=WHITE,DDTC=BLACK,DDI=30,DDA=CENTER,DDS=,DDID=1,DDC=true}',
    );
});

test('the sound: its own block after the lines, or alone', () => {
    assert.equal(
        wrcdCommand({1: {text: 'Door'}}, {sound: '6', repeat: '2', interval: '10'}),
        '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=CENTER,DDS=Door,DDID=1,DDC=true},{R=2,IN=10,ANS=6}',
    );
    assert.equal(wrcdCommand({}, {sound: 'EVENT'}), '{R=0,IN=5,ANS=6}');
    assert.equal(wrcdCommand({}, {sound: 0, repeat: 99, interval: 1}), '{R=15,IN=5,ANS=0}');
    assert.equal(wrcdCommand({}, {sound: 'low battery', repeat: -3, interval: 500}), '{R=0,IN=80,ANS=0}');
    assert.equal(wrcdCommand({}, {sound: 1, repeat: 'x', interval: 12}), '{R=0,IN=10,ANS=1}');
    assert.equal(wrcdCommand({}, {sound: 1, interval: 78}), '{R=0,IN=80,ANS=1}');
    // no sound: none of '', undefined, an unknown name or a number beyond the list plays one
    for (const sound of ['', undefined, null, 'GONG', 8, -1]) {
        assert.equal(wrcdCommand({}, {sound, repeat: 1, interval: 5}), '');
    }
});

test('icons: a number, a number as text, a name in any spelling; anything else is no icon', () => {
    const icon = (value) => /DDI=(\d+)/.exec(wrcdCommand({1: {icon: value}}))[1];
    assert.equal(icon(31), '31');
    assert.equal(icon('7'), '7');
    assert.equal(icon('CLOCK'), '31');
    assert.equal(icon('window open'), '24');
    assert.equal(icon('cloud-and-sun'), '19');
    for (const value of [32, 'NOPE', '', undefined, -1, 1.5, {}]) {
        assert.equal(icon(value), '0');
    }
});

test('alignment and colours: the device names, German ones too; anything else is the default', () => {
    const block = (line) => wrcdCommand({1: line});
    assert.match(block({align: 'links'}), /DDA=LEFT/);
    assert.match(block({align: ' Right '}), /DDA=RIGHT/);
    assert.match(block({align: 'diagonal'}), /DDA=CENTER/);
    assert.match(block({color: 'weiß', background: 'schwarz'}), /DDBC=BLACK,DDTC=WHITE/);
    assert.match(block({color: 'red', background: 0}), /DDBC=WHITE,DDTC=BLACK/);
});

test('the text: sixteen characters, umlauts as the display wants them', () => {
    assert.equal(wrcdText('ÄÖÜäöüß'), '[#$²|³_');
    assert.equal(wrcdText("Tom & Anna's"), 'Tom ] Annaµs');
    assert.equal(wrcdText('12345678901234567890'), '1234567890123456');
    assert.equal(wrcdText(21.5), '21.5');
    assert.equal(wrcdText(undefined), '');
    assert.equal(wrcdText(null), '');
    assert.equal(wrcdText(0), '0');
});

test('the text can never break the command: its punctuation is replaced, unknown characters dropped', () => {
    assert.equal(wrcdText('21,5 °C'), '21.5 C');
    assert.equal(wrcdText('a=b {c}'), 'a:b (c)');
    assert.equal(wrcdText('[x] #1 $ a|b a_b'), 'x 1  ab ab');
    assert.equal(wrcdText('€ 5\n\tok ✓'), ' 5ok ');
    const command = wrcdCommand({1: {text: '},{DDC=true,x=1'}});
    assert.equal(command, '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=CENTER,DDS=).(DDC:true.x:1,DDID=1,DDC=true}');
    assert.equal(command.split('},{').length, 1);
});

/** the node on a fake runtime and connection */
function load(config) {
    let Node;
    const handlers = {};
    const calls = [];
    const ccu = {
        register() {},
        setValue(...parameters) {
            calls.push(parameters);
            return ccu.fail ? Promise.reject(new Error('refused')) : Promise.resolve();
        },
    };
    displayNode({
        nodes: {
            createNode(node) {
                node.on = (event, handler) => {
                    handlers[event] = handler;
                };
            },
            getNode: () => ccu,
            registerType(name, constructor) {
                Node = constructor;
            },
        },
    });
    const node = new Node({ccuConfig: 'nc', ...config});
    const input = (message) =>
        new Promise((resolve) => {
            handlers.input(message, () => {}, resolve);
        });
    return {node, input, calls, ccu};
}

const wrcd = (more) => ({
    iface: 'HmIP-RF',
    channel: 'WRCD001:3',
    channelType: 'HmIP-WRCD',
    line1: 'Küche',
    wrcdIcon1: '2',
    wrcdAlign1: 'LEFT',
    wrcdColor1: 'BLACK',
    wrcdBackground1: 'WHITE',
    disable2: true,
    line3: '',
    wrcdIcon3: '0',
    disable4: true,
    disable5: true,
    // what a WM55 keeps in the same node must not reach the WRCD
    icon1: '0x81',
    color1: '0x81',
    wrcdSound: '',
    wrcdRepeat: '0',
    wrcdInterval: '5',
    ...more,
});

test('the node: one setValue of COMBINED_PARAMETER with the lines that are not left alone', async () => {
    const {input, calls} = load(wrcd());
    assert.equal(await input({}), undefined);
    assert.deepEqual(calls, [
        [
            'HmIP-RF',
            'WRCD001:3',
            'COMBINED_PARAMETER',
            '{DDBC=WHITE,DDTC=BLACK,DDI=2,DDA=LEFT,DDS=K³che,DDID=1},' +
                '{DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=CENTER,DDS=,DDID=3,DDC=true}',
        ],
    ]);
});

test('the node: the message sets lines, icons, colours, alignment and leaves lines alone', async () => {
    const {input, calls} = load(wrcd());
    await input({
        line1: 'Bad',
        icon1: 'FLAME',
        color1: 'white',
        background1: 'black',
        align1: 'right',
        disable3: true,
        config: {disable2: false, line2: '21,5', wrcdIcon2: 'SUN', wrcdSound: 'EVENT', wrcdRepeat: 3, wrcdInterval: 20},
    });
    assert.equal(
        calls[0][3],
        '{DDBC=BLACK,DDTC=WHITE,DDI=23,DDA=RIGHT,DDS=Bad,DDID=1},' +
            '{DDBC=WHITE,DDTC=BLACK,DDI=10,DDA=CENTER,DDS=21.5,DDID=2,DDC=true},{R=3,IN=20,ANS=6}',
    );
    // an empty text from the message clears the line, it does not fall back to the configured one
    await input({line1: ''});
    assert.match(calls[1][3], /DDS=,DDID=1/);
});

test('the node: nothing to send is an error, a refusal of the system as well', async () => {
    const {input, calls, ccu} = load(wrcd({disable1: true, disable3: true}));
    assert.match((await input({})).message, /nothing to send/);
    assert.equal(calls.length, 0);
    ccu.fail = true;
    assert.match((await input({config: {wrcdSound: 1}})).message, /refused/);
    assert.equal(calls[0][3], '{R=0,IN=5,ANS=1}');
});

test('the node: the HM-Dis-WM55 and HM-Dis-EP-WM55 still send their SUBMIT', async () => {
    const wm55 = load({
        iface: 'BidCos-RF',
        channel: 'DIS0001:1',
        channelType: 'HM-Dis-WM55',
        line1: 'Ab',
        icon1: '0x81',
    });
    await wm55.input({});
    assert.deepEqual(wm55.calls[0].slice(0, 3), ['BidCos-RF', 'DIS0001:1', 'SUBMIT']);
    assert.match(wm55.calls[0][3], /^0x02,0x12,0x41,0x62,0x11,0x80,0x13,0x81,0x0A/);
    const ep = load({
        iface: 'BidCos-RF',
        channel: 'EP00001:3',
        channelType: 'HM-Dis-EP-WM55',
        line1: 'A',
        line2: '',
        line3: '',
        sound: '0xC1',
        repeat: '0xD0',
        pause: '0xE0',
        signal: '0xF1',
    });
    await ep.input({});
    assert.equal(
        ep.calls[0][3],
        '0x02,0x0A,0x12,0x41,0x0A,0x12,0x20,0x0A,0x12,0x20,0x0A,0x14,0xC1,0x1C,0xD0,0x1D,0xE0,0x16,0xF1,0x03',
    );
});

test('the editor has the form: the lists of the runtime, every text in both languages', () => {
    const html = fs.readFileSync(path.join(NODES, 'ccu-display.html'), 'utf8');
    const script = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html)[1];
    const context = {RED: {nodes: {registerType() {}}}};
    vm.runInNewContext(script + '\nthis.icons = ccuWrcdIcons; this.sounds = ccuWrcdSounds;', context);
    assert.deepEqual([...context.icons], ICONS);
    assert.deepEqual([...context.sounds], SOUNDS);
    assert.match(html, /<option value="HmIP-WRCD">HmIP-WRCD<\/option>/);
    for (let i = 1; i <= 5; i++) {
        for (const field of ['wrcdIcon', 'wrcdAlign', 'wrcdColor', 'wrcdBackground']) {
            assert.ok(html.includes(`${field}${i}: {value:`), field + i);
        }
    }

    const keys = new Set([...html.matchAll(/data-i18n="ccu-display\.([\w.]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/text\('([\w.]+)'\)/g)) {
        keys.add(m[1]);
    }

    for (const name of ICONS) {
        keys.add('wrcd.icon.' + name);
    }

    for (const name of SOUNDS) {
        keys.add('wrcd.sound.' + name);
    }

    assert.ok(keys.size > 70);
    for (const lang of ['de', 'en-US']) {
        const texts = JSON.parse(fs.readFileSync(path.join(NODES, 'locales', lang, 'ccu-display.json'), 'utf8'));
        for (const key of keys) {
            if (key.endsWith('.')) {
                continue; // a prefix the script completes with a name
            }

            const value = key.split('.').reduce((o, k) => o && o[k], texts['ccu-display']);
            assert.equal(typeof value, 'string', `${lang}: ${key}`);
            assert.ok(value.length > 0, `${lang}: ${key}`);
        }

        const help = fs.readFileSync(path.join(NODES, 'locales', lang, 'ccu-display.html'), 'utf8');
        assert.match(help, /HmIP-WRCD/);
        assert.match(help, /wrcdSound/);
    }
});
