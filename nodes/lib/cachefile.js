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
 */

const fs = require('fs');
const path = require('path');

/**
 * Writes `data` as JSON to `file` by way of a temporary file and a rename; an existing file's mode
 * is kept.
 * @param {string} file
 * @param {*} data
 * @param {string|number} [indent] JSON.stringify's third argument
 */
function writeJsonAtomic(file, data, indent) {
    const temporary = path.join(
        path.dirname(file),
        '.' + path.basename(file) + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp',
    );
    try {
        fs.writeFileSync(temporary, JSON.stringify(data, null, indent));
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
    } catch (error) {
        try {
            fs.unlinkSync(temporary);
        } catch {}

        throw error;
    }
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

module.exports = {writeJsonAtomic, DebouncedSave};
