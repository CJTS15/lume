// SPDX-License-Identifier: GPL-3.0-or-later
//
// Applications. Uses the same search as the Shell overview
// (Shell.AppSystem.search, which matches names, keywords and executables),
// then falls back to a subsequence match so "frfx" still finds Firefox.

import Shell from 'gi://Shell';

import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MAX_FUZZY_RESULTS = 5;

export class AppsProvider extends Provider {
    constructor() {
        super({id: 'apps', name: _('Applications')});
        this._appSystem = Shell.AppSystem.get_default();
        this._parentalControls = ParentalControlsManager.getDefault();
    }

    query(text) {
        const usage = Shell.AppUsage.get_default();
        const apps = [];
        const tierOf = new Map();

        // Same filtering and ordering as the overview: groups are relevance
        // tiers, and apps within a tier are sorted by how often they are used.
        Shell.AppSystem.search(text).forEach((group, tier) => {
            const ids = group
                .filter(id => this._shouldShow(this._appSystem.lookup_app(id)))
                .sort((a, b) => usage.compare(a, b));
            for (const id of ids) {
                apps.push(this._appSystem.lookup_app(id));
                tierOf.set(id, tier);
            }
        });

        if (apps.length > 0) {
            return apps.map((app, index) => this._toResult(app,
                Math.max(0.6, 0.9 - 0.05 * tierOf.get(app.get_id()) - 0.002 * index)));
        }

        return this._appSystem.get_installed()
            .map(info => info.get_id())
            .filter(id => id !== null)
            .map(id => this._appSystem.lookup_app(id))
            .filter(app => this._shouldShow(app) && matchScore(app.get_name(), text) > 0)
            .sort((a, b) => usage.compare(a.get_id(), b.get_id()))
            .slice(0, MAX_FUZZY_RESULTS)
            .map(app => this._toResult(app, 0.6));
    }

    _shouldShow(app) {
        return app !== null && this._parentalControls.shouldShowApp(app.app_info);
    }

    _toResult(app, score) {
        return {
            id: app.get_id(),
            title: app.get_name(),
            subtitle: app.get_description() ?? undefined,
            icon: app.get_icon(),
            score,
            activate: () => app.activate(),
        };
    }
}
