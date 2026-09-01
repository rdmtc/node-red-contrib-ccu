/* Vendored from https://github.com/hobbyquaker/nextport (MIT, same author).
   Finds the next free TCP port at or above the given port. */

const net = require('net');

function nextport(port, address, cb) {
    if (typeof address === 'function') {
        cb = address;
        address = '0.0.0.0';
    }

    const server = net.createServer();
    server.on('listening', () => {
        server.close();
    });
    server.on('close', () => {
        cb(port);
    });
    server.on('error', () => {
        port += 1;
        if (port <= 65535) {
            nextport(port, address, cb);
        } else {
            cb(null);
        }
    });
    server.listen(port, address);
}

module.exports = nextport;
