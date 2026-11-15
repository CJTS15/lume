// SPDX-License-Identifier: GPL-3.0-or-later
//
// Snippets: saved text, found by name ("sig") or behind the "snip" keyword.
// Enter pastes it into the window that was in front before Lume opened;
// Ctrl+C copies it. {date}, {time} and {clipboard} are filled in then.
// Snippets are edited in Preferences, which writes the file this watches.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {paste, pasteTargetName} from '../lib/paste.js';
import {matchPrefix} from '../lib/prefix.js';
import {Provider} from '../lib/provider.js';
import {expandSnippet, parseSnippets, snippetsPath} from '../lib/snippets.js';

const ICON = 'insert-text-symbolic';
const MIN_UNSCOPED_LENGTH = 3;

// Enter pastes into another app, so without the keyword a snippet ranks
// below an app that matches as well (apps: 0.5–0.59); only its exact name
// makes it the top hit.
const unscopedScore = match => match === 1 ? 0.9 : 0.5 + 0.08 * match;

Gio._promisify(Gio.File.prototype, 'load_contents_async');

export class SnippetsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     * @param {() => void} openPreferences
     */
    constructor(settings, openPreferences) {
        super({id: 'snippets', name: _('Snippets'), label: _('Snippet')});
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._clock = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        /** @type {import('../lib/snippets.js').Snippet[]} */
        this._snippets = [];
        this._destroyed = false;
        this._file = Gio.File.new_for_path(snippetsPath());
        // Also notices the file (and its folder) being created later.
        this._monitor = this._file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', (_m, _f, _o, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.DELETED ||
                event === Gio.FileMonitorEvent.CREATED)
                this._load();
        });
        this._load();
    }

    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-snippets'));
    }

    owns(text) {
        return this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Snippets') : null;
    }

    query(text) {
        const filter = this._filter(text);
        if (filter !== null && this._snippets.length === 0) {
            return [{
                id: 'add',
                title: _('Add Snippets in Preferences'),
                subtitle: _('Save text you type often, then paste it by name'),
                icon: ICON,
                score: 0.99,
                activate: this._openPreferences,
            }];
        }

        // Behind the keyword, the text matches too and every snippet is
        // listed; otherwise only a good name match of 3+ letters is shown.
        if (filter === null && text.length < MIN_UNSCOPED_LENGTH)
            return [];
        const scored = this._snippets.map(snippet => ({
            snippet,
            score: filter === null ? matchScore(snippet.name, text)
                : filter === '' ? 1 : Math.max(matchScore(snippet.name, filter), 0.9 * matchScore(snippet.text, filter)),
        })).filter(({score}) => score >= (filter === null ? 0.7 : 0.6));

        const target = pasteTargetName();
        // TRANSLATORS: %s is an app, e.g. "Firefox"
        const pasteLabel = target ? _('Paste into %s').format(target) : null;
        return scored.map(({snippet, score}, index) => {
            const insert = deliver => () => this._insert(snippet.text, deliver);
            const copy = insert(copyText);
            const pasteIt = insert(paste);
            return {
                id: `snippet:${this._snippets.indexOf(snippet)}`,
                title: snippet.name,
                subtitle: pasteLabel ?? _('Copy to clipboard'),
                icon: ICON,
                score: filter === null ? unscopedScore(score) : 0.99 - 0.001 * index,
                activate: pasteIt,
                // Alt is still held then, so the app would get Ctrl+Alt+V.
                altActivate: copy,
                copy,
                actions: [
                    ...pasteLabel ? [{label: pasteLabel, icon: 'edit-paste-symbolic', run: pasteIt}] : [],
                    {label: _('Copy'), icon: 'edit-copy-symbolic', run: copy},
                ],
                preview: () => ({text: snippet.text}),
            };
        });
    }

    /** Fill in the variables, then paste or copy the result. */
    _insert(text, deliver) {
        const now = GLib.DateTime.new_now_local();
        const values = {
            date: now.format('%x'),
            time: now.format(this._clock.get_string('clock-format') === '12h' ? '%l:%M %p' : '%H:%M').trim(),
            clipboard: '',
        };
        if (!text.includes('{clipboard}')) {
            deliver(expandSnippet(text, values));
            return;
        }
        // Read before the snippet replaces it.
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, clipboard) => {
            if (!this._destroyed)
                deliver(expandSnippet(text, {...values, clipboard: clipboard ?? ''}));
        });
    }

    async _load() {
        let contents;
        try {
            [contents] = await this._file.load_contents_async(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error(`lume: could not read snippets: ${e.message}`);
            if (!this._destroyed)
                this._snippets = [];
            return;
        }
        if (this._destroyed)
            return;
        try {
            this._snippets = parseSnippets(new TextDecoder().decode(contents));
        } catch (e) {
            // Keep the last good list; the message never holds the file's text.
            console.error(`lume: ${snippetsPath()} is not a valid snippets file (${e.name})`);
        }
    }

    destroy() {
        this._destroyed = true;
        this._monitor.cancel();
        this._snippets = [];
    }
}

function copyText(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
