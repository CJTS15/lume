// SPDX-License-Identifier: GPL-3.0-or-later
//
// Time zone and date queries: "time in tokyo", "3pm est in london",
// "in 3 hours", "next monday", "days until dec 25", "unix 2026-12-25".
// Parsing only; places are resolved by the provider. Only GLib, so tests
// run under plain gjs.
// Limitation: English words only (month and day names, "until", "ago").

import GLib from 'gi://GLib';

// Common abbreviations; ambiguous ones take their usual meaning (IST is
// India, CST US Central, PST US Pacific).
const ABBREVIATIONS = {
    utc: 'UTC', gmt: 'UTC', z: 'UTC',
    est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
    bst: 'Europe/London', cet: 'Europe/Paris', cest: 'Europe/Paris',
    eet: 'Europe/Athens', eest: 'Europe/Athens', msk: 'Europe/Moscow',
    ist: 'Asia/Kolkata', pht: 'Asia/Manila', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong',
    jst: 'Asia/Tokyo', kst: 'Asia/Seoul', aest: 'Australia/Sydney', aedt: 'Australia/Sydney',
    nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland',
};

/**
 * @param {string} word - "EST", "jst"
 * @returns {string|null} an IANA time zone id
 */
export function zoneForAbbreviation(word) {
    return ABBREVIATIONS[word.toLowerCase()] ?? null;
}

const TIME_IN = /^(?:time|clock)\s+(?:in|at)\s+(.+)$/i;
// "3pm", "3:30 pm", "15:00"; then an optional source place, then the target.
// A bare number ("3 in tokyo") is left to unit conversion (inches).
const CONVERT = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:(.+?)\s+)?(?:in|to)\s+(.+)$/i;

/**
 * @param {string} text
 * @returns {{place: string}|{hour: number, minute: number, from: string|null,
 *   to: string}|null} the current time somewhere, or a time to convert
 */
export function parseTimeQuery(text) {
    const trimmed = text.trim();
    const now = TIME_IN.exec(trimmed);
    if (now)
        return {place: now[1].trim()};

    const match = CONVERT.exec(trimmed);
    if (!match || (match[2] === undefined && !match[3]))
        return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const half = match[3]?.toLowerCase();
    if (half ? hour < 1 || hour > 12 : hour > 23)
        return null;
    if (minute > 59)
        return null;
    if (half)
        hour = hour % 12 + (half === 'pm' ? 12 : 0);
    return {hour, minute, from: match[4]?.trim() || null, to: match[5].trim()};
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const UNIT = {minute: 'add_minutes', hour: 'add_hours', day: 'add_days', week: 'add_weeks', month: 'add_months', year: 'add_years'};

// 1–12 for "dec", "Sept", "December"; 0 for anything else ("decimal").
const month = name => MONTHS.findIndex(full => name.length >= 3 && full.startsWith(name.toLowerCase())) + 1;

const midnight = (now, year, mon, day) => GLib.DateTime.new(now.get_timezone(), year, mon, day, 0, 0, 0);

/**
 * "dec 25", "December 25, 2027", "25 dec", "2026-12-25". Without a year,
 * the next one (`future`) or the last one (`past`) from today; `this` year
 * otherwise.
 *
 * @returns {GLib.DateTime|null} local midnight
 */
function parseDate(text, now, direction) {
    let year, mon, day;
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
        [year, mon, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    } else if ((m = /^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(text)) && month(m[1])) {
        [mon, day, year] = [month(m[1]), Number(m[2]), m[3] && Number(m[3])];
    } else if ((m = /^(\d{1,2})\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/i.exec(text)) && month(m[2])) {
        [day, mon, year] = [Number(m[1]), month(m[2]), m[3] && Number(m[3])];
    } else {
        return null;
    }
    // GLib.DateTime.new() is null for a day that doesn't exist (dec 32).
    if (year)
        return mon >= 1 && mon <= 12 ? midnight(now, year, mon, day) : null;

    const today = midnight(now, now.get_year(), now.get_month(), now.get_day_of_month());
    let date = midnight(now, now.get_year(), mon, day);
    if (date && direction === 'future' && date.compare(today) < 0)
        date = midnight(now, now.get_year() + 1, mon, day);
    else if (date && direction === 'past' && date.compare(today) > 0)
        date = midnight(now, now.get_year() - 1, mon, day);
    return date;
}

/**
 * @param {string} text
 * @param {GLib.DateTime} now - local time
 * @returns {{kind: 'moment', time: boolean, date: GLib.DateTime}|
 *   {kind: 'days', days: number, date: GLib.DateTime}|
 *   {kind: 'unix', seconds: number, date: GLib.DateTime}|null}
 *   `time` is false for a whole day ("next monday"); `days` is negative
 *   for a date in the past ("days since jan 1")
 */
export function parseDateQuery(text, now) {
    const trimmed = text.trim().toLowerCase();
    let m;
    if ((m = /^in\s+(\d+)\s+(minute|hour|day|week|month|year)s?$/.exec(trimmed)))
        return {kind: 'moment', time: true, date: now[UNIT[m[2]]](Number(m[1]))};
    if ((m = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/.exec(trimmed)))
        return {kind: 'moment', time: true, date: now[UNIT[m[2]]](-Number(m[1]))};

    if ((m = /^(next|last)\s+([a-z]+)$/.exec(trimmed)) && WEEKDAYS.includes(m[2])) {
        // GLib: Monday is 1. "next" is never today, "last" never today.
        const delta = (WEEKDAYS.indexOf(m[2]) + 1 - now.get_day_of_week() + 7) % 7 || 7;
        const today = midnight(now, now.get_year(), now.get_month(), now.get_day_of_month());
        return {kind: 'moment', time: false, date: today.add_days(m[1] === 'next' ? delta : delta - 7)};
    }

    if ((m = /^days\s+(until|till|to|since)\s+(.+)$/.exec(trimmed))) {
        const date = parseDate(m[2], now, m[1] === 'since' ? 'past' : 'future');
        if (!date)
            return null;
        const today = midnight(now, now.get_year(), now.get_month(), now.get_day_of_month());
        // Rounded: a daylight-saving change makes a day 23 or 25 hours.
        return {kind: 'days', days: Math.round(date.difference(today) / (86400 * 1e6)), date};
    }

    if ((m = /^(?:unix|timestamp)\s+(.+)$/.exec(trimmed))) {
        const date = parseDate(m[1], now, 'this');
        return date ? {kind: 'unix', seconds: date.to_unix(), date} : null;
    }
    return null;
}
