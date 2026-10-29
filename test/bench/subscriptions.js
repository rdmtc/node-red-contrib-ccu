#!/usr/bin/env node
/* task 27: heap and dispatch time of the subscription dispatch, before (the per-datapoint
   whitelists/blacklists of 4.7.2, test/helpers/legacy-dispatch.js) and after (the index,
   nodes/lib/subscriptions.js), with a population like a large RedMatic system: 12,000 datapoints
   and ~1,000 subscriptions of the shapes RedMatic-Matter, RedMatic-HomeKit, ccu-value,
   ccu-rpc-event and the generic nodes make.

   Run each implementation in its own process:
     node --expose-gc test/bench/subscriptions.js legacy
     node --expose-gc test/bench/subscriptions.js indexed
   Options: --datapoints N (12000) --subscriptions N (1000) --events N (20000) --json */

const {SubscriptionIndex, matches} = require('../../nodes/lib/subscriptions.js');
const {LegacyDispatch} = require('../helpers/legacy-dispatch.js');

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) || 'indexed';
const option = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i === -1 ? fallback : Number(args[i + 1]);
};

const DATAPOINTS = option('datapoints', 12000);
const SUBSCRIPTIONS = option('subscriptions', 1000);
const EVENTS = option('events', 20000);
const json = args.includes('--json');

if (typeof global.gc !== 'function') {
    console.error('run with --expose-gc');
    process.exit(1);
}

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

const random = prng(42);
const pick = (array) => array[Math.floor(random() * array.length)];

const IFACES = ['BidCos-RF', 'HmIP-RF'];
const CHANNEL_TYPES = [
    'SWITCH_VIRTUAL_RECEIVER',
    'KEY_TRANSCEIVER',
    'HEATING_CLIMATECONTROL_TRANSCEIVER',
    'SHUTTER_CONTACT',
];
const DEVICE_TYPES = ['HmIP-BSM', 'HmIP-eTRV-2', 'HM-LC-Sw1-FM', 'HmIP-SWDO'];
const DATAPOINTS_PER_CHANNEL = [
    'STATE',
    'LEVEL',
    'ACTUAL_TEMPERATURE',
    'SET_POINT_TEMPERATURE',
    'UNREACH',
    'LOWBAT',
    'RSSI_DEVICE',
    'OPERATING_VOLTAGE',
    'ERROR_CODE',
    'PROCESS',
];
const ROOMS = ['Kitchen', 'Living room', 'Bedroom', 'Hall', 'Bath', 'Office'];
const FUNCTIONS = ['Light', 'Heating', 'Security', 'Climate'];

/** the datapoints: devices x 3 channels x 10 datapoints with stable attributes */
function world(count) {
    const datapoints = [];
    let d = 0;
    while (datapoints.length < count) {
        const iface = pick(IFACES);
        const device = 'DEV' + String(d).padStart(7, '0');
        const deviceType = pick(DEVICE_TYPES);
        for (let c = 1; c <= 3 && datapoints.length < count; c++) {
            const channel = device + ':' + c;
            const rooms = [pick(ROOMS)];
            const functions = [pick(FUNCTIONS)];
            const channelType = pick(CHANNEL_TYPES);
            for (const datapoint of DATAPOINTS_PER_CHANNEL) {
                if (datapoints.length >= count) {
                    break;
                }

                datapoints.push({
                    topic: '',
                    iface,
                    device,
                    deviceName: 'Device ' + d,
                    deviceType,
                    channel,
                    channelName: 'Channel ' + d + '-' + c,
                    channelType,
                    channelIndex: c,
                    datapoint,
                    datapointName: iface + '.' + channel + '.' + datapoint,
                    rooms,
                    room: rooms[0],
                    functions,
                    function: functions[0],
                    value: 0,
                    payload: 0,
                    cache: true,
                    change: false,
                    stable: true,
                    uncertain: false,
                    working: false,
                    ts: 0,
                    lc: 0,
                });
            }
        }

        d += 1;
    }

    return datapoints;
}

/** ~1,000 subscriptions: 55 % Matter/HomeKit (datapointName), 30 % ccu-value, 10 % rpc-event per iface/datapoint, 5 % generic */
function filters(datapoints, count) {
    const result = [];
    for (let i = 0; i < count; i++) {
        const dp = pick(datapoints);
        const shape = random();
        if (shape < 0.55) {
            result.push({cache: true, change: true, stable: random() < 0.8, datapointName: dp.datapointName});
        } else if (shape < 0.85) {
            result.push({
                cache: true,
                change: random() < 0.5,
                stable: true,
                iface: dp.iface,
                channel: dp.channel,
                datapoint: dp.datapoint,
            });
        } else if (shape < 0.95) {
            const f = {cache: false, change: false, stable: false, iface: dp.iface};
            if (random() < 0.7) {
                f.datapoint = random() < 0.7 ? dp.datapoint : new RegExp('^' + dp.datapoint.slice(0, 3));
            }

            if (random() < 0.3) {
                f.channelType = dp.channelType;
            }

            result.push(f);
        } else {
            const kind = random();
            if (kind < 0.4) {
                result.push({cache: true, change: true, room: pick(ROOMS)});
            } else if (kind < 0.7) {
                result.push({cache: false, change: true, rooms: new RegExp(pick(ROOMS).slice(0, 3))});
            } else {
                result.push({cache: false, function: pick(FUNCTIONS), datapoint: 'STATE'});
            }
        }
    }

    return result;
}

