/* Syntax-check the inline editor scripts of every node HTML file.

   Node-RED evaluates these in the browser, so a syntax error breaks the whole
   editor for every node - and nothing else in the suite would notice, because
   the runtime side keeps working. Cheap insurance for a part of the codebase
   the tests otherwise never touch. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NODES = path.join(__dirname, '..', '..', 'nodes');
const SCRIPT = /<script type="text\/javascript">([\s\S]*?)<\/script>/g;

const files = fs.readdirSync(NODES).filter((file) => file.endsWith('.html'));

test('there are node HTML files to check', () => {
    assert.ok(files.length > 10, 'expected the node editors to be present');
});

for (const file of files) {
    test(`${file}: editor scripts parse`, () => {
        const html = fs.readFileSync(path.join(NODES, file), 'utf8');
        let match;
        let index = 0;
        SCRIPT.lastIndex = 0;
        while ((match = SCRIPT.exec(html)) !== null) {
            index += 1;
            assert.doesNotThrow(
                () => new vm.Script(match[1], {filename: `${file} script#${index}`}),
                `${file} editor script #${index} does not parse`,
            );
        }
    });
}
