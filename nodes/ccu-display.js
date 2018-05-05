module.exports = function (RED) {
    class CcuDisplay {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.ccu = RED.nodes.getNode(config.ccuConfig);

            if (!this.ccu) {
                return;
            }

            const $nodeInputCcuConfig = $('#node-input-ccu-config');

            let data;

            function loadConfig() {
                const nodeId = $nodeInputCcuConfig.val();
                const url = 'ccu?config=' + nodeId;
                console.log('get ' + url);
                $.getJSON(url, d => {
                    data = d;
                    console.log(data);
                });
            }

            $nodeInputCcuConfig.change(loadConfig);



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
                console.log(config);
                let payload;
                switch (config.channelType) {
                    case 'SIGNAL_CHIME':
                        payload = config.chime;
                        break;
                    case 'SIGNAL_LED':
                        payload = config.led;
                        break;
                    case 'KEY':
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

                        if (config.signal) {
                            payload += ',' + config.signal;
                        }

                        payload += ',0x03';
                        break;
                    default:
                        console.error('channelType', config.channelType, 'unknown');
                }
                console.log(payload);
                this.ccu.setValue(config.iface, config.channel, 'SUBMIT', payload);
            });
        }
    }

    RED.nodes.registerType('ccu-display', CcuDisplay);
};
