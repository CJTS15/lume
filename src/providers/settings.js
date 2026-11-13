// SPDX-License-Identifier: GPL-3.0-or-later
//
// Settings panels: "wifi", "night light", "pointer speed". Matches each
// panel's name and keywords from its gnome-*-panel.desktop file, and opens
// the best match in Settings.

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {keywordScore, matchScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 3;
const PANEL_ID = /^gnome-.+-panel\.desktop$/;

export class SettingsProvider extends Provider {
    constructor() {
        super({id: 'settings', name: _('Settings'), label: _('Setting')});
        this._panels = null;
        // Panels come and go with packages; reload when apps change.
        this._monitor = Gio.AppInfoMonitor.get();
        this._monitorId = this._monitor.connect('changed', () => {
            this._panels = null;
        });
    }

    query(text) {
        if (text.length < MIN_QUERY_LENGTH)
            return [];

        // The panel files are NoDisplay, so they are not in the app search.
        this._panels ??= Gio.AppInfo.get_all()
            .filter(info => PANEL_ID.test(info.get_id() ?? ''))
            .map(info => ({info, name: info.get_name(), keywords: info.get_keywords?.() ?? []}));

        return this._panels
            .map(panel => {
                // A name match ("display", "sound") is the strongest signal;
                // keywords cover what people want to change.
                const name = matchScore(panel.name, text);
                const match = Math.max(name >= 0.8 ? name : 0,
                    0.9 * keywordScore(panel.name, panel.keywords, text));
                return {panel, match};
            })
            .filter(({match}) => match >= 0.45)
            .sort((a, b) => b.match - a.match)
            .slice(0, MAX_RESULTS)
            .map(({panel, match}) => ({
                id: panel.info.get_id(),
                title: panel.name,
                subtitle: _('Settings'),
                icon: panel.info.get_icon() ?? 'org.gnome.Settings-symbolic',
                // About 0.66 to 0.85: below a well-matched app, above fuzzy ones.
                score: 0.5 + 0.35 * match,
                activate: () => {
                    try {
                        panel.info.launch([], global.create_app_launch_context(0, -1));
                    } catch (e) {
                        console.error(`lume: could not open ${panel.info.get_id()}: ${e.message}`);
                    }
                },
            }));
    }

    destroy() {
        this._monitor.disconnect(this._monitorId);
        this._panels = null;
    }
}
