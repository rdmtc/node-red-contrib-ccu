/*
 * The connection's cache files (metadata, regadata, values) on disk.
 *
 * Written atomically: the JSON goes to a temporary file beside the target and is renamed over it,
 * so a crash or a power cut while writing leaves the old file, never a truncated one (the files
 * are read with JSON.parse at the next start, and a half-written one would throw the cache away).
 *
 * A burst of changes is written once: `DebouncedSave` collects the requests of a short window into
 * one write - at start every interface reports its device list within the same second, and before
 * there was one full rewrite and one log line per interface.
 *
 * Nothing unchanged is written: `writeJsonIfChanged` keeps a digest of what each file holds (what
 * was written, or read at start) and skips a write whose content is the same. On a CCU the names
 * are re-read every 15 minutes and every start re-sent the same device table - each of them was a
 * full rewrite on the SD card before. `lastWritten` lets the values file wait for its interval
 * across a redeploy or a restart.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** file -> {hash, ino, size, mtimeMs} of the content it holds, as far as this process knows */
const digests = new Map();

/** @param {string} text @returns {string} */
function digest(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
}

/** remembers what `file` holds now; its size and time tell a later change from outside */
function remember(file, hash) {
    try {
        const {ino, size, mtimeMs} = fs.statSync(file);
        digests.set(file, {hash, ino, size, mtimeMs});
    } catch {
        digests.delete(file);
    }
}

/** whether `file` still holds the content with this digest */
function holds(file, hash) {
    const known = digests.get(file);
    if (!known || known.hash !== hash) {
        return false;
    }

    try {
        const {ino, size, mtimeMs} = fs.statSync(file);
        return ino === known.ino && size === known.size && mtimeMs === known.mtimeMs;
    } catch {
        return false;
    }
}

/**
 * Writes `data` as JSON to `file` by way of a temporary file and a rename; an existing file's mode
 * is kept.
 * @param {string} file
 * @param {*} data
 * @param {string|number} [indent] JSON.stringify's third argument
 */
function writeJsonAtomic(file, data, indent) {
    writeTextAtomic(file, JSON.stringify(data, null, indent));
}

/**
 * Writes `text` to `file` by way of a temporary file and a rename; an existing file's mode is kept.
 * @param {string} file
 * @param {string} text
 */
function writeTextAtomic(file, text) {
    const temporary = path.join(
        path.dirname(file),
        '.' + path.basename(file) + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp',
    );
    try {
        fs.writeFileSync(temporary, text);
        // the rename replaces the inode: an existing file's mode is kept (0600 on a system that
        // made it so), a new one gets the umask's
        let mode;
        try {
            mode = fs.statSync(file).mode & 0o777;
        } catch {}

        if (mode !== undefined) {
            fs.chmodSync(temporary, mode);
        }

        fs.renameSync(temporary, file);
        remember(file, digest(text));
    } catch (error) {
        digests.delete(file);
        try {
            fs.unlinkSync(temporary);
        } catch {}

        throw error;
    }
}

/**
 * Writes `data` as JSON to `file` atomically - unless the file holds exactly that already.
 * @param {string} file
 * @param {*} data
 * @param {string|number} [indent] JSON.stringify's third argument
 * @returns {boolean} whether the file was written
 */
function writeJsonIfChanged(file, data, indent) {
    const text = JSON.stringify(data, null, indent);
    if (holds(file, digest(text))) {
        return false;
    }

    writeTextAtomic(file, text);
    return true;
}

/**
 * Reads a file and remembers its digest, so the same content is not written back.
 * @param {string} file
 * @returns {string} the file's text
 */
function readText(file) {
    const text = fs.readFileSync(file, 'utf8');
    remember(file, digest(text));
    return text;
}

class DebouncedSave {
    /**
     * @param {Function} write does the write; called once per burst
     * @param {number} [delay] the window, ms (default 1000)
     */
    constructor(write, delay = 1000) {
        this.write = write;
        this.delay = delay;
        this.timer = null;
        this.pending = false;
    }

    /** asks for a write; one write happens `delay` ms after the first request of a burst */
    request() {
        this.pending = true;
        if (this.timer) {
            return;
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.delay);
        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
    }

    /** writes now when a request is pending (close, redeploy) */
    flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (!this.pending) {
            return;
        }

        this.pending = false;
        this.write();
    }

    /** drops a pending request without writing */
    cancel() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.pending = false;
    }
}

/**
 * When `file` was last written, ms since the epoch (its modification time - a write of this
 * process or of the one before a restart), 0 when there is none.
 * @param {string} file
 * @returns {number}
 */
function lastWritten(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
}

/**
 * The module of one of Node-RED's context stores - a file store ('localfilesystem') writes the
 * connection's values to disk with every change of the global context ('memory', 'localfilesystem', ...), undefined
 * when there is no such store. `default` may name another store.
 * @param {object} settings RED.settings
 * @param {string} name
 * @returns {string|undefined}
 */
function contextStoreModule(settings, name) {
    let stores;
    try {
        stores = settings.contextStorage;
    } catch {
        return undefined;
    }

    if (!stores || !name) {
        return undefined;
    }

    const store = typeof stores[name] === 'string' ? stores[stores[name]] : stores[name];
    return store && typeof store.module === 'string' ? store.module : undefined;
}

module.exports = {writeJsonAtomic, writeJsonIfChanged, readText, lastWritten, contextStoreModule, DebouncedSave};
