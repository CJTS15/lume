// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web search: a last row for every query that opens the chosen search
// engine in the default browser. Nothing is sent until the row is chosen.

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {ENGINES, buildSearchUrl} from '../lib/web.js';

export class WebSearchProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'web', name: _('Web Search')});
        this._settings = settings;
    }

    query(text) {
        const engine = ENGINES[this._settings.get_string('web-search-engine')];
        const template = engine?.url ?? this._settings.get_string('web-search-url');
        const url = buildSearchUrl(template, text);
        if (!url)
            return [];

        return [{
            id: 'search',
            // TRANSLATORS: %s is a search engine name; the query follows.
            title: engine
                ? _('Search %s for “%s”').format(engine.name, text)
                : _('Search the web for “%s”').format(text),
            icon: 'web-browser-symbolic',
            // ponytail: lowest score, so it is cut when max-results rows
            // already match; reserve a slot in SearchWindow if that bites.
            score: 0.05,
            activate: () => {
                Gio.AppInfo.launch_default_for_uri_async(url,
                    global.create_app_launch_context(0, -1), null, (_o, res) => {
                        try {
                            Gio.AppInfo.launch_default_for_uri_finish(res);
                        } catch (e) {
                            console.error(`lume: could not open ${url}: ${e.message}`);
                        }
                    });
            },
        }];
    }
}
