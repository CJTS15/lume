# Plan: submitting Lume to extensions.gnome.org

- **Based on:** `main` at `e81e03b` (3.0.0), checked against the EGO review guidelines at <https://gjs.guide/extensions/review-guidelines/review-guidelines.html> as of 2026-11-17.
- **Companion:** [code-review.md](code-review.md) (finding IDs like M1 refer to it).

## Verdict

Lume is close to submittable. It meets every hard rule I could check: nothing happens at init, cleanup in `disable()`, no deprecated modules, no GTK in the Shell process, no Shell libraries in prefs, a schema under `org.gnome.shell.extensions`, clipboard use disclosed, no binaries, no telemetry, and a GPL-3.0-or-later license. The remaining risk is the **review itself**: about 8,400 lines and 25 providers is a lot for a volunteer reviewer to read, and a few patterns (module-level state, process lifetime, comment style) will draw questions. Fix the four items in step 1, and it should go through in one or two review rounds.

## Guideline checklist

| # | Rule | Status | Evidence / action |
|---|---|---|---|
| 1 | Nothing created at init (module import / constructor) | ⚠️ Mostly | Only `Gio._promisify` calls, `TextDecoder`, path strings and static tables at module scope, which reviewers accept. **Exception:** mutable `let NM` in `toggles.js:68`, which is never cleared (M1). The `Extension` subclass has no constructor. Confirmed. |
| 2 | Destroy all objects in `disable()` | ✅ | `extension.js:86-102` destroys the window, registry and paste state; each provider's `destroy()` drops its references. Confirmed. |
| 3 | Disconnect all signals | ✅ | Settings, selection, AppInfoMonitor, file monitor and D-Bus signal subscriptions are all released. Window-internal signals go with the actor. Confirmed. |
| 4 | Remove main loop sources | ✅ | Debounces, the clipboard save, paste wait, script timeout, `get_laters` render and measure timers are all removed on destroy. Confirmed. |
| 5 | No `ByteArray`/`Lang`/`Mainloop` | ✅ | grep finds none. Confirmed. |
| 6 | No Gtk/Gdk/Adw in the Shell | ✅ | Only `prefs.js` imports them. Confirmed. |
| 7 | No Clutter/Meta/St/Shell in prefs | ✅ | `prefs.js` imports `lib/agents.js`, `lib/snippets.js`, `lib/units.js` and `lib/web.js`, which have only GLib or no gi imports. Confirmed. |
| 8 | Don't touch other extensions | ✅ | None. |
| 9 | Not minified/obfuscated | ✅ | Plain ESM JavaScript. |
| 10 | No excessive logging | ✅ | Errors and `console.debug` only. Timing logs are behind `debug-timing` (default off) and never include the query. |
| 11 | No `run_dispose()` | ✅ | None. |
| 12 | Scripts/binaries, processes exit cleanly | ⚠️ Explain | No binaries ship. Lume *runs* user commands, user scripts in `~/.config/lume/scripts` and AI CLIs, always at the user's request and never privileged. Background commands outlive disable and can notify afterwards (M2). Explain the design in the submission notes (below). |
| 13 | Clipboard declared; no default clipboard shortcut; no sharing without user action | ✅ | Declared in `metadata.json` `description`. Ctrl+C/Ctrl+K act only inside Lume's own modal window; no global clipboard shortcut ships. `{clipboard}` in snippets is expanded only on Enter. |
| 14 | No privileged subprocesses | ✅ | `kill` is only sent to the user's own processes (uid-filtered, with a pid+start-time check). Power actions go through the Shell's `SystemActions`, and the CLI provider refuses `shutdown`/`systemctl poweroff` etc. |
| 15 | Functional | ✅ | CI smoke-tests the release zip on 45 to 51. |
| 16 | AI-generated code signals | ⚠️ Clean up | `ponytail:` comments, a stale "Example provider" header and a misplaced JSDoc (M4). You must be able to explain any line a reviewer asks about. |
| 17 | `metadata.json` | ⚠️ Small edits | uuid `lume@cjts15.github.io` is valid and namespaced to a domain you control. `shell-version` 45 to 51 lists stable releases only. `url` points to GitHub. No `session-modes`, so `user` is implied, which is correct. `version-name` is accepted by EGO. **Action:** extend `description` (below). Check the name "Lume" isn't already taken on EGO before uploading. |
| 18 | Session modes | ✅ | Not used. |
| 19 | GSettings schema | ✅ | id `org.gnome.shell.extensions.lume`, path `/org/gnome/shell/extensions/lume/`, file `org.gnome.shell.extensions.lume.gschema.xml`. The XML is in the zip and the compiled file is not; EGO and the Shell compile it on install for 44+. Confirmed by `make pack` output. |
| 20 | No telemetry | ✅ | The only network calls are Open-Meteo (weather/time zone, on an explicit `weather`/time query), Frankfurter (fixed URL, no user data) and the web search row, which runs only when chosen. Offline mode disables all of them. |
| — | Licensing | ✅ | GPL-3.0-or-later (compatible). The Unicode data license is shipped next to `emoji.json`. **Recommended:** ship `LICENSE` in the zip (L11). |
| — | Unnecessary files | ✅ | The zip contains only runtime files: no tests, `.pot`, Makefile or tools. `locale/` is empty until translations exist, which is harmless. |
| — | ESLint recommended | ⚠️ | No config is checked in (N6). |

## Step-by-step plan

