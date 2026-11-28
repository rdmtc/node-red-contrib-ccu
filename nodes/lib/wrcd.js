/* The HmIP-WRCD's display command (#144), pure: no connection, no Node-RED.

   Channel 3 (ACOUSTIC_DISPLAY_RECEIVER) takes the five lines of the display and a
   sound in one write of COMBINED_PARAMETER - a block in braces per line, the commit
   in the last one, then a block for the sound:

     {DDBC=WHITE,DDTC=BLACK,DDI=2,DDA=CENTER,DDS=Kitchen,DDID=1},
     {DDBC=WHITE,DDTC=BLACK,DDI=0,DDA=LEFT,DDS=21.5 C,DDID=2,DDC=true},{R=1,IN=5,ANS=6}

   DDBC/DDTC = background and text colour, DDI = the icon's number, DDA = alignment,
   DDS = the text, DDID = the line, DDC = commit; R = repetitions, IN = seconds between
   them, ANS = the sound's number. It is the text the CCU's own program dialog writes;
   the entries are those of the channel's description (DISPLAY_DATA_ICON,
   ACOUSTIC_NOTIFICATION_SELECTION). */

const LINES = 5;
const TEXT_LENGTH = 16;

/** DISPLAY_DATA_ICON's entries; the number sent is the index */
const ICONS = [
    'NO_ICON',
    'LAMP_OFF',
    'LAMP_ON',
    'PADLOCK_OPEN',
    'PADLOCK_CLOSED',
    'ERROR',
    'EVERYTHING_OKAY',
    'INFORMATION',
    'NEW_MESSAGE',
    'SERVICE_MESSAGE',
    'SUN',
    'MOON',
    'WIND',
    'CLOUD',
    'THUNDERSTORM',
    'DRIZZLE',
    'CLOUD_AND_MOOON',
    'RAIN',
    'SNOW',
    'CLOUD_AND_SUN',
    'CLOUD_SUN_AND_RAIN',
    'SNOWFLAKE',
    'RAINDROP',
    'FLAME',
    'WINDOW_OPEN',
    'SHUTTERS',
    'ECO',
    'PROTECTION_DEACTIVATED',
    'EXTERNAL_PROTECTION',
    'INTERNAL_PROTECTION',
    'BELL',
    'CLOCK',
];

/** ACOUSTIC_NOTIFICATION_SELECTION's entries; the number sent is the index */
const SOUNDS = [
    'LOW_BATTERY',
    'DISARMED',
    'INTERNALLY_ARMED',
    'EXTERNALLY_ARMED',
    'DELAYED_INTERNALLY_ARMED',
    'DELAYED_EXTERNALLY_ARMED',
    'EVENT',
    'ERROR',
];

const ALIGNMENTS = {
    LEFT: 'LEFT',
    LINKS: 'LEFT',
    CENTER: 'CENTER',
    CENTRE: 'CENTER',
    MITTE: 'CENTER',
    ZENTRIERT: 'CENTER',
    RIGHT: 'RIGHT',
    RECHTS: 'RIGHT',
};

const COLORS = {
    WHITE: 'WHITE',
    WEISS: 'WHITE',
    WEIß: 'WHITE',
    BLACK: 'BLACK',
    SCHWARZ: 'BLACK',
};

/** the display's stand-ins for the characters its table has in other places */
const CHARACTERS = {
    Ä: '[',
    Ö: '#',
    Ü: '$',
    ä: '²',
    ö: '|',
    ü: '³',
    ß: '_',
    '&': ']',
    "'": 'µ',
    // the command's own punctuation cannot be part of a text
    ',': '.',
    '=': ':',
    '{': '(',
    '}': ')',
};

/** the stand-ins as text would otherwise show them: the characters they displace */
const DISPLACED = new Set(['[', ']', '#', '$', '|', '_']);

/**
 * A line's text as the display takes it: sixteen characters of its table.
 * @param {*} text
 * @returns {string}
 */
function wrcdText(text) {
    let out = '';
    for (const c of String(text === undefined || text === null ? '' : text)) {
        if (CHARACTERS[c]) {
            out += CHARACTERS[c];
        } else if (c >= ' ' && c <= '~' && !DISPLACED.has(c)) {
            out += c;
        }
    }

    return out.slice(0, TEXT_LENGTH);
}

/**
 * An entry's number from a number, a number as text or a name.
 * @param {*} value
 * @param {string[]} entries
 * @returns {number} -1 = none of them
 */
function entryIndex(value, entries) {
    if (value === undefined || value === null || value === '') {
        return -1;
    }

    const text = String(value).trim();
    const index = /^\d+$/.test(text) ? Number(text) : entries.indexOf(text.toUpperCase().replace(/[\s-]+/g, '_'));
    return index >= 0 && index < entries.length ? index : -1;
}

function clamp(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (Number.isNaN(number)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, number));
}

/**
 * The COMBINED_PARAMETER text of one message.
 * @param {object} lines per line (1 to 5) what to show: `{text, icon, align, color, background}`;
 *     a line that is missing stays as it is on the display
 * @param {object} [sound] `{sound, repeat, interval}`; without a sound nothing is played
 * @returns {string} empty when there is neither a line nor a sound
 */
function wrcdCommand(lines, sound) {
    const blocks = [];
    for (let i = 1; i <= LINES; i++) {
        const line = lines && lines[i];
        if (!line) {
            continue;
        }

        const upper = (value) => String(value === undefined || value === null ? '' : value).toUpperCase();
        blocks.push(
            [
                'DDBC=' + (COLORS[upper(line.background).trim()] || 'WHITE'),
                'DDTC=' + (COLORS[upper(line.color).trim()] || 'BLACK'),
                'DDI=' + Math.max(0, entryIndex(line.icon, ICONS)),
                'DDA=' + (ALIGNMENTS[upper(line.align).trim()] || 'CENTER'),
                'DDS=' + wrcdText(line.text),
                'DDID=' + i,
            ].join(','),
        );
    }

    if (blocks.length > 0) {
        blocks[blocks.length - 1] += ',DDC=true';
    }

    const number = sound ? entryIndex(sound.sound, SOUNDS) : -1;
    if (number !== -1) {
        blocks.push(
            [
                'R=' + clamp(sound.repeat, 0, 15, 0),
                // seconds, in the steps of five the CCU's dialog offers
                'IN=' + Math.round(clamp(sound.interval, 5, 80, 5) / 5) * 5,
                'ANS=' + number,
            ].join(','),
        );
    }

    return blocks.map((block) => '{' + block + '}').join(',');
}

module.exports = {ICONS, SOUNDS, LINES, TEXT_LENGTH, wrcdText, wrcdCommand};
