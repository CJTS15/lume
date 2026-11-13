// SPDX-License-Identifier: GPL-3.0-or-later
//
// Commands: when the first word is a program on PATH ("htop", "git status",
// "ls -la"), offer to run the line. Enter runs it in the background,
// Ctrl+Enter in a terminal window. The line is run by /bin/sh, as if typed
// in a terminal, because that is what the user typed it for.

import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {matchPrefix} from '../lib/prefix.js';
import {runInBackground, runInTerminal} from '../lib/terminal.js';

const TITLE_LENGTH = 80;
// Power commands act without GNOME's confirmation (polkit lets the active
// user power off): leave them to the System provider, whose power off and
// restart ask first.
const POWER_PROGRAMS = new Set(['shutdown', 'poweroff', 'reboot', 'halt']);
// ponytail: only direct calls are caught; wrappers (sh -c, env) are not.
// sudo fails without a terminal to ask for the password.
const POWER_VERBS = /^(systemctl|loginctl)\s+(-\S+\s+)*(poweroff|reboot|halt|kexec|soft-reboot|suspend|hibernate|hybrid-sleep|suspend-then-hibernate)\b/;
// Flags, paths, pipes, redirects, assignments: clearly a command line.
const COMMAND_SYNTAX = /(^|\s)-|[/|<>=$&;]/;


export class CliProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'cli', name: _('Commands'), label: _('Command')});
        this._settings = settings;
    }

    owns(text) {
        return this._settings.get_boolean('run-commands') && this._scoped(text) !== null;
    }

    /**
     * The command after ">": run in the terminal, commands only. Deliberate,
     * so power commands are allowed here.
     *
     * @returns {string|null}
     */
    _scoped(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-terminal'));
    }

    scope(text) {
        return this.owns(text) ? _('Terminal') : null;
    }

    query(text) {
        if (!this._settings.get_boolean('run-commands'))
            return [];
        if (this.owns(text))
            return this._terminalRow(this._scoped(text));
        const program = text.split(/\s+/)[0];
        if (POWER_PROGRAMS.has(program) || POWER_VERBS.test(text))
            return [];
        // A path to a folder ("/etc/") is a file browse, not a command.
        if (!GLib.find_program_in_path(program))
            return [];

        const args = text.slice(program.length);
        const shown = text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text;
        return [{
            id: 'run',
            title: shown,
            subtitle: _('Run in background · Ctrl+Enter to run in a terminal'),
            icon: 'utilities-terminal-symbolic',
            // Only clear command syntax ("ls -la") ranks above apps and
            // Settings panels: "date time" or "time zone" start with a
            // program but are searches. A bare word ("firefox") is more
            // likely an app.
            score: COMMAND_SYNTAX.test(args) ? 0.92 : args ? 0.6 : 0.45,
            activate: () => runInBackground(text),
            ctrlActivate: () => this._runInTerminal(text),
            actions: [
                {label: _('Run in Background'), icon: 'system-run-symbolic', run: () => runInBackground(text)},
                {label: _('Run in Terminal'), icon: 'utilities-terminal-symbolic', run: () => this._runInTerminal(text)},
            ],
        }];
    }

    _terminalRow(line) {
        if (!line)
            return [];
        return [{
            id: 'terminal',
            title: line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line,
            subtitle: _('Run in a terminal'),
            icon: 'utilities-terminal-symbolic',
            score: 0.97,
            activate: () => this._runInTerminal(line),
        }];
    }

    _runInTerminal(line) {
        // eval keeps the line as typed; the shell after it keeps the
        // window open so the output can be read.
        runInTerminal(this._settings,
            ['/bin/sh', '-c', 'eval "$1"; exec "${SHELL:-/bin/sh}"', 'sh', line]);
    }

}
