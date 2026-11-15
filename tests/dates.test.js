// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/dates.test.js   (or `make test`)

import GLib from 'gi://GLib';
import System from 'system';

import {parseDateQuery, parseTimeQuery, zoneForAbbreviation} from '../src/lib/dates.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// Time zone queries
check('time in', parseTimeQuery('time in tokyo'), {place: 'tokyo'});
check('keeps case', parseTimeQuery('Time in New York'), {place: 'New York'});
check('time at', parseTimeQuery('time at london'), {place: 'london'});
check('3pm in', parseTimeQuery('3pm in tokyo'), {hour: 15, minute: 0, from: null, to: 'tokyo'});
check('with a from zone', parseTimeQuery('3:30 pm est in london'), {hour: 15, minute: 30, from: 'est', to: 'london'});
check('24-hour', parseTimeQuery('15:00 in tokyo'), {hour: 15, minute: 0, from: null, to: 'tokyo'});
check('to', parseTimeQuery('9am pst to manila'), {hour: 9, minute: 0, from: 'pst', to: 'manila'});
check('midnight', parseTimeQuery('12am in tokyo'), {hour: 0, minute: 0, from: null, to: 'tokyo'});
check('noon', parseTimeQuery('12pm in tokyo'), {hour: 12, minute: 0, from: null, to: 'tokyo'});
check('a bare number is inches', parseTimeQuery('3 in tokyo'), null);
check('13pm', parseTimeQuery('13pm in tokyo'), null);
check('25:00', parseTimeQuery('25:00 in tokyo'), null);
check('a unit conversion', parseTimeQuery('10 km in mi'), null);
check('a question', parseTimeQuery('what time is it'), null);

check('EST', zoneForAbbreviation('EST'), 'America/New_York');
check('utc', zoneForAbbreviation('utc'), 'UTC');
check('unknown', zoneForAbbreviation('xyz'), null);

// Dates, from Sunday 2026-11-15 10:00 in Manila
const now = GLib.DateTime.new(GLib.TimeZone.new_identifier('Asia/Manila'), 2026, 11, 15, 10, 0, 0);
const date = result => result && {...result, date: result.date.format('%F %R')};
const q = text => date(parseDateQuery(text, now));

check('in hours', q('in 3 hours'), {kind: 'moment', time: true, date: '2026-11-15 13:00'});
check('in days', q('in 2 days'), {kind: 'moment', time: true, date: '2026-11-17 10:00'});
check('in a week', q('in 1 week'), {kind: 'moment', time: true, date: '2026-11-22 10:00'});
check('in minutes', q('in 90 minutes'), {kind: 'moment', time: true, date: '2026-11-15 11:30'});
check('ago', q('3 days ago'), {kind: 'moment', time: true, date: '2026-11-12 10:00'});
check('next monday', q('next monday'), {kind: 'moment', time: false, date: '2026-11-16 00:00'});
check('next sunday on a Sunday', q('next sunday'), {kind: 'moment', time: false, date: '2026-11-22 00:00'});
check('last friday', q('last friday'), {kind: 'moment', time: false, date: '2026-11-13 00:00'});
check('days until', q('days until dec 25'), {kind: 'days', days: 40, date: '2026-12-25 00:00'});
check('days until ISO', q('days until 2026-12-25'), {kind: 'days', days: 40, date: '2026-12-25 00:00'});
check('days until, next year', q('days until jan 1'), {kind: 'days', days: 47, date: '2027-01-01 00:00'});
check('days since', q('days since jan 1'), {kind: 'days', days: -318, date: '2026-01-01 00:00'});
check('day month year', q('days until 25 December 2027'), {kind: 'days', days: 405, date: '2027-12-25 00:00'});
check('comma year', q('days until Dec 25, 2026'), {kind: 'days', days: 40, date: '2026-12-25 00:00'});
check('unix', q('unix 2026-12-25'), {kind: 'unix', seconds: 1798128000, date: '2026-12-25 00:00'});
check('timestamp', q('timestamp dec 25 2026'), {kind: 'unix', seconds: 1798128000, date: '2026-12-25 00:00'});

check('not a unit', q('in 3 apples'), null);
check('no date', q('days until foo'), null);
check('bad day', q('days until dec 32'), null);
check('not a month', q('days until decimal 5'), null);
check('sept', q('days until sept 1'), {kind: 'days', days: 290, date: '2027-09-01 00:00'});
check('bare in', q('in'), null);
check('unix alone is devtools', q('unix'), null);

if (failures > 0) {
    print(`${failures} dates test(s) failed`);
    System.exit(1);
}
print('dates: all tests passed');
