// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run an argv in the user's terminal. Used by the AI agent and command
// providers. The terminal choice itself is in lib/agents.js
// (terminalPrefix), which has no gi:// imports so it can be tested.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {terminalPrefix} from './agents.js';

const DESKTOP_TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';

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
