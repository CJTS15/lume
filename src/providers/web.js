// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web search: a fallback row, shown when few other rows match, that opens
// the chosen search engine in the default browser. Nothing is sent until
// the row is chosen.

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {ENGINES, buildSearchUrl} from '../lib/web.js';

// "? query" or "b query": web search only.
const PREFIX = /^(?:\?|b\s)\s*/i;

export class WebSearchProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'web', name: _('Web Search'), label: _('Web')});
        this._settings = settings;
    }

    owns(text) {
        return PREFIX.test(text);
    }

    scope(text) {
        return this.owns(text) ? _('Web') : null;
    }

    query(text) {
        const owned = this.owns(text);
        text = text.replace(PREFIX, '').trim();
        if (!text)
            return [];
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
            score: 0.05,
            // Asked for with a prefix: show it whatever else matches.
            fallback: !owned,
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
