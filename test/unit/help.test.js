/* task 7 (#58): every node has its help in German and English, as
   locales/<lang>/<node file>.html - the layout Node-RED documents for node
   help; the runtime serves one language per request from these files (a
   file under locales/de/ serves "de" and "de-DE" alike, en-US is the
   default for everything else). German is the source, English is derived:
   the English file must not be a stub of the German one. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const pkg = require(path.join(root, 'package.json'));
const nodeFiles = Object.values(pkg['node-red'].nodes);
const LANGS = ['de', 'en-US'];

/** the type(s) a node file registers: RED.nodes.registerType('ccu-…', …) */
function registeredTypes(jsFile) {
    const source = fs.readFileSync(path.join(root, jsFile), 'utf8');
    return [...source.matchAll(/registerType\(\s*'([^']+)'/g)].map((m) => m[1]);
}

function helpFile(lang, jsFile) {
    return path.join(root, 'nodes', 'locales', lang, path.basename(jsFile, '.js') + '.html');
}

function textLength(html) {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim().length;
}

test('the package registers the sixteen node files', () => {
    assert.equal(nodeFiles.length, 16);
});

for (const jsFile of nodeFiles) {
    const types = registeredTypes(jsFile);

    test(jsFile + ' registers one node type', () => {
        assert.equal(types.length, 1, jsFile);
    });

    for (const lang of LANGS) {
        test(jsFile + ': help in ' + lang + ' names the node type and is not empty', () => {
            const file = helpFile(lang, jsFile);
            assert.ok(fs.existsSync(file), 'missing ' + path.relative(root, file));
            const html = fs.readFileSync(file, 'utf8');
            const names = [...html.matchAll(/data-help-name="([^"]+)"/g)].map((m) => m[1]);
            assert.deepEqual(names, [types[0]], path.relative(root, file));
            assert.ok(/<script type="text\/html" data-help-name=/.test(html), 'text/html script block expected');
            assert.ok(textLength(html) > 40, 'help text too short in ' + path.relative(root, file));
        });
    }

    test(jsFile + ': the English help is not a stub of the German one', () => {
        const de = textLength(fs.readFileSync(helpFile('de', jsFile), 'utf8'));
        const en = textLength(fs.readFileSync(helpFile('en-US', jsFile), 'utf8'));
        assert.ok(en >= de * 0.6, `English ${en} chars against German ${de}`);
    });

    test(jsFile + ': no inline help block is left in the node file', () => {
        const html = fs.readFileSync(path.join(root, jsFile.replace(/\.js$/, '.html')), 'utf8');
        assert.equal(/data-help-name=/.test(html), false, 'inline help in ' + jsFile.replace(/\.js$/, '.html'));
    });
}

test('the value nodes link the eQ-3 device documentation in both languages', () => {
    for (const base of ['ccu-value', 'ccu-get-value', 'ccu-set-value', 'ccu-rpc-event']) {
        for (const lang of LANGS) {
            const html = fs.readFileSync(path.join(root, 'nodes', 'locales', lang, base + '.html'), 'utf8');
            assert.ok(/HmIP_Device_Documentation\.pdf/.test(html), base + ' ' + lang);
        }
    }
});
