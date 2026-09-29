/* Pure ${placeholder} replacement for node topics, extracted unchanged
   from ccu-connection.js topicReplace (Phase 3). Placeholders are matched
   case-insensitively against the message properties; ${Interface} is an
   alias for the iface property; unknown placeholders become ''. */

/**
 * @param {string} topic topic template, e.g. '${CCU}/${Interface}/${channel}/${datapoint}'
 * @param {object} message source of the placeholder values
 * @returns {string}
 */
function topicReplace(topic, message) {
    if (!topic || typeof message !== 'object') {
        return topic;
    }

    const messageLower = {};
    Object.keys(message).forEach((k) => {
        messageLower[k.toLowerCase()] = message[k];
    });

    const match = topic.match(/\${[^}]+}/g);
    if (match) {
        match.forEach((v) => {
            const key = v.substr(2, v.length - 3);
            const rx = new RegExp('\\${' + key + '}', 'g');
            let rkey = key.toLowerCase();
            if (rkey === 'interface') {
                rkey = 'iface';
            }

            topic = topic.replace(rx, typeof messageLower[rkey] === 'undefined' ? '' : messageLower[rkey]);
        });
    }

    return topic;
}

/**
 * The datapoint address in an incoming msg.topic (task 6, #39). Two shapes:
 * the value node's old input form `iface.channel.datapoint` (dots), and the
 * shape the nodes emit by default, `${CCU}/${Interface}/${channel}/${datapoint}`
 * or without the CCU part - with slashes, the last three segments count, so
 * an event's topic can be fed straight back into a value node.
 * @param {string} topic
 * @returns {{iface: string|undefined, channel: string|undefined, datapoint: string|undefined}}
 */
function parseTopicAddress(topic) {
    const text = typeof topic === 'string' ? topic : '';
    if (text.includes('/')) {
        const parts = text.split('/').filter((part) => part !== '');
        const [iface, channel, datapoint] = parts.slice(-3);
        return parts.length >= 3 ? {iface, channel, datapoint} : {};
    }

    const [iface, channel, datapoint] = text.split('.');
    return {iface, channel, datapoint};
}

module.exports = {topicReplace, parseTopicAddress};
