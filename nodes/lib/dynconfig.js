/* Per-message dynamic node configuration (B-2, issues #172 #71 #103 #80
   #56 #148 #133).

   Two mechanisms, in increasing precedence:

   1. Flat properties (`msg.channel`, `msg.rooms`, ...). Long-standing
      behaviour of ccu-set-value/ccu-value/ccu-get-value: they fill in
      configuration the node itself leaves empty. Kept as-is because
      messages coming straight from an event node carry exactly these
      names, which is what makes it convenient - and, for the same
      reason, only ever used for the nodes that already did it.
   2. `msg.config`, an object of overrides. Always wins, works for every
      configurable field including lists, and cannot collide with the
      properties an event message carries (`msg.ccu` is the CCU host, so
      it is not available as a namespace). This is what makes the
      settings of the signal/display/switch/sysvar nodes reachable from
      a flow.

   The old inline implementation in ccu-set-value wrote message
   properties into the node's own `config` object, so only the *first*
   message ever configured the node: every later message hit the
   `if (!config[key])` guard and was ignored (#133). Nothing here mutates
   the stored configuration. */

/**
 * Build the effective configuration for one message.
 *
 * @param {object} config the node's stored configuration (never mutated)
 * @param {object} message the incoming message
 * @param {string[]} keys the keys that may be overridden; anything else
 *        in `msg.config` is ignored, so a stray property cannot reach
 *        node internals
 * @param {object} [options]
 * @param {boolean} [options.flat=false] also fill empty keys from
 *        top-level message properties (mechanism 1)
 * @returns {{config: object, dynamic: boolean}} effective config plus
 *          whether anything actually came from the message
 */
function effectiveConfig(config, message, keys, options) {
    const effective = {...config};
    let dynamic = false;

    if (!message || typeof message !== 'object') {
        return {config: effective, dynamic};
    }

    if (options && options.flat) {
        keys.forEach((key) => {
            if (!effective[key] && key in message) {
                effective[key] = message[key];
                dynamic = true;
            }
        });
    }

    const overrides = message.config;
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
        keys.forEach((key) => {
            if (key in overrides) {
                effective[key] = overrides[key];
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
    return keys.map((key) => JSON.stringify(config[key] === undefined ? null : config[key])).join(' ');
}

module.exports = {effectiveConfig, configCacheKey};
