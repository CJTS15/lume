// SPDX-License-Identifier: GPL-3.0-or-later
//
// Git projects: folders with a .git (a folder, or a file for worktrees and
// submodules) up to 3 levels inside the project folders set in
// Preferences. Found by name in ordinary results, or behind "proj".
// Enter opens the project in an editor, Ctrl+Enter in a terminal.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {matchPrefix} from '../lib/prefix.js';
import {Provider} from '../lib/provider.js';
import {runInTerminal} from '../lib/terminal.js';

const MAX_DEPTH = 3;
const MAX_FOLDERS = 5000;
const RESCAN_SECONDS = 300;
const MIN_UNSCOPED_LENGTH = 3;
const SKIPPED = new Set(['node_modules', 'vendor', 'target', 'build', 'dist', '__pycache__']);
// Tried in order when no editor command is set; each opens a folder.
const EDITORS = [
    'com.microsoft.VSCode.desktop', 'code.desktop', 'com.visualstudio.code.desktop',
    'codium.desktop', 'com.vscodium.codium.desktop',
    'dev.zed.Zed.desktop', 'zed.desktop',
    'org.gnome.Builder.desktop',
];

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

function openUri(uri) {
    Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, (_o, res) => {
        try {
            Gio.AppInfo.launch_default_for_uri_finish(res);
        } catch (e) {
            console.error(`lume: could not open a project folder: ${e.message}`);
        }
    });
}

