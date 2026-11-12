# Lume

A lightweight Spotlight-style search window for GNOME Shell 45–51.

Press a shortcut, type, pick a result with the arrow keys and Enter. Lume is
styled entirely by your Shell theme, so it follows light, dark, high contrast
and custom Shell themes.

> Status: v1 feature-complete. Tested on GNOME 51 only; the code handles
> 45–50 (see [Version notes](#version-notes-gnome-4551)) but nobody has run
> it there yet.

## Install

Requirements: GNOME Shell 45 or newer, `make`, `glib-compile-schemas`
(package `glib2` on Fedora) and `gnome-extensions` (ships with GNOME Shell).

### Regular install

```sh
git clone https://github.com/CJTS15/lume.git
cd lume
make install          # packs src/ and runs `gnome-extensions install --force`
```

Then log out and back in (Wayland can't restart the Shell in place) and run:

```sh
gnome-extensions enable lume@cjts15
```

To remove: `gnome-extensions uninstall lume@cjts15`.

### Development install

`make link` compiles the schema and symlinks `src/` into
`~/.local/share/gnome-shell/extensions/lume@cjts15`, so edits are picked up
the next time a Shell starts. `make unlink` removes only that symlink.

## Use

| Key | Action |
| --- | --- |
| <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> | Open or close Lume (default, configurable) |
| <kbd>↑</kbd> / <kbd>↓</kbd>, <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move the selection; <kbd>↑</kbd> on the first result goes back to the search field |
| <kbd>Page Up</kbd> / <kbd>Page Down</kbd> | First / last result |
| <kbd>Enter</kbd> | Open the selected result |
| <kbd>Esc</kbd> or a click outside | Close |

Enter on the search field opens the top (highlighted) result. Moving with the
keyboard puts focus on the result itself, so screen readers such as Orca read
its title and description; typing sends you back to the search field.

What you can type:

| Query | Result |
| --- | --- |
| An app name, keyword or initials (`term`, `frfx`) | Applications; Enter opens or focuses it |
| An expression (`2*(3+4)`, `sqrt(2)`, `2^10`) | The result; Enter copies it |
| Three or more letters of a file or folder name | Up to 5 files, from the LocalSearch index; Enter opens it |
| `clip`, or `clip <text>` | Clipboard history; Enter copies the item again |
| `weather`, or `weather <city>` | Current weather from Open-Meteo.com; Enter opens GNOME Weather, or copies the summary if it isn't installed |
| `ask <prompt>`, or `claude`/`codex`/`agy <prompt>` | Opens the AI agent's CLI in a terminal with your prompt |
| Anything | Last row: search the web for it |
| `pref` | Lume Preferences |

The calculator supports `+ - * / % ^` (or `**`), parentheses and `sqrt cbrt
abs exp ln log sin cos tan asin acos atan round floor ceil`, `pi` and `e`.
It never uses `eval`.

Files come from GNOME's file index (LocalSearch, formerly Tracker), so only
indexed folders are searched (Settings → Search → Search Locations). Hidden
folders and `node_modules` are skipped. Without an index, Lume searches the
names in your home folder, three levels deep.

### Web search, weather and AI agents

The web search row opens your query with the engine chosen in preferences
(Google by default; DuckDuckGo, Brave Search, Startpage, or a custom
`https://…%s` URL). Nothing is sent until you choose the row. It has the
lowest score, so it drops off when the other results already fill the list.

`weather` uses the default city from preferences; `weather <city>` looks up
any city with Open-Meteo's geocoding. The city goes to Open-Meteo.com only
when you search for weather, and results are cached for 10 minutes. Weather
data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).

`ask <prompt>` opens the default agent (Claude Code, Codex or agy, set in
preferences) in a terminal, starting in your home folder. Typing an agent's
command name instead of `ask` picks that agent. Only agents found on your
`PATH` are offered. The prompt is passed to the CLI as a single argument,
never through a shell. Lume uses your terminal command from preferences if
set, otherwise `xdg-terminal-exec`, GNOME's default terminal setting, or the
first of Ptyxis, Console, GNOME Terminal, Konsole, kitty, Alacritty, foot,
WezTerm and xterm that is installed.

### Clipboard history

Copied text is shown only when you search `clip`, never in ordinary results.
It is on by default and kept in memory, so it is cleared when the screen
locks, you log out or the extension is disabled. Turn on *Keep After Locking
or Logging Out* to save it to `~/.local/state/lume/clipboard.json` (readable
only by you); turning it off deletes the file. `clip` also offers *Clear
Clipboard History*.

Copies that a password manager marks as secret (`x-kde-passwordManagerHint`,
set by KeePassXC and others) are skipped. Password managers that don't set
it are not excluded; turn off *Remember Copied Text* if that matters to you.

**Why not <kbd>Super</kbd>+<kbd>Space</kbd>?** GNOME uses it to switch input
sources. To use it for Lume, first clear or change *Settings → Keyboard →
View and Customize Shortcuts → Typing → Switch to next input source*, then set
it in Lume's preferences.

## Preferences

`gnome-extensions prefs lume@cjts15`, or search "Lume Preferences" in Lume.

- **Open Lume**: click the row and press a combination. It needs Super, Ctrl
  or Alt. Esc cancels, Backspace disables the shortcut, the arrow button
  resets it. A combination already taken by GNOME never reaches the dialog;
  free it in GNOME Settings first.
- **Width**, **Distance From Top**, **Maximum Results**.
- **Clipboard History**: on/off, keep on disk, number of items (5–200).
- **Web Search**: search engine, custom URL.
- **Weather**: default city, units (°C or °F).
- **AI Agent**: default agent, terminal command (empty for automatic).

## Testing in a nested session

A nested Shell runs in a window, so a broken extension can't take down your
real session.

```sh
make link
make nested           # picks the right flag for your Shell version
```

`make nested` runs one of these:

| GNOME | Command |
| --- | --- |
| 49 and newer | `dbus-run-session -- gnome-shell --devkit --wayland` |
| 45–48 | `dbus-run-session -- gnome-shell --nested --wayland` |

On GNOME 49+ `--devkit` needs Mutter's devkit viewer, which some distros
package separately. On Fedora, find the package with
`dnf provides '*/mutter-devkit'` and install it with `sudo dnf install <name>`
(undo with `sudo dnf remove <name>`).

Inside the nested session, open a terminal there and run
`gnome-extensions enable lume@cjts15`, or enable it before starting with
`gsettings set org.gnome.shell enabled-extensions "['lume@cjts15']"`
(this changes your real settings too). Set the window size with
`MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000` (the Makefile does).

The nested Shell shares your real settings. Turning on high contrast, large
text or the screen reader inside it turns them on in your session too. Undo
with:

```sh
gsettings reset org.gnome.desktop.a11y.interface high-contrast
gsettings reset org.gnome.desktop.interface text-scaling-factor
gsettings reset org.gnome.desktop.a11y.applications screen-reader-enabled
```

Logs: the nested Shell prints to the terminal you started it from. For the
real session: `journalctl -f -o cat /usr/bin/gnome-shell`. Preferences run in
a separate process; watch `journalctl -f -o cat` while opening them.

## Tests

```sh
make test             # gjs self-checks for the pure modules in src/lib/
make smoke            # headless gnome-shell: enable/disable cycles, prefs
```

`make test` covers the pure modules in `src/lib/`. `make smoke` starts a
throwaway headless Shell with its own config and data directories (your
settings are not touched), enables Lume, disables and re-enables it five
times, opens the preferences, and fails on any JS error or preferences
warning. It does not open the search window; test that, and the providers,
in a nested session.

## Writing a provider

Every feature is a provider. The window doesn't know about features; it asks
each provider for results and shows them merged by score. Providers answer
independently, so a slow one (network, disk) doesn't hold back a fast one.

```js
// src/providers/example.js
import {Provider} from '../lib/provider.js';

export class ExampleProvider extends Provider {
    constructor() {
        super({id: 'example', name: 'Example'});
    }

    // Return an array, or a Promise of one. Stop early if `cancellable`
    // is cancelled: the user typed again.
    query(text, cancellable) {
        return [{
            id: 'hello',                    // stable within this provider
            title: `Hello, ${text}`,
            subtitle: 'Optional second line',
            icon: 'face-smile-symbolic',    // icon name or Gio.Icon
            score: 0.5,                     // 0..1, higher sorts first
            activate: () => console.log('chosen'),  // window is already closed
        }];
    }

    destroy() {
        // Disconnect signals, remove timeouts, cancel subprocesses.
    }
}
```

Register it in `enable()` in `src/extension.js`:

```js
this._registry.register(new ExampleProvider());
```

`ProviderRegistry.destroy()` calls every provider's `destroy()` on disable.

## Layout

```
src/
  extension.js        enable/disable, shortcut, provider registration
  prefs.js            libadwaita preferences window
  stylesheet.css      layout only; colors come from the Shell theme
  lib/provider.js     Provider base class and registry
  lib/searchWindow.js the search window (St widgets)
  lib/calculator.js   expression parser (no gi imports)
  lib/match.js        text match scoring (no gi imports)
  lib/web.js          search engine URLs (no gi imports)
  lib/agents.js       agent and terminal argv (no gi imports)
  providers/          one file per provider: apps, calculator, commands,
                      files, clipboard, weather, agents, web
  schemas/            GSettings schema
tests/                gjs self-checks (`make test`), headless smoke test
                      (`make smoke`)
```

## Version notes (GNOME 45–51)

Handled in code, listed here so they're easy to find:

- **St.BoxLayout**: `vertical` became `orientation` in 48. `setVertical()`
  in `lib/searchWindow.js` uses whichever exists.
- **St.ScrollView**: `add_actor()` is gone since 46 and `vadjustment` is new
  in 46 (45 has `vscroll.adjustment`). Lume uses `child` and falls back for
  the adjustment.
- **Theme selection state**: menu items highlight on `:hover` in 45–46 and
  on `:selected` in 47+. Lume sets both on the selected row.
- **Modal grab**: 45–47 can fail to take the grab; Lume checks
  `get_seat_state()` when it exists and stays closed if the grab failed.
- **Preferences**: only libadwaita 1.4 widgets (GNOME 45), so no
  `Adw.Dialog`. `fillPreferencesWindow` is synchronous, which 47+ still
  accepts.
- **Nested testing**: `--nested` until 48, `--devkit` from 49.
- **TinySPARQL**: the namespace is `Tsparql` from 47 and `Tracker` before,
  and the index service is `org.freedesktop.LocalSearch3` from 47 and
  `org.freedesktop.Tracker3.Miner.Files` before. `providers/files.js` tries
  both.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
