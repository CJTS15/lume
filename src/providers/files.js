// SPDX-License-Identifier: GPL-3.0-or-later
//
// Files and folders by name, from the LocalSearch (Tracker) index. If no
// index is available, falls back to a bounded walk of the home folder.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 5;
// Fetch more than shown: hidden and node_modules paths are dropped after.
const QUERY_LIMIT = 40;

// LocalSearch3 is the name since GNOME 47; the Tracker3 name is the older
// one, and is still provided as an alias.
const SERVICES = ['org.freedesktop.LocalSearch3', 'org.freedesktop.Tracker3.Miner.Files'];

const SPARQL = `
SELECT ?url ?name ?folder WHERE {
  GRAPH tracker:FileSystem {
    ?f a nfo:FileDataObject ;
       nie:url ?url ;
       nfo:fileName ?name ;
       fts:match ~term .
    BIND(EXISTS { ?f nie:interpretedAs/rdf:type nfo:Folder } AS ?folder)
  }
} ORDER BY DESC(fts:rank(?f)) LIMIT ${QUERY_LIMIT}`;

const WALK_MAX_DEPTH = 3;
const WALK_MAX_ENTRIES = 5000;
const WALK_CACHE_SECONDS = 300;

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

function isNoisePath(path) {
    return path.split('/').some(part => part.startsWith('.') || part === 'node_modules');
}

export class FilesProvider extends Provider {
    constructor() {
        super({id: 'files', name: _('Files')});
        this._sparql = undefined;
        this._connection = null;
        this._serviceIndex = 0;
        this._serviceWorks = false;
        this._walk = null;
        this._walkCancellable = new Gio.Cancellable();
        this._destroyed = false;
        this._home = GLib.get_home_dir();
    }

    async query(text, cancellable) {
        if (text.length < MIN_QUERY_LENGTH)
            return [];

        const files = await this._indexQuery(text, cancellable) ??
            await this._walkQuery(text);

        return files
            .filter(file => !isNoisePath(file.path))
            .map(file => ({
                ...file,
                // Files stay below apps (0.6+) so a slow index never pushes
                // an app off the list.
                score: 0.2 + 0.3 * matchScore(file.name, text),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map(file => this._toResult(file));
    }

    /**
     * @returns {Promise<object[]|null>} null when no index is reachable
     */
    async _indexQuery(text, cancellable) {
        const term = toFtsQuery(text);
        if (!term)
            return [];

        if (this._sparql === undefined)
            this._sparql = await importSparql();
        if (!this._sparql)
            return null;

        while (this._serviceIndex < SERVICES.length) {
            try {
                return await this._runQuery(term, cancellable);
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

    async _runQuery(term, cancellable) {
        if (!this._connection) {
            const connection = await this._sparql.SparqlConnection.bus_new_async(
                SERVICES[this._serviceIndex], null, null, cancellable);
            if (this._destroyed) {
                connection.close();
                return [];
            }
            this._connection = connection;
        }

        const statement = this._connection.query_statement(SPARQL, cancellable);
        statement.bind_string('term', term);
        const cursor = await statement.execute_async(cancellable);

        const files = [];
        try {
            while (await cursor.next_async(cancellable)) {
                const uri = cursor.get_string(0)[0];
                const path = Gio.File.new_for_uri(uri).get_path();
                if (path) {
                    files.push({
                        uri,
                        path,
                        name: cursor.get_string(1)[0],
                        folder: cursor.get_boolean(2),
                    });
                }
            }
        } finally {
            cursor.close();
        }
        this._serviceWorks = true;
        return files;
    }

    async _walkQuery(text) {
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
        // Substring or better: a subsequence over thousands of names is noise.
        return entries.filter(e => matchScore(e.name, text) >= 0.6);
    }

    async _walkDir(dir, depth, entries, cancellable) {
        let enumerator;
        try {
            enumerator = await dir.enumerate_children_async(
                'standard::name,standard::type,standard::is-hidden',
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

    _toResult({uri, path, name, folder, score}) {
        const parent = GLib.path_get_dirname(path);
        const icon = folder
            ? 'folder'
            : Gio.content_type_get_icon(Gio.content_type_guess(name, null)[0]);

        return {
            id: uri,
            title: name,
            subtitle: parent === this._home || parent.startsWith(`${this._home}/`)
                ? `~${parent.slice(this._home.length)}`
                : parent,
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
        };
    }

    _closeConnection() {
        this._connection?.close();
        this._connection = null;
    }

    destroy() {
        this._destroyed = true;
        this._walkCancellable.cancel();
        this._closeConnection();
        this._walk = null;
    }
}
