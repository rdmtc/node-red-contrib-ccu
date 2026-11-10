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
