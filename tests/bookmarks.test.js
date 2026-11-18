// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/bookmarks.test.js   (or `make test`)

import System from 'system';

import {parseBookmarks, shortUrl} from '../src/lib/bookmarks.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const file = {
    roots: {
        bookmark_bar: {
            type: 'folder',
            children: [
                {type: 'url', name: 'GNOME', url: 'https://www.gnome.org/'},
                {type: 'folder', name: 'Dev', children: [
                    {type: 'url', name: 'GitLab', url: 'https://gitlab.gnome.org/GNOME/gnome-shell'},
                    {type: 'url', name: 'Bookmarklet', url: 'javascript:alert(1)'},
                ]},
            ],
        },
        other: {type: 'folder', children: [
            {type: 'url', name: 'Flags', url: 'chrome://flags'},
            {type: 'url', name: 'Local', url: 'file:///etc/passwd'},
            {type: 'url', url: 'http://example.com'},
            {type: 'url', name: 'Long', url: `https://example.com/${'x'.repeat(3000)}`},
        ]},
        synced: {type: 'folder', children: [{type: 'url', name: 'Phone', url: 'HTTPS://m.example.com'}]},
    },
};
check('http(s) only, in order', parseBookmarks(JSON.stringify(file)), [
    {name: 'GNOME', url: 'https://www.gnome.org/'},
    {name: 'GitLab', url: 'https://gitlab.gnome.org/GNOME/gnome-shell'},
    {name: '', url: 'http://example.com'},
    {name: 'Phone', url: 'HTTPS://m.example.com'},
]);
check('no roots', parseBookmarks('{}'), []);
check('odd nodes', parseBookmarks('{"roots": {"bookmark_bar": {"children": [null, 3, "x", {"type": "url", "url": 5}]}}}'), []);

let deep = {type: 'url', name: 'Deep', url: 'https://deep.example'};
for (let i = 0; i < 40; i++)
    deep = {type: 'folder', children: [deep]};
check('depth capped', parseBookmarks(JSON.stringify({roots: {other: deep}})), []);

try {
    parseBookmarks('{oops');
    failures++;
    print('FAIL not JSON: expected an error');
} catch {
    // Expected.
}

check('short url', shortUrl('https://www.gnome.org/'), 'gnome.org');
check('short url path', shortUrl('http://example.com/a/b'), 'example.com/a/b');

if (failures > 0) {
    print(`${failures} bookmarks test(s) failed`);
    System.exit(1);
}
print('bookmarks: all tests passed');
