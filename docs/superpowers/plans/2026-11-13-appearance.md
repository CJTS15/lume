# Appearance Pass Implementation Plan

> **Written after implementation.** The work was built straight from the
> approved design on `feature/appearance`; this plan records it as a set of
> tasks so later work can follow (or repeat) the same steps. Checked boxes
> were done; the one unchecked step was not.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the search window after the Superbar reference: rounded
panel, roomier rows, regular titles, a scope pill, a type label per row and
a footer with key hints.

**Architecture:** Providers gain a short `label` and an optional
`scope(text)`; the registry exposes `scopeFor(text)`. `SearchWindow` adds
the pill, per-row type labels and a footer. All sizing is layout CSS in
`stylesheet.css`; colours stay with the Shell theme classes.

**Tech Stack:** GJS (ESM), St/Clutter, Atk, GNOME Shell 45–51.

**Spec:** `docs/superpowers/specs/2026-11-13-appearance-design.md`

## Global Constraints

- Colours come only from Shell theme classes, plus
  `rgba(127, 127, 127, 0.15)` behind the pill and key chips. No other
  colours in `stylesheet.css`.
- High contrast and custom Shell themes must keep working.
- No hint for a key that does nothing (no "Actions" until the action menu).
- Every user-visible string goes through `_()`.
- `make test` and `make smoke` stay green.

## Review Focus

- High contrast: the selected row must stay visibly outlined. Check with
  `high-contrast true` in the screenshot harness (Task 3).
- Text scaling 1.5: the pill, type labels and footer must not overflow or
  push the title off-screen. Check with `text-scaling-factor 1.5` (Task 3).
- GNOME 45–46 have no `-st-accent-color`: the pill dot may be blank, but
  nothing else may break. Untested; check when a 45/46 session is available.
- Screen readers: a focused row must announce its type after its title
  (`DESCRIBED_BY`). Check with Orca in `make nested`.
- Light style: the headless shell renders dark even with `prefer-light`;
  check the light style in `make nested` or a real session.

---

### Task 1: Provider labels and scopes

**Files:**
- Modify: `src/lib/provider.js` (Provider constructor, `scope()`, `ProviderRegistry.scopeFor()`, `Result.type` docs)
- Modify: every `src/providers/*.js` constructor (`label`)
- Modify: `src/providers/clipboard.js`, `weather.js`, `agents.js`, `files.js` (`scope()`); `files.js` also sets `type: 'Folder'` on folder rows
- Test: `tests/provider.test.js`

**Interfaces:**
- Produces: `new Provider({id, name, label?})` with `provider.label`
  (defaults to `name`); `provider.scope(text: string): string|null`
  (base returns `null`); `registry.scopeFor(text: string): string|null`
  (first non-null in registration order); optional `Result.type: string`.

- [x] **Step 1: Write the failing test** `tests/provider.test.js`:
  `new Provider({id: 'a', name: 'Apps'}).label === 'Apps'`;
  `new Provider({id: 'a', name: 'Apps', label: 'App'}).label === 'App'`;
  base `scope('clip') === null`; with two providers scoping `clip` as
  `'Clipboard'` then `'Other'`, `scopeFor('clip foo') === 'Clipboard'` and
  `scopeFor('firefox') === null`. (Added after the implementation.)
- [x] **Step 2: Run `gjs -m tests/provider.test.js`.** Before Step 3 it
  fails with `scopeFor is not a function`.
- [x] **Step 3: Implement** the interfaces above in `src/lib/provider.js`.
- [x] **Step 4: Set labels** (all through `_()`): apps `App`, settings
  `Setting`, files `File`, calculator `Calculator`, units `Conversion`,
  url `Link`, cli `Command`, clipboard `Clipboard`, weather `Weather`,
  agents `Agent`, web `Web`, lume-commands `Lume`.
- [x] **Step 5: Add `scope(text)`:**
  - clipboard returns `Clipboard` for `clip` / `clip …`
  - weather returns `Weather` for `weather` / `weather …`
  - agents returns `AI Agent` for `ask …`, or for an agent name *with* a
    prompt (a bare `claude` may be an app search)
  - files returns `Folder` when `_browseTarget(text)` is non-null
  - files rows for folders set `type: _('Folder')`
