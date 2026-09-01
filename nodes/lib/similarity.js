/* Replaces the deprecated string-similarity package. Same algorithm as its
   compareTwoStrings: Sørensen–Dice coefficient on bigram multisets, with
   whitespace stripped first. */

function compareTwoStrings(first, second) {
    first = first.replace(/\s+/g, '');
    second = second.replace(/\s+/g, '');

    if (first === second) {
        return 1;
    }

    if (first.length < 2 || second.length < 2) {
        return 0;
    }

    const firstBigrams = new Map();
    for (let i = 0; i < first.length - 1; i++) {
        const bigram = first.substring(i, i + 2);
        firstBigrams.set(bigram, (firstBigrams.get(bigram) || 0) + 1);
    }

    let intersectionSize = 0;
    for (let i = 0; i < second.length - 1; i++) {
        const bigram = second.substring(i, i + 2);
        const count = firstBigrams.get(bigram) || 0;
        if (count > 0) {
            firstBigrams.set(bigram, count - 1);
            intersectionSize++;
        }
    }

    return (2 * intersectionSize) / (first.length + second.length - 2);
}

function bestMatch(mainString, targetStrings) {
    let best = targetStrings[0];
    let bestRating = -1;

    for (const target of targetStrings) {
        const rating = compareTwoStrings(mainString, target);
        if (rating > bestRating) {
            bestRating = rating;
            best = target;
        }
    }

    return best;
}

module.exports = {compareTwoStrings, bestMatch};
