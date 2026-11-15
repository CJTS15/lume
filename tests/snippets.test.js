// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/snippets.test.js   (or `make test`)

import System from 'system';

import {expandSnippet, parseSnippets} from '../src/lib/snippets.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function throws(label, fn) {
    try {
        fn();
    } catch {
        return;
    }
    failures++;
    print(`FAIL ${label}: expected an error`);
}

const values = {date: '11/15/2026', time: '2:30 PM', clipboard: 'copied'};
check('variables', expandSnippet('On {date} at {time}: {clipboard}', values), 'On 11/15/2026 at 2:30 PM: copied');
check('repeated', expandSnippet('{date} {date}', values), '11/15/2026 11/15/2026');
check('unknown braces stay', expandSnippet('function () { return {name}; }', values), 'function () { return {name}; }');
check('case matters', expandSnippet('{Date}', values), '{Date}');
check('no replacement patterns', expandSnippet('{clipboard}', {...values, clipboard: '$& $1'}), '$& $1');

check('parse', parseSnippets('[{"name": "Sig", "text": "Regards"}]'), [{name: 'Sig', text: 'Regards'}]);
check('skips bad entries', parseSnippets('[{"name": "", "text": "x"}, {"name": 1, "text": "x"}, {"name": "a"}, null, "x", {"name": "ok", "text": ""}]'),
    [{name: 'ok', text: ''}]);
check('drops other fields', parseSnippets('[{"name": "a", "text": "b", "extra": 1}]'), [{name: 'a', text: 'b'}]);
check('caps text', parseSnippets(JSON.stringify([{name: 'a', text: 'x'.repeat(30000)}]))[0].text.length, 20000);
check('caps count', parseSnippets(JSON.stringify(Array.from({length: 1200}, () => ({name: 'a', text: 'b'})))).length, 1000);
throws('not JSON', () => parseSnippets('{oops'));
throws('not a list', () => parseSnippets('{"name": "a", "text": "b"}'));

if (failures > 0) {
    print(`${failures} snippets test(s) failed`);
    System.exit(1);
}
print('snippets: all tests passed');
