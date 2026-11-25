const WAITING = {fill: 'yellow', shape: 'ring', text: 'waiting'};

module.exports = (that, data) => {
    data = data || {};
    // task 11: an interface whose process does not answer yet is retried; the
    // nodes show "waiting" (yellow ring) for it instead of "disconnected"
    const waiting = data.ifaceWaiting || {};
    // B-44: an interface the connection cannot reach for a reason the user has to fix (the
    // openccu-lite token lacks a scope) shows that reason instead of "disconnected"
    const errors = data.ifaceError || {};
    const error = (text) => ({fill: 'red', shape: 'ring', text});
    if (!that.iface) {
        if (data.ifaceStatus) {
            let status = 0;
            Object.keys(data.ifaceStatus).forEach((s) => {
                if (data.ifaceStatus[s]) {
                    status += 1;
                }
            });
            if (status < 1) {
                const failed = Object.keys(errors).find((s) => errors[s]);
                if (failed) {
                    that.status(error(errors[failed]));
                    that.currentStatus = 'error';
                } else if (Object.keys(waiting).some((s) => waiting[s])) {
                    that.status(WAITING);
                    that.currentStatus = 'waiting';
                } else {
                    that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
                    that.currentStatus = 'red';
                }
            } else if (status === Object.keys(data.ifaceStatus).length) {
                if (that.currentStatus !== 'green') {
                    that.status({fill: 'green', shape: 'dot', text: 'connected'});
                    that.currentStatus = 'green';
                }
            } else {
                const failed = Object.keys(errors).find((s) => errors[s] && !data.ifaceStatus[s]);
                that.status({
                    fill: 'yellow',
                    shape: 'dot',
                    text: failed ? 'partly connected: ' + errors[failed] : 'partly connected',
                });
                that.currentStatus = 'yellow';
            }
        } else {
            that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
            that.currentStatus = 'red';
        }
    } else if (data.ifaceStatus && data.ifaceStatus[that.iface]) {
        if (that.currentStatus !== 'green') {
            that.status({fill: 'green', shape: 'dot', text: 'connected'});
            that.currentStatus = 'green';
        }
    } else if (errors[that.iface]) {
        that.status(error(errors[that.iface]));
        that.currentStatus = 'error';
    } else if (waiting[that.iface]) {
        that.status(WAITING);
        that.currentStatus = 'waiting';
    } else {
        that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
        that.currentStatus = 'red';
    }
};

/**
 * task 32: the status of a node of system variables or programs (sysvar, program, poll): on a CCU
 * the ReGaHSS's, on openccu-lite the Logic interface's - or why there is none (the addon is not
 * installed, the connection does not use lite-rpc).
 * @param {object} that the node; `that.ccu.sysvarSource()` decides
 * @param {object} data what the connection pushes
 */
module.exports.sysvar = (that, data) => {
    const source = that.ccu && typeof that.ccu.sysvarSource === 'function' ? that.ccu.sysvarSource() : {};
    if (source.iface) {
        that.iface = source.iface;
    }

    if (source.error) {
        if (that.currentStatus !== 'error:' + source.error) {
            that.status({fill: 'red', shape: 'ring', text: source.error});
            that.currentStatus = 'error:' + source.error;
        }

        return;
    }

    if (source.waiting) {
        that.status(WAITING);
        that.currentStatus = 'waiting';
        return;
    }

    module.exports(that, data);
};
