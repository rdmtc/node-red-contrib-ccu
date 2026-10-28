const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {writeJsonAtomic, DebouncedSave} = require('../../nodes/lib/cachefile.js');

/* task 24: the cache files are written once per burst and atomically. */

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('writeJsonAtomic', () => {
    test('writes the JSON and leaves no temporary file behind', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        writeJsonAtomic(file, {devices: {a: 1}});
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {devices: {a: 1}});
        assert.deepEqual(fs.readdirSync(dir), ['ccu_test.json']);

        writeJsonAtomic(file, {devices: {}}, '  ');
        assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "devices": {}\n}');
        assert.deepEqual(fs.readdirSync(dir), ['ccu_test.json']);
        fs.rmSync(dir, {recursive: true});
    });

    test('a failed write keeps the old file and throws', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        writeJsonAtomic(file, {kept: true});
        // a value JSON.stringify cannot serialise
        assert.throws(() => writeJsonAtomic(file, {big: 1n}), TypeError);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {kept: true});
        assert.deepEqual(fs.readdirSync(dir), ['ccu_test.json']);
        fs.rmSync(dir, {recursive: true});
    });
});

describe('DebouncedSave', () => {
    test('a burst of requests is one write, after the delay', async () => {
        let writes = 0;
        const save = new DebouncedSave(() => writes++, 30);
        save.request();
        save.request();
        save.request();
        assert.equal(writes, 0);
        assert.equal(save.pending, true);
        await wait(60);
        assert.equal(writes, 1);
        assert.equal(save.pending, false);

        // the next burst is the next write
        save.request();
        await wait(60);
        assert.equal(writes, 2);
    });

    test('flush writes a pending request at once and nothing when none is pending', () => {
        let writes = 0;
        const save = new DebouncedSave(() => writes++, 1000);
        save.flush();
        assert.equal(writes, 0);
        save.request();
        save.flush();
        assert.equal(writes, 1);
        save.flush();
        assert.equal(writes, 1);
        assert.equal(save.timer, null);
    });

    test('cancel drops a pending request', async () => {
        let writes = 0;
        const save = new DebouncedSave(() => writes++, 20);
        save.request();
        save.cancel();
        await wait(40);
        assert.equal(writes, 0);
        assert.equal(save.pending, false);
    });
});
