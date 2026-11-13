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

class Owner extends Provider {
    constructor(id, prefix) {
        super({id});
        this._prefix = prefix;
    }

    owns(text) {
        return this._prefix !== null && text.startsWith(this._prefix);
    }

    query() {
        return [{id: 'x', title: this.id, activate: () => {}}];
    }
}

const scoped = new ProviderRegistry();
scoped.register(new Owner('apps', null));
scoped.register(new Owner('web', 'b '));
const answered = text => {
    const ids = [];
    // query() is async; the providers above answer synchronously.
    scoped.query(text, {is_cancelled: () => false}, provider => ids.push(provider.id));
    return ids;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

await settle();
const owned = answered('b foo');
const open = answered('foo');
await settle();
check('owner only', owned.join(), 'web');
check('everyone without an owner', open.join(), 'apps,web');

// update() shows interim rows; the final answer replaces them.
class Slow extends Provider {
    constructor() {
        super({id: 'slow'});
    }

    async query(text, _cancellable, update) {
        update([{id: 'pending', title: 'Fetching', activate: () => {}}]);
        await settle();
        return [{id: 'done', title: 'Done', activate: () => {}}];
    }
}
const slow = new ProviderRegistry();
slow.register(new Slow());
const reports = [];
let cancelled = false;
const running = slow.query('x', {is_cancelled: () => cancelled},
    (_provider, results) => reports.push(results[0].id));
check('interim rows first', reports.join(), 'pending');
await running;
check('final rows replace them', reports.join(), 'pending,done');

reports.length = 0;
cancelled = true;
await slow.query('x', {is_cancelled: () => cancelled}, (_p, results) => reports.push(results[0].id));
check('no interim rows once cancelled', reports.join(), '');

if (failures > 0) {
    print(`${failures} provider test(s) failed`);
    System.exit(1);
}
print('provider: all tests passed');
