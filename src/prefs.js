// SPDX-License-Identifier: GPL-3.0-or-later
//
// Uses only libadwaita 1.4 widgets (GNOME 45's version) so the same code runs
// on GNOME 45-51. Adw.Dialog (1.5+) is avoided for that reason.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AGENTS} from './lib/agents.js';
import {snippetsPath} from './lib/snippets.js';
import {CURRENCIES, homeCurrency} from './lib/units.js';
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
        page.add(this._buildSearchGroup(settings));
        page.add(this._buildClipboardGroup(settings));
        page.add(this._buildPrivacyGroup(settings));
        page.add(this._buildWebSearchGroup(settings));
        page.add(this._buildWeatherGroup(settings));
        page.add(this._buildAgentGroup(settings));
        page.add(this._buildProjectsGroup(window, settings));

        const prefixPage = new Adw.PreferencesPage({
            title: _('Prefixes'),
            icon_name: 'input-keyboard-symbolic',
        });
        prefixPage.add(this._buildPrefixGroup(settings));
        window.add(prefixPage);

        window.add(this._buildSnippetsPage(window));
    }

    _buildProjectsGroup(window, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Projects'),
            description: _('Git repositories up to 3 levels inside these folders. Type a project’s name, or “proj” to list them; Enter opens it in the editor, Ctrl+Enter in a terminal.'),
        });
        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add Project Folder'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        add.update_property([Gtk.AccessibleProperty.LABEL], [_('Add Project Folder')]);
        group.set_header_suffix(add);

        const home = GLib.get_home_dir();
        const short = path => path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
        let rows = [];
        const sync = () => {
            for (const row of rows)
                group.remove(row);
            rows = settings.get_strv('project-folders').map(folder => {
                const row = new Adw.ActionRow({title: folder, use_markup: false});
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: _('Remove Folder'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                // TRANSLATORS: %s is a folder path
                remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove %s').format(folder)]);
                remove.connect('clicked', () =>
                    settings.set_strv('project-folders', settings.get_strv('project-folders').filter(f => f !== folder)));
                row.add_suffix(remove);
                return row;
            });
            // Rows go before the editor row, which stays last.
            for (const row of rows)
                group.add(row);
            group.remove(editor);
            group.add(editor);
        };

        add.connect('clicked', () => {
            new Gtk.FileDialog({title: _('Add Project Folder')}).select_folder(window, null, (dialog, res) => {
                let folder;
                try {
                    folder = dialog.select_folder_finish(res)?.get_path();
                } catch {
                    return; // Cancelled.
                }
                const folders = settings.get_strv('project-folders');
                if (folder && !folders.includes(short(folder)))
                    settings.set_strv('project-folders', [...folders, short(folder)]);
            });
        });

        const editor = new Adw.EntryRow({
            title: _('Editor Command (empty: automatic)'),
            text: settings.get_string('project-editor'),
            show_apply_button: true,
        });
        editor.connect('apply', () => settings.set_string('project-editor', editor.text.trim()));
        group.add(editor);

        settings.connect('changed::project-folders', sync);
        sync();
        return group;
    }

    /**
     * Edits the snippets file (lib/snippets.js); the Shell reloads it when
     * it changes. Saved half a second after the last edit, and on close.
     */
    _buildSnippetsPage(window) {
        const page = new Adw.PreferencesPage({
            title: _('Snippets'),
            icon_name: 'insert-text-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Snippets'),
            description: _('Type a snippet’s name, or “snip” to list them all. Enter pastes it into the window you were using; Ctrl+C copies it. {date}, {time} and {clipboard} are filled in when it is used.'),
        });
        page.add(group);

        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add Snippet'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        add.update_property([Gtk.AccessibleProperty.LABEL], [_('Add Snippet')]);
        group.set_header_suffix(add);

        const file = Gio.File.new_for_path(snippetsPath());
        let snippets;
        try {
            const [, contents] = file.load_contents(null);
            // Stricter than the Shell, which skips bad entries: saving here
            // rewrites the whole file, so anything not understood is kept
            // by not editing at all.
            const saved = JSON.parse(new TextDecoder().decode(contents));
            if (!Array.isArray(saved) || !saved.every(s => typeof s?.name === 'string' && typeof s.text === 'string'))
                throw new TypeError('not a list of snippets');
            snippets = saved.map(({name, text}) => ({name, text}));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                // Never overwrite a file that could not be read.
                // TRANSLATORS: %s is a file path
                group.description = _('%s is not a valid snippets file. Fix or remove it, then open Preferences again.').format(file.get_path());
                add.sensitive = false;
                return page;
            }
            snippets = [];
        }

        let saveId = 0;
        const save = () => {
            if (saveId) {
                GLib.source_remove(saveId);
                saveId = 0;
            }
            // A snippet without a name could not be found; keep its text anyway.
            const json = JSON.stringify(snippets.map(({name, text}) => ({name: name.trim() || _('Untitled Snippet'), text})), null, 2);
            try {
                GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
                // PRIVATE creates the file with mode 0600: snippets can hold an address.
                file.replace_contents(new TextEncoder().encode(json), null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (e) {
                window.add_toast(new Adw.Toast({title: _('Could not save snippets: %s').format(e.message)}));
            }
        };
        const scheduleSave = () => {
            if (saveId)
                GLib.source_remove(saveId);
            saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                saveId = 0;
                save();
                return GLib.SOURCE_REMOVE;
            });
        };
        window.connect('close-request', () => {
            if (saveId)
                save();
            return false;
        });

        const addRow = (snippet, isNew) => {
            const row = new Adw.ExpanderRow({use_markup: false, expanded: isNew});
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: _('Remove Snippet'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            row.add_suffix(remove);
            const sync = () => {
                row.title = snippet.name.trim() || _('Untitled Snippet');
                row.subtitle = snippet.text.split('\n')[0].slice(0, 80);
                // TRANSLATORS: %s is a snippet's name
                remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove snippet %s').format(row.title)]);
            };
            sync();

            const name = new Adw.EntryRow({title: _('Name'), text: snippet.name});
            name.connect('changed', () => {
                snippet.name = name.text;
                sync();
                scheduleSave();
            });
            row.add_row(name);

            const text = new Gtk.TextView({
                wrap_mode: Gtk.WrapMode.WORD_CHAR,
                accepts_tab: false,
                height_request: 120,
                top_margin: 12,
                bottom_margin: 12,
                left_margin: 12,
                right_margin: 12,
            });
            text.update_property([Gtk.AccessibleProperty.LABEL], [_('Text')]);
            text.buffer.text = snippet.text;
            text.buffer.connect('changed', () => {
                snippet.text = text.buffer.text;
                sync();
                scheduleSave();
            });
            row.add_row(new Gtk.ListBoxRow({child: text, activatable: false, selectable: false}));

            remove.connect('clicked', () => {
                snippets.splice(snippets.indexOf(snippet), 1);
                group.remove(row);
                scheduleSave();
            });
            group.add(row);
            if (isNew)
                name.grab_focus();
        };

        for (const snippet of snippets)
            addRow(snippet, false);
        add.connect('clicked', () => {
            const snippet = {name: _('New Snippet'), text: ''};
            snippets.push(snippet);
            addRow(snippet, true);
            scheduleSave();
        });
        return page;
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

        // Stored as start/end so right-to-left layouts mirror it.
        const rtl = Gtk.Widget.get_default_direction() === Gtk.TextDirection.RTL;
        const position = this._comboRow(settings, 'preview-position', _('Preview Position'), [
            ['end', rtl ? _('Left') : _('Right')],
            ['start', rtl ? _('Right') : _('Left')],
        ]);
        position.subtitle = _('Side of the results where Ctrl+P shows the preview');
        group.add(position);

        return group;
    }

    _buildSearchGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Search')});

        const fuzzy = this._comboRow(settings, 'fuzzy-matching', _('Fuzzy Matching'), [
            ['strict', _('Strict')],
            ['normal', _('Normal')],
            ['loose', _('Loose')],
        ]);
        fuzzy.subtitle = _('For app and file names. Loose also skips letters, so “vsc” finds Visual Studio Code.');
        group.add(fuzzy);

        const currency = this._comboRow(settings, 'home-currency', _('Home Currency'), [
            // TRANSLATORS: %s is a currency code, e.g. "USD"
            ['auto', _('Automatic (%s)').format(homeCurrency(GLib.get_language_names()))],
            ...[...CURRENCIES].sort().map(code => [code, code]),
        ]);
        currency.subtitle = _('“100 eur” and “€50” convert to it; “$” means it when it is a dollar');
        group.add(currency);

        const contents = new Adw.SwitchRow({
            title: _('Search File Contents'),
            subtitle: _('Also match text inside indexed files. Slower.'),
        });
        settings.bind('file-contents', contents, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(contents);

        const commands = new Adw.SwitchRow({
            title: _('Run Commands'),
            subtitle: _('When the first word is a program, offer to run the line'),
        });
        settings.bind('run-commands', commands, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(commands);

        const enter = this._comboRow(settings, 'command-enter', _('Enter Runs Commands In'), [
            ['terminal', _('Terminal')],
            ['background', _('Background')],
        ]);
        enter.subtitle = _('A terminal shows the output and lets you stop the command. Ctrl+Enter does the other.');
        settings.bind('run-commands', enter, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(enter);

        return group;
    }

    _buildPrivacyGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Privacy')});
        const offline = new Adw.SwitchRow({
            title: _('Offline Mode'),
            subtitle: _('Nothing leaves this computer: no weather, exchange-rate or time-zone requests, no results from apps’ search providers, no web search. Saved exchange rates are still used.'),
        });
        settings.bind('offline-mode', offline, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(offline);
        return group;
    }

    _buildClipboardGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Clipboard History'),
            description: _('Search “clip” to see copied text. Copies that password managers mark as secret, and ones that look like tokens, keys or card numbers, are skipped.'),
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
            // Group descriptions are Pango markup; escape the <placeholders>.
            description: GLib.markup_escape_text(_('Search “weather” or “weather <city>”. The city is sent to Open-Meteo.com only when you search for weather.'), -1),
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

    _buildAgentGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('AI Agent'),
            description: GLib.markup_escape_text(_('Search “ask <prompt>” to open the agent in a terminal, or start with an agent’s name, e.g. “codex <prompt>”. Leave Terminal empty to use the system default.'), -1),
        });

        group.add(this._comboRow(settings, 'ai-agent', _('Default Agent'),
            Object.entries(AGENTS).map(([id, agent]) => [id, agent.name])));

        const terminal = new Adw.EntryRow({title: _('Terminal Command')});
        settings.bind('terminal', terminal, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(terminal);

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
    _buildPrefixGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Prefixes'),
            description: _('Start a search with one of these to see only that kind of result. Separate several with spaces; leave empty to turn a prefix off. Letters need a space after them (“f readme”), symbols do not (“?lume”).'),
        });

        const scopes = [
            ['prefix-web', _('Web Search')],
            ['prefix-wikipedia', _('Wikipedia')],
            ['prefix-bookmarks', _('Bookmarks')],
            ['prefix-youtube', _('YouTube')],
            ['prefix-calculator', _('Calculator')],
            ['prefix-files', _('Files')],
            ['prefix-projects', _('Projects')],
            ['prefix-recent', _('Recent Files')],
            ['prefix-windows', _('Open Windows')],
            ['prefix-workspaces', _('Workspaces')],
            ['prefix-clipboard', _('Clipboard History')],
            ['prefix-agent', _('AI Agent')],
            ['prefix-terminal', _('Run in Terminal')],
            ['prefix-processes', _('Processes')],
            ['prefix-emoji', _('Emoji')],
            ['prefix-snippets', _('Snippets')],
        ];
        const rows = new Map();
        const words = key => settings.get_strv(key).map(w => w.toLowerCase());

        // A prefix in two scopes only works for the first; flag both rows.
        const checkDuplicates = () => {
            for (const [key, row] of rows) {
                const shared = words(key).some(w => scopes.some(([other]) => other !== key && words(other).includes(w)));
                if (shared)
                    row.add_css_class('error');
                else
                    row.remove_css_class('error');
            }
        };

        for (const [key, title] of scopes) {
            const row = new Adw.EntryRow({title, show_apply_button: true});
            const sync = () => {
                row.text = settings.get_strv(key).join(' ');
                checkDuplicates();
            };
            row.connect('apply', () => settings.set_strv(key, row.text.split(/\s+/).filter(w => w)));
            settings.connect(`changed::${key}`, sync);

            const reset = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                tooltip_text: _('Reset to default'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            // TRANSLATORS: %s is a prefix scope, e.g. "Files"
            reset.update_property([Gtk.AccessibleProperty.LABEL], [_('Reset %s prefix').format(title)]);
            reset.connect('clicked', () => settings.reset(key));
            row.add_suffix(reset);

            rows.set(key, row);
            group.add(row);
        }
        for (const key of rows.keys())
            rows.get(key).text = settings.get_strv(key).join(' ');
        checkDuplicates();
        return group;
    }

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
