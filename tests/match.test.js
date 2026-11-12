// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/match.test.js   (or `make test`)

import System from 'system';

import {matchScore} from '../src/lib/match.js';

let failures = 0;

function check(haystack, needle, expected) {
    const actual = matchScore(haystack, needle);
    if (actual !== expected) {
        failures++;
        print(`FAIL matchScore(${JSON.stringify(haystack)}, ${JSON.stringify(needle)}): expected ${expected}, got ${actual}`);
    }
}

check('Firefox', 'firefox', 1);
check('Firefox', 'fire', 0.9);
check('Visual Studio Code', 'stu', 0.8);
check('report-final.pdf', 'final', 0.8);
check('Firefox', 'fox', 0.6);
check('Firefox', 'frfx', 0.3);
check('Firefox', 'xf', 0);
check('Firefox', '', 0);
check('', 'a', 0);

if (failures > 0) {
    print(`${failures} match test(s) failed`);
    System.exit(1);
}
print('match: all tests passed');