function heapMB() {
    global.gc();
    global.gc();
    return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

const datapoints = world(DATAPOINTS);
const values = {};
for (const dp of datapoints) {
    values[dp.datapointName] = dp;
}

const filterList = filters(datapoints, SUBSCRIPTIONS);
const baseline = heapMB();
let delivered = 0;
const callback = () => {
    delivered += 1;
};

let dispatch;
let subscribe;
let unsubscribe;
let entries;
let legacy;
let index;

if (which === 'legacy') {
    legacy = new LegacyDispatch();
    legacy.values = values;
    subscribe = (f) => legacy.subscribe(f, callback);
    unsubscribe = (id) => legacy.unsubscribe(id);
    dispatch = (message) => legacy.callCallbacks(message);
    entries = () => legacy.entries();
} else {
    index = new SubscriptionIndex();
    subscribe = (f) => {
        const id = index.add(f, callback);
        if (f.cache) {
            for (const cached of SubscriptionIndex.replayCandidates(f, values)) {
                const message = {...cached, cache: true, change: false};
                if (matches(f, message, id)) {
                    callback(message);
                }
            }
        }

        return id;
    };

    unsubscribe = (id) => index.remove(id);
    dispatch = (message) => {
        for (const id of index.candidates(message)) {
            const subscription = index.get(id);
            if (matches(subscription.filter, message, id)) {
                subscription.callback(message);
            }
        }
    };

    entries = () => index.entries();
}

const result = {
    implementation: which,
    datapoints: DATAPOINTS,
    subscriptions: SUBSCRIPTIONS,
    events: EVENTS,
    baselineMB: baseline,
};

// 1. subscribe (a deploy: every cache:true subscription replays the cached values)
let t = process.hrtime.bigint();
const ids = filterList.map((f) => subscribe(f));
result.subscribeMs = Number(process.hrtime.bigint() - t) / 1e6;
result.replayDelivered = delivered;
result.heapAfterSubscribeMB = heapMB() - baseline;

// 2. one event per datapoint (fills every per-datapoint set in the legacy dispatch)
delivered = 0;
t = process.hrtime.bigint();
for (const dp of datapoints) {
    const message = {...dp, value: 1, payload: 1, cache: false, change: true};
    values[dp.datapointName] = message;
    dispatch(message);
}

result.firstPassMs = Number(process.hrtime.bigint() - t) / 1e6;
result.heapAfterFirstPassMB = heapMB() - baseline;
result.entriesAfterFirstPass = entries();

// 3. steady state: random events
delivered = 0;
t = process.hrtime.bigint();
for (let n = 0; n < EVENTS; n++) {
    const dp = datapoints[Math.floor(random() * datapoints.length)];
    const message = {...dp, value: n, payload: n, cache: false, change: true};
    values[dp.datapointName] = message;
    dispatch(message);
}

result.eventMicros = Number(process.hrtime.bigint() - t) / 1e3 / EVENTS;
result.eventsPerSecond = Math.round(1e6 / result.eventMicros);
result.steadyDelivered = delivered;

// 4. a redeploy: unsubscribe all, subscribe again (the legacy sets keep the string ids)
t = process.hrtime.bigint();
for (const id of ids) {
    unsubscribe(id);
}

filterList.forEach((f) => subscribe(f));
for (const dp of datapoints) {
    const message = {...dp, value: 2, payload: 2, cache: false, change: true};
    dispatch(message);
}

result.redeployMs = Number(process.hrtime.bigint() - t) / 1e6;
result.heapAfterRedeployMB = heapMB() - baseline;
result.entriesAfterRedeploy = entries();

for (const key of Object.keys(result)) {
    if (typeof result[key] === 'number' && !Number.isInteger(result[key])) {
        result[key] = Math.round(result[key] * 100) / 100;
    }
}

if (json) {
    console.log(JSON.stringify(result));
} else {
    console.log(which + ': ' + DATAPOINTS + ' datapoints, ' + SUBSCRIPTIONS + ' subscriptions');
    console.log(
        '  subscribe (deploy with cache replay): ' +
            result.subscribeMs +
            ' ms, ' +
            result.replayDelivered +
            ' replayed',
    );
    console.log('  heap above baseline after subscribe:  ' + result.heapAfterSubscribeMB + ' MB');
    console.log('  first event on every datapoint:       ' + result.firstPassMs + ' ms');
    console.log(
        '  heap above baseline after that:       ' +
            result.heapAfterFirstPassMB +
            ' MB (' +
            result.entriesAfterFirstPass +
            ' entries)',
    );
    console.log(
        '  steady state:                         ' +
            result.eventMicros +
            ' us/event (' +
            result.eventsPerSecond +
            ' events/s)',
    );
    console.log('  redeploy (unsubscribe + subscribe):   ' + result.redeployMs + ' ms');
    console.log(
        '  heap above baseline after redeploy:   ' +
            result.heapAfterRedeployMB +
            ' MB (' +
            result.entriesAfterRedeploy +
            ' entries)',
    );
}
