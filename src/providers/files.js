// SPDX-License-Identifier: GPL-3.0-or-later
//
// Files and folders.
// - A name or part of a path: from the LocalSearch (Tracker) index, as
//   fuzzy as the fuzzy-matching setting allows. Without an index, a bounded
//   walk of the home folder.
// - A path ("~/Documents/", "/etc/"): lists that folder, filtered by what
//   follows the last slash.
// - With file-contents on, also text inside indexed files.
// Enter opens, Ctrl+Enter shows the file in its folder, Alt+Enter shows its
// properties, Ctrl+C copies it (for pasting in Files).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {evaluate} from '../lib/calculator.js';
import {fuzzyScore, matchScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 3;
// "e name": files only.
const PREFIX = /^e\s+/i;
const MAX_RESULTS = 5;
// Fetch more than shown; results are scored and cut afterwards.
const QUERY_LIMIT = 40;
const CONTENT_LIMIT = 20;
// Longer loose queries make long regexes for little gain.
const MAX_LOOSE_LENGTH = 40;
const BROWSE_SCORE = 0.96;
// Index queries scan every file name (about 50 to 150 ms in LocalSearch,
// which keeps working after a cancel): wait for typing to pause.
const DEBOUNCE_MS = 150;
const BROWSE_MAX_ENTRIES = 2000;
const BROWSE_CACHE_SECONDS = 10;

// LocalSearch3 is the name since GNOME 47; the Tracker3 name is the older
// one, and is still provided as an alias.
const SERVICES = ['org.freedesktop.LocalSearch3', 'org.freedesktop.Tracker3.Miner.Files'];

// Hidden files and node_modules are noise in a launcher; drop them in the
// query so they do not use up the LIMIT.
const NOT_NOISE = 'FILTER(!CONTAINS(?url, "/.") && !CONTAINS(?url, "/node_modules/"))';

// One filter per fuzziness level. User text only ever reaches SPARQL as the
// bound ~term parameter.
const NAME_FILTERS = {
    strict: {match: '?f fts:match ~term .', order: 'DESC(fts:rank(?f))'},
    normal: {match: 'FILTER(CONTAINS(LCASE(?name), ~term))', order: 'STRLEN(?name)'},
    loose: {match: 'FILTER(REGEX(?name, ~term, "i"))', order: 'STRLEN(?name)'},
};
const PATH_FILTERS = {
    contains: {match: 'FILTER(CONTAINS(LCASE(?url), ~term))', order: 'STRLEN(?url)'},
    loose: {match: 'FILTER(REGEX(?url, ~term, "i"))', order: 'STRLEN(?url)'},
};

const nameQuery = ({match, order}) => `
SELECT ?url ?name ?folder WHERE {
  GRAPH tracker:FileSystem {
    ?f a nfo:FileDataObject ;
       nie:url ?url ;
       nfo:fileName ?name .
    ${match}
    ${NOT_NOISE}
    BIND(EXISTS { ?f nie:interpretedAs/rdf:type nfo:Folder } AS ?folder)
  }
} ORDER BY ${order} LIMIT ${QUERY_LIMIT}`;

const CONTENT_QUERY = `
SELECT ?url ?name WHERE {
  ?ie fts:match ~term ;
      nie:isStoredAs ?f .
  ?f nie:url ?url ;
     nfo:fileName ?name .
  ${NOT_NOISE}
} ORDER BY DESC(fts:rank(?ie)) LIMIT ${CONTENT_LIMIT}`;

const WALK_MAX_DEPTH = 3;
const WALK_MAX_ENTRIES = 5000;
const WALK_CACHE_SECONDS = 300;

const ENUMERATE_ATTRIBUTES = 'standard::name,standard::type,standard::is-hidden';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

/**
 * TinySPARQL is `Tsparql` since GNOME 47 and `Tracker` before; a static
 * import could not fall back, so load it on first use.
 *
 * @returns {Promise<object|null>} the namespace, or null if neither exists
 */
async function importSparql() {
    for (const name of ['gi://Tsparql', 'gi://Tracker?version=3.0']) {
        try {
            const sparql = (await import(name)).default;
            Gio._promisify(sparql.SparqlConnection, 'bus_new_async', 'bus_new_finish');
            Gio._promisify(sparql.SparqlStatement.prototype, 'execute_async');
            Gio._promisify(sparql.SparqlCursor.prototype, 'next_async');
            return sparql;
        } catch {
            // Try the next name.
        }
    }
    return null;
}

/**
 * Turn free text into an FTS query: each word becomes a prefix match.
 * Dropping everything but letters and digits keeps FTS syntax (quotes,
 * `*`, `-`, AND/OR) out of user input.
 *
 * @param {string} text
 * @returns {string} empty when no word is left
 */
function toFtsQuery(text) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.map(w => `${w}*`).join(' ');
}

