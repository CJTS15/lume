# Lume

A lightweight Spotlight-style search window for GNOME Shell 45–51.

Press a shortcut, type, pick a result with the arrow keys and Enter. Lume is
styled entirely by your Shell theme, so it follows light, dark, high contrast
and custom Shell themes.

> Status: step 2 of 4. Apps, calculator, files and clipboard history work.
> Web search, weather and AI agents come next.

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
| <kbd>↑</kbd> / <kbd>↓</kbd>, <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move the selection |
| <kbd>Page Up</kbd> / <kbd>Page Down</kbd> | First / last result |
| <kbd>Enter</kbd> | Open the selected result |
| <kbd>Esc</kbd> or a click outside | Close |

What you can type:

| Query | Result |
| --- | --- |
| An app name, keyword or initials (`term`, `frfx`) | Applications; Enter opens or focuses it |
| An expression (`2*(3+4)`, `sqrt(2)`, `2^10`) | The result; Enter copies it |
| Three or more letters of a file or folder name | Up to 5 files, from the LocalSearch index; Enter opens it |
| `clip`, or `clip <text>` | Clipboard history; Enter copies the item again |
| `pref` | Lume Preferences |

The calculator supports `+ - * / % ^` (or `**`), parentheses and `sqrt cbrt
abs exp ln log sin cos tan asin acos atan round floor ceil`, `pi` and `e`.
It never uses `eval`.

Files come from GNOME's file index (LocalSearch, formerly Tracker), so only
indexed folders are searched (Settings → Search → Search Locations). Hidden
folders and `node_modules` are skipped. Without an index, Lume searches the
names in your home folder, three levels deep.

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

Logs: the nested Shell prints to the terminal you started it from. For the
real session: `journalctl -f -o cat /usr/bin/gnome-shell`. Preferences run in
a separate process; watch `journalctl -f -o cat` while opening them.

## Tests

```sh
make test             # gjs self-checks for the calculator and matcher
```

They cover the pure modules in `src/lib/`. Providers that need the Shell are
tested in a nested session.

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
  providers/          one file per provider: apps, calculator, commands,
                      files, clipboard
  schemas/            GSettings schema
tests/                gjs self-checks, run with `make test`
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
