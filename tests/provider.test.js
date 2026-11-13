// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/provider.test.js   (or `make test`)

import System from 'system';

import {Provider, ProviderRegistry} from '../src/lib/provider.js';

let failures = 0;

function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

class Keyword extends Provider {
    constructor(id, keyword, scope) {
        super({id, name: id});
        this._keyword = keyword;
        this._scope = scope;
    }

    scope(text) {
        return text.startsWith(this._keyword) ? this._scope : null;
    }
}

check('label defaults to name', new Provider({id: 'a', name: 'Apps'}).label, 'Apps');
check('label', new Provider({id: 'a', name: 'Apps', label: 'App'}).label, 'App');
check('base scope', new Provider({id: 'a'}).scope('clip'), null);

const registry = new ProviderRegistry();
registry.register(new Provider({id: 'plain'}));
registry.register(new Keyword('clipboard', 'clip', 'Clipboard'));
registry.register(new Keyword('other', 'clip', 'Other'));
check('first scope wins', registry.scopeFor('clip foo'), 'Clipboard');
check('no scope', registry.scopeFor('firefox'), null);

if (failures > 0) {
    print(`${failures} provider test(s) failed`);
    System.exit(1);
}
print('provider: all tests passed');
