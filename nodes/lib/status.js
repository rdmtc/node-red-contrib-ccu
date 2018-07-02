module.exports = (that, data) => {
    data = data || {};
    if (!that.iface) {
        if (data.ifaceStatus) {
            let status = 0;
            Object.keys(data.ifaceStatus).forEach(s => {
                if (data.ifaceStatus[s] || s === 'ReGaHSS') {
                    status += 1;
                }
            });
            if (status === 0) {
                that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
            } else if (status === Object.keys(data.ifaceStatus).length) {
                that.status({fill: 'green', shape: 'dot', text: 'connected'});
            } else {
                that.status({fill: 'yellow', shape: 'dot', text: 'partly connected'});
            }
        } else {
            that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
        }
    } else if (data.ifaceStatus && data.ifaceStatus[that.iface]) {
        that.status({fill: 'green', shape: 'dot', text: 'connected'});
    } else {
        that.status({fill: 'red', shape: 'dot', text: 'disconnected'});
    }
};
