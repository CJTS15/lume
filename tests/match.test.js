// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/match.test.js   (or `make test`)

import System from 'system';

import {fuzzyScore, keywordScore, matchScore} from '../src/lib/match.js';

let failures = 0;

function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        print(`FAIL ${label}: expected ${expected}, got ${actual}`);
    }
}

const match = (h, n, expected) =>
    check(`matchScore(${JSON.stringify(h)}, ${JSON.stringify(n)})`, matchScore(h, n), expected);

match('Firefox', 'firefox', 1);
match('Firefox', 'fire', 0.9);
match('Visual Studio Code', 'stu', 0.8);
match('report-final.pdf', 'final', 0.8);
match('Firefox', 'fox', 0.6);
match('Visual Studio Code', 'vsc', 0.4);
match('Visual Studio Code', 'vs', 0.4);
match('Firefox', 'frfx', 0.3);
match('Firefox', 'xf', 0);
match('Firefox', '', 0);
match('', 'a', 0);

check('strict prefix', fuzzyScore('Firefox', 'fire', 'strict'), 0.9);
check('strict substring', fuzzyScore('Firefox', 'fox', 'strict'), 0);
check('normal substring', fuzzyScore('Firefox', 'fox', 'normal'), 0.6);
check('normal initials', fuzzyScore('Visual Studio Code', 'vsc', 'normal'), 0);
check('loose initials', fuzzyScore('Visual Studio Code', 'vsc', 'loose'), 0.4);
check('loose subsequence', fuzzyScore('Firefox', 'frfx', 'loose'), 0.3);
check('unknown level is normal', fuzzyScore('Firefox', 'fox', 'bogus'), 0.6);

const display = ['Panel', 'Screen', 'Resolution', 'Night', 'Light', 'Monitor'];
const mouse = ['Trackpad', 'Pointer', 'Click', 'Scroll'];
check('keywords all words', keywordScore('Displays', display, 'night light'), 1);
check('keywords name word', keywordScore('Mouse & Touchpad', mouse, 'touchpad'), 1);
check('keywords prefix', keywordScore('Mouse & Touchpad', mouse, 'point'), 0.8);
check('keywords half', keywordScore('Mouse & Touchpad', mouse, 'pointer speed'), 0.5);
check('keywords none', keywordScore('Displays', display, 'bluetooth'), 0);
check('keywords one letter', keywordScore('Displays', display, 'n'), 0);

if (failures > 0) {
    print(`${failures} match test(s) failed`);
    System.exit(1);
}
print('match: all tests passed');
