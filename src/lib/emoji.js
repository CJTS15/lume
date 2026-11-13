// SPDX-License-Identifier: GPL-3.0-or-later
//
// Emoji search over the bundled data (src/data/emoji.json: [emoji, name,
// "keyword keyword ..."]). No gi:// imports, so tests run under plain gjs.

import {keywordScore, matchScore} from './match.js';

const words = name => name.split(/\s+/).length;

/**
 * @param {Array<[string, string, string]>} data - from emoji.json
 * @returns {Array<{emoji: string, name: string, keywords: string[]}>}
 */
export function parseEmoji(data) {
    return data.map(([emoji, name, keywords]) => ({
        emoji,
        name,
        keywords: keywords ? keywords.split(' ') : [],
    }));
}

/**
 * Emoji whose name or keywords match `text`, best first; then shorter
 * names; then the data's order (Unicode's, roughly most common first).
 *
 * @param {Array<{emoji: string, name: string, keywords: string[]}>} entries
 * @param {string} text
 * @param {number} limit
 * @returns {Array<{emoji: string, name: string, keywords: string[]}>}
 */
export function searchEmoji(entries, text, limit) {
    if (!text.trim())
        return [];
    return entries
        .map(entry => {
            const name = matchScore(entry.name, text);
            return {
                entry,
                // Words of the name ("red heart" for "heart") beat keywords,
                // which beat a match inside a name word ("hearts").
                score: Math.max(name >= 0.6 ? name : 0,
                    keywordScore(entry.name, [], text),
                    0.95 * keywordScore(entry.name, entry.keywords, text)),
            };
        })
        .filter(({score}) => score >= 0.5)
        // On a tie the shorter name is the more specific one ("red heart"
        // before "smiling face with heart-eyes").
        .sort((a, b) => b.score - a.score || words(a.entry.name) - words(b.entry.name))
        .slice(0, limit)
        .map(({entry}) => entry);
}
