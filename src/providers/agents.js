// SPDX-License-Identifier: GPL-3.0-or-later
//
// AI agents: "ask <prompt>" opens the default agent's CLI in a terminal with
// the prompt; "<agent> <prompt>" (claude, codex, agy) picks one agent.
// The prompt is passed as a single argv element, never through a shell.

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AGENTS, agentArgv} from '../lib/agents.js';
import {Provider} from '../lib/provider.js';
import {matchPrefix} from '../lib/prefix.js';
import {findProgram, runInTerminal} from '../lib/terminal.js';

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
        return this._scoped(text) !== null;
    }

    /** @returns {string|null} the prompt after "ask"/"ai", or null without it */
    _scoped(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-agent'));
    }

    scope(text) {
        const [, word, rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const keyword = word?.toLowerCase();
        // A bare agent name ("claude") may be an app search.
        if (this.owns(text) || (Object.hasOwn(AGENTS, keyword) && rest.trim()))
            return _('AI Agent');
        return null;
    }

    query(text) {
        const scoped = this._scoped(text);
        const [, word, rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const explicit = scoped === null;
        const id = explicit ? word?.toLowerCase() : this._settings.get_string('ai-agent');
        if (!Object.hasOwn(AGENTS, id))
            return [];

        const agent = AGENTS[id];
        const prompt = explicit ? rest.trim() : scoped;
        const path = findProgram(agent.command);

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
