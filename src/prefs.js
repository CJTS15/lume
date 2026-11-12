// SPDX-License-Identifier: GPL-3.0-or-later
//
// Uses only libadwaita 1.4 widgets (GNOME 45's version) so the same code runs
// on GNOME 45-51. Adw.Dialog (1.5+) is avoided for that reason.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ENGINES, isValidSearchUrl} from './lib/web.js';

const SHORTCUT_KEY = 'toggle-shortcut';

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_Caps_Lock,
]);

// A global shortcut needs one of these, or it would swallow normal typing.
const REQUIRED_MODIFIERS =
    Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;

export default class LumePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep a reference so the settings object lives as long as the window.
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        page.add(this._buildShortcutGroup(window, settings));
        page.add(this._buildAppearanceGroup(settings));
        page.add(this._buildClipboardGroup(settings));
        page.add(this._buildWebSearchGroup(settings));
        page.add(this._buildWeatherGroup(settings));
    }

    _buildShortcutGroup(window, settings) {
        const group = new Adw.PreferencesGroup({title: _('Keyboard')});

        const row = new Adw.ActionRow({
            title: _('Open Lume'),
            subtitle: _('Shows or hides the search window'),
            activatable: true,
        });

        const label = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        const sync = () => {
            label.accelerator = settings.get_strv(SHORTCUT_KEY)[0] ?? '';
        };
        sync();
        settings.connect(`changed::${SHORTCUT_KEY}`, sync);
        row.add_suffix(label);

        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: _('Reset to default'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.update_property([Gtk.AccessibleProperty.LABEL], [_('Reset shortcut to default')]);
        reset.connect('clicked', () => settings.reset(SHORTCUT_KEY));
        row.add_suffix(reset);

        row.connect('activated', () => this._captureShortcut(window, settings));
        group.add(row);
        return group;
    }

    _buildAppearanceGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Search Window')});

        const spinRow = (key, title, subtitle, step) => {
            // get_range() is ('range', <(min, max)>) for keys with a <range>.
            const [, range] = settings.settings_schema.get_key(key).get_range().recursiveUnpack();
            const row = Adw.SpinRow.new_with_range(range[0], range[1], step);
            row.title = title;
            row.subtitle = subtitle;
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };

        spinRow('panel-width', _('Width'), _('In pixels, limited to the monitor width'), 20);
        spinRow('top-offset', _('Distance From Top'), _('Percentage of the monitor height'), 1);
        spinRow('max-results', _('Maximum Results'), _('How many results to show at most'), 1);

        return group;
    }

    _buildClipboardGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Clipboard History'),
            description: _('Search “clip” to see copied text. Copies that password managers mark as secret are skipped.'),
        });

        const history = new Adw.SwitchRow({title: _('Remember Copied Text')});
        settings.bind('clipboard-history', history, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(history);

        const persist = new Adw.SwitchRow({
            title: _('Keep After Locking or Logging Out'),
            subtitle: _('Saves the history to disk, readable only by you'),
        });
        settings.bind('clipboard-persist', persist, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('clipboard-history', persist, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(persist);

        const [, range] = settings.settings_schema.get_key('clipboard-size').get_range().recursiveUnpack();
        const size = Adw.SpinRow.new_with_range(range[0], range[1], 5);
        size.title = _('Items to Remember');
        settings.bind('clipboard-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('clipboard-history', size, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(size);

        return group;
    }

    _buildWebSearchGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Web Search'),
            description: _('The last result opens your query in the browser. Nothing is sent until you choose it.'),
        });

        group.add(this._comboRow(settings, 'web-search-engine', _('Search Engine'), [
            ...Object.entries(ENGINES).map(([id, engine]) => [id, engine.name]),
            ['custom', _('Custom')],
        ]));

        const url = new Adw.EntryRow({title: _('Custom URL, with %s for the query')});
        settings.bind('web-search-url', url, 'text', Gio.SettingsBindFlags.DEFAULT);
        const sync = () => {
            url.sensitive = settings.get_string('web-search-engine') === 'custom';
            if (url.text && !isValidSearchUrl(url.text))
                url.add_css_class('error');
            else
                url.remove_css_class('error');
        };
        sync();
        settings.connect('changed::web-search-engine', sync);
        url.connect('notify::text', sync);
        group.add(url);

        return group;
    }

    _buildWeatherGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Weather'),
            description: _('Search “weather” or “weather <city>”. The city is sent to Open-Meteo.com only when you search for weather.'),
        });

        const city = new Adw.EntryRow({title: _('Default City')});
        settings.bind('weather-city', city, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(city);

        group.add(this._comboRow(settings, 'weather-units', _('Units'), [
            ['metric', _('Metric (°C)')],
            ['imperial', _('Imperial (°F)')],
        ]));

        return group;
    }

    /**
     * An Adw.ComboRow for a string key with <choices>.
     *
     * @param {Gio.Settings} settings
     * @param {string} key
     * @param {string} title
     * @param {Array<[string, string]>} options - [value, label] pairs
     */
    _comboRow(settings, key, title, options) {
        const row = new Adw.ComboRow({
            title,
            model: Gtk.StringList.new(options.map(([, label]) => label)),
        });
        const sync = () => {
            row.selected = Math.max(0, options.findIndex(([value]) => value === settings.get_string(key)));
        };
        sync();
        settings.connect(`changed::${key}`, sync);
        row.connect('notify::selected', () => {
            const value = options[row.selected]?.[0];
            if (value && value !== settings.get_string(key))
                settings.set_string(key, value);
        });
        return row;
    }

    _captureShortcut(parent, settings) {
        const status = new Adw.StatusPage({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            title: _('Press a Key Combination'),
            description: _('Press Esc to cancel or Backspace to disable the shortcut.'),
        });

        const toolbar = new Adw.ToolbarView({content: status});
        toolbar.add_top_bar(new Adw.HeaderBar({show_title: false}));

        const dialog = new Adw.Window({
            title: _('Set Shortcut'),
            modal: true,
            transient_for: parent,
            default_width: 440,
            default_height: 320,
            content: toolbar,
        });

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (mask === 0 && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (mask === 0 && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv(SHORTCUT_KEY, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            // Wait for the non-modifier key.
            if (MODIFIER_KEYS.has(keyval))
                return Gdk.EVENT_STOP;

            if ((mask & REQUIRED_MODIFIERS) === 0 || !Gtk.accelerator_valid(keyval, mask)) {
                status.description = _('Use at least one of Super, Ctrl or Alt with another key.');
                return Gdk.EVENT_STOP;
            }

            const accel = Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mask);
            settings.set_strv(SHORTCUT_KEY, [accel]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
