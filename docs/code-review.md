# Lume code review

- **Reviewed:** `main` at `e81e03b` (Lume 3.0.0, merge of PR #20), 2026-11-17
- **Scope:** `src/` in full (extension, search window, the 25 providers, `lib/`, prefs, schema, stylesheet), plus `Makefile`, CI and the release zip.
- **Checks run:** `make test` passed all 15 unit test files (gjs, Ubuntu GNOME 46 container). `glib-compile-schemas --strict` passed. `make pack` builds a 58-file zip with no compiled schema. CI on `main` is green on GNOME 45 to 51 (Actions run 43835884756).
- **Not run:** the headless smoke test on my side, since CI already covers it, and nothing on a real GNOME 51 session.

Confidence labels:
- **Confirmed:** I read the code path and the behavior follows from it, or I reproduced it.
- **Likely:** the code path is clear, but I did not trigger it in a running Shell.
- **Possible:** it depends on timing or the environment.

## Summary

The codebase is in good shape. Lifecycle handling is careful: every provider that holds a signal, main loop source, D-Bus subscription, Soup session or file monitor releases it in `destroy()`, and `disable()` tears down in the right order. User text never reaches a shell or SPARQL unescaped. Clipboard history skips secrets and is written with mode 0600. I found **no high-severity bugs**. Most of the findings below are small robustness gaps, plus a few things an extensions.gnome.org (EGO) reviewer is likely to point at. Those overlap with [ego-submission.md](ego-submission.md).

| Severity | Count | Theme |
|---|---|---|
| High | 0 | |
| Medium | 4 | EGO review flags, process lifetime after disable, async preview after destroy |
| Low | 11 | Leaked enumerators, per-keystroke work, a11y focus, privacy edges |
| Nit | 6 | Stale comments, misplaced JSDoc, consistency |

---

## Medium

### M1. Module-level `NM` state survives `disable()` (EGO rule 1)
`src/providers/toggles.js:68` and `:122`. **Confirmed.**

`let NM = null` sits at module scope, gets assigned on the first enable, and is never cleared. The EGO guidelines say memory stored dynamically "must be cleared in `disable()`". A reviewer reading `toggles.js` will likely flag a mutable module global. It is harmless at runtime because a typelib namespace is static, but it is the easiest flag to remove.

**Fix:** keep the namespace on the instance, e.g. `this._NM = module`, and read `this._NM.DeviceType.WIFI` in `available()`. `Gio._promisify` is idempotent, so calling it on every enable is fine. If you'd rather keep the module variable, set `NM = null` in `destroy()` and add a one-line comment saying why it exists.

### M2. Background commands outlive `disable()` and notify afterwards
`src/lib/terminal.js:30-51`. **Confirmed** by reading the code; the notification after disable is **Likely**.

`runInBackground()` spawns `/bin/sh -c <line>` and awaits `wait_async(null)` with no cancellable. Lock the screen while a long background command runs (`sleep 600`, `rsync …`) and the extension is disabled, but the promise is still pending. When the process fails, `Main.notifyError` fires from a disabled extension. EGO rule 12 asks that "processes must be spawned carefully and exit cleanly." A user-started command that keeps running is defensible, since it's the same as launching an app, but a callback that runs after disable is not.

**Fix:** keep a module-level `Gio.Cancellable` in `lib/terminal.js` and pass it to `wait_async()`. Add an exported `destroy()` that cancels it and makes a fresh one, call it from `extension.js` `disable()` next to `Paste.destroy()`, and skip the notification when the wait was cancelled. Leave the child process itself running; killing a user's `rsync` on screen lock would be worse. Say that in a comment so the reviewer sees it was deliberate.

### M3. An async preview can fill a destroyed pane
`src/lib/searchWindow.js:337-346`, `:595-615`. **Possible**: it needs `show-preview` on and a disable while a file preview is loading.

`_updatePreview()` awaits `result.preview()`, which does file I/O for files and projects, and then checks `token !== this._previewToken`. `_onDestroy()` doesn't bump the token, so a preview that resolves after `disable()` calls `_fillPreview()` on disposed actors. That logs "Object St.BoxLayout … has been already disposed" criticals.

**Fix:** one line in `_onDestroy()`: `this._previewToken++;`. Optionally set `this._destroyed = true` too and check it in the same guard.

### M4. Comment style an EGO reviewer may read as AI output (EGO rule 16)
Seven `// ponytail:` comments (`lib/paste.js:7,9`, `lib/procs.js:5`, `lib/dates.js:7`, `providers/cli.js:22`, `providers/scripts.js:118`, `providers/files.js:622`), a stale header in `providers/commands.js:3` ("Example provider … exists to prove the provider interface"), and a misplaced JSDoc in `prefs.js:502-510`. **Confirmed** that they exist; whether they trigger a rejection is **Possible**.

Rule 16 lists "inconsistent style … comments acting as LLM prompts, or other signs of AI-generated output" as grounds for rejection. "ponytail" isn't a convention any reviewer will recognize, and an "example provider" shipping in a 3.0 release reads as scaffolding that was left behind. You also need to be able to explain every line on request. At about 8,400 lines of `src/` JavaScript across 25 providers, this is a large review surface, so trim anything you couldn't defend quickly.

**Fix:** rename `ponytail:` to `Limitation:` (or `TODO:` where it is one). Rewrite the `commands.js` header to describe what it does ("Lume's own commands: opening Preferences"). Move the `_comboRow` JSDoc down to `_comboRow` (`prefs.js:577`).

---

## Low

### L1. File enumerators are never closed in four places
`providers/projects.js:226` (returns early on `.git` without closing), `providers/scripts.js:87`, `providers/processes.js:175`, `providers/bookmarks.js:183`. **Confirmed.**

`files.js` closes its enumerators in `finally`, but these four leave the fd open until GC finalizes the object. The project scan can open up to `MAX_FOLDERS` of them in one pass.

**Fix:** use the same `try { … } finally { enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {}); }` pattern as `files.js:420`.

### L2. Apps provider walks every installed app on every keystroke
`providers/apps.js:101`. **Confirmed** (cost not measured).

`get_installed()`, then `lookup_app` and `fuzzyScore` run for every app on each keypress, even when `fuzzy-matching` is `strict`. That's cheap at 200 apps and wasteful at 1,000 with Flatpaks.

**Fix:** cache the `[id, name]` list, invalidate it on `Shell.AppSystem` `installed-changed`, and skip the fuzzy pass entirely when the level is `strict`. Turn on `debug-timing` first to check whether it matters.

### L3. Synchronous `find_program_in_path` per keystroke
`providers/cli.js:65`, `providers/agents.js:57`. **Confirmed.**

Each query stats the first word against every `$PATH` entry on the Shell's main thread, for two providers. It's normally microseconds, but a `$PATH` entry on a slow or stale network mount would stall the compositor.

**Fix:** memoize per word in a small Map with a TTL of a few seconds, or cache the agent paths at enable time and refresh on query miss.

### L4. The search entry has no visible focus indicator
`src/stylesheet.css:22-30`. **Confirmed.**

`.lume-entry:focus` drops the border and the box-shadow. Only the text caret shows focus, which fails WCAG 2.4.7 and is hard to see in high contrast. Arrowing back up from the rows to the entry gives almost no visual cue.

**Fix:** keep the flat look but restore the theme's focus style on `:focus`, or add a 2px outline/box-shadow on `.lume-search-row` when the entry has focus. Test with the High Contrast setting.

### L5. Preview shows plain-text secrets that don't match a token pattern
`providers/files.js:728`. **Confirmed.**

`looksSecret()` catches tokens, keys and card numbers. A `.env` holding `DB_PASSWORD=hunter2` or a `~/.netrc` previews in full. It only happens when the preview is on (default off) and the user browses to a hidden file, so the risk is low.

**Fix:** also refuse to preview files whose name starts with `.env` or matches `.netrc`, `.pgpass` or `*credentials*`, or any file with group/other read bits off (mode `0600` is a strong "private" signal).

### L6. Weather and time-zone lookups send partial city names while typing
`providers/weather.js:280-288`, `providers/time.js` geocode path. **Confirmed.**

Debounced at 400 ms, so pausing mid-word ("weather amst") sends "amst" to Open-Meteo. The prefs text says the city is sent "only when you search for weather", which is true, but the user may not expect partial input to go out.

**Fix:** none needed for the code. Optionally say "as you type" in the prefs description and the EGO description (see the submission plan).

### L7. `weather` keyword is hard-coded
`providers/weather.js:18`. **Confirmed.**

Every other scope has a `prefix-*` key and a row in the Prefixes page. Weather alone can't be renamed or translated, and it doesn't implement `owns()`, so "weather paris" also runs every other provider.

**Fix:** add `prefix-weather` (default `['weather']`), use `matchPrefix`, implement `owns()`, and add it to `prefs.js:516`.

### L8. Unhandled rejection path in `_onTextChanged`
`src/lib/searchWindow.js:401-420`. **Possible.**

`registry.query()` catches provider errors, but if `onResults` itself throws (a render bug), the promise rejects with no `.catch`, which logs an unhandled rejection without saying which provider was involved.

**Fix:** add `.catch(e => console.error(\`lume: search failed: ${e}\`))`.

### L9. `_onKeyPress` runs twice for some keys
`src/lib/searchWindow.js:222` and `:235`. **Likely.**

The handler is connected on both `clutter_text` and the backdrop, so a key the entry propagates (e.g. F-keys, or keys with modifiers it doesn't use) bubbles to the backdrop and runs `_onKeyPress` again. Today that's harmless because every action returns `EVENT_STOP` the first time, but it's a trap for the next key binding someone adds.

**Fix:** connect only on the backdrop, which already sees bubbled entry events, or bail out in the backdrop handler when `event.get_source()` is inside the entry.

### L10. Clipboard history is lost on every screen lock by default
`providers/clipboard.js:6-8`. **Confirmed** (documented behavior).

Without `session-modes`, the extension is disabled on lock, so the in-memory history is wiped each time the screen locks. That's correct for EGO and for privacy, but users will report it as a bug.

**Fix:** none in code. Put it in the README FAQ and keep the prefs wording ("Keep After Locking or Logging Out"), which already explains it. Don't add `unlock-dialog` just for this; EGO will push back.

### L11. Release zip doesn't carry the GPL text
`Makefile:13-16`. **Confirmed.**

The zip has `data/UNICODE-LICENSE.txt` but not `LICENSE`. EGO doesn't require it, but GPL redistribution expects the license text to travel with the code.

**Fix:** add `--extra-source=../LICENSE` to `pack`. Paths are relative to `src/`, same as `--podir`.

---

## Nits

- **N1.** `prefs.js` puts nine groups on one "General" page. The GNOME HIG suggests splitting long pages: for example *General* (shortcut, window, search), *Privacy* (clipboard, offline), and *Integrations* (web, weather, AI agent, projects).
- **N2.** `providers/clipboard.js:119` is mis-indented (`preview:` has 4 extra spaces).
- **N3.** `providers/cli.js:27-28` has a double blank line, and `:111` has a trailing blank line inside the class.
- **N4.** `debug-timing` has no UI, which is fine, but say in the README that it's toggled with `gsettings set org.gnome.shell.extensions.lume debug-timing true`.
- **N5.** Several providers duplicate the same `_wait()` debounce helper (files, weather, remote, scripts, time). A small `lib/debounce.js` would remove five copies. That's optional: they're tiny and correct.
- **N6.** No ESLint config is checked in. The EGO guidelines recommend ESLint, and GNOME Shell's own config (`eslint-config-gnome` style) would catch N2/N3 automatically. Add it to CI next to `make test`.

---

## Things that are done well (keep them)

- `ProviderRegistry.query` isolates providers: one failing or slow provider never blocks others, and `checkResults()` caps untrusted text.
- No shell interpolation of user input anywhere: agents, terminal, editor and folder paths are always separate argv elements (`lib/agents.js`, `files.js:656`, `projects.js:111`).
- SPARQL gets user text only via `bind_string` (`files.js:504`).
- The scripts provider refuses scripts that other users can modify, using the same rule as ssh (`scripts.js:117`), and runs them under `nice` and `timeout` with process-group kill.
- Clipboard history skips password-manager hints and token-like text, stores the file at 0600 in a 0700 directory, and deletes it when either switch is turned off.
- Version shims (`add_actor`, `orientation`, `get_seat_state`, `stage.context`) are each commented with the GNOME version they cover.
