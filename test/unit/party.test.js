/* task 2 (#156, #161): party mode writes on HmIP thermostats - lib/party.js */

const test = require('node:test');
const assert = require('node:assert/strict');

const {PARTY_DATAPOINTS, isPartyWrite, formatPartyTime, mergePartyValues} = require('../../nodes/lib/party.js');

const hmipValues = {
    PARTY_MODE: {TYPE: 'BOOL', OPERATIONS: 5},
    PARTY_SET_POINT_TEMPERATURE: {TYPE: 'FLOAT', MIN: 4.5, MAX: 30.5, OPERATIONS: 5},
    PARTY_TIME_END: {TYPE: 'STRING', OPERATIONS: 7},
    PARTY_TIME_START: {TYPE: 'STRING', OPERATIONS: 7},
    SET_POINT_TEMPERATURE: {TYPE: 'FLOAT', OPERATIONS: 7},
};

// the HM variant: PARTY_MODE_SUBMIT and the split fields, not the three
const hmValues = {
    PARTY_MODE_SUBMIT: {TYPE: 'STRING', OPERATIONS: 2},
    PARTY_START_TIME: {TYPE: 'INTEGER', OPERATIONS: 7},
    PARTY_STOP_TIME: {TYPE: 'INTEGER', OPERATIONS: 7},
    PARTY_TEMPERATURE: {TYPE: 'FLOAT', OPERATIONS: 7},
};

test('the three datapoints the device takes together', () => {
    assert.deepEqual(PARTY_DATAPOINTS, ['PARTY_TIME_START', 'PARTY_TIME_END', 'PARTY_SET_POINT_TEMPERATURE']);
});

test('isPartyWrite: one of the three on a channel that carries all three', () => {
    for (const name of PARTY_DATAPOINTS) {
        assert.equal(isPartyWrite(name, hmipValues), true, name);
    }
});

test('isPartyWrite: not for other datapoints, the HM variant, or without a description', () => {
    assert.equal(isPartyWrite('SET_POINT_TEMPERATURE', hmipValues), false);
    assert.equal(isPartyWrite('PARTY_MODE', hmipValues), false);
    assert.equal(isPartyWrite('PARTY_TEMPERATURE', hmValues), false);
    assert.equal(isPartyWrite('PARTY_TIME_START', hmValues), false);
    assert.equal(isPartyWrite('PARTY_TIME_START', undefined), false);
    assert.equal(isPartyWrite('PARTY_TIME_START', {PARTY_TIME_START: {TYPE: 'STRING'}}), false);
});

test("formatPartyTime: the device's own string passes through", () => {
    assert.equal(formatPartyTime('2026_12_24 18:00'), '2026_12_24 18:00');
    assert.equal(formatPartyTime('1999_11_30 00:00'), '1999_11_30 00:00');
});

test('formatPartyTime: a Date, epoch milliseconds and an ISO string, in local time', () => {
    const date = new Date(2026, 11, 24, 18, 5); // local components
    assert.equal(formatPartyTime(date), '2026_12_24 18:05');
    assert.equal(formatPartyTime(date.getTime()), '2026_12_24 18:05');
    assert.equal(formatPartyTime(date.toISOString()), '2026_12_24 18:05');
    assert.equal(formatPartyTime(new Date(2026, 0, 1, 0, 0)), '2026_01_01 00:00');
});

test('formatPartyTime: what is not a time is passed on as a string', () => {
    assert.equal(formatPartyTime('tomorrow'), 'tomorrow');
    assert.equal(formatPartyTime(''), '');
    assert.equal(formatPartyTime(null), 'null');
});

test('mergePartyValues: the written one plus the current other two, times formatted', () => {
    const current = {PARTY_TIME_END: '2026_12_26 10:00', PARTY_SET_POINT_TEMPERATURE: 21.5};
    assert.deepEqual(mergePartyValues('PARTY_TIME_START', new Date(2026, 11, 24, 18, 0), current), {
        values: {
            PARTY_TIME_START: '2026_12_24 18:00',
            PARTY_TIME_END: '2026_12_26 10:00',
            PARTY_SET_POINT_TEMPERATURE: 21.5,
        },
        missing: [],
    });
    assert.deepEqual(
        mergePartyValues('PARTY_SET_POINT_TEMPERATURE', 18, {
            PARTY_TIME_START: '2026_12_24 18:00',
            PARTY_TIME_END: '2026_12_26 10:00',
        }),
        {
            values: {
                PARTY_TIME_START: '2026_12_24 18:00',
                PARTY_TIME_END: '2026_12_26 10:00',
                PARTY_SET_POINT_TEMPERATURE: 18,
            },
            missing: [],
        },
    );
});

test('mergePartyValues: names without a current value are reported as missing', () => {
    assert.deepEqual(mergePartyValues('PARTY_TIME_START', '2026_12_24 18:00', {}), {
        values: {PARTY_TIME_START: '2026_12_24 18:00'},
        missing: ['PARTY_TIME_END', 'PARTY_SET_POINT_TEMPERATURE'],
    });
    assert.deepEqual(mergePartyValues('PARTY_TIME_END', '2026_12_26 10:00', undefined).missing, [
        'PARTY_TIME_START',
        'PARTY_SET_POINT_TEMPERATURE',
    ]);
});
