// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/prefix.test.js   (or `make test`)

import System from 'system';

import {matchPrefix} from '../src/lib/prefix.js';

let failures = 0;

function check(text, prefixes, expected) {
    const actual = matchPrefix(text, prefixes);
    if (actual !== expected) {
        failures++;
        print(`FAIL matchPrefix(${JSON.stringify(text)}, ${JSON.stringify(prefixes)}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// Word prefixes need a space after them.
check('f readme', ['f'], 'readme');
check('F readme', ['f'], 'readme');
check('f', ['f'], null);
check('foo', ['f'], null);
check('b gnome hig', ['?', 'b'], 'gnome hig');
// Symbols need no space.
check('?lume', ['?', 'b'], 'lume');
check('? lume', ['?', 'b'], 'lume');
check('?', ['?'], '');
check(':coffee', [':', 'emoji'], 'coffee');
check('>ls -la', ['>'], 'ls -la');
check('=2+2', ['='], '2+2');
// Multi-character prefixes also match on their own.
check('win', ['win'], '');
check('win quart', ['win'], 'quart');
check('wine', ['win'], null);
check('emoji', [':', 'emoji'], '');
check('ai', ['ask', 'ai'], '');
check('ask explain', ['ask', 'ai'], 'explain');
// Disabled scope, junk entries.
check('f readme', [], null);
check('f readme', ['', '  '], null);

if (failures > 0) {
    print(`${failures} prefix test(s) failed`);
    System.exit(1);
}
print('prefix: all tests passed');