- [x] **Step 6: Run `make test`.** Expected: every suite prints
  `all tests passed`.
- [x] **Step 7: Commit:** "Give providers a row label and an optional scope".

### Task 2: Search window pill, type labels and footer

**Files:**
- Modify: `src/lib/searchWindow.js` (`_init`, new `_createFooter()`, `_onTextChanged`, `_render`, `_createRow`)

**Interfaces:**
- Consumes: `provider.label`, `result.type`, `registry.scopeFor(text)`
  (Task 1).
- Produces: style classes `lume-search-row`, `lume-pill`, `lume-pill-dot`,
  `lume-pill-label`, `lume-result-type`, `lume-footer`, `lume-key`,
  `lume-hint`, used by Task 3.

- [x] **Step 1: Search row.** Put the entry in a horizontal
  `St.BoxLayout` `lume-search-row`. After it, add the pill: a box
  `lume-pill` holding a dot `St.Widget` `lume-pill-dot` and an `St.Label`
  `lume-pill-label` with the text `_('All results')`.
- [x] **Step 2: Update the pill.** In `_onTextChanged`, set the label to
  `(text && registry.scopeFor(text)) || _('All results')`.
- [x] **Step 3: Type label.** In `_init`, build a `Map` of provider id to
  label from `registry.providers`. In `_render`, compute
  `result.type ?? label`. `_createRow(result, type, index)` appends an
  `St.Label` with classes `popup-inactive-menu-item lume-result-type`, and
  adds a `DESCRIBED_BY` relation from the row to it.
- [x] **Step 4: Footer.** Add an always-visible separator, built from the
  same `popup-separator-menu-item` classes as the existing one. Then
  `_createFooter()`: a spacer with `x_expand`, then three pairs of a
  `lume-key` chip and a `popup-inactive-menu-item lume-hint` label:
  `↑↓`/`Navigate`, `↵`/`Open`, `Esc`/`Close`.
- [x] **Step 5: Run `make smoke`.** Expected: `smoke: passed`.
- [x] **Step 6: Commit** together with Task 3 (the CSS gives the classes
  their look).

### Task 3: Stylesheet and visual check

**Files:**
- Modify: `src/stylesheet.css`
- Modify: `README.md` (Use section, Writing a provider)

- [x] **Step 1: CSS values:**
  - `.lume-panel`: `border-radius: 24px; padding: 10px`
  - `.lume-entry` (also `:focus` and `:hover`): `background-color:
    transparent; border-width: 0; box-shadow: none` (a flat field, a
    builder's call beyond the spec)
  - `.lume-result`: `min-height: 44px; padding: 8px 14px; border-radius:
    12px; spacing: 14px`
  - `.lume-result-title`: no `font-weight` rule
  - `.lume-pill` and `.lume-key`: the neutral tint. The pill is rounded
    `999px`, the chips `6px`.
  - `.lume-pill-dot`: 7px circle, `background-color: -st-accent-color`
  - `.lume-result-subtitle`, `.lume-result-type`: `font-size: 0.9em`
  - `.lume-footer`: `font-size: 0.85em`
- [x] **Step 2: Screenshot check.** Use the scratch harness: a headless
  shell with throwaway XDG dirs, plus a test-only extension that sets
  `global.context.unsafe_mode`, so `org.gnome.Shell.Eval` can open the
  window and call `Shell.Screenshot`. Capture these states:
  - empty
  - `terminal`
  - `clip`
  - `~/`
  - dark, high contrast and text scaling 1.5

  Expected: no overflow, high contrast keeps the selection outline, and
  the pill reads `Clipboard` / `Folder` for `clip` / `~/`.
- [ ] **Step 3: Light style.** Check in `make nested` (not done: the
  headless shell stayed dark).
- [x] **Step 4: README.** Describe the pill and the type labels under Use.
  Add `label`, `scope()` and `type` to the provider example. Credit the
  reference launchers under Inspiration.
- [x] **Step 5: Run `make test && make smoke`**, then commit:
  "Restyle the search window after the Superbar reference".