/** "rpt" -> "r.*?p.*?t": the characters in order, anything in between. */
function toLooseRegex(text) {
    return [...text].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?');
}

/** Escape like g_file_get_uri(), so text can be matched against nie:url. */
function escapeForUri(text) {
    return GLib.uri_escape_string(text, "!$&'()*+,;=:@/", false);
}

function isNoisePath(path) {
    return path.split('/').some(part => part.startsWith('.') || part === 'node_modules');
}

function callFileManager(method, uri) {
    Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', method, new GLib.Variant('(ass)', [[uri], '']),
        null, Gio.DBusCallFlags.NONE, -1, null, (connection, res) => {
            try {
                connection.call_finish(res);
            } catch (e) {
                console.error(`lume: ${method} for ${uri} failed: ${e.message}`);
            }
        });
}

export class FilesProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'files', name: _('Files'), label: _('File')});
        this._settings = settings;
        this._sparql = undefined;
        this._connection = null;
        this._serviceIndex = 0;
        this._serviceWorks = false;
        this._walk = null;
        this._walkCancellable = new Gio.Cancellable();
        this._listing = null;
        this._debounce = null;
        this._destroyed = false;
        this._home = GLib.get_home_dir();
    }

    owns(text) {
        // "e * 2" is the constant e, not a file search.
        return PREFIX.test(text) && evaluate(text) === null;
    }

    scope(text) {
        if (this.owns(text))
            return _('Files');
        return this._browseTarget(text) ? _('Folder') : null;
    }

    async query(text, cancellable) {
        const level = this._settings.get_string('fuzzy-matching');
        text = text.replace(PREFIX, '').trim();

        const target = this._browseTarget(text);
        if (target)
            return this._browse(target, level, cancellable);

        if (text.length < MIN_QUERY_LENGTH)
            return [];

        await this._wait();
        if (cancellable.is_cancelled() || this._destroyed)
            return [];

        const byPath = text.includes('/');
        let files = await this._indexQuery(text, level, byPath, cancellable);
        if (files === null) {
            files = await this._walkQuery(text, level);
        } else if (!byPath && this._settings.get_boolean('file-contents')) {
            const seen = new Set(files.map(f => f.uri));
            const inContents = await this._contentQuery(text, cancellable);
            files.push(...inContents.filter(f => !seen.has(f.uri)));
        }

        return files
            .filter(file => !isNoisePath(file.path))
            .map(file => {
                // The index already applied the fuzziness level; matchScore
                // only orders. Content matches rank below name matches.
                // Files stay below apps (0.6+) so a slow index never pushes
                // an app off the list.
                const match = file.inContents ? 0 : matchScore(byPath ? file.path : file.name, text);
                return {...file, score: 0.2 + 0.3 * Math.max(match, file.inContents ? 0.2 : 0.3)};
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map(file => this._toResult(file));
    }

    /**
     * Resolve after DEBOUNCE_MS, or right away when a newer query replaces
     * this one (the caller then sees its cancellable is cancelled).
     */
    _wait() {
        this._cancelWait();
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._debounce = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._debounce = {id, resolve};
        });
    }

    _cancelWait() {
        if (!this._debounce)
            return;
        GLib.source_remove(this._debounce.id);
        this._debounce.resolve();
        this._debounce = null;
    }

    /**
     * @returns {{dir: string, shown: string, filter: string}|null} the folder
     *   to list when `text` is a path ("~/Doc", "/etc/"), else null
     */
    _browseTarget(text) {
        if (text === '~')
            text = '~/';
        if (!text.startsWith('/') && !text.startsWith('~/'))
            return null;
        const slash = text.lastIndexOf('/');
        const shown = text.slice(0, slash + 1);
        const dir = shown.startsWith('~/') ? `${this._home}${shown.slice(1)}` : shown;
        return {dir, shown, filter: text.slice(slash + 1)};
    }

    async _browse({dir, shown, filter}, level, cancellable) {
        const entries = await this._list(dir, cancellable);
        const showHidden = filter.startsWith('.');

        return entries
            .filter(entry => showHidden || !entry.hidden)
            .map(entry => ({...entry, match: filter ? fuzzyScore(entry.name, filter, level) : 1}))
            .filter(entry => entry.match > 0)
            .sort((a, b) => b.match - a.match || b.folder - a.folder ||
                a.name.localeCompare(b.name))
            .slice(0, 50)
            .map(entry => this._toResult({...entry, score: BROWSE_SCORE}, shown));
    }

    /** Folder entries, cached briefly so typing a filter does not re-read. */
    async _list(dir, cancellable) {
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._listing?.dir === dir && now - this._listing.time < BROWSE_CACHE_SECONDS)
            return this._listing.entries;

        const folder = Gio.File.new_for_path(dir);
        let enumerator;
        try {
            enumerator = await folder.enumerate_children_async(ENUMERATE_ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return []; // Missing or unreadable: nothing to list.
        }

        const entries = [];
        try {
            let infos;
            while (entries.length < BROWSE_MAX_ENTRIES &&
                (infos = await enumerator.next_files_async(200, GLib.PRIORITY_DEFAULT, cancellable)).length > 0) {
                for (const info of infos) {
                    const child = folder.get_child(info.get_name());
                    entries.push({
                        uri: child.get_uri(),
                        path: child.get_path(),
                        name: info.get_name(),
                        folder: info.get_file_type() === Gio.FileType.DIRECTORY,
                        hidden: info.get_is_hidden(),
                    });
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
        this._listing = {dir, time: now, entries};
        return entries;
    }

    /**
     * @returns {Promise<object[]|null>} null when no index is reachable
     */
    async _indexQuery(text, level, byPath, cancellable) {
        let sparql, term;
        if (byPath) {
            const loose = level === 'loose' && text.length <= MAX_LOOSE_LENGTH;
            sparql = nameQuery(loose ? PATH_FILTERS.loose : PATH_FILTERS.contains);
            // Lowercase after escaping: LCASE(?url) also lowercases %C3%A9.
            term = loose ? toLooseRegex(escapeForUri(text)) : escapeForUri(text).toLowerCase();
        } else if (level === 'loose' && text.length <= MAX_LOOSE_LENGTH) {
            sparql = nameQuery(NAME_FILTERS.loose);
            term = toLooseRegex(text);
        } else if (level === 'strict') {
            sparql = nameQuery(NAME_FILTERS.strict);
            term = toFtsQuery(text);
        } else {
            sparql = nameQuery(NAME_FILTERS.normal);
            term = text.toLowerCase();
        }
        if (!term)
            return [];
        return this._run(sparql, term, cancellable);
    }

    async _contentQuery(text, cancellable) {
        const term = toFtsQuery(text);
        if (!term)
            return [];
        const files = await this._run(CONTENT_QUERY, term, cancellable) ?? [];
        return files.map(file => ({...file, inContents: true}));
    }

    /**
     * Run a query on the first index service that answers.
     *
     * @returns {Promise<object[]|null>} null when no index is reachable
     */
    async _run(sparql, term, cancellable) {
        if (this._sparql === undefined)
            this._sparql = await importSparql();
        if (!this._sparql)
            return null;

        while (this._serviceIndex < SERVICES.length) {
            try {
                return await this._execute(sparql, term, cancellable);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    throw e;
                // Once a service has answered, a failure is about this query
                // (e.g. an FTS term it rejects), not the service.
                if (this._serviceWorks) {
                    console.debug(`lume: file search failed: ${e.message}`);
                    return [];
                }
                console.debug(`lume: ${SERVICES[this._serviceIndex]} unavailable: ${e.message}`);
                this._closeConnection();
                this._serviceIndex++;
            }
        }
        return null;
    }

    async _execute(sparql, term, cancellable) {
        if (!this._connection) {
            const connection = await this._sparql.SparqlConnection.bus_new_async(
                SERVICES[this._serviceIndex], null, null, cancellable);
            if (this._destroyed) {
                connection.close();
                return [];
            }
            this._connection = connection;
        }

        const statement = this._connection.query_statement(sparql, cancellable);
        statement.bind_string('term', term);
        const cursor = await statement.execute_async(cancellable);

        const files = [];
        try {
            const hasFolderColumn = cursor.get_n_columns() > 2;
            while (await cursor.next_async(cancellable)) {
                const uri = cursor.get_string(0)[0];
                const path = Gio.File.new_for_uri(uri).get_path();
                if (path) {
                    files.push({
                        uri,
                        path,
                        name: cursor.get_string(1)[0],
                        folder: hasFolderColumn && cursor.get_boolean(2),
                    });
                }
            }
        } finally {
            cursor.close();
        }
        this._serviceWorks = true;
        return files;
    }

    async _walkQuery(text, level) {
        const now = GLib.get_monotonic_time() / 1e6;
        if (!this._walk || now - this._walk.time > WALK_CACHE_SECONDS) {
            // The walk has its own cancellable: typing cancels each query, and
            // that must not restart the walk on every key press.
            const entries = [];
            this._walk = {
                time: now,
                done: this._walkDir(Gio.File.new_for_path(this._home), 0, entries,
                    this._walkCancellable).then(() => entries),
            };
        }
        const entries = await this._walk.done;
        // Over thousands of names a subsequence is noise unless the user
        // asked for loose matching.
        return entries.filter(e => fuzzyScore(e.name, text, level) > 0);
    }

    async _walkDir(dir, depth, entries, cancellable) {
        let enumerator;
        try {
            enumerator = await dir.enumerate_children_async(ENUMERATE_ATTRIBUTES,
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return; // Unreadable folder: skip it.
        }

        const subdirs = [];
        try {
            let infos;
            while ((infos = await enumerator.next_files_async(100, GLib.PRIORITY_LOW, cancellable)).length > 0) {
                for (const info of infos) {
                    if (info.get_is_hidden())
                        continue;
                    const child = dir.get_child(info.get_name());
                    const folder = info.get_file_type() === Gio.FileType.DIRECTORY;
                    entries.push({
                        uri: child.get_uri(),
                        path: child.get_path(),
                        name: info.get_name(),
                        folder,
                    });
                    if (entries.length >= WALK_MAX_ENTRIES)
                        return;
                    if (folder && depth + 1 < WALK_MAX_DEPTH)
                        subdirs.push(child);
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }

        for (const subdir of subdirs) {
            if (entries.length >= WALK_MAX_ENTRIES)
                return;
            await this._walkDir(subdir, depth + 1, entries, cancellable);
        }
    }

    _shortPath(path) {
        return path === this._home || path.startsWith(`${this._home}/`)
            ? `~${path.slice(this._home.length)}`
            : path;
    }

    /**
     * @param {object} file
     * @param {string} [shownFolder] - when listing a folder, its path as typed
     */
    _toResult({uri, path, name, folder, inContents, score}, shownFolder) {
        const icon = folder
            ? 'folder'
            : Gio.content_type_get_icon(Gio.content_type_guess(name, null)[0]);
        const location = shownFolder ?? this._shortPath(GLib.path_get_dirname(path));

        return {
            id: uri,
            title: folder && shownFolder ? `${name}/` : name,
            type: folder ? _('Folder') : undefined,
            subtitle: inContents
                // TRANSLATORS: %s is a folder path
                ? _('%s · matches contents').format(location)
                : location,
            icon,
            score,
            activate: () => {
                Gio.AppInfo.launch_default_for_uri_async(uri,
                    global.create_app_launch_context(0, -1), null, (_o, res) => {
                        try {
                            Gio.AppInfo.launch_default_for_uri_finish(res);
                        } catch (e) {
                            console.error(`lume: could not open ${uri}: ${e.message}`);
                        }
                    });
            },
            ctrlActivate: () => callFileManager('ShowItems', uri),
            altActivate: () => callFileManager('ShowItemProperties', uri),
            // The format Files reads when pasting copied files.
            copy: () => St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD,
                'x-special/gnome-copied-files', new GLib.Bytes(new TextEncoder().encode(`copy\n${uri}`))),
        };
    }

    _closeConnection() {
        this._connection?.close();
        this._connection = null;
    }

    destroy() {
        this._destroyed = true;
        this._cancelWait();
        this._walkCancellable.cancel();
        this._closeConnection();
        this._walk = null;
        this._listing = null;
    }
}
