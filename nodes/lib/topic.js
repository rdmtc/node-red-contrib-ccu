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

module.exports = {topicReplace};
