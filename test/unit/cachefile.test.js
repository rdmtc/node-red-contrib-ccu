const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    writeJsonAtomic,
    writeJsonIfChanged,
    readText,
    lastWritten,
    contextStoreModule,
    DebouncedSave,
} = require('../../nodes/lib/cachefile.js');

/* task 24: the cache files are written once per burst and atomically; nothing unchanged is written. */

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

    test('an existing file keeps its mode', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        fs.writeFileSync(file, '{}', {mode: 0o600});
        fs.chmodSync(file, 0o600);
        writeJsonAtomic(file, {a: 1});
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
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

describe('writeJsonIfChanged', () => {
    test('the same content is not written again, a changed one is', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        assert.equal(writeJsonIfChanged(file, {a: 1}), true);
        assert.equal(writeJsonIfChanged(file, {a: 1}), false);
        assert.equal(writeJsonIfChanged(file, {a: 2}), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {a: 2});
        assert.deepEqual(fs.readdirSync(dir), ['ccu_test.json']);
        fs.rmSync(dir, {recursive: true});
    });

    test('a file changed or removed from outside is written again', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        writeJsonIfChanged(file, {a: 1});
        fs.writeFileSync(file, '{"a":1000}');
        assert.equal(writeJsonIfChanged(file, {a: 1}), true);
        fs.unlinkSync(file);
        assert.equal(writeJsonIfChanged(file, {a: 1}), true);
        assert.equal(fs.existsSync(file), true);
        fs.rmSync(dir, {recursive: true});
    });

    test('what readText read is not written back', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        fs.writeFileSync(file, JSON.stringify({names: {x: 'Lamp'}}));
        const data = JSON.parse(readText(file));
        assert.equal(writeJsonIfChanged(file, data), false);
        data.names.y = 'Door';
        assert.equal(writeJsonIfChanged(file, data), true);
        fs.rmSync(dir, {recursive: true});
    });
});

describe('lastWritten', () => {
    test("the file's modification time, 0 without a file", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrccu-cachefile-'));
        const file = path.join(dir, 'ccu_test.json');
        assert.equal(lastWritten(file), 0);
        writeJsonAtomic(file, {});
        assert.ok(Math.abs(lastWritten(file) - Date.now()) < 5000);
        fs.utimesSync(file, 1000, 1000);
        assert.equal(lastWritten(file), 1000000);
        fs.rmSync(dir, {recursive: true});
    });
});

describe('contextStoreModule', () => {
    const settings = {
        contextStorage: {default: 'file', file: {module: 'localfilesystem'}, memory: {module: 'memory'}},
    };

    test('the module of a store, the default by its name', () => {
        assert.equal(contextStoreModule(settings, 'file'), 'localfilesystem');
        assert.equal(contextStoreModule(settings, 'default'), 'localfilesystem');
        assert.equal(contextStoreModule(settings, 'memory'), 'memory');
    });

    test('no store, no name, no settings: undefined', () => {
        assert.equal(contextStoreModule(settings, ''), undefined);
        assert.equal(contextStoreModule(settings, 'redis'), undefined);
        assert.equal(contextStoreModule({}, 'file'), undefined);
        assert.equal(
            contextStoreModule(
                {
                    get contextStorage() {
                        throw new Error('no such setting');
                    },
                },
                'file',
            ),
            undefined,
        );
    });
});
