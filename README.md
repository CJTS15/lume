# Lume

A lightweight Spotlight-style search window for GNOME Shell 45–51.

Press a shortcut, type, pick a result with the arrow keys and Enter. Lume is
styled entirely by your Shell theme, so it follows light, dark, high contrast
and custom Shell themes.

> Status: v2. Tested on GNOME 51 only; the code handles 45–50 (see
> [Version notes](#version-notes-gnome-4551)) but nobody has run it there
> yet.

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
gnome-extensions enable lume@cjts15.github.io
```

To remove: `gnome-extensions uninstall lume@cjts15.github.io`.

### Development install

`make link` compiles the schema and symlinks `src/` into
`~/.local/share/gnome-shell/extensions/lume@cjts15.github.io`, so edits are
picked up the next time a Shell starts. `make unlink` removes only that symlink.

## Use

| Key | Action |
| --- | --- |
| <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> | Open or close Lume (default, configurable) |
| <kbd>↑</kbd> / <kbd>↓</kbd>, <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move the selection; <kbd>↑</kbd> on the first result goes back to the search field |
| <kbd>Page Up</kbd> / <kbd>Page Down</kbd> | First / last result |
| <kbd>Enter</kbd> | Open the selected result |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Second action: show a file in its folder, run a command in the background |
| <kbd>Alt</kbd>+<kbd>Enter</kbd> | File properties |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Copy the selected file (to paste in Files), result or address; with text selected in the search field, copies that text |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | The selected result's actions; <kbd>Esc</kbd> goes back |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Show or hide the preview pane (remembered) |
| <kbd>Ctrl</kbd>+<kbd>,</kbd> | Open Lume Preferences (also the gear button in the footer) |
| <kbd>Esc</kbd> or a click outside | Close |

Each row shows its type on the right (App, Setting, File, Folder, Web, …),
and the pill in the search field shows what you are searching: *All
results*, or *Clipboard*, *Weather*, *AI Agent*, *Windows*, *Media* or
*Folder* when a keyword or path takes over. Enter on the search field opens the top (highlighted)
result. Moving with the
keyboard puts focus on the result itself, so screen readers such as Orca read
its title and description; typing sends you back to the search field.

What you can type:

| Query | Result |
| --- | --- |
| Part or all of an app name (`term`, `vsc` on *Loose*) | Applications; Enter opens or focuses it |
| A Settings panel or what you want to change (`wifi`, `night light`, `pointer speed`) | The best-matching Settings panels; Enter opens it |
| A window title or app name, or `wd` for all windows | Open windows; Enter focuses the window and its workspace. Firefox and Chrome windows show their active tab |
| `ws`, `ws 2`, `ws firefox` | Workspaces with their apps; Enter switches to the workspace |
| `lock`, `suspend`, `restart`, `power off`, `log out` | GNOME's own system actions; power off, restart and log out ask for confirmation |
| `dark`, `night light`, `dnd` | Turn Dark Style, Night Light or Do Not Disturb on or off |
| `media`, `music`, `pause`, `next`, or a player, song or artist | Each playing or paused player; Enter plays/pauses, Ctrl+Enter next, Alt+Enter previous |
| Three or more letters of a file name, or part of a path | Up to 5 files from the LocalSearch index; Enter opens it |
| A folder path (`~/Documents/`, `/etc/`, `~/Doc`) | That folder's contents, filtered by what follows the last `/` |
| An expression (`4 + 3 * 8`, `2pi`, `sind(30)`) | The result; Enter copies it |
| A conversion (`10 km to mi`, `cup to qt`, `32 F to C`, `16px to rem`, `100 eur to usd`) | The converted value; Enter copies it |
| `uuid`, `base64 encode\|decode <text>`, `sha256 <text>`, `md5 <text>` | A new UUID, Base64, or a checksum; Enter copies it |
| A colour (`#ff8800`, `rgb(255, 136, 0)`) | The other notation with a swatch; Enter copies it |
| `unix`, or a 10- or 13-digit timestamp | The current Unix time, or that moment's date; Enter copies it |
| A web address (`https://example.com`, `example.com`, `localhost:3000`, `192.168.1.1`) | Opens it in your browser |
| A command line starting with a program on `PATH` (`htop`, `git status`) | Runs it in your terminal; Ctrl+Enter runs it in the background |
| `clip`, or `clip <text>` | Clipboard history; Enter copies the item again |
| `:coffee` or `emoji coffee` | Emoji by name or keyword; Enter copies the emoji |
| Anything apps can search (an event, a contact, an app to install, …) | Results from apps' GNOME search providers; Enter opens it in the app |
| `weather`, or `weather <city>` | Current weather from Open-Meteo.com; Enter opens GNOME Weather, or copies the summary if it isn't installed |
| `ask <prompt>` or `ai <prompt>`, or `claude`/`codex`/`agy <prompt>` | Opens the AI agent's CLI in a terminal with your prompt |
| Anything that matches little else | Search the web for it |
| `pref` | Lume Preferences |

### Prefixes

Start with one of these to see only one kind of result; the pill names it.

| Prefix | Shows only |
| --- | --- |
| `? ` or `b ` | Web search |
| `wiki ` | Search Wikipedia (in your language) |
| `yt ` | Search YouTube |
| `= ` | Calculator |
| `f ` | Files |
| `wd` | Open windows |
| `ws` | Workspaces |
| `clip` | Clipboard history |
| `:` or `emoji ` | Emoji |
| `ask ` or `ai ` | AI agent |
| `> ` | The command, run in your terminal on Enter |

`> ` is deliberate, so it also runs power commands (`> shutdown now`) that
the command row otherwise leaves out; you see them in the terminal.

These are the defaults. Change them on the *Prefixes* page of Lume's
preferences: several per scope, separated by spaces, or none to turn a scope
off. A prefix that starts with a letter needs a space after it (`f readme`),
a symbol does not (`?lume`). A user script's name works as a prefix too.

### Actions and preview

<kbd>Ctrl</kbd>+<kbd>K</kbd> shows what you can do with the selected result:

| Result | Actions |
| --- | --- |
| App | Open, New Window, the app's own actions (New Private Window, …), launch on the other graphics card (dual-GPU machines), App Details (with GNOME Software) |
| File or folder | Open, Show in Folder, Properties, Copy File, Copy Path, Open Folder in Terminal |
| Window | Focus, Close Window |
| Media player | Play or Pause, Next, Previous |
| Command | Run in Background, Run in Terminal |
| Anything else | Open, and Copy where it can be copied |

<kbd>Ctrl</kbd>+<kbd>P</kbd> shows a preview pane beside the results, and
Lume remembers whether it is shown. Files show their type, size, date and
location, with a thumbnail for images; clipboard entries their full text;
weather a 5-day forecast; other results their icon, title and subtitle.
*Preferences → Preview Position* puts it on the left or right.

### User scripts

Put an executable file in `~/.config/lume/scripts/`, for example `vpn`.
Typing `vpn work` runs it with `work` as its single argument (never through a
shell), in your home folder. Every line it prints becomes a result:

```
title|subtitle|command
```

Enter runs `command` with `/bin/sh` in the background (a line without a
command copies its title). A script gets 2 seconds and 50 lines; it runs
under `timeout` at low CPU priority (`nice`), so anything it started ends
with it. Lume runs only scripts you put there, and only when their name
starts the search. New scripts are picked up within a few seconds.

A script, and the `scripts` folder, must belong to you (or root) and must not
be writable by other users; otherwise Lume shows "Script not run" instead.
`chmod go-w ~/.config/lume/scripts ~/.config/lume/scripts/*` fixes it.

```sh
#!/bin/sh
# ~/.config/lume/scripts/vpn: "vpn" shows both rows
echo "Connect work VPN|nmcli|nmcli connection up work"
echo "Disconnect work VPN|nmcli|nmcli connection down work"
```

The command is run by the shell. If your script puts the search text into a
command, quoting it safely is up to the script.

### Fuzzy matching

*Preferences → Search → Fuzzy Matching* sets how app and file names match:
*Strict* matches the start of a name or a word in it, *Normal* (default) any
part of a name, *Loose* also lets you leave out characters in between, so
`vsc` finds Visual Studio Code. Apps always include GNOME's own overview
search on top of this.

### Calculator and unit conversion

The calculator follows the order of operations: `+ - * / % ^` (or `**`) and
parentheses. Implicit multiplication works: `2pi`, `2(3+4)`, `(2)(3)`.
Functions: `sqrt cbrt abs exp ln log log10 log2 round rint floor ceil fact
rad deg sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow fmod
hypot min max`. `log` is base 10. Add `d` to a trigonometry function for
degrees: `sind(30)`, `asind(0.5)`. Constants: `pi` (or `π`) and `e`. It never
uses `eval`.

Conversions take `to`, `in`, `into`, `as` or `->` between units of one
category; without a number, 1 is assumed (`cup to qt`). Currencies use ISO
codes (`100 eur to usd`, `50 usd in php`) for the 30 currencies with ECB
reference rates. Rates come from [Frankfurter](https://frankfurter.dev) at
most every 12 hours and are cached in `~/.cache/lume/rates.json`, so
conversions keep working offline with the last rates; the row shows their
date. Only that request for the day's rates is sent, never what you type. Categories: length,
mass, volume (US cups, pints, quarts, gallons), time, area, speed, storage
(`kb`/`mb`/`gb` are 1000-based, `kib`/`mib`/`gib` 1024-based) and temperature.

Web units are lengths with CSS's fixed ratios: 96 `px` per inch, `pt`
(1/72 in) and `pc` (12 pt), and `rem`/`em` at the browser default of 16 px
(`em` ignores parent font sizes). `vw`, `vh`, `vmin` and `vmax` use the
logical size of the monitor Lume opens on; a browser's real viewport is a
little smaller because of its toolbars. `pt` means point next to another
length (`12pt to px`) and pint next to a volume (`qt to pt`).

### Files

Files come from GNOME's file index (LocalSearch, formerly Tracker), so only
indexed folders are searched (Settings → Search → Search Locations). Hidden
folders and `node_modules` are skipped. Without an index, Lume searches the
names in your home folder, three levels deep. Typing a path that starts with
`/` or `~/` lists that folder instead (hidden files appear once the filter
starts with `.`).

*Search File Contents* (off by default) also matches text inside indexed
files. It is slower, and only covers files LocalSearch extracts text from.

### Web addresses

With `https://` anything opens. Without it, only `localhost`, IPv4 addresses
and a list of common domain endings (`.com`, `.org`, `.io`, `.dev`, `.ai`,
country codes, …) count as addresses, because many endings are also file
extensions: `notes.md`, `archive.zip` and `script.sh` stay file searches.

### Apps' search providers

Apps like Calendar, Contacts, Software, Characters, Clocks and Firefox can
answer searches the way they do in the overview, and their results show in
Lume below its own. Lume uses GNOME's own code for this, so *Settings →
Search* decides which apps are asked and in what order. Settings, Files,
Calculator and Weather are skipped because Lume has its own versions of
those. An app that has not answered within 2 seconds (for example while it
starts) is left out of that search.

### Emoji

`:coffee` or `emoji coffee` finds emoji by English name and keyword
(1914 emoji up to Emoji 17.0, without skin-tone variants). The list is
built from Unicode's emoji data by `tools/emoji.py` and ships in
`src/data/`, under the Unicode licence in `src/data/UNICODE-LICENSE.txt`.

### Commands

When the first word is a program on your `PATH`, Lume offers to run the whole
line in your home folder. Enter opens it in your terminal, run by your own
shell (fish, bash or zsh, so your aliases and functions work), and keeps the
window open afterwards, so a mistyped command can be seen and stopped.
Ctrl+Enter runs it in the background with `/bin/sh` instead, and shows a
notification if it fails; its output is discarded. *Enter Runs Commands In*
in preferences swaps the two. A bare program name ranks below matching
apps, and a line ranks above Settings panels and apps only when it looks
like a command (`-flag`, `/`, `|`, `>`, `=`, `$`). Turn this off with *Run
Commands* in preferences. Power commands (`shutdown`, `poweroff`, `reboot`,
`halt`, `systemctl poweroff`/`reboot`/`suspend`, …) are not offered: they
would act without asking, so use *Power Off* or *Restart*, which open GNOME's
confirmation.

### Web search, weather and AI agents

The web search row opens your query with the engine chosen in preferences
(Google by default; DuckDuckGo, Brave Search, Startpage, or a custom
`https://…%s` URL). Nothing is sent until you choose the row. It appears only
when fewer than three other results match.

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
set by KeePassXC and KWallet) are skipped. Bitwarden and 1Password don't set
it, so Lume also skips copies that look like a secret: GitHub, AWS, Slack and
AI API tokens (`sk-…`), JWTs, private keys and card numbers. A plain password
from such a manager can't be recognised; turn off *Remember Copied Text* if
that matters to you.

### What leaves your computer

Lume sends nothing unless one of these happens:

- `weather …`: the city to Open-Meteo.com (geocoding and forecast).
- A currency conversion: one fixed request for the day's ECB rates to
  frankfurter.dev, at most every 12 hours. Your query is never sent.
- Results from apps' GNOME search providers: Lume asks the apps, as the
  overview does; some (Software, browsers) may search online.
- Choosing a web, Wikipedia or YouTube search row or a web address: your
  browser opens it.

*Preferences → Privacy → Offline Mode* turns off the first three and the web
search rows. Saved exchange rates are still used. Commands, AI agents and
web addresses you choose to open are not affected.

**Why not <kbd>Super</kbd>+<kbd>Space</kbd>?** GNOME uses it to switch input
sources. To use it for Lume, first clear or change *Settings → Keyboard →
View and Customize Shortcuts → Typing → Switch to next input source*, then set
it in Lume's preferences.

## Preferences

`gnome-extensions prefs lume@cjts15.github.io`, <kbd>Ctrl</kbd>+<kbd>,</kbd> or the gear button in Lume, or search "Lume Preferences".

- **Open Lume**: click the row and press a combination. It needs Super, Ctrl
  or Alt. Esc cancels, Backspace disables the shortcut, the arrow button
  resets it. A combination already taken by GNOME never reaches the dialog;
  free it in GNOME Settings first.
- **Width**, **Distance From Top**, **Maximum Results**.
- **Search**: fuzzy matching (strict, normal, loose), search file contents,
  run commands.
- **Prefixes** (own page): the prefixes for each scope.
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
`gnome-extensions enable lume@cjts15.github.io`, or enable it before starting with
`gsettings set org.gnome.shell enabled-extensions "['lume@cjts15.github.io']"`
(this changes your real settings too). Set the window size with
`MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000` (the Makefile does).

The nested Shell shares your real settings. Turning on high contrast, large
text or the screen reader inside it turns them on in your session too. Note
your current values first (`gsettings get` with the same keys), because
`reset` goes back to the default, not to your previous value:

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
        // label: the short type shown on each row's right ("App").
        super({id: 'example', name: 'Example', label: 'Example'});
    }

    // Optional: when a keyword of yours owns the query, name it for the
    // pill in the search field ("clip" -> "Clipboard").
    scope(text) {
        return text.startsWith('hello ') ? 'Example' : null;
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
            // Optional: ctrlActivate (Ctrl+Enter), altActivate (Alt+Enter),
            // copy (Ctrl+C), fallback: true (only shown when few rows match),
            // type: 'Folder' (overrides the provider's label on this row)
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
  lib/units.js        unit conversion (no gi imports)
  lib/rates.js        ECB exchange rates, cached
  lib/devtools.js     UUID, Base64, checksums, colours, Unix time
  lib/emoji.js        emoji search (no gi imports)
  lib/url.js          web address recognition (no gi imports)
  lib/agents.js       agent and terminal argv (no gi imports)
  lib/terminal.js     run commands in the terminal or the background
  lib/prefix.js       prefix scope matching (no gi imports)
  providers/          one file per provider: apps, windows, system,
                      toggles, settings, files, calculator, units,
                      devtools, emoji, url, cli, clipboard, media,
                      weather, agents, remote (apps' search providers),
                      scripts (user scripts), web, commands (Lume's own)
  data/               emoji.json (generated) and its Unicode licence
  schemas/            GSettings schema
tests/                gjs self-checks (`make test`), headless smoke test
                      (`make smoke`)
tools/emoji.py        rebuilds src/data/emoji.json from Unicode data
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

## Inspiration

Lume borrows ideas from these GNOME Shell launchers:

- [lightning-search-gnome](https://github.com/mihierkansal/lightning-search-gnome)
- [superbar](https://github.com/Furkan-rgb/superbar), the reference for the
  search window's look
- [searchlightng](https://git.salix.host/salix/searchlightng)

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). The emoji data in `src/data/` is
derived from Unicode data under the
[Unicode License v3](src/data/UNICODE-LICENSE.txt).
