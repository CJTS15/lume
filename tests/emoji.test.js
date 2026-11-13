// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/emoji.test.js   (or `make test`)

import GLib from 'gi://GLib';
import System from 'system';

import {parseEmoji, searchEmoji} from '../src/lib/emoji.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const entries = parseEmoji([
    ['😀', 'grinning face', 'cheerful grin happy smile'],
    ['❤️', 'red heart', 'emotion love'],
    ['💔', 'broken heart', 'break breakup crushed'],
    ['☕', 'hot beverage', 'cafe coffee drink tea'],
    ['👍', 'thumbs up', '+1 good hand like yes'],
    ['🍵', 'teacup without handle', 'beverage cup drink tea'],
]);
const search = (text, limit = 8) => searchEmoji(entries, text, limit).map(e => e.emoji);

check('keyword', search('coffee'), ['☕']);
check('name', search('thumbs up'), ['👍']);
check('name prefix', search('thumb'), ['👍']);
check('several', search('heart'), ['❤️', '💔']);
check('keyword over several', search('tea'), ['☕', '🍵']);
check('limit', search('heart', 1), ['❤️']);
check('no match', search('zzzz'), []);
check('empty', search(''), []);

// The bundled data parses and finds a common emoji.
const data = JSON.parse(new TextDecoder().decode(GLib.file_get_contents('src/data/emoji.json')[1]));
const bundled = parseEmoji(data);
check('bundled data', searchEmoji(bundled, 'coffee', 3)[0]?.emoji, '☕');
// A heart, not a face that mentions hearts.
check('bundled name word first', /^\S+ heart$/.test(searchEmoji(bundled, 'heart', 3)[0]?.name ?? ''), true);
check('bundled thumbs up', searchEmoji(bundled, 'thumbs up', 3)[0]?.emoji, '👍');

if (failures > 0) {
    print(`${failures} emoji test(s) failed`);
    System.exit(1);
}
print('emoji: all tests passed');
