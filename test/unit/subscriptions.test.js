/* task 27: the indexed subscription dispatch (nodes/lib/subscriptions.js) delivers exactly what
   the per-datapoint whitelist/blacklist dispatch of 4.7.2 delivered - the same callbacks in the
   same order, for randomised filters of every shape the nodes, RedMatic-HomeKit and
   RedMatic-Matter use, over randomised events; the cache replay too. And its memory grows with
   the subscriptions, not with datapoints x subscriptions, and unsubscribe leaves nothing behind. */

const {test} = require('node:test');
const assert = require('node:assert/strict');

const {SubscriptionIndex, keyOf, matches, INDEXED_ATTRIBUTES} = require('../../nodes/lib/subscriptions.js');
const {LegacyDispatch} = require('../helpers/legacy-dispatch.js');

/** a seeded generator, so a failing seed can be rerun */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = (random, array) => array[Math.floor(random() * array.length)];

const IFACES = ['BidCos-RF', 'HmIP-RF', 'VirtualDevices'];
const DEVICE_TYPES = ['HmIP-BSM', 'HmIP-eTRV-2', 'HM-LC-Sw1-FM', 'HmIP-SWDO', 'HM-CC-RT-DN'];
const CHANNEL_TYPES = [
    'SWITCH_VIRTUAL_RECEIVER',
    'KEY_TRANSCEIVER',
    'HEATING_CLIMATECONTROL_TRANSCEIVER',
    'SHUTTER_CONTACT',
];
const DATAPOINTS = [
    'STATE',
    'LEVEL',
    'ACTUAL_TEMPERATURE',
    'SET_POINT_TEMPERATURE',
    'PRESS_SHORT',
    'UNREACH',
    'LOWBAT',
];
const ROOMS = ['Kitchen', 'Living room', 'Bedroom', 'Hall'];
const FUNCTIONS = ['Light', 'Heating', 'Security'];

/** a world of devices, channels and datapoints with stable attributes - the messages of each datapoint */
function world(random, deviceCount) {
    const datapoints = [];
    for (let d = 0; d < deviceCount; d++) {
        const iface = pick(random, IFACES);
        const device = 'DEV' + String(d).padStart(6, '0');
        const deviceType = pick(random, DEVICE_TYPES);
        const deviceName = 'Device ' + d;
        const channels = 1 + Math.floor(random() * 3);
        for (let c = 1; c <= channels; c++) {
            const channel = device + ':' + c;
            const channelType = pick(random, CHANNEL_TYPES);
            const channelName = random() < 0.8 ? 'Channel ' + d + '-' + c : undefined;
            const rooms = random() < 0.7 ? [pick(random, ROOMS)] : [];
            if (rooms.length > 0 && random() < 0.2) {
                rooms.push(pick(random, ROOMS));
            }

            const functions = random() < 0.5 ? [pick(random, FUNCTIONS)] : [];
            const count = 1 + Math.floor(random() * 4);
            for (let i = 0; i < count; i++) {
                const datapoint = pick(random, DATAPOINTS);
                const datapointName = iface + '.' + channel + '.' + datapoint;
                if (datapoints.some((dp) => dp.datapointName === datapointName)) {
                    continue;
                }

                datapoints.push({
                    topic: '',
                    iface,
                    device,
                    deviceName,
                    deviceType,
                    channel,
                    channelName,
                    channelType,
                    channelIndex: c,
                    datapoint,
                    datapointName,
                    rooms,
                    room: rooms[0],
                    functions,
                    function: functions[0],
                });
            }
        }
    }

    return datapoints;
}

/** an event on one of the world's datapoints with random flags and a value */
function event(random, datapoints, value) {
    const base = pick(random, datapoints);
    return {
        ...base,
        payload: value,
        value,
        cache: random() < 0.15,
        change: random() < 0.6,
        stable: random() < 0.8,
        uncertain: random() < 0.1,
        working: false,
    };
}

