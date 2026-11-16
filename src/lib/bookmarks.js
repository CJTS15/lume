// SPDX-License-Identifier: GPL-3.0-or-later
//
// Chromium-family bookmarks (Chrome, Chromium, Brave, Edge, Vivaldi): the
// profile's "Bookmarks" JSON file. No gi:// imports, so tests run under
// plain gjs.

const MAX_DEPTH = 32;
const MAX_BOOKMARKS = 20000;
const MAX_URL = 2048;

/** @typedef {{name: string, url: string}} Bookmark */

/**
 * The web bookmarks in a Bookmarks file, in the browser's order. Only
 * http(s) links: bookmarklets (javascript:), chrome:// and file: pages are
 * left out.
 *
 * @param {string} json
 * @returns {Bookmark[]}
 * @throws {SyntaxError} if it isn't JSON
 */
export function parseBookmarks(json) {
    const roots = JSON.parse(json)?.roots;
    const bookmarks = [];
    const walk = (node, depth) => {
        if (bookmarks.length >= MAX_BOOKMARKS || depth > MAX_DEPTH || typeof node !== 'object' || !node)
            return;
        if (node.type === 'url') {
            if (typeof node.url === 'string' && node.url.length <= MAX_URL && /^https?:\/\//i.test(node.url))
                bookmarks.push({name: typeof node.name === 'string' ? node.name : '', url: node.url});
            return;
        }
        if (Array.isArray(node.children)) {
            for (const child of node.children)
                walk(child, depth + 1);
        }
    };
    for (const key of ['bookmark_bar', 'other', 'synced'])
        walk(roots?.[key], 0);
    return bookmarks;
}

/**
 * @param {string} url
 * @returns {string} without the scheme, "www." and a trailing slash
 */
export function shortUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}
