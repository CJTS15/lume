# Lume

A lightweight Spotlight-style search window for GNOME Shell 45–51.

Press a shortcut, type, pick a result with the arrow keys and Enter. Lume is
styled entirely by your Shell theme, so it follows light, dark, high contrast
and custom Shell themes.

> Status: step 1 of 4. The window, shortcut, preferences and provider
> interface are in place. The only provider so far is an example
> ("Lume Preferences"). Apps, calculator, files, clipboard, web search,
> weather and AI agents come next.

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

Type `pref` to see the example provider.

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
  providers/          one file per provider
  schemas/            GSettings schema
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

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
