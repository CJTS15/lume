// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/web.test.js   (or `make test`)

import System from 'system';

import {ENGINES, buildSearchUrl, isValidSearchUrl} from '../src/lib/web.js';

let failures = 0;

function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

check('google', buildSearchUrl(ENGINES.google.url, 'gnome shell'),
    'https://www.google.com/search?q=gnome%20shell');
check('encodes &, #, ?', buildSearchUrl(ENGINES.duckduckgo.url, 'a&b=c #d?'),
    'https://duckduckgo.com/?q=a%26b%3Dc%20%23d%3F');
check('unicode', buildSearchUrl(ENGINES.brave.url, 'café'),
    'https://search.brave.com/search?q=caf%C3%A9');
check('every %s', buildSearchUrl('https://x.org/%s/%s', 'q'), 'https://x.org/q/q');
for (const [id, engine] of Object.entries(ENGINES))
    check(`${id} template valid`, isValidSearchUrl(engine.url), true);

check('no placeholder', buildSearchUrl('https://example.org/search', 'q'), null);
check('javascript:', buildSearchUrl('javascript:alert(%s)', 'q'), null);
check('file:', buildSearchUrl('file:///etc/%s', 'q'), null);
check('spaces', buildSearchUrl('https://example.org/?q= %s', 'q'), null);
check('no host', buildSearchUrl('https:///%s', 'q'), null);
check('empty', buildSearchUrl('', 'q'), null);

if (failures > 0) {
    print(`${failures} web test(s) failed`);
    System.exit(1);
}
print('web: all tests passed');