/** a filter of one of the shapes the consumers use, with random flag attributes */
function filter(random, datapoints) {
    const dp = pick(random, datapoints);
    const f = {};
    if (random() < 0.7) {
        f.cache = random() < 0.5;
    }

    if (random() < 0.7) {
        f.change = random() < 0.5;
    }

    if (random() < 0.5) {
        f.stable = random() < 0.5;
    }

    if (random() < 0.2) {
        f.uncertain = false;
    }

    const shape = random();
    if (shape < 0.3) {
        // RedMatic-Matter, RedMatic-HomeKit: the datapoint exactly
        f.datapointName = dp.datapointName;
    } else if (shape < 0.5) {
        // ccu-value
        f.iface = dp.iface;
        f.channel = dp.channel;
        f.datapoint = dp.datapoint;
    } else if (shape < 0.58) {
        // ccu-alexa, ccu-homeassistant
        f.iface = dp.iface;
        f.channel = dp.channel;
    } else if (shape < 0.65) {
        f.datapoint = dp.datapoint;
    } else if (shape < 0.7) {
        // ccu-rpc-event: iface plus some attributes, strings or regular expressions
        f.iface = dp.iface;
        if (random() < 0.5) {
            f.channelType = random() < 0.5 ? dp.channelType : new RegExp(dp.channelType.slice(0, 4));
        }

        if (random() < 0.5) {
            f.datapoint = random() < 0.5 ? dp.datapoint : new RegExp('^' + dp.datapoint.slice(0, 3));
        }

        if (random() < 0.3) {
            f.deviceType = dp.deviceType;
        }
    } else if (shape < 0.75) {
        f.device = dp.device;
    } else if (shape < 0.8) {
        f.room = pick(random, ROOMS);
    } else if (shape < 0.84) {
        f.rooms = random() < 0.5 ? pick(random, ROOMS) : new RegExp(pick(random, ROOMS).slice(0, 3));
    } else if (shape < 0.87) {
        f.function = pick(random, FUNCTIONS);
        f.functions = random() < 0.5 ? pick(random, FUNCTIONS) : new RegExp('^' + pick(random, FUNCTIONS).slice(0, 2));
    } else if (shape < 0.9) {
        f.channelName = random() < 0.5 ? dp.channelName : new RegExp('Channel 1');
        if (f.channelName === undefined) {
            f.channelName = '';
        }
    } else if (shape < 0.93) {
        f.deviceName = dp.deviceName;
        f.channelIndex = random() < 0.5 ? String(dp.channelIndex) : dp.channelIndex;
    } else if (shape < 0.96) {
        // empty strings from an editor dialog filter nothing
        f.iface = '';
        f.channel = '';
        f.datapoint = dp.datapoint;
    } else if (shape < 0.98) {
        f.iface = dp.iface;
        f.channelIndex = String(dp.channelIndex);
        f.datapoint = dp.datapoint;
    }
    // else: a filter with flags only (ccu-mqtt, ccu-homeassistant's event subscription)

    return f;
}

/** the same filter twice: the dispatchers may mutate it (channelIndex) */
function cloneFilter(f) {
    const copy = {};
    for (const attr of Object.keys(f)) {
        copy[attr] = f[attr] instanceof RegExp ? new RegExp(f[attr].source) : f[attr];
    }

    return copy;
}

/**
 * Runs the same subscriptions and events through both dispatchers and returns what each delivered.
 * @returns {{legacy: string[], indexed: string[]}} one line per delivery: event number, id, datapointName
 */
function run(seed, {devices = 60, subscriptions = 150, events = 400, cachedValues = true, unsubscribeEvery = 0}) {
    const random = prng(seed);
    const datapoints = world(random, devices);

    const legacy = new LegacyDispatch();
    const indexed = new SubscriptionIndex();
    const indexedValues = {};
    const delivered = {legacy: [], indexed: []};

    if (cachedValues) {
        for (const dp of datapoints) {
            const cached = {...dp, payload: 1, value: 1, cache: true, change: false, stable: true, uncertain: false};
            legacy.values[dp.datapointName] = cached;
            indexedValues[dp.datapointName] = cached;
        }
    }

    const indexedSubscribe = (f) => {
        const id = indexed.add(f, (message) =>
            delivered.indexed.push(message.__event + ' ' + id + ' ' + message.datapointName),
        );
        if (f.cache) {
            for (const cached of SubscriptionIndex.replayCandidates(f, indexedValues)) {
                const message = {...cached, cache: true, change: false};
                if (matches(f, message, id)) {
                    indexed.get(id).callback(message);
                }
            }
        }

        return id;
    };

    const ids = [];
    for (let i = 0; i < subscriptions; i++) {
        const f = filter(random, datapoints);
        for (const dp of Object.keys(legacy.values)) {
            legacy.values[dp].__event = 'replay';
        }

        const expectedId = legacy.idCallback;
        const legacyId = legacy.subscribe(cloneFilter(f), (message) =>
            delivered.legacy.push(message.__event + ' ' + expectedId + ' ' + message.datapointName),
        );
        assert.equal(legacyId, expectedId);
        const indexedId = indexedSubscribe(cloneFilter(f));
        assert.equal(indexedId, legacyId);
        ids.push(legacyId);
    }

    const dispatchIndexed = (message) => {
        for (const id of indexed.candidates(message)) {
            const subscription = indexed.get(id);
            if (matches(subscription.filter, message, id)) {
                subscription.callback(message);
            }
        }
    };

    for (let n = 0; n < events; n++) {
        const e = event(random, datapoints, n);
        e.__event = String(n);
        legacy.values[e.datapointName] = e;
        indexedValues[e.datapointName] = e;
        legacy.callCallbacks(e);
        dispatchIndexed(e);

        if (unsubscribeEvery && n % unsubscribeEvery === 0 && ids.length > 0) {
            const id = ids.splice(Math.floor(random() * ids.length), 1)[0];
            assert.equal(legacy.unsubscribe(id), true);
            assert.equal(indexed.remove(id), true);
        }

        if (unsubscribeEvery && n % (unsubscribeEvery * 3) === 1) {
            // a node re-deployed: a new subscription while events flow (with a replay)
            const f = filter(random, datapoints);
            for (const dp of Object.keys(legacy.values)) {
                legacy.values[dp].__event = 'replay@' + n;
            }

            const expectedId = legacy.idCallback;
            const legacyId = legacy.subscribe(cloneFilter(f), (message) =>
                delivered.legacy.push(message.__event + ' ' + expectedId + ' ' + message.datapointName),
            );
            assert.equal(legacyId, expectedId);
            const indexedId = indexedSubscribe(cloneFilter(f));
            assert.equal(indexedId, legacyId);
            ids.push(legacyId);
        }
    }

    return delivered;
}

