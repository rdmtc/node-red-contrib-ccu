const {test} = require('node:test');
const assert = require('node:assert/strict');

const {combinedParameterValue} = require('../../nodes/lib/combined.js');

const desc = {LEVEL: {}, LEVEL_2: {}, COMBINED_PARAMETER: {TYPE: 'STRING'}};

test('LEVEL_2 write maps to L2 percent when COMBINED_PARAMETER exists', () => {
    assert.equal(combinedParameterValue('LEVEL_2', 0.5, desc), 'L2=50');
    assert.equal(combinedParameterValue('LEVEL_2', 0, desc), 'L2=0');
    assert.equal(combinedParameterValue('LEVEL_2', 1, desc), 'L2=100');
});

test('string values are parsed', () => {
    assert.equal(combinedParameterValue('LEVEL_2', '0.25', desc), 'L2=25');
});

test('rounding to whole percent', () => {
    assert.equal(combinedParameterValue('LEVEL_2', 0.505, desc), 'L2=51');
});

test('no mapping without COMBINED_PARAMETER in the description', () => {
    assert.equal(combinedParameterValue('LEVEL_2', 0.5, {LEVEL_2: {}}), null);
    assert.equal(combinedParameterValue('LEVEL_2', 0.5, undefined), null);
});

test('LEVEL and other datapoints are never remapped', () => {
    assert.equal(combinedParameterValue('LEVEL', 0.5, desc), null);
    assert.equal(combinedParameterValue('STATE', true, desc), null);
});

test('unparseable values are not remapped', () => {
    assert.equal(combinedParameterValue('LEVEL_2', 'nope', desc), null);
    assert.equal(combinedParameterValue('LEVEL_2', undefined, desc), null);
});
