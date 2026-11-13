// SPDX-License-Identifier: GPL-3.0-or-later
//
// Commands: when the first word is a program on PATH ("htop", "git status",
// "ls -la"), offer to run the line. Enter runs it in the background,
// Ctrl+Enter in a terminal window. The line is run by /bin/sh, as if typed
// in a terminal, because that is what the user typed it for.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {runInTerminal} from '../lib/terminal.js';

const TITLE_LENGTH = 80;
const ERROR_LENGTH = 300;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export class CliProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'cli', name: _('Commands')});
        this._settings = settings;
    }

    query(text) {
        if (!this._settings.get_boolean('run-commands'))
            return [];
        const program = text.split(/\s+/)[0];
        // A path to a folder ("/etc/") is a file browse, not a command.
        if (!GLib.find_program_in_path(program))
            return [];

        const hasArgs = program !== text;
        const shown = text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text;
        return [{
            id: 'run',
            title: shown,
            subtitle: _('Run in background · Ctrl+Enter to run in a terminal'),
            icon: 'utilities-terminal-symbolic',
            // A bare word ("firefox", "htop") is more likely an app search:
            // stay below apps. With arguments it is clearly a command.
            score: hasArgs ? 0.92 : 0.45,
            activate: () => this._runInBackground(text),
            // eval keeps the line as typed; the shell after it keeps the
            // window open so the output can be read.
            ctrlActivate: () => runInTerminal(this._settings,
                ['/bin/sh', '-c', 'eval "$1"; exec "${SHELL:-/bin/sh}"', 'sh', text]),
        }];
    }

    async _runInBackground(line) {
        let stderr, status;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.set_cwd(GLib.get_home_dir());
            const process = launcher.spawnv(['/bin/sh', '-c', line]);
            [, stderr] = await process.communicate_utf8_async(null, null);
            if (process.get_successful())
                return;
            status = process.get_exit_status();
        } catch (e) {
            stderr = e.message;
        }
        const detail = stderr?.trim().slice(-ERROR_LENGTH) ||
            _('Exited with status %d').format(status);
        Main.notifyError(_('Command failed: %s').format(line.slice(0, TITLE_LENGTH)), detail);
    }
}
