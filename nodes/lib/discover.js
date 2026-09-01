/* Vendored from https://github.com/hobbyquaker/hm-discover (MIT, same
   author), rewritten without the abandoned `binary` and `async`
   dependencies. Sends the eQ-3 UDP broadcast discovery datagram and
   probes the known interface ports on every responding CCU. */

const net = require('net');
const dgram = require('dgram');

const SERVICE_PORTS = {
    ReGaHSS: 1999,
    'BidCos-Wired': 2000,
    'BidCos-RF': 2001,
    'HmIP-RF': 2010,
    VirtualDevices: 9292,
    CUxD: 8701,
    'CCU-Jack': 2121,
};

function checkService(host, port) {
    return new Promise((resolve) => {
        const c = net.connect({port, host, timeout: 1200}, () => {
            resolve(true);
            c.end();
        });
        c.on('timeout', () => {
            resolve(false);
            c.destroy();
        });
        c.on('error', () => {
            resolve(false);
        });
    });
}

/* Response layout: 5-byte header 02 8f 91 c0 01, then NUL-terminated
   type, NUL-terminated serial, 3 bytes, NUL-terminated version. */
function parseResponse(message) {
    if (message.length < 5 || message.slice(0, 5).toString('hex') !== '028f91c001') {
        return null;
    }

    let offset = 5;
    const readString = () => {
        const end = message.indexOf(0, offset);
        if (end === -1) {
            return null;
        }

        const string = message.slice(offset, end).toString();
        offset = end + 1;
        return string;
    };

    const type = readString();
    const serial = readString();
    offset += 3;
    const version = readString();

    if (type === null || serial === null || version === null) {
        return null;
    }

    return {type, serial, version};
}

function hmDiscover(options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    } else if (typeof options !== 'object' || options === null) {
        options = {};
    }

    const timeout = options.timeout || 1200;
    const remoteport = 43439;
    // Kept verbatim from hm-discover — Buffer.from() coerces the string
    // elements to 0x00, and that is the datagram CCUs answer to.
    const message = Buffer.from([0x02, 0x8f, 0x91, 0xc0, 0x01, 'e', 'Q', '3', 0x2d, 0x2a, 0x00, 0x2a, 0x00, 0x49]);
    const found = [];
    const foundAddresses = [];
    const client = dgram.createSocket('udp4');

    client.on('error', () => {
        /* ignore — discovery is best-effort; an unhandled 'error' event
           would crash the whole process */
    });

    client.on('message', (msg, remote) => {
        const parsed = parseResponse(msg);
        if (!parsed || foundAddresses.includes(remote.address)) {
            return;
        }

        foundAddresses.push(remote.address);
        const device = {
            type: parsed.type,
            serial: parsed.serial,
            version: parsed.version,
            address: remote.address,
        };

        Promise.all(
            Object.keys(SERVICE_PORTS).map((name) =>
                checkService(remote.address, SERVICE_PORTS[name]).then((ok) => [name, ok]),
            ),
        ).then((entries) => {
            const interfaces = {};
            entries.forEach(([name, ok]) => {
                interfaces[name] = ok;
            });
            device.interfaces = interfaces;
            found.push(device);
        });
    });

    client.bind(() => {
        client.setBroadcast(true);
        client.send(message, 0, message.length, remoteport, '255.255.255.255');
    });

    setTimeout(() => {
        client.close();
        callback(found);
    }, timeout);
}

module.exports = hmDiscover;
