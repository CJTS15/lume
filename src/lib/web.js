// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web search URLs. No gi:// imports, so tests run under plain gjs.

/** `%s` is replaced by the URL-encoded query. */
export const ENGINES = {
    google: {name: 'Google', url: 'https://www.google.com/search?q=%s'},
    duckduckgo: {name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s'},
    brave: {name: 'Brave Search', url: 'https://search.brave.com/search?q=%s'},
    startpage: {name: 'Startpage', url: 'https://www.startpage.com/do/search?query=%s'},
};

/**
 * Whether a custom search URL is usable: http(s), no spaces, and a `%s`
 * placeholder for the query.
 *
 * @param {string} template
 * @returns {boolean}
 */
export function isValidSearchUrl(template) {
    return /^https?:\/\/[^\s/]+\S*$/i.test(template) && template.includes('%s');
}

/**
 * @param {string} template - a URL containing `%s`
 * @param {string} text - the query
 * @returns {string|null} null if the template is not valid
 */
export function buildSearchUrl(template, text) {
    if (!isValidSearchUrl(template))
        return null;
    return template.replaceAll('%s', encodeURIComponent(text));
}
