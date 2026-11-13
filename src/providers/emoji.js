// SPDX-License-Identifier: GPL-3.0-or-later
//
// Emoji picker: ":coffee" or "emoji coffee". Enter and Ctrl+C copy the
// emoji. Names and keywords come from the bundled data/emoji.json (built
// from Unicode data by tools/emoji.py), loaded on first use.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {parseEmoji, searchEmoji} from '../lib/emoji.js';
import {Provider} from '../lib/provider.js';
import {matchPrefix} from '../lib/prefix.js';

const DATA = GLib.uri_resolve_relative(import.meta.url, '../data/emoji.json', GLib.UriFlags.NONE);

Gio._promisify(Gio.File.prototype, 'load_contents_async');

export class EmojiProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'emoji', name: _('Emoji'), label: _('Emoji')});
        this._settings = settings;
        this._entries = null;
    }

    owns(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-emoji')) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Emoji') : null;
    }

    async query(text) {
        const words = matchPrefix(text, this._settings.get_strv('prefix-emoji'));
        if (!words)
            return [];

        this._entries ??= this._load();
        const entries = await this._entries;
        return searchEmoji(entries, words, this._settings.get_int('max-results'))
            .map((entry, index) => {
                const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.emoji);
                return {
                    id: entry.emoji,
                    title: entry.name,
                    subtitle: entry.keywords.slice(0, 6).join(', ') || undefined,
                    glyph: entry.emoji,
                    score: 0.97 - 0.001 * index,
                    activate: copy,
                    copy,
                };
            });
    }

    async _load() {
        try {
            const [contents] = await Gio.File.new_for_uri(DATA).load_contents_async(null);
            return parseEmoji(JSON.parse(new TextDecoder().decode(contents)));
        } catch (e) {
            console.error(`lume: could not load emoji data: ${e.message}`);
            this._entries = null; // Try again next time.
            return [];
        }
    }
}
