// SPDX-License-Identifier: GPL-3.0-or-later

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ProviderRegistry} from './lib/provider.js';
import {SearchWindow} from './lib/searchWindow.js';
import {AgentsProvider} from './providers/agents.js';
import {AppsProvider} from './providers/apps.js';
import {CalculatorProvider} from './providers/calculator.js';
import {CliProvider} from './providers/cli.js';
import {ClipboardProvider} from './providers/clipboard.js';
import {CommandsProvider} from './providers/commands.js';
import {DevToolsProvider} from './providers/devtools.js';
import {EmojiProvider} from './providers/emoji.js';
import {FilesProvider} from './providers/files.js';
import {MediaProvider} from './providers/media.js';
import {RemoteProvider} from './providers/remote.js';
import {ScriptsProvider} from './providers/scripts.js';
import {SettingsProvider} from './providers/settings.js';
import {SystemProvider} from './providers/system.js';
import {TogglesProvider} from './providers/toggles.js';
import {UnitsProvider} from './providers/units.js';
import {UrlProvider} from './providers/url.js';
import {WeatherProvider} from './providers/weather.js';
import {WebSearchProvider} from './providers/web.js';
import {WindowsProvider} from './providers/windows.js';
import {WorkspacesProvider} from './providers/workspaces.js';

const SHORTCUT_KEY = 'toggle-shortcut';

export default class LumeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._registry = new ProviderRegistry();
        // Registration order breaks score ties.
        this._registry.register(new CalculatorProvider(this._settings));
        this._registry.register(new UnitsProvider());
        this._registry.register(new DevToolsProvider());
        this._registry.register(new EmojiProvider(this._settings));
        this._registry.register(new UrlProvider());
        this._registry.register(new AppsProvider(this._settings));
        this._registry.register(new WindowsProvider(this._settings));
        this._registry.register(new WorkspacesProvider(this._settings));
        this._registry.register(new CommandsProvider(this));
        this._registry.register(new SystemProvider());
        this._registry.register(new TogglesProvider());
        this._registry.register(new SettingsProvider());
        this._registry.register(new FilesProvider(this._settings));
        this._registry.register(new ClipboardProvider(this._settings));
        this._registry.register(new MediaProvider(this._settings));
        this._registry.register(new WeatherProvider(this._settings, () => this.openPreferences()));
        this._registry.register(new AgentsProvider(this._settings, () => this.openPreferences()));
        this._registry.register(new CliProvider(this._settings));
        this._registry.register(new RemoteProvider());
        // After the built-in scopes, so a script never hides "wd" or "clip".
        this._registry.register(new ScriptsProvider());
        this._registry.register(new WebSearchProvider(this._settings));

        this._window = new SearchWindow(this._settings, this._registry, () => this.openPreferences());
        Main.layoutManager.modalDialogGroup.add_child(this._window);

        this._addShortcut();
        // Re-register on change so a new shortcut works without a restart.
        this._shortcutChangedId = this._settings.connect(`changed::${SHORTCUT_KEY}`, () => {
            this._removeShortcut();
            this._addShortcut();
        });
    }

    disable() {
        if (this._shortcutChangedId) {
            this._settings.disconnect(this._shortcutChangedId);
            this._shortcutChangedId = 0;
        }
        this._removeShortcut();

        // Destroying the window also releases its modal grab if it is open.
        this._window?.destroy();
        this._window = null;

        this._registry?.destroy();
        this._registry = null;

        this._settings = null;
    }

    _addShortcut() {
        if (this._settings.get_strv(SHORTCUT_KEY).length === 0)
            return;

        const action = Main.wm.addKeybinding(
            SHORTCUT_KEY,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            // POPUP is the mode while Lume itself is open, so the same
            // shortcut also closes it.
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._window.toggle());

        this._shortcutBound = action !== Meta.KeyBindingAction.NONE;
        if (!this._shortcutBound) {
            console.warn(`lume: could not bind ${this._settings.get_strv(SHORTCUT_KEY)}; ` +
                'it may be invalid or already used by another shortcut');
        }
    }

    _removeShortcut() {
        if (!this._shortcutBound)
            return;
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        this._shortcutBound = false;
    }
}
