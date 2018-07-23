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
                if (['0x80', '0x81', '0x82', '0x83', '0x84', '0x85'].indexOf(col) === -1) {
                    col = '0x80';
                }
                return col;
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
                    'service message': '0x88'
                };

                if (map[ico]) {
                    col = map[ico];
                }
                if ([].indexOf(ico) === -1) {
                    ico = '';
                }
                return ico;
            }

            function convertString(str) {
                if (typeof str !== 'string') {
                    str = String(str);
                }
                if (!str) {
                    str = ' ';
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
                str.split('').forEach(c => {
                    res.push(charcodes[c] || ('0x' + c.charCodeAt(0).toString(16).toUpperCase()));
                });

                return res.slice(0, 12).join(',');
            }

            this.on('input', () => {
                let payload = '0x02';

                if (config.channelType === 'Hm-Dis-EP-WM55') {
                    payload += ',0x0A';
                }

                payload += ',0x12,' + convertString(msg.line1 || config.line1);
                if (config.channelType === 'HM-Dis-WM55') {
                    payload += ',0x11,' + convertColor(msg.color1 || config.color1);
                }
                if (config.icon1) {
                    payload += ',0x13,' + convertIcon(msg.icon1 || config.icon1);
                }
                payload += ',0x0A';

                payload += ',0x12,' + convertString(msg.line2 || config.line2);
                if (config.channelType === 'HM-Dis-WM55') {
                    payload += ',0x11,' + convertColor(msg.color2 || config.color2);
                }
                if (config.icon2) {
                    payload += ',0x13,' + convertIcon(msg.icon2 || config.icon2);
                }
                payload += ',0x0A';

                payload += ',0x12,' + convertString(msg.line3 || config.line3);
                if (config.channelType === 'HM-Dis-WM55') {
                    payload += ',0x11,' + convertColor(msg.color3 || config.color3);
                }
                if (config.icon3) {
                    payload += ',0x13,' + convertIcon(msg.icon3 || config.icon3);
                }
                payload += ',0x0A';

                if (config.channelType === 'HM-Dis-WM55') {
                    payload += ',0x12,' + convertString(msg.line4 || config.line4);
                    payload += ',0x11,' + convertColor(msg.color4 || config.color4);
                    if (config.icon4) {
                        payload += ',0x13,' + convertIcon(msg.icon4 || config.icon4);
                    }
                    payload += ',0x0A';

                    payload += ',0x12,' + convertString(msg.line5 || config.line5);
                    payload += ',0x11,' + convertColor(msg.color5 || config.color5);
                    if (config.icon5) {
                        payload += ',0x13,' + convertIcon(msg.icon5 || config.icon5);
                    }
                    payload += ',0x0A';

                    payload += ',0x12,' + convertString(msg.line6 || config.line6);
                    payload += ',0x11,' + convertColor(msg.color6 || config.color6);
                    if (config.icon6) {
                        payload += ',0x13,' + convertIcon(msg.icon6 || config.icon6);
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

                this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-display', CcuDisplay);
};