### 1. Pre-submission fixes (one small PR)
Must-fix, because reviewers are likely to ask:
1. **M1:** move `NM` onto the `TogglesProvider` instance, or null it in `destroy()`.
2. **M2:** cancellable `wait_async` in `runInBackground`, cancelled from `disable()`, with no notification after disable.
3. **M4:** rename `ponytail:` comments, rewrite the `commands.js` header, move the `_comboRow` JSDoc.
4. **M3:** bump `_previewToken` in `SearchWindow._onDestroy()`.

Should-fix in the same PR (cheap):
5. **L11:** `--extra-source=../LICENSE` in `make pack`.
6. **L1:** close the four leaked enumerators.
7. **N6:** add an ESLint config and a CI lint step, then fix what it reports (N2, N3).

### 2. Update `metadata.json` description
EGO shows this text on the extension page, and reviewers compare it against what the code does. Suggested wording (keep the clipboard paragraph, since rule 13 requires it):

```text
A lightweight Spotlight-style search window for GNOME Shell: apps, files, windows, settings, calculator, unit and currency conversion, emoji, snippets, media, quick toggles, processes, web search and more. Opens with Super+Alt+Space.

Clipboard access: Lume keeps a clipboard history (it can be turned off, and is saved to disk only if you choose). Snippets, calculator and clipboard results can be copied to the clipboard and pasted into the window you were using.

Network access: weather and time-zone searches send the typed city to Open-Meteo.com; currency conversion downloads ECB rates from frankfurter.dev. Turn on Offline Mode to stop all network requests.

Commands: when you choose to, Lume runs the command you typed, your own scripts from ~/.config/lume/scripts, or an AI agent CLI in your terminal. Nothing runs with elevated privileges.
```

Then set `version-name` to the release you upload (e.g. `3.1.0`). Don't add a `version` key; EGO assigns it.

### 3. Build and verify the upload zip
```sh
make clean && make pack                       # lume@cjts15.github.io.shell-extension.zip
unzip -l lume@cjts15.github.io.shell-extension.zip   # expect no gschemas.compiled, tests/, .pot
gnome-extensions install --force lume@cjts15.github.io.shell-extension.zip
```
Then log out and back in (Wayland can't restart the Shell in place) and check:
- `gnome-extensions enable lume@cjts15.github.io` and use it.
- `gnome-extensions prefs lume@cjts15.github.io` opens all three pages.
- Lock and unlock the screen 3 times while watching `journalctl -f -o cat /usr/bin/gnome-shell`. Expect no `lume:` errors and no "already disposed" warnings.
- Disable and enable 5 times in a row, with the same log check.

The CI job "Smoke test of the release zip" already automates the enable/disable part on GNOME 45 to 51. The manual pass covers your real GNOME 51 session, which CI can't.

**Revert:** `gnome-extensions uninstall lume@cjts15.github.io`, then `make link` to go back to the dev symlink.

### 4. Prepare the listing
- **Screenshot:** reuse or refresh the search window shot (`lume-step1/search-window-gnome46.png` in project files is from an early build; take a new one on GNOME 51 with grouped results and the preview pane).
- **Name:** "Lume". Search EGO first; if it's taken, rename both `name` and the listing (the uuid can stay).
- **Homepage:** `https://github.com/CJTS15/lume` (already the `url`). Make sure the README has an install section that mentions EGO once it's live.

### 5. Upload
1. Sign in at <https://extensions.gnome.org> (create an account if needed).
2. Open <https://extensions.gnome.org/upload/>, accept the GPL-compatible license statement, and upload the zip.
3. In the reviewer notes field, paste the notes below.
4. The extension shows as *Unreviewed*. Review time varies from days to a few weeks, and a large extension tends toward the longer end.

**Suggested reviewer notes:**
```text
Lume is a Spotlight-style launcher. Each feature is a Provider (src/lib/provider.js) registered in enable() and destroyed in disable() via ProviderRegistry.destroy().

Subprocesses: Lume only spawns processes when the user chooses a result: the command they typed (lib/terminal.js, in their terminal by default), an AI agent CLI with the prompt as one argv element (lib/agents.js), kill(1) on the user's own processes after a pid+start-time check (providers/processes.js), and the user's own executables in ~/.config/lume/scripts (providers/scripts.js), which are refused if other users can write to them and are run under nice/timeout. Nothing runs privileged, and user text is never interpolated into a shell string.

Network: Open-Meteo (weather/time zone queries) and frankfurter.dev (exchange rates, fixed URL). Offline Mode disables both, plus remote search providers and web search.

Clipboard: history is opt-out, kept in memory, and written to disk (0600) only if the user turns that on; password-manager-hinted and token-like copies are skipped.
```

### 6. During review
- Reply to the reviewer on the EGO review page, not by email. Each new upload restarts review for that version.
- Typical asks for an extension like this: justify each subprocess, move something out of module scope, remove a log line. Fix each in a small commit and re-upload the zip with a bumped `version-name`.
- Keep a `release/ego` tag per uploaded version so you can map EGO version numbers back to commits.

### 7. After approval
- Each future release is reviewed again, and small diffs review faster. Keep releases focused.
- When GNOME 52 reaches stable (around March 2027), test, add `"52"` to `shell-version` and upload. Don't add it before the stable release (rule 17).
- Consider dropping GNOME 45 now that its distros (Fedora 39, Ubuntu 23.10) are end-of-life. That would remove the `add_actor`/`vertical`/`get_seat_state` shims and make the review surface smaller.

## Repo housekeeping note

`.gitignore` on `main` ignores `/docs/` (commit `d762b0f`). These two files were force-added (`git add -f`) so they could go in a PR. If you want `docs/` to stay local-only, close the PR and copy the files out. If you want docs tracked, remove `/docs/` from `.gitignore`.
