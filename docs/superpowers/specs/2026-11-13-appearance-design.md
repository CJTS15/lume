# Appearance pass: Superbar-inspired look

**Why:** Lume works; CJ wants it to look as polished as the Superbar
reference before starting the v2 features.

**Goals**
1. Rounded panel with roomier rows.
2. Regular (not bold) result titles.
3. A scope pill on the right of the search field.
4. A short type label on the right of each row.
5. A footer with key hints.

**Non-goals (later, v2 plan):** window results, the `>` action menu,
prefix scopes, clipboard timestamps, coloured icon tiles.

**Anti-goals:** breaking high contrast or custom Shell themes; a hint for a
key that does nothing.

## Approaches

- **A. Theme colours plus neutral tints — chosen.** Colours keep coming
  from the Shell theme classes; new shapes are layout CSS; the pill and key
  chips use a translucent neutral grey that reads on light and dark. Keeps
  high contrast and custom themes working, as decided in v1.
- **B. Own palette** (`stylesheet-light.css` / `-dark.css`): pixel-close to
  the reference, but stops following high contrast and custom themes.
  Rejected by CJ: "Follow shell theme."

## Design

- **Panel:** `border-radius: 24px` on `.lume-panel`; more padding. Rows get
  a larger min-height and padding, and a rounded selection (`12px`).
- **Title:** `.lume-result-title` drops `font-weight: bold`.
- **Scope pill:** an `St.Label` in the entry's secondary-icon slot area (or
  a box beside the entry), text "All results" by default. A provider may
  implement `scope(text)` returning a label when a keyword of its own owns
  the query; the first non-null wins. Initial scopes: Clipboard (`clip`),
  Weather (`weather`), AI Agent (`ask`, agent names), Folder (path typed
  with `/` or `~/`). Neutral tint background, dot + label as in the
  reference.
- **Type label:** each provider declares a short `label` (App, Setting,
  File, Calculator, Conversion, Link, Command, Clipboard, Weather, Agent,
  Web, Lume); a result may override it (`type: 'Folder'`). Dimmed text on
  the row's right, using the theme's insensitive colour
  (`popup-inactive-menu-item`). Included in the row's accessible
  description.
- **Footer:** separator, then right-aligned hints `[↑↓] Navigate`,
  `[↵] Open`, `[Esc] Close`. Chips use the neutral tint; text dimmed like
  subtitles. Always visible, also with no results.
- **Colours:** only Shell theme classes plus `rgba(127, 127, 127, 0.15)` for
  chip and pill backgrounds. No other colours in `stylesheet.css`.

## Left to the builder

Exact paddings and sizes; whether the pill sits inside the `St.Entry` or
in a box next to it; footer font size. Check light, dark, high contrast and
text scaling 1.5 in `make nested`, and that `make smoke` stays green.
