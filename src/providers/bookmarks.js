// SPDX-License-Identifier: GPL-3.0-or-later
//
// Bookmarks from Chromium-family browsers (Chrome, Chromium, Brave, Edge,
// Vivaldi; also their Flatpaks), every profile. Found by name in ordinary
// results, or behind "bm" by name or address. Enter opens the page in the
// default browser. Firefox bookmarks come from Firefox's own search
// provider (providers/remote.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {parseBookmarks, shortUrl} from '../lib/bookmarks.js';
import {matchScore} from '../lib/match.js';
import {matchPrefix} from '../lib/prefix.js';
import {Provider} from '../lib/provider.js';

// [folder under the config dir, name, Flatpak app id]
const BROWSERS = [
    ['google-chrome', 'Google Chrome', 'com.google.Chrome'],
    ['google-chrome-beta', 'Google Chrome Beta', null],
    ['google-chrome-unstable', 'Google Chrome Dev', null],
    ['chromium', 'Chromium', 'org.chromium.Chromium'],
    ['BraveSoftware/Brave-Browser', 'Brave', 'com.brave.Browser'],
    ['microsoft-edge', 'Microsoft Edge', 'com.microsoft.Edge'],
    ['microsoft-edge-beta', 'Microsoft Edge Beta', null],
    ['microsoft-edge-dev', 'Microsoft Edge Dev', null],
    ['vivaldi', 'Vivaldi', 'com.vivaldi.Vivaldi'],
];
// Look for new or changed files at most this often.
const RELOAD_SECONDS = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIN_UNSCOPED_LENGTH = 3;
const ICON = 'user-bookmarks-symbolic';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

function open(url) {
    Gio.AppInfo.launch_default_for_uri_async(url, global.create_app_launch_context(0, -1), null, (_o, res) => {
        try {
            Gio.AppInfo.launch_default_for_uri_finish(res);
        } catch (e) {
            // Never log the address.
            console.error(`lume: could not open a bookmark: ${e.message}`);
        }
    });
}

export class BookmarksProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'bookmarks', name: _('Bookmarks'), label: _('Bookmark')});
        this._settings = settings;
        /** @type {Map<string, {modified: number, browser: string, bookmarks: object[]}>} path -> parsed file */
        this._files = new Map();
        this._checked = 0;
        this._loading = null;
        this._destroyed = false;
    }

    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-bookmarks'));
    }

    owns(text) {
        return this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Bookmarks') : null;
    }

    async query(text, cancellable) {
        const filter = this._filter(text);
        if (filter === null && text.length < MIN_UNSCOPED_LENGTH)
            return [];
        const bookmarks = await this._bookmarks();
        if (cancellable.is_cancelled())
            return [];

        // Without the keyword, only a good name match, below apps that
        // match as well; behind it, the address matches too.
        const scored = bookmarks.map(bookmark => ({
            bookmark,
            score: filter === null ? matchScore(bookmark.name, text)
                : filter === '' ? 1
                    : Math.max(matchScore(bookmark.name, filter), 0.9 * matchScore(shortUrl(bookmark.url), filter)),
        })).filter(({score}) => score >= (filter === null ? 0.7 : 0.6));
        if (filter)
            scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, this._settings.get_int('max-results')).map(({bookmark, score}, index) => {
            const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, bookmark.url);
            return {
                id: bookmark.url,
                title: bookmark.name || shortUrl(bookmark.url),
                subtitle: `${shortUrl(bookmark.url)} · ${bookmark.browser}`,
                icon: ICON,
                score: filter === null ? 0.5 + 0.08 * score : 0.99 - 0.001 * index,
                activate: () => open(bookmark.url),
                copy,
                paste: bookmark.url,
            };
        });
    }

    /** Every browser's bookmarks, each address once; files re-read when changed. */
    async _bookmarks() {
        const now = GLib.get_monotonic_time() / 1e6;
        if (now - this._checked > RELOAD_SECONDS) {
            this._checked = now;
            this._loading ??= this._reload().catch(e => console.error(`lume: could not read bookmarks: ${e.message}`))
                .finally(() => {
                    this._loading = null;
                });
        }
        // The first search waits for the files; later ones use what is there.
        if (this._files.size === 0 && this._loading)
            await this._loading;
        const seen = new Set();
        const all = [];
        for (const {browser, bookmarks} of this._files.values()) {
            for (const bookmark of bookmarks) {
                if (!seen.has(bookmark.url)) {
                    seen.add(bookmark.url);
                    all.push({...bookmark, browser});
                }
            }
        }
        return all;
    }

    async _reload() {
        const config = GLib.get_user_config_dir();
        const apps = GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app']);
        const bases = BROWSERS.flatMap(([folder, browser, flatpak]) => [
            [GLib.build_filenamev([config, folder]), browser],
            ...flatpak ? [[GLib.build_filenamev([apps, flatpak, 'config', folder]), browser]] : [],
        ]);
        const found = (await Promise.all(bases.map(([base, browser]) => this._profiles(base, browser)))).flat();

        const files = new Map();
        await Promise.all(found.map(async ({path, browser}) => {
            const file = Gio.File.new_for_path(path);
            let info;
            try {
                info = await file.query_info_async('time::modified,standard::size',
                    Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
            } catch {
                return; // This profile has no bookmarks.
            }
            const modified = info.get_modification_date_time()?.to_unix() ?? 0;
            const cached = this._files.get(path);
            if (cached?.modified === modified) {
                files.set(path, cached);
                return;
            }
            if (info.get_size() > MAX_FILE_BYTES)
                return;
            try {
                const [contents] = await file.load_contents_async(null);
                files.set(path, {modified, browser, bookmarks: parseBookmarks(new TextDecoder().decode(contents))});
            } catch (e) {
                // A browser writing the file right now; try again next time.
                console.warn(`lume: skipped ${browser} bookmarks: ${e.name}`);
            }
        }));
        if (!this._destroyed)
            this._files = files;
    }

    /** @returns {Promise<{path: string, browser: string}[]>} the profiles' Bookmarks files */
    async _profiles(base, browser) {
        let enumerator;
        try {
            enumerator = await Gio.File.new_for_path(base).enumerate_children_async('standard::name',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, null);
        } catch {
            return []; // Not installed.
        }
        const profiles = [];
        try {
            let infos;
            while ((infos = await enumerator.next_files_async(100, GLib.PRIORITY_LOW, null)).length > 0) {
                for (const info of infos) {
                    const name = info.get_name();
                    if (name === 'Default' || name.startsWith('Profile '))
                        profiles.push({path: GLib.build_filenamev([base, name, 'Bookmarks']), browser});
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
        return profiles;
    }

    destroy() {
        this._destroyed = true;
        this._files.clear();
    }
}
