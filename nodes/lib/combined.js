/* COMBINED_PARAMETER mapping for HmIP actuators (B-14, issues #136 #154
   #175): HmIP blind/shutter actuators accept but ignore a lone LEVEL_2
   (slat position) write — the CCU itself writes the COMBINED_PARAMETER
   datapoint instead, as comma-separated shortcut=value pairs in percent
   (e.g. `L2=50`, `L2=50,L=80`). A lone `L2=<pct>` changes the slats and
   leaves the height untouched (confirmed working in #154; the WebUI's
   `L=101` "unchanged" marker does not work). */

const SHORTCUTS = {
    LEVEL_2: 'L2',
};

/**
 * Returns the COMBINED_PARAMETER string for a datapoint write that must be
 * remapped, or null when the write should go out unchanged.
 * @param {string} datapoint
 * @param {*} value native datapoint scale (LEVEL_2: 0..1)
 * @param {object} [valuesDescription] the channel's VALUES paramset description
 * @returns {string|null} e.g. 'L2=50'
 */
function combinedParameterValue(datapoint, value, valuesDescription) {
    const shortcut = SHORTCUTS[datapoint];
    if (!shortcut || !valuesDescription || !valuesDescription.COMBINED_PARAMETER) {
        return null;
    }

    const pct = Math.round(Number.parseFloat(value) * 100);
    if (!Number.isFinite(pct)) {
        return null;
    }

    return shortcut + '=' + pct;
}

module.exports = {combinedParameterValue};
