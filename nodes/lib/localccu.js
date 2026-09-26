/* Detecting "Node-RED runs on the CCU itself" (B-4).

   When it does, the interface processes can be reached directly on their
   3xxxx ports (BINRPC where available) instead of going through the CCU's
   lighttpd proxy on 1999/2000/2001/2010/9292 - fewer hops, and BINRPC
   instead of XML-RPC for BidCos.

   The old test grepped /etc/lighttpd/conf.d/proxy.conf for
   `"port" => 32001`. On current firmware that file is a one-line
   `include "/var/etc/lighttpd_proxy.conf"`, which itself only includes
   proxy_normal.conf - the port markers are two levels down, so the regex
   has not matched since (verified on CCU3 firmware 3.89.8, where 31999,
   32001, 32010 and 39292 are all listening while proxy.conf says nothing
   about them). Every local install has silently been running through the
   proxy.

   Rather than chasing lighttpd's include chain, ask the kernel: a
   listener on the direct port is exactly the condition that makes using
   it correct. /proc/net/tcp is a plain file, so this stays synchronous -
   the interface table is built in the connection node's constructor.

   A listener alone misses a start before rfd: openccu-lite starts an addon
   that copes with it before the interface processes (its early start), so
   the ports are not open yet and the connection went through the proxy for
   good. The CCU's own interface list, /etc/config/InterfacesList.xml, is
   there from the first second on every CCU firmware (CCU3, OpenCCU,
   openccu-lite), so a loopback host with that file is the CCU we run on as
   well. */

const fs = require('fs');

/** rfd's direct BINRPC port on firmware >= 3.41; the marker for "on the CCU". */
const LOCAL_PROBE_PORTS = [32001, 31999];

const PROC_NET_TCP = ['/proc/net/tcp', '/proc/net/tcp6'];

/** The CCU firmware's list of its interface processes. */
const INTERFACES_LIST = '/etc/config/InterfacesList.xml';

/** /proc/net/tcp connection state 0A = TCP_LISTEN. */
const TCP_LISTEN = '0A';

/**
 * The TCP ports something is listening on, from /proc/net/tcp{,6}.
 * @param {string[]} [files] override, for tests
 * @returns {Set<number>} empty when /proc is unavailable (non-Linux)
 */
function listeningPorts(files) {
    const ports = new Set();

    (files || PROC_NET_TCP).forEach((file) => {
        let content;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            return;
        }

        content.split('\n').forEach((line) => {
            // sl  local_address rem_address st ...
            const columns = line.trim().split(/\s+/);
            if (columns.length < 4 || columns[3] !== TCP_LISTEN) {
                return;
            }

            const port = Number.parseInt(String(columns[1]).split(':')[1], 16);
            if (Number.isInteger(port)) {
                ports.add(port);
            }
        });
    });

    return ports;
}

/**
 * Are we talking to a CCU we are running on, with the direct ports open?
 * @param {string} host the configured CCU host
 * @param {object} [options]
 * @param {string[]} [options.files] /proc files to read, for tests
 * @param {string} [options.interfacesList] the CCU's interface list, for tests
 * @returns {boolean}
 */
function isLocalCcu(host, options) {
    if (!host || !(String(host).startsWith('127.') || host === 'localhost' || host === '::1')) {
        return false;
    }

    const ports = listeningPorts(options && options.files);
    if (LOCAL_PROBE_PORTS.some((port) => ports.has(port))) {
        return true;
    }

    // the interface processes are not up yet (a start before them): the
    // firmware's interface list still says this is the CCU
    return fs.existsSync((options && options.interfacesList) || INTERFACES_LIST);
}

module.exports = {isLocalCcu, listeningPorts, LOCAL_PROBE_PORTS, INTERFACES_LIST};
