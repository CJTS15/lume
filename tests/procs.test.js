// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/procs.test.js   (or `make test`)

import System from 'system';

import {cpuPercent, parseCmdline, parseStat, withAncestors} from '../src/lib/procs.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// 52 fields, as on Linux 7.x; utime 14 = 300, stime 15 = 50, starttime 22 = 9000, rss 24 = 2560 pages.
const rest = 'S 1200 1234 1234 0 -1 4194304 100 0 0 0 300 50 0 0 20 0 1 0 9000 123456789 2560 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0';
const stat = name => `1234 (${name}) ${rest}\n`;
check('plain', parseStat(stat('bash')),
    {pid: 1234, comm: 'bash', state: 'S', ppid: 1200, ticks: 350, start: 9000, rss: 2560 * 4096});
check('spaces', parseStat(stat('Web Content'))?.comm, 'Web Content');
check('parentheses', parseStat(stat('(a) b)'))?.comm, '(a) b)');
check('parentheses keep fields', parseStat(stat('x) S 1 2 3'))?.ppid, 1200);
check('cut short', parseStat('1234 (bash) S 1200'), null);
check('garbage', parseStat('nothing here'), null);
check('empty', parseStat(''), null);

check('cmdline', parseCmdline('/usr/bin/python3\0-m\0http.server\0'), ['/usr/bin/python3', '-m', 'http.server']);
check('empty cmdline', parseCmdline(''), []);

check('cpu', cpuPercent(100, 150, 1), 50);
check('cpu two cores', cpuPercent(0, 100, 0.5), 200);
check('cpu no time', cpuPercent(0, 100, 0), 0);
check('cpu never negative', cpuPercent(100, 50, 1), 0);

const parents = new Map([[50, 40], [40, 1], [1, 0], [60, 60]]);
check('ancestors', [...withAncestors(50, parents)], [50, 40, 1]);
check('unknown parent', [...withAncestors(70, parents)], [70]);
check('loop', [...withAncestors(60, parents)], [60]);

if (failures > 0) {
    print(`${failures} procs test(s) failed`);
    System.exit(1);
}
print('procs: all tests passed');
