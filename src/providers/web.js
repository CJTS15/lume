// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web search: a fallback row, shown when few other rows match, that opens
// the chosen search engine in the default browser; "wiki " and "yt " search
// Wikipedia and YouTube. Nothing is sent until the row is chosen.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {matchPrefix} from '../lib/prefix.js';
import {ENGINES, SITES, buildSearchUrl, wikipediaLanguage} from '../lib/web.js';

export class WebSearchProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'web', name: _('Web Search'), label: _('Web')});
        this._settings = settings;
    }

    /**
     * @returns {{site: object|null, text: string}|null} the site ("wiki ")
     *   or web search ("b ") prefix leading `text` and the rest, or null
     */
    _scoped(text) {
        for (const site of Object.values(SITES)) {
            const rest = matchPrefix(text, this._settings.get_strv(site.key));
            if (rest !== null)
                return {site, text: rest};
        }
        const rest = matchPrefix(text, this._settings.get_strv('prefix-web'));
        return rest === null ? null : {site: null, text: rest};
    }

    owns(text) {
        return this._scoped(text) !== null;
    }

    scope(text) {
        const scoped = this._scoped(text);
        return scoped ? scoped.site?.name ?? _('Web') : null;
    }

    query(text) {
        const scoped = this._scoped(text);
        text = scoped?.text ?? text;
        if (!text)
            return [];

        let name = scoped?.site?.name;
        let template;
        if (scoped?.site) {
            template = scoped.site.url(wikipediaLanguage(GLib.get_language_names()));
        } else {
            const engine = ENGINES[this._settings.get_string('web-search-engine')];
            name = engine?.name;
            template = engine?.url ?? this._settings.get_string('web-search-url');
        }
        const url = buildSearchUrl(template, text);
        if (!url)
            return [];

        return [{
            id: 'search',
            // TRANSLATORS: %s is a search engine or site name; the query follows.
            title: name
                ? _('Search %s for “%s”').format(name, text)
                : _('Search the web for “%s”').format(text),
            icon: 'web-browser-symbolic',
            score: 0.05,
            // Asked for with a prefix: show it whatever else matches.
            fallback: !scoped,
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