test('indexed dispatch delivers what the legacy dispatch delivered, in the same order (randomised)', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const {legacy, indexed} = run(seed, {});
        assert.ok(legacy.length > 0, 'seed ' + seed + ' delivered nothing');
        assert.deepEqual(indexed, legacy, 'seed ' + seed);
    }
});

test('the same with subscriptions coming and going while events flow', () => {
    for (let seed = 100; seed <= 130; seed++) {
        const {legacy, indexed} = run(seed, {unsubscribeEvery: 7});
        assert.deepEqual(indexed, legacy, 'seed ' + seed);
    }
});

test('the same without cached values (before the first value cache arrived)', () => {
    for (let seed = 200; seed <= 210; seed++) {
        const {legacy, indexed} = run(seed, {cachedValues: false});
        assert.deepEqual(indexed, legacy, 'seed ' + seed);
    }
});

test('keyOf: the most selective plain string attribute, nothing for regular expressions, numbers, arrays and empty strings', () => {
    assert.deepEqual(keyOf({cache: true, datapointName: 'HmIP-RF.ABC:1.STATE'}), {
        attr: 'datapointName',
        value: 'HmIP-RF.ABC:1.STATE',
    });
    assert.deepEqual(keyOf({iface: 'HmIP-RF', channel: 'ABC:1', datapoint: 'STATE'}), {
        attr: 'channel',
        value: 'ABC:1',
    });
    assert.deepEqual(keyOf({iface: 'HmIP-RF', datapoint: 'STATE'}), {attr: 'datapoint', value: 'STATE'});
    assert.deepEqual(keyOf({iface: 'HmIP-RF', channel: '', datapoint: /^PRESS/}), {attr: 'iface', value: 'HmIP-RF'});
    assert.equal(keyOf({cache: true}), null);
    assert.equal(keyOf({room: 'Kitchen'}), null);
    assert.equal(keyOf({channelIndex: 1, rooms: /Kit/}), null);
    assert.equal(keyOf({iface: '', channel: ''}), null);
    assert.deepEqual(INDEXED_ATTRIBUTES[0], 'datapointName');
});

test('candidates are a superset of the matches: an indexed subscription is a candidate for every message it matches', () => {
    const random = prng(7);
    const datapoints = world(random, 80);
    const index = new SubscriptionIndex();
    const filters = [];
    for (let i = 0; i < 300; i++) {
        const f = filter(random, datapoints);
        filters.push(f);
        index.add(f, () => {});
    }

    for (let n = 0; n < 500; n++) {
        const e = event(random, datapoints, n);
        const candidates = new Set(index.candidates(e));
        for (let id = 0; id < filters.length; id++) {
            if (matches(filters[id], e, id)) {
                assert.ok(
                    candidates.has(id),
                    'id ' + id + ' matches but was not a candidate: ' + JSON.stringify(filters[id]),
                );
            }
        }
    }
});

test('memory: the entries grow with the subscriptions, not with datapoints x subscriptions', () => {
    const random = prng(11);
    const small = world(random, 20);
    const large = world(prng(11), 20).concat(world(prng(12), 400));
    assert.ok(large.length > small.length * 5);

    for (const datapoints of [small, large]) {
        const legacy = new LegacyDispatch();
        const index = new SubscriptionIndex();
        const values = {};
        for (const dp of datapoints) {
            const cached = {...dp, value: 0, cache: true, change: false, stable: true};
            legacy.values[dp.datapointName] = cached;
            values[dp.datapointName] = cached;
        }

        const subs = 100;
        for (let i = 0; i < subs; i++) {
            const f = filter(random, datapoints);
            f.cache = true;
            legacy.subscribe(cloneFilter(f), () => {});
            index.add(f, () => {});
        }

        for (const dp of datapoints) {
            const e = {...dp, value: 1, cache: false, change: true, stable: true};
            legacy.callCallbacks(e);
            index.candidates(e);
        }

        assert.equal(index.entries(), subs);
        assert.equal(index.size, subs);
        // the legacy sets held one entry per datapoint per subscription (and the replay's
        // numeric ids beside the event path's string ids)
        assert.ok(legacy.entries() >= datapoints.length * subs, legacy.entries() + ' < ' + datapoints.length * subs);
    }
});

