// SPDX-License-Identifier: GPL-3.0-or-later
//
// Open windows. Matching windows show in normal results below their app;
// "win" lists every window, most recently used first. Enter focuses the
// window, switching workspace if needed.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fuzzyScore} from '../lib/match.js';
import {matchPrefix} from '../lib/prefix.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 5;

export class WindowsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'windows', name: _('Windows'), label: _('Window')});
        this._settings = settings;
        this._tracker = Shell.WindowTracker.get_default();
    }

    owns(text) {
        return this._keywordFilter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Windows') : null;
    }

    /** @returns {string|null} the filter after "win", or null without it */
    _keywordFilter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-windows'));
    }

    query(text) {
        const filter = this._keywordFilter(text);
        if (filter === null && text.length < MIN_QUERY_LENGTH)
            return [];

        const level = this._settings.get_string('fuzzy-matching');
        // Tab-list order: most recently used first.
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .map(window => ({window, app: this._tracker.get_window_app(window)}));

        if (filter !== null) {
            return windows
                .filter(({window, app}) => !filter || this._match(window, app, filter, level) > 0)
                .map(({window, app}, index) => this._toResult(window, app, 0.97 - 0.001 * index));
        }

        return windows
            .map(({window, app}) => ({window, app, match: this._match(window, app, text, level)}))
            .filter(({match}) => match > 0)
            .sort((a, b) => b.match - a.match)
            .slice(0, MAX_RESULTS)
            // Below an exactly matching app (0.9), so a window sits under it.
            .map(({window, app, match}) => this._toResult(window, app, 0.5 + 0.35 * Math.min(match, 0.9)));
    }

    _match(window, app, text, level) {
        return Math.max(
            fuzzyScore(window.get_title() ?? '', text, level),
            app ? fuzzyScore(app.get_name(), text, level) : 0);
    }

    _toResult(window, app, score) {
        const parts = [];
        if (app)
            parts.push(app.get_name());
        if (global.workspace_manager.n_workspaces > 1) {
            const workspace = window.get_workspace();
            // Windows on all workspaces have no single one.
            if (workspace && !window.is_on_all_workspaces())
                parts.push(_('Workspace %d').format(workspace.index() + 1));
        }

        return {
            id: String(window.get_id()),
            title: window.get_title() || app?.get_name() || _('Untitled window'),
            subtitle: parts.join(' · ') || undefined,
            icon: app?.get_icon() ?? 'focus-windows-symbolic',
            score,
            activate: () => Main.activateWindow(window),
        };
    }
}
