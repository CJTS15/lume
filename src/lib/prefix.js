// SPDX-License-Identifier: GPL-3.0-or-later
//
// Prefix scopes ("f readme", "? query", ":coffee"). No gi:// imports, so
// tests run under plain gjs.

const WORD = /^[\p{L}\p{N}]/u;

/**
 * The text after the first matching prefix, or null if none matches.
 *
 * A prefix starting with a letter or digit ("f", "win") must be followed
 * by whitespace, so typing a word ("foo", "wine") is never taken; one of
 * two or more characters also matches on its own ("win" lists all
 * windows). A symbol prefix ("?", ">", ":") may be followed directly by
 * text. Comparison ignores case.
 *
 * @param {string} text - the trimmed query
 * @param {string[]} prefixes - from the scope's settings key
 * @returns {string|null} the rest, trimmed (may be empty)
 */
export function matchPrefix(text, prefixes) {
    const lower = text.toLowerCase();
    for (const raw of prefixes) {
        const prefix = raw.trim().toLowerCase();
        if (!prefix || !lower.startsWith(prefix))
            continue;
        const rest = text.slice(prefix.length);
        if (!WORD.test(prefix) || /^\s/.test(rest) || (rest === '' && prefix.length > 1))
            return rest.trim();
    }
    return null;
}
