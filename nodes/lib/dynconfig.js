/* Per-message dynamic node configuration (B-2, issues #172 #71 #103 #80
   #56 #148 #133).

   The old inline implementation in ccu-set-value wrote message properties
   into the node's own `config` object, so only the *first* message ever
   configured the node: every later message hit the `if (!config[key])`
   guard, was ignored, and the node kept acting on the first message's
   filter (#133). These helpers build an *effective* configuration per
   message instead and never touch the stored one. */

/**
 * Merge message properties over a node's stored configuration.
 *
 * A key is taken from the message when the message carries it (`key in
 * message`, so an explicit `null`/`0`/`''` counts) and the node's own
 * value is empty. Configured values win — the editor stays the primary
 * source, the message fills the blanks — which is the behaviour flows
 * have relied on since the feature was introduced.
 *
 * @param {object} config the node's stored configuration (never mutated)
 * @param {object} message the incoming message
 * @param {string[]} keys the keys that may be overridden
 * @returns {{config: object, dynamic: boolean}} effective config plus
 *          whether any key actually came from the message
 */
function effectiveConfig(config, message, keys) {
    const effective = {...config};
    let dynamic = false;

    if (message && typeof message === 'object') {
        keys.forEach((key) => {
            if (!effective[key] && key in message) {
                effective[key] = message[key];
                dynamic = true;
            }
        });
    }

    return {config: effective, dynamic};
}

/**
 * A stable identity for a set of configuration keys, used to decide
 * whether a cache derived from them is still valid. Two effective configs
 * that produce the same key select the same devices/datapoints.
 * @param {object} config
 * @param {string[]} keys
 * @returns {string}
 */
function configCacheKey(config, keys) {
    return keys.map((key) => JSON.stringify(config[key] === undefined ? null : config[key])).join('\u0000');
}

module.exports = {effectiveConfig, configCacheKey};
