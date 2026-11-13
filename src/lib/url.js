// SPDX-License-Identifier: GPL-3.0-or-later
//
// Recognize typed web addresses. No gi:// imports, so tests run under
// plain gjs.

// Without "https://", only these endings count as websites: many endings
// are also file extensions (.zip, .mov, .sh, .py, .rs, .md, .pl, .in), and
// "notes.md" should stay a file search.
const KNOWN_TLDS = new Set([
    'com', 'net', 'org', 'io', 'dev', 'app', 'ai', 'co', 'me', 'info', 'biz',
    'xyz', 'tech', 'site', 'online', 'blog', 'page', 'cloud', 'gov', 'edu',
    'eu', 'uk', 'us', 'ca', 'au', 'nz', 'de', 'fr', 'nl', 'be', 'ch', 'at',
    'se', 'no', 'dk', 'fi', 'es', 'it', 'pt', 'ie', 'cz', 'jp', 'kr',
    'cn', 'tw', 'hk', 'sg', 'ph', 'id', 'my', 'th', 'vn', 'br', 'mx',
    'ar', 'za', 'ru', 'ua', 'tv', 'fm', 'gg', 'to', 'ly', 'gl',
]);

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const PORT_AND_PATH = '(?::(\\d{1,5}))?([/?#]\\S*)?';

const WITH_SCHEME = /^https?:\/\/[^\s/?#]+\S*$/i;
const LOCALHOST = new RegExp(`^localhost${PORT_AND_PATH}$`, 'i');
const IPV4 = new RegExp(`^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})${PORT_AND_PATH}$`);
const DOMAIN = new RegExp(`^((?:${HOST_LABEL}\\.)+([a-z]{2,63}))${PORT_AND_PATH}$`, 'i');

const validPort = port => port === undefined || Number(port) <= 65535;

/**
 * The URL to open for `text`, or null if it does not look like a web
 * address: https://example.com, example.com, localhost:3000, 192.168.1.1.
 * Local addresses get http://, domains https://.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function toUrl(text) {
    text = text.trim();
    if (!text || /\s/.test(text))
        return null;

    if (WITH_SCHEME.test(text))
        return text;

    let match = LOCALHOST.exec(text);
    if (match)
        return validPort(match[1]) ? `http://${text}` : null;

    match = IPV4.exec(text);
    if (match) {
        const octetsValid = match.slice(1, 5).every(octet => Number(octet) <= 255);
        return octetsValid && validPort(match[5]) ? `http://${text}` : null;
    }

    match = DOMAIN.exec(text);
    if (match && KNOWN_TLDS.has(match[2].toLowerCase()) && validPort(match[3]))
        return `https://${text}`;

    return null;
}
