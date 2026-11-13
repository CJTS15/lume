// SPDX-License-Identifier: GPL-3.0-or-later
//
// Applications. Uses the same search as the Shell overview
// (Shell.AppSystem.search, which matches names, keywords and executables),
// then adds name matches as fuzzy as the fuzzy-matching setting allows:
// on "loose", "vsc" finds Visual Studio Code.

import Shell from 'gi://Shell';

import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fuzzyScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MAX_FUZZY_RESULTS = 5;

export class AppsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'apps', name: _('Applications')});
        this._settings = settings;
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

        const results = apps.map((app, index) => this._toResult(app,
            Math.max(0.6, 0.9 - 0.05 * tierOf.get(app.get_id()) - 0.002 * index)));

        // Name matches the overview search missed ("vsc", "frfx"), below
        // its results: 0.53 to 0.59.
        const level = this._settings.get_string('fuzzy-matching');
        const fuzzy = this._appSystem.get_installed()
            .map(info => info.get_id())
            .filter(id => id !== null && !tierOf.has(id))
            .map(id => this._appSystem.lookup_app(id))
            .filter(app => this._shouldShow(app))
            .map(app => ({app, score: fuzzyScore(app.get_name(), text, level)}))
            .filter(({score}) => score > 0)
            .sort((a, b) => b.score - a.score || usage.compare(a.app.get_id(), b.app.get_id()))
            .slice(0, MAX_FUZZY_RESULTS)
            .map(({app, score}) => this._toResult(app, 0.5 + 0.1 * Math.min(score, 0.9)));

        return [...results, ...fuzzy];
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
