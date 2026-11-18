// SPDX-License-Identifier: GPL-3.0-or-later
//
// User scripts: an executable ~/.config/lume/scripts/<name> is run when the
// query starts with its name ("gh lume"), with the rest of the query as
// its one argument (never through a shell). Each line it prints,
// "title|subtitle|command", becomes a row; Enter runs the command with
// /bin/sh in the background. Only scripts the user put there ever run, and
// only for their own name; a script or folder that another user could
// change is never run.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchPrefix} from '../lib/prefix.js';
import {noAction, Provider} from '../lib/provider.js';
import {runInBackground} from '../lib/terminal.js';

const SCRIPTS_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'lume', 'scripts']);
const SCAN_SECONDS = 5;

const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 2000;
const MAX_LINES = 50;
const SIGTERM = 15;

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');
// The Shell may already have wrapped read_line_async (with bytes as the
// result), and a second wrap is ignored, so lines are decoded below.
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8');

export class ScriptsProvider extends Provider {
    constructor() {
        super({id: 'scripts', name: _('User Scripts'), label: _('Script')});
        /** @type {Map<string, string>} name -> path */
        this._scripts = new Map();
        this._uid = new Gio.Credentials().get_unix_user();
        this._scanned = 0;
        this._scanning = null;
        this._debounce = null;
        this._destroyed = false;
        this._scan();
    }

    /** @returns {{name: string, rest: string}|null} */
    _match(text) {
        // Rescan in the background now and then; this answer uses the last.
        if (GLib.get_monotonic_time() / 1e6 - this._scanned > SCAN_SECONDS)
            this._scan();
        for (const name of this._scripts.keys()) {
            const rest = matchPrefix(text, [name]);
            if (rest !== null)
                return {name, rest};
        }
        return null;
    }

    owns(text) {
        return this._match(text) !== null;
    }

    scope(text) {
        return this._match(text)?.name ?? null;
    }

    _scan() {
        this._scanning ??= this._listScripts().then(scripts => {
            this._scripts = scripts;
        }).catch(e => {
            console.debug(`lume: could not read ${SCRIPTS_DIR}: ${e.message}`);
            this._scripts = new Map();
        }).finally(() => {
            this._scanned = GLib.get_monotonic_time() / 1e6;
            this._scanning = null;
        });
    }

    async _listScripts() {
        const scripts = new Map();
        const dir = Gio.File.new_for_path(SCRIPTS_DIR);
        let enumerator;
        try {
            enumerator = await dir.enumerate_children_async(
                'standard::name,standard::type,access::can-execute',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return scripts;
            throw e;
        }
        try {
            let infos;
            while ((infos = await enumerator.next_files_async(50, GLib.PRIORITY_LOW, null)).length > 0) {
                for (const info of infos) {
                    const name = info.get_name();
                    // A name with spaces could never be typed as a prefix.
                    if (info.get_file_type() === Gio.FileType.REGULAR &&
                        info.get_attribute_boolean('access::can-execute') && !/\s/.test(name) && !name.startsWith('.'))
                        scripts.set(name, GLib.build_filenamev([SCRIPTS_DIR, name]));
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
        return scripts;
    }

    /**
     * Whether another user could change the script, or swap it by changing
     * a folder above it: the script or any folder up to / is owned by
     * someone other than the user or root, or writable by group or others
     * (the rule ssh applies to ~/.ssh). Checked right before each run.
     *
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    async _unsafe(path) {
        // Limitation: a symlinked folder's own parents are not walked; the
        // usual layout has none. Resolve symlinks first if that changes.
        for (let file = Gio.File.new_for_path(path); file; file = file.get_parent()) {
            const info = await file.query_info_async('unix::uid,unix::mode',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            const uid = info.get_attribute_uint32('unix::uid');
            const mode = info.get_attribute_uint32('unix::mode');
            // A sticky folder (/tmp) is fine: others can't rename what is ours.
            if ((uid !== this._uid && uid !== 0) || ((mode & 0o022) !== 0 && (mode & 0o1000) === 0))
                return true;
        }
        return false;
    }

    async query(text, cancellable) {
        const match = this._match(text);
        if (!match)
            return [];
        const path = this._scripts.get(match.name);
        await this._wait();
        if (cancellable.is_cancelled() || this._destroyed)
            return [];

        // After the wait: right before the run, not 300 ms earlier.
        if (await this._unsafe(path)) {
            return [{
                id: 'unsafe',
                type: match.name,
                title: _('Script “%s” not run').format(match.name),
                subtitle: _('Other users can change it or a folder above it. Fix with: chmod go-w'),
                icon: 'dialog-warning-symbolic',
                score: 0.97,
                activate: noAction,
            }];
        }

        const lines = await this._run(path, match.rest, cancellable);
        return lines.map(line => line.split('|'))
            .filter(([title]) => title?.trim())
            .map(([title, subtitle, ...command], index) => {
                const run = command.join('|').trim();
                const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, title.trim());
                return {
                    id: `${index}:${title}`,
                    type: match.name,
                    title: title.trim(),
                    subtitle: subtitle?.trim() || undefined,
                    icon: 'application-x-executable-symbolic',
                    score: 0.97 - 0.001 * index,
                    activate: run ? () => runInBackground(run) : copy,
                    copy,
                };
            });
    }

    /**
     * Run `path rest` for at most TIMEOUT_MS and read at most MAX_LINES
     * lines of its output.
     *
     * @returns {Promise<string[]>}
     */
    async _run(path, rest, cancellable) {
        let process;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            launcher.set_cwd(GLib.get_home_dir());
            // timeout(1) runs the script in its own process group and ends
            // the whole group, so children it started do not outlive it.
            const timeout = GLib.find_program_in_path('timeout');
            const seconds = String(TIMEOUT_MS / 1000 + 1);
            // Low CPU priority, so a busy script never slows the desktop.
            const nice = GLib.find_program_in_path('nice');
            process = launcher.spawnv([
                ...nice ? [nice, '-n', '10'] : [],
                ...timeout ? [timeout, '-k', '1', seconds] : [],
                path, rest,
            ]);
        } catch (e) {
            console.warn(`lume: could not run script ${path}: ${e.message}`);
            return [];
        }

        const stop = new Gio.Cancellable();
        let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_MS, () => {
            timeoutId = 0; // Fired: removing it again would warn.
            stop.cancel();
            return GLib.SOURCE_REMOVE;
        });
        const cancelId = cancellable.connect(() => stop.cancel());

        const lines = [];
        const stream = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
        try {
            while (lines.length < MAX_LINES) {
                const [line] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, stop);
                if (line === null)
                    break;
                lines.push(typeof line === 'string' ? line : new TextDecoder().decode(line));
            }
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`lume: script ${path}: ${e.message}`);
        } finally {
            if (timeoutId)
                GLib.source_remove(timeoutId);
            cancellable.disconnect(cancelId);
            // Stopped early (timeout, enough lines, newer query): end it.
            // SIGTERM, which timeout(1) passes on to the script's group.
            process.send_signal(SIGTERM);
        }
        return lines;
    }

    /**
     * Resolve after DEBOUNCE_MS, or right away when a newer query replaces
     * this one (the caller then sees its cancellable is cancelled).
     */
    _wait() {
        if (this._debounce) {
            GLib.source_remove(this._debounce.id);
            this._debounce.resolve();
        }
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._debounce = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._debounce = {id, resolve};
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._debounce) {
            GLib.source_remove(this._debounce.id);
            this._debounce.resolve();
            this._debounce = null;
        }
        this._scripts.clear();
    }
}
