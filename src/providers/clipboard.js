// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clipboard history. Shown only behind the "clip" keyword, so copied text
// never appears while typing an ordinary search.
//
// History lives in memory and is lost on disable (screen lock, logout)
// unless "clipboard-persist" is on, in which case it is saved to
// $XDG_STATE_HOME/lume/clipboard.json with mode 0600.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';
import {matchPrefix} from '../lib/prefix.js';
import {looksSecret} from '../lib/secrets.js';

// Large copies (logs, files' contents) are not worth keeping or rendering.
const MAX_ENTRY_LENGTH = 20000;
const TITLE_LENGTH = 80;
const SAVE_DELAY_SECONDS = 2;
// Password managers (KeePassXC, KDE Wallet, ...) add this type to secret
// copies. For managers that do not set it (Bitwarden, 1Password), copies
// that look like tokens, keys or card numbers are skipped (lib/secrets.js).
const SECRET_HINT_MIMETYPE = 'x-kde-passwordManagerHint';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');

function toTitle(text) {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

export class ClipboardProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'clipboard', name: _('Clipboard'), label: _('Clipboard')});

        this._settings = settings;
        /** @type {string[]} newest first */
        this._history = [];
        this._saveId = 0;
        this._destroyed = false;
        this._file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_state_dir(), 'lume', 'clipboard.json']));

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (_s, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onClipboardChanged();
        });

        this._settingsIds = [
            settings.connect('changed::clipboard-history', () => this._onPrivacyChanged()),
            settings.connect('changed::clipboard-persist', () => this._onPrivacyChanged()),
            settings.connect('changed::clipboard-size', () => this._trim()),
        ];

        if (this._enabled && this._persist)
            this._load().catch(e => console.error(`lume: could not load clipboard history: ${e.message}`));
    }

    get _enabled() {
        return this._settings.get_boolean('clipboard-history');
    }

    get _persist() {
        return this._settings.get_boolean('clipboard-persist');
    }

    owns(text) {
        // Off: let "clip …" fall through to normal results.
        return this._enabled && this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Clipboard') : null;
    }

    /** @returns {string|null} the text after "clip", or null without it */
    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-clipboard'));
    }

    query(text) {
        const filter = this._enabled ? this._filter(text) : null;
        if (filter === null)
            return [];
        // Unfiltered, leave room for the "Clear" row within max-results;
        // older items are reached by typing a filter. With room for one
        // row only, there is no "Clear" row: Enter must not wipe history.
        const maxResults = this._settings.get_int('max-results');
        const showClear = !filter && this._history.length > 0 && maxResults >= 2;
        const entries = filter
            ? this._history.filter(entry => matchScore(entry, filter) >= 0.6)
            : this._history.slice(0, showClear ? maxResults - 1 : maxResults);

        // The keyword is an explicit request, so these rank above apps.
        const results = entries.map((entry, index) => {
            const copy = () => this._clipboard.set_text(St.ClipboardType.CLIPBOARD, entry);
            return {
                id: `entry:${entry}`,
                title: toTitle(entry),
                subtitle: _('Copy to clipboard'),
                icon: 'edit-paste-symbolic',
                score: 0.99 - 0.001 * index,
                activate: copy,
                copy,
                paste: entry,
                    preview: () => ({text: entry, rows: [[_('Length'), _('%d characters').format(entry.length)]]}),
            };
        });

        if (showClear) {
            results.push({
                id: 'clear',
                title: _('Clear Clipboard History'),
                icon: 'edit-clear-all-symbolic',
                score: 0.98 - 0.001 * results.length,
                activate: () => this._clear(),
            });
        }
        return results;
    }

    _onClipboardChanged() {
        if (!this._enabled)
            return;

        const mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        if (mimetypes.includes(SECRET_HINT_MIMETYPE))
            return;

        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
            if (!this._destroyed)
                this._add(text);
        });
    }

    _add(text) {
        if (!text?.trim() || text.length > MAX_ENTRY_LENGTH || looksSecret(text))
            return;

        // Copying an item again (also from Lume itself) moves it to the top.
        this._history = [text, ...this._history.filter(entry => entry !== text)];
        this._trim();
        this._scheduleSave();
    }

    _trim() {
        this._history.length = Math.min(this._history.length, this._settings.get_int('clipboard-size'));
    }

    _clear() {
        this._history = [];
        this._deleteFile();
    }

    _onPrivacyChanged() {
        if (!this._enabled)
            this._history = [];
        // Turning either switch off removes the copy on disk.
        if (!this._enabled || !this._persist)
            this._deleteFile();
        else
            this._scheduleSave();
    }

    async _load() {
        let contents;
        try {
            [contents] = await this._file.load_contents_async(null);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return;
            throw e;
        }
        if (this._destroyed)
            return;

        const saved = JSON.parse(new TextDecoder().decode(contents));
        if (!Array.isArray(saved))
            return;

        // Entries copied since enable() stay on top.
        const valid = saved.filter(entry => typeof entry === 'string' && entry.length <= MAX_ENTRY_LENGTH);
        // Saved before secrets were skipped: drop them, also from the file.
        const loaded = valid.filter(entry => !looksSecret(entry));
        this._history = [...new Set([...this._history, ...loaded])];
        this._trim();
        if (loaded.length < valid.length)
            this._scheduleSave();
    }

    _scheduleSave() {
        if (!this._persist || this._saveId)
            return;
        // Batch quick successive copies into one write.
        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, SAVE_DELAY_SECONDS, () => {
            this._saveId = 0;
            this._save().catch(e => console.error(`lume: could not save clipboard history: ${e.message}`));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _save() {
        if (!this._enabled || !this._persist)
            return;
        // Snapshot first: destroy() clears the history while this runs.
        const json = JSON.stringify(this._history);

        // Gio has no async mkdir -p; this is a single syscall when it exists.
        const dir = this._file.get_parent().get_path();
        if (GLib.mkdir_with_parents(dir, 0o700) !== 0)
            throw new Error(`cannot create ${dir}`);

        const bytes = new GLib.Bytes(new TextEncoder().encode(json));
        // PRIVATE creates the file with mode 0600.
        await this._file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        // Persistence may have been turned off while writing.
        if (!this._enabled || !this._persist)
            this._deleteFile();
    }

    _deleteFile() {
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
        }
        this._file.delete_async(GLib.PRIORITY_LOW, null).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error(`lume: could not delete clipboard history: ${e.message}`);
        });
    }

    destroy() {
        this._destroyed = true;
        this._selection.disconnect(this._ownerChangedId);
        for (const id of this._settingsIds)
            this._settings.disconnect(id);

        // Write pending changes now rather than lose them.
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
            this._save().catch(e => console.error(`lume: could not save clipboard history: ${e.message}`));
        }
        this._history = [];
    }
}
