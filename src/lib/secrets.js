// SPDX-License-Identifier: GPL-3.0-or-later
//
// Copied text that looks like a secret, which clipboard history never
// keeps. Most password managers on Linux set no clipboard hint (only
// KeePassXC and KWallet do), so this catches the common token formats.
// No gi:// imports, so tests run under plain gjs.

const PATTERNS = [
    /\bgh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
    /\bgithub_pat_[A-Za-z0-9_]{22,}/, // GitHub fine-grained tokens
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key IDs
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWTs
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM / OpenSSH private keys
    /\bsk-[A-Za-z0-9_-]{20,}/, // AI API keys (sk-ant-…, sk-proj-…)
];

// The whole text is 13–19 digits, maybe grouped by spaces or dashes,
// starting with 2–6 like card numbers (millisecond timestamps start with 1).
const CARD = /^[2-6](?:[ -]?\d){12,18}$/;

/** @param {string} digits */
function passesLuhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let digit = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
            digit *= 2;
            if (digit > 9)
                digit -= 9;
        }
        sum += digit;
    }
    return sum % 10 === 0;
}

/**
 * @param {string} text - copied text
 * @returns {boolean} whether it looks like a token, key or card number
 */
export function looksSecret(text) {
    const trimmed = text.trim();
    if (CARD.test(trimmed) && passesLuhn(trimmed.replace(/[ -]/g, '')))
        return true;
    return PATTERNS.some(pattern => pattern.test(trimmed));
}
