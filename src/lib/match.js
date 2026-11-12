// SPDX-License-Identifier: GPL-3.0-or-later
//
// Text matching shared by providers. No gi:// imports, so tests run under
// plain gjs.

/**
 * How well `needle` matches `haystack`, from 0 (no match) to 1.
 *
 * Exact > prefix > word prefix > substring > subsequence ("frfx" matches
 * "Firefox"). Comparison ignores case.
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
        return /[\s\-_.]/.test(h[index - 1]) ? 0.8 : 0.6;
    }

    // Subsequence: every needle character, in order.
    let pos = 0;
    for (const ch of n) {
        pos = h.indexOf(ch, pos);
        if (pos < 0)
            return 0;
        pos++;
    }
    return 0.3;
}
