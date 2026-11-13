// SPDX-License-Identifier: GPL-3.0-or-later
//
// Workspaces: "ws" lists every workspace with its apps; "ws 2" or
// "ws firefox" filters by number, name, app or window title. Enter
// switches to the workspace.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fuzzyScore} from '../lib/match.js';
import {matchPrefix} from '../lib/prefix.js';
import {Provider} from '../lib/provider.js';

const SCORE = 0.97;

export class WorkspacesProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'workspaces', name: _('Workspaces'), label: _('Workspace')});
        this._settings = settings;
        this._wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._tracker = Shell.WindowTracker.get_default();
    }

    owns(text) {
        return this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Workspaces') : null;
    }

    /** @returns {string|null} the filter after "ws", or null without it */
    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-workspaces'));
    }

    query(text) {
        const filter = this._filter(text);
        if (filter === null)
            return [];

        const manager = global.workspace_manager;
        const active = manager.get_active_workspace_index();
        const names = this._wmSettings.get_strv('workspace-names');
        const level = this._settings.get_string('fuzzy-matching');
        const results = [];
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            const name = names[i]?.trim() || _('Workspace %d').format(i + 1);
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
            const apps = [...new Set(windows.map(w => this._tracker.get_window_app(w)?.get_name()).filter(Boolean))];
            const titles = windows.map(w => w.get_title() ?? '');
            if (filter && filter !== String(i + 1) &&
                ![name, ...apps, ...titles].some(candidate => fuzzyScore(candidate, filter, level) > 0))
                continue;

            const parts = [];
            if (i === active)
                parts.push(_('Current'));
            parts.push(windows.length
                ? ngettext('%d window', '%d windows', windows.length).format(windows.length)
                : _('Empty'));
            if (apps.length)
                parts.push(apps.join(', '));
            results.push({
                id: String(i),
                title: name,
                subtitle: parts.join(' · '),
                icon: 'view-grid-symbolic',
                score: SCORE - 0.001 * i,
                activate: () => workspace.activate(global.get_current_time()),
            });
        }
        return results;
    }
}
