/* Replaces the buffer-base62 dependency (which pulled in big-number,
   buffer-reverse and underscore). BigInt implementation, byte-for-byte
   identical output: big-endian buffer value, alphabet 0-9A-Za-z. */

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function toBase62(buffer) {
    let n = 0n;
    for (const byte of buffer) {
        n = n * 256n + BigInt(byte);
    }

    let out = '';
    do {
        out = alphabet[Number(n % 62n)] + out;
        n /= 62n;
    } while (n > 0n);

    return out;
}

module.exports = {toBase62};
