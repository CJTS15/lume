// SPDX-License-Identifier: GPL-3.0-or-later
//
// AI agents: "ask <prompt>" opens the default agent's CLI in a terminal with
// the prompt; "<agent> <prompt>" (claude, codex, agy) picks one agent.
// The prompt is passed as a single argv element, never through a shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AGENTS, agentArgv, terminalPrefix} from '../lib/agents.js';
import {Provider} from '../lib/provider.js';

const KEYWORD = 'ask';
const TITLE_LENGTH = 80;
const DESKTOP_TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';

export class AgentsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     * @param {() => void} openPreferences
     */
    constructor(settings, openPreferences) {
        super({id: 'agents', name: _('AI Agents')});
        this._settings = settings;
        this._openPreferences = openPreferences;
    }

    query(text) {
        const [, word, rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const keyword = word?.toLowerCase();
        const explicit = keyword !== KEYWORD;
        const id = explicit ? keyword : this._settings.get_string('ai-agent');
        if (!Object.hasOwn(AGENTS, id))
            return [];

        const agent = AGENTS[id];
        const prompt = rest.trim();
        const path = GLib.find_program_in_path(agent.command);

        if (!path) {
            // Typing an agent's name is likely an app search; stay quiet.
            if (explicit)
                return [];
            return [{
                id: 'missing',
                title: _('%s is not installed').format(agent.name),
                subtitle: _('Install it, or choose another agent in Preferences'),
                icon: 'dialog-warning-symbolic',
                score: 0.97,
                activate: () => this._openPreferences(),
            }];
        }

        const shown = prompt.replace(/\s+/g, ' ');
        return [{
            id,
            title: prompt
                ? _('Ask %s: %s').format(agent.name,
                    shown.length > TITLE_LENGTH ? `${shown.slice(0, TITLE_LENGTH - 1)}…` : shown)
                : _('Open %s').format(agent.name),
            subtitle: _('Opens in a terminal'),
            icon: 'utilities-terminal-symbolic',
            // A bare keyword ("claude") may be an app search: stay below apps.
            score: prompt ? 0.97 : 0.55,
            activate: () => this._launch(agentArgv(id, path, prompt)),
        }];
    }

    _launch(argv) {
        const terminal = terminalPrefix({
            override: this._override(),
            desktopDefault: this._desktopDefault(),
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

    _override() {
        const value = this._settings.get_string('terminal').trim();
        if (!value)
            return null;
        try {
            return GLib.shell_parse_argv(value)[1];
        } catch (e) {
            console.warn(`lume: ignoring terminal setting "${value}": ${e.message}`);
            return null;
        }
    }

    _desktopDefault() {
        // A missing schema would abort gnome-shell, so look before creating.
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(DESKTOP_TERMINAL_SCHEMA, true);
        if (!schema?.has_key('exec'))
            return null;
        const settings = new Gio.Settings({settings_schema: schema});
        const execArg = schema.has_key('exec-arg') ? settings.get_string('exec-arg') : '';
        return [settings.get_string('exec'), execArg];
    }
}
