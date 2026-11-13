// SPDX-License-Identifier: GPL-3.0-or-later
//
// Applications. Uses the same search as the Shell overview
// (Shell.AppSystem.search, which matches names, keywords and executables),
// then adds name matches as fuzzy as the fuzzy-matching setting allows:
// on "loose", "vsc" finds Visual Studio Code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fuzzyScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MAX_FUZZY_RESULTS = 5;

/**
 * The actions of the Shell's app menu: New Window, the app's own desktop
 * actions, the other graphics card, App Details.
 *
 * @param {Shell.App} app
 * @returns {Array<{label: string, icon?: string, run: () => void}>}
 */
function appActions(app) {
    const appInfo = app.app_info;
    const desktopActions = appInfo?.list_actions() ?? [];
    const actions = [{label: _('Open'), icon: 'document-open-symbolic', run: () => app.activate()}];

    if (app.can_open_new_window() && !desktopActions.includes('new-window'))
        actions.push({label: _('New Window'), icon: 'window-new-symbolic', run: () => app.open_new_window(-1)});
    for (const action of desktopActions) {
        actions.push({
            label: appInfo.get_action_name(action),
            run: () => app.launch_action(action, global.get_current_time(), -1),
        });
    }

    const dualGpu = global.get_switcheroo_control?.()?.get_cached_property('HasDualGpu')?.unpack();
    if (dualGpu && app.state === Shell.AppState.STOPPED) {
        const prefersOther = appInfo.get_boolean('PrefersNonDefaultGPU');
        actions.push({
            label: prefersOther
                ? _('Launch Using Integrated Graphics Card')
                : _('Launch Using Discrete Graphics Card'),
            icon: 'video-display-symbolic',
            run: () => app.launch(0, -1, prefersOther ? Shell.AppLaunchGpu.DEFAULT : Shell.AppLaunchGpu.DISCRETE),
        });
    }

    if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop')) {
        actions.push({
            label: _('App Details'),
            icon: 'help-about-symbolic',
            // The same D-Bus call as the Shell's app menu.
            run: () => Gio.DBus.session.call('org.gnome.Software', '/org/gnome/Software',
                'org.gtk.Actions', 'Activate',
                new GLib.Variant('(sava{sv})', ['details', [new GLib.Variant('(ss)', [app.get_id(), ''])], {}]),
                null, Gio.DBusCallFlags.NONE, -1, null, null),
        });
    }
    return actions;
}

export class AppsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'apps', name: _('Applications'), label: _('App')});
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
            // Built when Ctrl+K asks, like the Shell's app menu.
            get actions() {
                return appActions(app);
            },
        };
    }
}
