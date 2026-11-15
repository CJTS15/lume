// SPDX-License-Identifier: GPL-3.0-or-later
//
// Snippets: saved text, pasted by name. Kept in
// $XDG_CONFIG_HOME/lume/snippets.json as [{"name": "...", "text": "..."}],
// written by Preferences (mode 0600) and read by the Shell. Only GLib, so
// tests run under plain gjs and Preferences can share it.

import GLib from 'gi://GLib';

const MAX_SNIPPETS = 1000;
const MAX_NAME = 200;
const MAX_TEXT = 20000;

/** @typedef {{name: string, text: string}} Snippet */

/** @returns {string} the snippets file's path */
export function snippetsPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'lume', 'snippets.json']);
}

/**
 * The snippets in the file's contents; entries that aren't a name and a
 * text are skipped, long ones capped.
 *
 * @param {string} json
 * @returns {Snippet[]}
 * @throws {SyntaxError|TypeError} if it isn't a JSON array
 */
export function parseSnippets(json) {
    const saved = JSON.parse(json);
    if (!Array.isArray(saved))
        throw new TypeError('not a list of snippets');
    return saved.filter(s => typeof s?.name === 'string' && s.name.trim() && typeof s.text === 'string')
        .slice(0, MAX_SNIPPETS)
        .map(s => ({name: s.name.slice(0, MAX_NAME), text: s.text.slice(0, MAX_TEXT)}));
}

const VARIABLE = /\{(date|time|clipboard)\}/g;

/**
 * Fill in {date}, {time} and {clipboard}; other braces stay as they are.
 *
 * @param {string} text
 * @param {{date: string, time: string, clipboard: string}} values
 * @returns {string}
 */
export function expandSnippet(text, values) {
    return text.replace(VARIABLE, (_m, name) => values[name]);
}
