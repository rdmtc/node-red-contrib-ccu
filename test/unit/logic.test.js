const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {isLogicIface, parseAddress, nameOf, variableShape, castVariable} = require('../../nodes/lib/logic.js');

/* task 32: the pure pieces of the Logic mapping. */

describe('the Logic interface and its addresses', () => {
    test('Logic is told by its addon id, else by its name', () => {
        assert.equal(isLogicIface('Logic'), true);
        assert.equal(isLogicIface('Logic', {addon: 'logic'}), true);
        assert.equal(isLogicIface('Logik', {addon: 'logic'}), true);
        assert.equal(isLogicIface('Logic', {addon: 'other'}), false);
        assert.equal(isLogicIface('HmIP-RF'), false);
    });

    test("a variable's and a program's value channel; anything else is none", () => {
        assert.deepEqual(parseAddress('var-regen:1'), {
            kind: 'variable',
            key: 'regen',
            device: 'var-regen',
            channel: 'var-regen:1',
        });
        assert.deepEqual(parseAddress('prg-markise-bei-regen:1'), {
            kind: 'program',
            key: 'markise-bei-regen',
            device: 'prg-markise-bei-regen',
            channel: 'prg-markise-bei-regen:1',
        });
        assert.equal(parseAddress('var-regen:0'), null);
        assert.equal(parseAddress('var-regen'), null);
        assert.equal(parseAddress('ABC1:1'), null);
        assert.equal(parseAddress(undefined), null);
    });

    test("the name: the channel's, else the device's, else the key", () => {
        const ref = parseAddress('var-regen:1');
        assert.equal(nameOf({'var-regen:1': 'Regen', 'var-regen': 'Gerät'}, ref), 'Regen');
        assert.equal(nameOf({'var-regen': 'Gerät'}, ref), 'Gerät');
        assert.equal(nameOf({}, ref), 'regen');
        assert.equal(nameOf(undefined, ref), 'regen');
    });
});

describe("a variable's shape as the CCU's", () => {
    test('a logic value with its texts', () => {
        assert.deepEqual(variableShape({TYPE: 'BOOL', VALUE_LIST: ['aus', 'an']}), {
            valueType: 'boolean',
            enum: ['aus', 'an'],
            unit: '',
            type: 'BOOL',
        });
    });

    test('a value list: a number with its entries, no limits', () => {
        const shape = variableShape({TYPE: 'ENUM', MIN: 0, MAX: 2, VALUE_LIST: ['a', 'b', 'c']});
        assert.equal(shape.valueType, 'number');
        assert.deepEqual(shape.enum, ['a', 'b', 'c']);
        assert.equal(shape.min, undefined);
    });

    test('a number with its unit and limits, a string', () => {
        assert.deepEqual(variableShape({TYPE: 'FLOAT', MIN: 5, MAX: 30, UNIT: '°C'}), {
            valueType: 'number',
            enum: [],
            unit: '°C',
            type: 'FLOAT',
            min: 5,
            max: 30,
        });
        assert.equal(variableShape({TYPE: 'STRING'}).valueType, 'string');
        assert.equal(variableShape({TYPE: 'INTEGER'}).valueType, 'number');
        assert.equal(variableShape({TYPE: 'ACTION'}).valueType, 'boolean');
    });

    test('without a description the value decides', () => {
        assert.equal(variableShape(undefined, true).valueType, 'boolean');
        assert.equal(variableShape(undefined, 'x').valueType, 'string');
        assert.equal(variableShape(undefined, 3).valueType, 'number');
        assert.deepEqual(variableShape(undefined, 3).enum, []);
    });
});

describe('a value to write', () => {
    const bool = variableShape({TYPE: 'BOOL', VALUE_LIST: ['trocken', 'regnet']});
    const list = variableShape({TYPE: 'ENUM', VALUE_LIST: ['aus', 'tag', 'nacht']});

    test('a logic value: true/false, its texts, "false" and "0", anything else as truthy', () => {
        assert.equal(castVariable(true, bool), true);
        assert.equal(castVariable(0, bool), false);
        assert.equal(castVariable('regnet', bool), true);
        assert.equal(castVariable('trocken', bool), false);
        assert.equal(castVariable('false', bool), false);
        assert.equal(castVariable('0', bool), false);
        assert.equal(castVariable('yes', bool), true);
    });

    test('a value list: the number, or the entry by its text', () => {
        assert.equal(castVariable('nacht', list), 2);
        assert.equal(castVariable(1, list), 1);
        assert.equal(castVariable('1', list), 1);
        assert.equal(castVariable(1.6, list), 2);
        assert.equal(castVariable(true, list), 1);
    });

    test('a FLOAT as a double, an INTEGER whole, a number without a type plain, garbage as 0', () => {
        assert.deepEqual(castVariable('21.5', variableShape({TYPE: 'FLOAT'})), {explicitDouble: 21.5});
        assert.equal(castVariable('7.4', variableShape({TYPE: 'INTEGER'})), 7);
        assert.equal(castVariable('7.4', variableShape(undefined, 1)), 7.4);
        assert.deepEqual(castVariable('x', variableShape({TYPE: 'FLOAT'})), {explicitDouble: 0});
    });

    test('a string', () => {
        const shape = variableShape({TYPE: 'STRING'});
        assert.equal(castVariable(12, shape), '12');
        assert.equal(castVariable(null, shape), '');
    });
});
