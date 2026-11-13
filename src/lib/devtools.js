// SPDX-License-Identifier: GPL-3.0-or-later
//
// Developer quick-tools: UUIDs, Base64, checksums, colours, Unix time.
// Only gi://GLib, so tests run under plain gjs.

import GLib from 'gi://GLib';

/** @returns {string} a random (version 4) UUID */
export function uuid() {
    return GLib.uuid_string_random();
}

/**
 * @param {string} text
 * @returns {string} Base64 of the UTF-8 bytes
 */
export function base64Encode(text) {
    return GLib.base64_encode(new TextEncoder().encode(text));
}

/**
 * @param {string} text
 * @returns {string|null} the decoded text, or null if `text` is not valid
 *   Base64 of UTF-8 text (binary data is not shown)
 */
export function base64Decode(text) {
    const clean = text.replace(/\s+/g, '');
    if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean))
        return null;
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(GLib.base64_decode(clean));
    } catch {
        return null;
    }
}

const CHECKSUMS = {
    md5: GLib.ChecksumType.MD5,
    sha1: GLib.ChecksumType.SHA1,
    sha256: GLib.ChecksumType.SHA256,
    sha512: GLib.ChecksumType.SHA512,
};

/**
 * @param {string} type - md5, sha1, sha256 or sha512
 * @param {string} text
 * @returns {string|null} lowercase hex digest of the UTF-8 bytes, or null
 *   for an unknown type
 */
export function checksum(type, text) {
    if (!Object.hasOwn(CHECKSUMS, type))
        return null;
    return GLib.compute_checksum_for_data(CHECKSUMS[type], new TextEncoder().encode(text));
}

export const CHECKSUM_TYPES = Object.keys(CHECKSUMS);

/**
 * "#ff8800", "#f80" or "rgb(255, 136, 0)".
 *
 * @param {string} text
 * @returns {{hex: string, rgb: string}|null} both notations; `hex` is
 *   always "#rrggbb", safe to use as a CSS colour
 */
export function parseColor(text) {
    let channels;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map(d => d + d).join('') : hex[1];
        channels = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
    } else {
        const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text.trim());
        if (!rgb)
            return null;
        channels = rgb.slice(1, 4).map(Number);
        if (channels.some(c => c > 255))
            return null;
    }
    return {
        hex: `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`,
        rgb: `rgb(${channels.join(', ')})`,
    };
}

/**
 * "unix" or "timestamp": the current time; a 10-digit (seconds) or
 * 13-digit (milliseconds) number: that moment.
 *
 * @param {string} text
 * @param {number} now - current Unix time in seconds
 * @param {string} [zone] - time zone identifier for `iso`; local if omitted
 * @returns {{seconds: number, iso: string}|null}
 */
export function timestamp(text, now, zone) {
    const word = text.trim().toLowerCase();
    let seconds;
    if (word === 'unix' || word === 'timestamp')
        seconds = Math.floor(now);
    else if (/^\d{10}$/.test(word))
        seconds = Number(word);
    else if (/^\d{13}$/.test(word))
        seconds = Number(word) / 1000;
    else
        return null;

    const tz = zone ? GLib.TimeZone.new_identifier(zone) : GLib.TimeZone.new_local();
    const date = GLib.DateTime.new_from_unix_utc(Math.floor(seconds)).to_timezone(tz);
    return {seconds, iso: date.format('%Y-%m-%d %H:%M:%S %Z')};
}
