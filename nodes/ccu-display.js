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

            function convertString(str) {
                if (!str) {
                    str = ' ';
                }
                if (typeof str !== 'string') {
                    str = String(str);
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
                    res.push(charcodes[c] || ('0x' + c.charCodeAt(0).toString(16).toUpperCase()).slice(0, 12));
                });

                return res.slice(0, 12).join(',');
            }

            this.on('input', () => {
                let payload;
                switch (config.channelType) {
                    case 'HM-Dis-WM55':
                        payload = config.led;
                        break;
                    case 'HM-Dis-EP-WM55':
                        payload = '0x02,0x0A';

                        payload += ',0x12,' + convertString(config.line1);
                        if (config.icon1) {
                            payload += ',0x13,' + config.icon1;
                        }
                        payload += ',0x0A';

                        payload += ',0x12,' + convertString(config.line2);
                        if (config.icon2) {
                            payload += ',0x13,' + config.icon2;
                        }
                        payload += ',0x0A';

                        payload += ',0x12,' + convertString(config.line3);
                        if (config.icon3) {
                            payload += ',0x13,' + config.icon3;
                        }
                        payload += ',0x0A';

                        if (config.sound) {
                            payload += ',0x14,' + config.sound + ',0x1C';
                        }

                        payload += ',' + config.repeat + ',0x1D,' + config.pause + ',0x16';

                        if (config.signal) {
                            payload += ',' + config.signal;
                        }

                        payload += ',0x03';
                        break;
                    default:
                        console.error('channelType', config.channelType, 'unknown');
                }
                this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
            });
        }

        setStatus(data) {
            statusHelper(this, data);
        }
    }

    RED.nodes.registerType('ccu-display', CcuDisplay);
};
