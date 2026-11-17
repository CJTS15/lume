// SPDX-License-Identifier: GPL-3.0-or-later
//
// Lume's own commands: "Lume Preferences" opens the preferences window.

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';

export class CommandsProvider extends Provider {
    /**
     * @param {import('resource:///org/gnome/shell/extensions/extension.js').Extension} extension
     */
    constructor(extension) {
        super({id: 'lume-commands', name: _('Lume'), label: _('Lume')});

        this._commands = [{
            id: 'preferences',
            title: _('Lume Preferences'),
            subtitle: _('Change the shortcut, size and position'),
            icon: 'preferences-system-symbolic',
            keywords: ['lume', 'preferences', 'settings', 'configure', 'shortcut'],
            activate: () => extension.openPreferences(),
        }];
    }

    query(text) {
        const needle = text.toLowerCase();
        const results = [];

        for (const command of this._commands) {
            const title = command.title.toLowerCase();
            let score = 0;
            if (title.startsWith(needle))
                score = 0.9;
            else if (title.includes(needle))
                score = 0.7;
            else if (command.keywords.some(k => k.startsWith(needle)))
                score = 0.5;

            if (score > 0) {
                const {keywords: _k, ...result} = command;
                results.push({...result, score});
            }
        }
        return results;
    }
}
