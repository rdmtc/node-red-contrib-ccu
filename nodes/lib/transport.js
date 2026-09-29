/* TLS and authentication for the connections to the CCU (task 5, #27).

   Both belong to the CCU's web server, which fronts the interface processes
   for the LAN: XML-RPC on 2000/2001/2010/9292 in plain text and on
   42000/42001/42010/49292 over TLS, the ReGaHSS on 8181 and 48181 - a CCU3
   switches them on in its firewall settings, openccu-lite on its remote
   access page ("classic RPC"). The processes themselves listen on the
   loopback (31999, 32000, 32001, 32010, 39292) with neither. Hence:

   - a local connection (Node-RED on the CCU) reaches the processes directly,
     so TLS and credentials are not used whatever the dialog says: https to a
     plain port or credentials in a BIN-RPC frame only break the connection;
   - BIN-RPC has neither. With TLS on, BidCos-RF goes XML-RPC over TLS even
     when BIN-RPC was asked for (the hidden `bcrfBinRpc` property); with
     authentication and without TLS the option stays, and a warning says the
     CCU will refuse it;
   - CUxD (BIN-RPC on 8701) has neither, on any connection;
   - the callback server Node-RED runs for the CCU's events stays plain: the
     CCU presents no credentials and cannot verify our certificate.

   Pure: the connection node feeds it the config and logs the notes. */

/**
 * @typedef {object} Transport
 * @property {boolean} tls the XML-RPC and ReGa clients use TLS (the 4xxxx ports)
 * @property {boolean} auth the clients send the username and password (HTTP basic)
 * @property {boolean} inSecure invalid certificates are accepted (only with tls)
 * @property {boolean} bcrfBinRpc BidCos-RF goes over BIN-RPC on a remote connection
 * @property {Array<{level: 'info'|'warn', message: string}>} notes what to log once
 */

/**
 * @param {object} config
 * @param {boolean} config.isLocal Node-RED runs on the CCU (lib/localccu.js)
 * @param {boolean} [config.tls]
 * @param {boolean} [config.authentication]
 * @param {boolean} [config.inSecure]
 * @param {boolean} [config.bcrfBinRpc]
 * @returns {Transport}
 */
function resolveTransport({isLocal, tls, authentication, inSecure, bcrfBinRpc}) {
    const notes = [];

    if (isLocal) {
        if (tls || authentication) {
            notes.push({
                level: 'info',
                message:
                    'local connection: TLS and authentication are not used, the interface processes are reached directly',
            });
        }

        return {tls: false, auth: false, inSecure: false, bcrfBinRpc: false, notes};
    }

    const useTls = Boolean(tls);
    const useAuth = Boolean(authentication);
    let binRpc = Boolean(bcrfBinRpc);

    if (binRpc && useTls) {
        binRpc = false;
        notes.push({
            level: 'warn',
            message: 'BidCos-RF: BIN-RPC has no TLS - using XML-RPC over TLS (port 42001) instead',
        });
    } else if (binRpc && useAuth) {
        notes.push({
            level: 'warn',
            message: 'BidCos-RF: BIN-RPC carries no credentials - the CCU refuses it while authentication is on',
        });
    }

    if (useAuth && !useTls) {
        notes.push({level: 'warn', message: 'authentication without TLS: the credentials are sent in plain text'});
    }

    return {tls: useTls, auth: useAuth, inSecure: useTls && Boolean(inSecure), bcrfBinRpc: binRpc, notes};
}

module.exports = {resolveTransport};
