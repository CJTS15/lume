// SPDX-License-Identifier: GPL-3.0-or-later
//
// Quick toggles: Dark Style, Night Light, Do Not Disturb. The row says what
// Enter will do ("Turn On Night Light") and the current state.

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {keywordScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 2;
// Every word must match ("night light", "dark mode"); one stray word is
// not enough ("light mode" must not offer Night Light).
const MIN_MATCH = 0.75;
// N_ marks strings for translation; they are translated when used.
const N_ = s => s;

const TOGGLES = [{
    id: 'dark-style',
    name: N_('Dark Style'),
    keywords: ['dark', 'theme', 'mode', 'style', 'appearance'],
    // "light mode" only makes sense as a way to turn dark style off.
    keywordsWhenOn: ['light'],
    icon: 'dark-mode-symbolic',
    schema: 'org.gnome.desktop.interface',
    isOn: settings => settings.get_string('color-scheme') === 'prefer-dark',
    set: (settings, on) => settings.set_string('color-scheme', on ? 'prefer-dark' : 'default'),
}, {
    id: 'night-light',
    name: N_('Night Light'),
    keywords: ['night', 'light', 'blue', 'warm', 'redshift'],
    icon: 'night-light-symbolic',
    schema: 'org.gnome.settings-daemon.plugins.color',
    isOn: settings => settings.get_boolean('night-light-enabled'),
    set: (settings, on) => settings.set_boolean('night-light-enabled', on),
}, {
    id: 'do-not-disturb',
    name: N_('Do Not Disturb'),
    keywords: ['dnd', 'notifications', 'notification', 'focus', 'quiet', 'silence'],
    icon: 'notifications-disabled-symbolic',
    schema: 'org.gnome.desktop.notifications',
    isOn: settings => !settings.get_boolean('show-banners'),
    set: (settings, on) => settings.set_boolean('show-banners', !on),
}];

export class TogglesProvider extends Provider {
    constructor() {
        super({id: 'toggles', name: _('Quick Toggles'), label: _('Toggle')});
        const source = Gio.SettingsSchemaSource.get_default();
        // A missing schema would abort gnome-shell, so look before creating.
        this._toggles = TOGGLES
            .filter(toggle => source?.lookup(toggle.schema, true))
            .map(toggle => ({...toggle, settings: new Gio.Settings({schema_id: toggle.schema})}));
    }

    query(text) {
        if (text.length < MIN_QUERY_LENGTH)
            return [];

        return this._toggles
            .map(toggle => {
                const on = toggle.isOn(toggle.settings);
                const keywords = on ? [...toggle.keywords, ...toggle.keywordsWhenOn ?? []] : toggle.keywords;
                return {toggle, on, match: keywordScore(_(toggle.name), keywords, text)};
            })
            .filter(({match}) => match >= MIN_MATCH)
            .map(({toggle, on, match}) => {
                const name = _(toggle.name);
                return {
                    id: toggle.id,
                    // TRANSLATORS: %s is a setting, e.g. "Night Light"
                    title: on ? _('Turn Off %s').format(name) : _('Turn On %s').format(name),
                    subtitle: on ? _('Currently on') : _('Currently off'),
                    icon: toggle.icon,
                    score: 0.6 + 0.26 * match,
                    activate: () => toggle.set(toggle.settings, !on),
                };
            });
    }
}