export class ProjectsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'projects', name: _('Projects'), label: _('Project')});
        this._settings = settings;
        this._home = GLib.get_home_dir();
        /** @type {string[]} project paths */
        this._projects = [];
        this._scanned = -Infinity;
        this._scan = null;
        this._cancellable = new Gio.Cancellable();
        this._foldersChangedId = settings.connect('changed::project-folders', () => {
            this._scanned = -Infinity;
        });
    }

    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-projects'));
    }

    owns(text) {
        return this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Projects') : null;
    }

    async query(text, cancellable) {
        const filter = this._filter(text);
        if (filter === null && text.length < MIN_UNSCOPED_LENGTH)
            return [];
        const projects = await this._list();
        if (cancellable.is_cancelled())
            return [];

        // Without the keyword, only a good name match, below apps that
        // match as well; behind it, a folder in the path matches too.
        const scored = projects.map(path => {
            const name = GLib.path_get_basename(path);
            return {
                path, name,
                score: filter === null ? matchScore(name, text)
                    : filter === '' ? 1 : Math.max(matchScore(name, filter),
                        // A folder on the way ("proj work" for ~/work/site).
                        ...this._short(path).split('/').map(part => 0.9 * matchScore(part, filter))),
            };
        }).filter(({score}) => score >= (filter === null ? 0.7 : 0.6))
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

        const editor = this._editor();
        return scored.slice(0, this._settings.get_int('max-results'))
            .map(({path, name, score}, index) => this._row(path, name,
                filter === null ? 0.5 + 0.08 * score : 0.99 - 0.001 * index, editor));
    }

    _row(path, name, score, editor) {
        const uri = Gio.File.new_for_path(path).get_uri();
        const files = () => openUri(uri);
        const edit = editor ? () => editor.open(path) : files;
        // The folder is an argument, never part of the script.
        const terminal = () => runInTerminal(this._settings,
            ['/bin/sh', '-c', 'cd -- "$1" && exec "${SHELL:-/bin/sh}"', 'sh', path]);
        const copyPath = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, path);
        return {
            id: path,
            title: name,
            subtitle: this._short(GLib.path_get_dirname(path)),
            icon: 'folder-development',
            score,
            activate: edit,
            ctrlActivate: terminal,
            copy: copyPath,
            actions: [
                // TRANSLATORS: %s is an editor, e.g. "Visual Studio Code"
                ...editor ? [{label: _('Open in %s').format(editor.name), icon: 'document-edit-symbolic', run: edit}] : [],
                {label: _('Open in Terminal'), icon: 'utilities-terminal-symbolic', run: terminal},
                {label: _('Open in Files'), icon: 'folder-open-symbolic', run: files},
                {label: _('Copy Path'), icon: 'edit-copy-symbolic', run: copyPath},
            ],
            preview: async () => ({
                gicon: Gio.ThemedIcon.new('folder-development'),
                rows: [[_('Branch'), await this._branch(path) ?? _('Unknown')], [_('Location'), this._short(path)]],
            }),
        };
    }

    /** @returns {{name: string, open: (path: string) => void}|null} */
    _editor() {
        const command = this._settings.get_string('project-editor').trim();
        if (command) {
            try {
                const [, argv] = GLib.shell_parse_argv(command);
                // The path is its own argument, never parsed by a shell.
                return {name: GLib.path_get_basename(argv[0]), open: path => Util.spawn([...argv, path])};
            } catch (e) {
                console.warn(`lume: ignoring the editor command: ${e.message}`);
            }
        }
        for (const id of EDITORS) {
            // Through the Shell: Gio.DesktopAppInfo warns on GNOME 51.
            const app = Shell.AppSystem.get_default().lookup_app(id)?.get_app_info();
            if (app) {
                return {
                    name: app.get_name(),
                    open: path => app.launch([Gio.File.new_for_path(path)], global.create_app_launch_context(0, -1)),
                };
            }
        }
        return null;
    }

    /** The current branch, from .git/HEAD (or a worktree's own HEAD). */
    async _branch(path) {
        const read = async file => new TextDecoder().decode((await Gio.File.new_for_path(file).load_contents_async(null))[0]);
        const git = GLib.build_filenamev([path, '.git']);
        let head;
        try {
            head = await read(GLib.build_filenamev([git, 'HEAD']));
        } catch {
            // A worktree or submodule: .git is a file naming the real one.
            try {
                const dir = (await read(git)).match(/^gitdir:\s*(.+)$/m)?.[1].trim();
                if (!dir)
                    return null;
                head = await read(GLib.build_filenamev([GLib.path_is_absolute(dir) ? dir : GLib.build_filenamev([path, dir]), 'HEAD']));
            } catch {
                return null;
            }
        }
        head = head.trim();
        return head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? head.slice(0, 7);
    }

    _short(path) {
        return path === this._home || path.startsWith(`${this._home}/`) ? `~${path.slice(this._home.length)}` : path;
    }

    /** The cached projects; a scan older than RESCAN_SECONDS runs in the background. */
    async _list() {
        const now = GLib.get_monotonic_time() / 1e6;
        if (now - this._scanned > RESCAN_SECONDS && !this._scan) {
            const first = this._scanned === -Infinity;
            this._scanned = now;
            this._scan = this._scanAll().then(projects => {
                this._projects = projects;
            }).catch(e => {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`lume: project scan failed: ${e.message}`);
            }).finally(() => {
                this._scan = null;
            });
            // The first search (or one after the folders changed) waits.
            if (first)
                await this._scan;
        }
        return this._projects;
    }

    async _scanAll() {
        const roots = [...new Set(this._settings.get_strv('project-folders')
            .map(folder => folder === '~' || folder.startsWith('~/') ? `${this._home}${folder.slice(1)}` : folder)
            .filter(folder => GLib.path_is_absolute(folder)))];
        const projects = [];
        const budget = {folders: 0};
        for (const root of roots)
            await this._walk(root, 0, projects, budget);
        return [...new Set(projects)];
    }

    async _walk(dir, depth, projects, budget) {
        if (++budget.folders > MAX_FOLDERS)
            return;
        let enumerator;
        try {
            // Symlinks are never followed, so a link loop can't trap the scan.
            enumerator = await Gio.File.new_for_path(dir).enumerate_children_async('standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, this._cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            if (depth === 0 && !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`lume: skipped project folder ${dir}: ${e.message}`);
            return;
        }
        const children = [];
        let infos;
        while ((infos = await enumerator.next_files_async(200, GLib.PRIORITY_LOW, this._cancellable)).length > 0) {
            for (const info of infos) {
                const name = info.get_name();
                if (name === '.git') {
                    projects.push(dir);
                    return; // Nested repositories (submodules) belong to this one.
                }
                if (info.get_file_type() === Gio.FileType.DIRECTORY && !name.startsWith('.') && !SKIPPED.has(name))
                    children.push(GLib.build_filenamev([dir, name]));
            }
        }
        if (depth < MAX_DEPTH) {
            for (const child of children)
                await this._walk(child, depth + 1, projects, budget);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._settings.disconnect(this._foldersChangedId);
        this._projects = [];
    }
}
