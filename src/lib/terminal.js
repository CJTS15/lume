// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run commands: in the user's terminal (AI agents, commands, files) or in
// the background (commands, user scripts). The terminal choice itself is
// in lib/agents.js (terminalPrefix), which has no gi:// imports so it can
// be tested.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {terminalPrefix} from './agents.js';

const DESKTOP_TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';
const TITLE_LENGTH = 80;
// Exit status of sh when the program could not be found.
const NOT_FOUND = 127;

Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

/**
 * Run a shell command line in the home folder, in the background; notify
 * if it fails.
 *
 * @param {string} line
 */
export async function runInBackground(line) {
    let detail;
    try {
        // Output is discarded, not piped: a long-running command
        // ("tail -f") must not grow the Shell's memory.
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        launcher.set_cwd(GLib.get_home_dir());
        const process = launcher.spawnv(['/bin/sh', '-c', line]);
        await process.wait_async(null);
        if (process.get_successful())
            return;
        const status = process.get_if_exited() ? process.get_exit_status() : -1;
        detail = status === NOT_FOUND
            ? _('Command not found')
            : _('Exited with status %d').format(status);
    } catch (e) {
        detail = e.message;
    }
    Main.notifyError(_('Command failed: %s').format(line.slice(0, TITLE_LENGTH)), detail);
}

/**
 * @param {Gio.Settings} settings - Lume's settings (for the override)
 * @param {string[]} argv - run in a new terminal window, never via a shell
 *   unless argv itself starts one
 */
export function runInTerminal(settings, argv) {
    const terminal = terminalPrefix({
        override: override(settings),
        desktopDefault: desktopDefault(),
        findProgram: program => GLib.find_program_in_path(program),
    });
    if (!terminal) {
        Main.notifyError(_('No terminal found'),
            _('Set a terminal command in Lume Preferences.'));
        return;
    }
    // Util.spawn reports failures as a notification.
    Util.spawn([...terminal, ...argv]);
}

function override(settings) {
    const value = settings.get_string('terminal').trim();
    if (!value)
        return null;
    try {
        return GLib.shell_parse_argv(value)[1];
    } catch (e) {
        console.warn(`lume: ignoring terminal setting "${value}": ${e.message}`);
        return null;
    }
}

function desktopDefault() {
    // A missing schema would abort gnome-shell, so look before creating.
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(DESKTOP_TERMINAL_SCHEMA, true);
    if (!schema?.has_key('exec'))
        return null;
    const settings = new Gio.Settings({settings_schema: schema});
    const execArg = schema.has_key('exec-arg') ? settings.get_string('exec-arg') : '';
    return [settings.get_string('exec'), execArg];
}