test('unsubscribe cleans the index: no bucket, no generic entry, no map left behind', () => {
    const index = new SubscriptionIndex();
    const ids = [
        index.add({cache: true, datapointName: 'HmIP-RF.ABC:1.STATE'}, () => {}),
        index.add({iface: 'HmIP-RF', channel: 'ABC:1', datapoint: 'STATE'}, () => {}),
        index.add({iface: 'HmIP-RF', channel: 'ABC:1', datapoint: 'LEVEL'}, () => {}),
        index.add({room: 'Kitchen'}, () => {}),
        index.add({}, () => {}),
    ];
    assert.equal(index.entries(), 5);
    assert.deepEqual(index.candidates({channel: 'ABC:1', datapointName: 'HmIP-RF.ABC:1.STATE'}), [0, 1, 2, 3, 4]);

    assert.equal(index.remove(ids[1]), true);
    assert.equal(index.remove(String(ids[0])), true, 'by a string id too');
    assert.equal(index.remove(ids[0]), false, 'already gone');
    assert.equal(index.remove(999), false);
    assert.deepEqual(index.candidates({channel: 'ABC:1', datapointName: 'HmIP-RF.ABC:1.STATE'}), [2, 3, 4]);
    assert.equal(index.buckets.get('datapointName'), undefined, 'the empty attribute map is gone');
    assert.equal(index.buckets.get('channel').get('ABC:1').size, 1);

    for (const id of [2, 3, 4]) {
        assert.equal(index.remove(id), true);
    }

    assert.equal(index.size, 0);
    assert.equal(index.entries(), 0);
    assert.equal(index.buckets.size, 0);
    assert.equal(index.generic.size, 0);
    assert.equal(
        index.add({cache: true}, () => {}),
        5,
        'ids are never reused',
    );
});

test('replayCandidates: one lookup for a datapoint named exactly, a filtered walk otherwise', () => {
    const values = {
        'HmIP-RF.ABC:1.STATE': {
            datapointName: 'HmIP-RF.ABC:1.STATE',
            iface: 'HmIP-RF',
            channel: 'ABC:1',
            datapoint: 'STATE',
        },
        'HmIP-RF.ABC:1.LEVEL': {
            datapointName: 'HmIP-RF.ABC:1.LEVEL',
            iface: 'HmIP-RF',
            channel: 'ABC:1',
            datapoint: 'LEVEL',
        },
        'HmIP-RF.DEF:2.STATE': {
            datapointName: 'HmIP-RF.DEF:2.STATE',
            iface: 'HmIP-RF',
            channel: 'DEF:2',
            datapoint: 'STATE',
        },
    };
    const names = (list) => list.map((v) => v.datapointName);
    assert.deepEqual(
        names(SubscriptionIndex.replayCandidates({cache: true, datapointName: 'HmIP-RF.ABC:1.LEVEL'}, values)),
        ['HmIP-RF.ABC:1.LEVEL'],
    );
    assert.deepEqual(
        names(SubscriptionIndex.replayCandidates({cache: true, datapointName: 'HmIP-RF.NONE:1.LEVEL'}, values)),
        [],
    );
    assert.deepEqual(
        names(
            SubscriptionIndex.replayCandidates(
                {cache: true, iface: 'HmIP-RF', channel: 'DEF:2', datapoint: 'STATE'},
                values,
            ),
        ),
        ['HmIP-RF.DEF:2.STATE'],
    );
    assert.deepEqual(
        names(SubscriptionIndex.replayCandidates({cache: true, iface: 'HmIP-RF', channel: 'ABC:1'}, values)),
        ['HmIP-RF.ABC:1.STATE', 'HmIP-RF.ABC:1.LEVEL'],
    );
    assert.deepEqual(names(SubscriptionIndex.replayCandidates({cache: true, datapoint: 'STATE'}, values)), [
        'HmIP-RF.ABC:1.STATE',
        'HmIP-RF.DEF:2.STATE',
    ]);
    assert.deepEqual(names(SubscriptionIndex.replayCandidates({cache: true}, values)), Object.keys(values));
    assert.deepEqual(
        names(SubscriptionIndex.replayCandidates({cache: true, room: 'Kitchen'}, values)),
        Object.keys(values),
    );
});
