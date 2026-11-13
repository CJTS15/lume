// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/url.test.js   (or `make test`)

import System from 'system';

import {toUrl} from '../src/lib/url.js';

let failures = 0;

function check(input, expected) {
    const actual = toUrl(input);
    if (actual !== expected) {
        failures++;
        print(`FAIL ${JSON.stringify(input)}: expected ${expected}, got ${actual}`);
    }
}

check('https://example.com', 'https://example.com');
check('http://example.com/a?b=c#d', 'http://example.com/a?b=c#d');
check('HTTPS://Example.com', 'HTTPS://Example.com');
check('example.com', 'https://example.com');
check('docs.gnome.org/hig', 'https://docs.gnome.org/hig');
check('claude.ai', 'https://claude.ai');
check('example.com:8080/x', 'https://example.com:8080/x');
check('localhost:3000', 'http://localhost:3000');
check('localhost', 'http://localhost');
check('localhost/api', 'http://localhost/api');
check('192.168.1.1', 'http://192.168.1.1');
check('10.0.0.2:8080/admin', 'http://10.0.0.2:8080/admin');

// Not websites
check('archive.zip', null);
check('notes.md', null);
check('script.sh', null);
check('main.py', null);
check('script.pl', null);
check('Makefile.in', null);
check('photo.jpg', null);
check('firefox', null);
check('2.5', null);
check('256.1.1.1', null);
check('1.2.3', null);
check('localhost:99999', null);
check('example .com', null);
check('-bad.com', null);
check('ftp://example.com', null);
check('javascript:alert(1)', null);
check('file:///etc/passwd', null);
check('', null);

if (failures > 0) {
    print(`${failures} url test(s) failed`);
    System.exit(1);
}
print('url: all tests passed');
