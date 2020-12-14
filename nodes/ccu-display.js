const path = require('path');

const statusHelper = require(path.join(__dirname, '/lib/status.js'));

module.exports = function (RED) {
    class CcuDisplay {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            this.iface = config.iface;

            this.ccu.register(this);

            function convertColor(col) {
                col = String(col).toLowerCase();
                const map = {
                    weiss: '0x80',
                    weiß: '0x80',
                    white: '0x80',
                    rot: '0x81',
                    red: '0x81',
                    orange: '0x82',
                    gelb: '0x83',
                    yellow: '0x83',
                    gruen: '0x84',
                    grün: '0x84',
                    green: '0x84',
                    blue: '0x85'
                };

                if (map[col]) {
                    col = map[col];
                }

                if (!['0x80', '0x81', '0x82', '0x83', '0x84', '0x85'].includes(col)) {
                    col = '0x80';
                }

                return ',0x11,' + col;
            }

            function convertIcon(ico) {
                ico = String(ico).toLowerCase();
                const map = {
                    aus: '0x80',
                    off: '0x80',
                    ein: '0x81',
                    an: '0x81',
                    on: '0x81',
                    offen: '0x82',
                    geoeffnet: '0x82',
                    geöffnet: '0x82',
                    open: '0x82',
                    geschlossen: '0x83',
                    zu: '0x83',
                    closed: '0x83',
                    fehler: '0x84',
                    error: '0x84',
                    ok: '0x85',
                    information: '0x86',
                    'neue nachricht': '0x87',
                    nachricht: '0x87',
                    message: '0x87',
                    servicemeldung: '0x88',
                    servicemessage: '0x88',
                    'service message': '0x88',
                    grün: '0x89',
                    signalgrün: '0x89',
                    'signal grün': '0x89',
                    green: '0x89',
                    signalgreen: '0x89',
                    'signal green': '0x89',
                    gelb: '0x8A',
                    signalgelb: '0x8A',
                    'signal gelb': '0x8A',
                    yellow: '0x8A',
                    signalyellow: '0x8A',
                    'signal yellow': '0x8A',
                    rot: '0x8B',
                    signalrot: '0x8B',
                    'signal rot': '0x8B',
                    red: '0x8B',
                    signalred: '0x8B',
                    'signal red': '0x8B'
                };

                if (map[ico]) {
                    ico = map[ico];
                }

                if (!['0x80', '0x81', '0x82', '0x83', '0x84', '0x85', '0x86', '0x87', '0x88', '0x89', '0x8a', '0x8b'].includes(ico)) {
                    ico = '';
                }

                return ico ? (',0x13,' + ico) : '';
            }

            function convertString(string) {
                if (typeof string !== 'string') {
                    string = String(string);
                }

                if (!string) {
                    string = ' ';
                }

                const charcodes = {
                    Ä: '0x5B',
                    Ö: '0x23',
                    Ü: '0x24',
                    ä: '0x7B',
                    ö: '0x7C',
                    ü: '0x7D',
                    ß: '0x5F'
                };
                const res = [];
                string.split('').forEach(c => {
                    res.push(charcodes[c] || ('0x' + c.charCodeAt(0).toString(16).toUpperCase()));
                });

                return ',0x12,' + res.slice(0, 12).join(',');
            }

            this.on('input', (message, send, done) => {
                let payload = '0x02';

                let countLines = 6; // HM-Dis-WM55
                if (config.channelType === 'HM-Dis-EP-WM55') {
                    payload += ',0x0A';
                    countLines = 3;
                }

                for (let i = 1; i <= countLines; i++) {
                    if (!message['disable' + i] && !config['disable' + i]) {
                        payload += convertString(message['line' + i] || config['line' + i]);
                        if (config.channelType === 'HM-Dis-WM55') {
                            payload += convertColor(message['color' + i] || config['color' + i]);
                        }

                        payload += convertIcon(message['icon' + i] || config['icon' + i]);
                    }

                    payload += ',0x0A';
                }

                if (config.channelType === 'HM-Dis-EP-WM55') {
                    if (config.sound) {
                        payload += ',0x14,' + config.sound + ',0x1C';
                    }

                    payload += ',' + config.repeat + ',0x1D,' + config.pause + ',0x16';

                    if (config.signal) {
                        payload += ',' + config.signal;
                    }
                }

                payload += ',0x03';

                this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload)
                    .then(() => {
                        done();
                    }).catch(error => {
                        done(error);
                    });
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-display', CcuDisplay);
};
