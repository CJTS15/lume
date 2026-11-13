// SPDX-License-Identifier: GPL-3.0-or-later
//
// Text matching shared by providers. No gi:// imports, so tests run under
// plain gjs.

const SEPARATOR = /[\s\-_.]/;

/**
 * How well `needle` matches `haystack`, from 0 (no match) to 1.
 *
 * Exact > prefix > word prefix > substring > word initials > subsequence
 * ("frfx" matches "Firefox"). Comparison ignores case.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
export function matchScore(haystack, needle) {
    const h = haystack.toLowerCase();
    const n = needle.toLowerCase();
    if (!n || !h)
        return 0;

    if (h === n)
        return 1;
    if (h.startsWith(n))
        return 0.9;

    const index = h.indexOf(n);
    if (index > 0) {
        // A match right after a separator ("visual studio" + "stu") reads as
        // a word prefix.
        return SEPARATOR.test(h[index - 1]) ? 0.8 : 0.6;
    }

    // Subsequence: every needle character, in order.
    let pos = 0;
    for (const ch of n) {
        pos = h.indexOf(ch, pos);
        if (pos < 0)
            return 0;
        pos++;
    }

    // Word initials ("vsc" for "Visual Studio Code") rank above other
    // subsequences.
    const initials = h.split(SEPARATOR).filter(w => w).map(w => w[0]).join('');
    return initials.startsWith(n) ? 0.4 : 0.3;
}

/** Lowest matchScore each fuzziness level accepts. */
export const FUZZY_MIN_SCORE = {
    strict: 0.8, // prefix or word prefix
    normal: 0.6, // also any substring
    loose: 0.3, // also characters left out in between
};

/**
 * matchScore, or 0 when it is below what `level` accepts.
 *
 * @param {string} haystack
 * @param {string} needle
 * @param {string} level - a key of FUZZY_MIN_SCORE; unknown means normal
 * @returns {number}
 */
export function fuzzyScore(haystack, needle, level) {
    const score = matchScore(haystack, needle);
    return score >= (FUZZY_MIN_SCORE[level] ?? FUZZY_MIN_SCORE.normal) ? score : 0;
}

/**
 * How well a query describes something with a name and keywords, such as
 * a Settings panel: "night light" matches keywords Night and Light. Each
 * query word scores 1 for a whole name word or keyword, 0.8 for a prefix
 * (two letters or more); the result is the average, so at least half of
 * the words must match for 0.5.
 *
 * @param {string} name
 * @param {string[]} keywords
 * @param {string} query
 * @returns {number} 0 to 1
 */
export function keywordScore(name, keywords, query) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w);
    if (words.length === 0)
        return 0;

    const vocabulary = [
        ...name.toLowerCase().split(/[\s&,/-]+/),
        ...keywords.map(k => k.toLowerCase()),
    ].filter(w => w);

    let total = 0;
    for (const word of words) {
        if (vocabulary.includes(word))
            total += 1;
        else if (word.length >= 2 && vocabulary.some(v => v.startsWith(word)))
            total += 0.8;
    }
    return total / words.length;
}
