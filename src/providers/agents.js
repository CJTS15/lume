// SPDX-License-Identifier: GPL-3.0-or-later
//
// AI agents: "ask <prompt>" opens the default agent's CLI in a terminal with
// the prompt; "<agent> <prompt>" (claude, codex, agy) picks one agent.
// The prompt is passed as a single argv element, never through a shell.

import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AGENTS, agentArgv} from '../lib/agents.js';
import {Provider} from '../lib/provider.js';
import {runInTerminal} from '../lib/terminal.js';

// "ask <prompt>" or "ai <prompt>": the default agent, agents only.
const KEYWORDS = ['ask', 'ai'];
const TITLE_LENGTH = 80;

export class AgentsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     * @param {() => void} openPreferences
     */
    constructor(settings, openPreferences) {
        super({id: 'agents', name: _('AI Agents'), label: _('Agent')});
        this._settings = settings;
        this._openPreferences = openPreferences;
    }

    owns(text) {
        return KEYWORDS.includes(text.split(/\s+/)[0].toLowerCase());
    }

    scope(text) {
        const [, word, rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const keyword = word?.toLowerCase();
        // A bare agent name ("claude") may be an app search.
        if (KEYWORDS.includes(keyword) || (Object.hasOwn(AGENTS, keyword) && rest.trim()))
            return _('AI Agent');
        return null;
    }

    query(text) {
        const [, word, rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const keyword = word?.toLowerCase();
        const explicit = !KEYWORDS.includes(keyword);
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
            activate: () => runInTerminal(this._settings, agentArgv(id, path, prompt)),
        }];
    }
}
