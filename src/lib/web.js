// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web search URLs and browser window titles. No gi:// imports, so tests
// run under plain gjs.

/** `%s` is replaced by the URL-encoded query. */
export const ENGINES = {
    google: {name: 'Google', url: 'https://www.google.com/search?q=%s'},
    duckduckgo: {name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s'},
    brave: {name: 'Brave Search', url: 'https://search.brave.com/search?q=%s'},
    startpage: {name: 'Startpage', url: 'https://www.startpage.com/do/search?query=%s'},
};

/**
 * Sites with their own prefix ("wiki ", "yt "). `url(language)` gives the
 * template; `key` is the prefix settings key.
 */
export const SITES = {
    wikipedia: {
        name: 'Wikipedia',
        key: 'prefix-wikipedia',
        url: language => `https://${language}.wikipedia.org/wiki/Special:Search?search=%s`,
    },
    youtube: {
        name: 'YouTube',
        key: 'prefix-youtube',
        url: () => 'https://www.youtube.com/results?search_query=%s',
    },
};

/**
 * @param {string[]} languageNames - GLib.get_language_names()
 * @returns {string} the Wikipedia language code ("de" for de_DE.UTF-8)
 */
export function wikipediaLanguage(languageNames) {
    const code = (languageNames[0] ?? '').split(/[_.@]/)[0].toLowerCase();
    return /^[a-z]{2,3}$/.test(code) ? code : 'en';
}

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

// The suffix browsers add to a window title, after the active tab's title.
const BROWSER_SUFFIX = /\s[—–-]\s(?:Mozilla Firefox(?: Private Browsing)?|Google Chrome|Chromium)$/;

/**
 * @param {string} windowTitle
 * @returns {string|null} the active tab's title if this is a Firefox or
 *   Chrome window ("Lofi Girl - YouTube — Mozilla Firefox"), else null
 */
export function browserTab(windowTitle) {
    const tab = windowTitle.replace(BROWSER_SUFFIX, '');
    return tab !== windowTitle && tab.trim() ? tab : null;
}
