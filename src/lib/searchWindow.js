// SPDX-License-Identifier: GPL-3.0-or-later
//
// The search window: a centered panel with an entry and a result list.
//
// Styling comes from the Shell theme's own classes (popup-menu-content,
// popup-menu-item, StEntry, ...), so the window follows light, dark and
// high-contrast styles and any custom Shell theme. stylesheet.css only sets
// layout, never colors.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {paste, pasteTargetName, rememberWindow} from './paste.js';
import {noAction} from './provider.js';

const ICON_SIZE = 24;
const SCREEN_MARGIN = 16;
// Fallback rows (web search) are hidden once this many other rows match.
const FALLBACK_HIDDEN_AT = 3;
// The preview pane (Ctrl+P) adds this much width, in logical pixels.
const PREVIEW_WIDTH = 340;
const PREVIEW_ICON_SIZE = 96;
const PREVIEW_TEXT_LENGTH = 2000;
const PREVIEW_TEXT_LINES = 12;

const NAVIGATION_KEYS = new Set([
    Clutter.KEY_Down, Clutter.KEY_KP_Down, Clutter.KEY_Up, Clutter.KEY_KP_Up,
    Clutter.KEY_Tab, Clutter.KEY_ISO_Left_Tab, Clutter.KEY_Page_Down, Clutter.KEY_Page_Up,
]);

// Return on the entry usually arrives as ClutterText 'activate' instead;
// both paths pass the Ctrl/Alt state on to _activate.
const ENTER_KEYS = new Set([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter]);

/**
 * St.BoxLayout's `vertical` property was replaced by `orientation` in
 * GNOME 48. Set whichever this Shell has.
 *
 * @param {St.BoxLayout} box
 */
function setVertical(box) {
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
}

export const SearchWindow = GObject.registerClass(
class LumeSearchWindow extends St.Widget {
    /**
     * @param {Gio.Settings} settings
     * @param {import('./provider.js').ProviderRegistry} registry
     * @param {() => void} openPreferences
     */
    _init(settings, registry, openPreferences) {
        // Full-stage transparent backdrop: catches clicks outside the panel.
        super._init({
            name: 'lumeBackdrop',
            reactive: true,
            visible: false,
        });
        this.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));

        this._settings = settings;
        this._registry = registry;
        this._openPreferences = openPreferences;
        this._grab = null;
        this._cancellable = null;
        this._renderLater = 0;
        this._resultsByProvider = new Map();
        this._rows = [];
        this._selected = -1;
        // Whether the user moved the selection since the query changed.
        this._userMoved = false;
        // The result whose actions (Ctrl+K) replace the list, or null.
        this._actionsOf = null;
        // An action waiting for Enter on its confirm row, or null.
        this._confirm = null;

        this._panel = new St.BoxLayout({
            style_class: 'popup-menu popup-menu-content lume-panel',
            reactive: true,
        });
        setVertical(this._panel);
        this.add_child(this._panel);

        const searchRow = new St.BoxLayout({style_class: 'lume-search-row'});
        this._panel.add_child(searchRow);

        this._entry = new St.Entry({
            style_class: 'lume-entry',
            hint_text: _('Search'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({
                style_class: 'lume-entry-icon',
                icon_name: 'edit-find-symbolic',
            }),
        });
        this._entry.accessible_name = _('Lume search');
        searchRow.add_child(this._entry);

        // What the query searches: "All results", or a keyword's scope.
        const pill = new St.BoxLayout({
            style_class: 'lume-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        pill.add_child(new St.Widget({
            style_class: 'lume-pill-dot',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._scopeLabel = new St.Label({
            style_class: 'lume-pill-label',
            text: _('All results'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        pill.add_child(this._scopeLabel);
        searchRow.add_child(pill);

        this._separator = new St.Widget({
            style_class: 'popup-separator-menu-item lume-separator',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
        });
        this._separator.add_child(new St.Widget({
            style_class: 'popup-separator-menu-item-separator',
            x_expand: true,
        }));
        this._panel.add_child(this._separator);

        this._resultsBox = new St.BoxLayout({
            style_class: 'lume-results',
            accessible_role: Atk.Role.LIST,
            accessible_name: _('Results'),
        });
        setVertical(this._resultsBox);

        this._scrollView = new St.ScrollView({
            style_class: 'lume-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            visible: false,
        });
        // GNOME 45's St.ScrollView tracks its child only through
        // add_actor(); setting `child` there aborts the Shell when the
        // window is destroyed (st_bin_destroy assertion). 46 removed
        // add_actor() and uses `child`.
        if (this._scrollView.add_actor)
            this._scrollView.add_actor(this._resultsBox);
        else
            this._scrollView.child = this._resultsBox;

        // Results and the preview pane (Ctrl+P), in preview-position order.
        const body = new St.BoxLayout({style_class: 'lume-body', x_expand: true});
        this._scrollView.x_expand = true;
        body.add_child(this._scrollView);
        this._previewPane = new St.BoxLayout({
            style_class: 'lume-preview',
            width: PREVIEW_WIDTH,
            visible: false,
            // Never taller than the results area (see _updateGeometry).
            clip_to_allocation: true,
            accessible_name: _('Preview'),
        });
        this._previewLink = null;
        setVertical(this._previewPane);
        body.add_child(this._previewPane);
        this._panel.add_child(body);
        const placePreview = () => {
            const start = settings.get_string('preview-position') === 'start';
            body.set_child_at_index(this._previewPane, start ? 0 : 1);
            // St has no logical borders: put the divider on the results side.
            const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
            if (start !== rtl)
                this._previewPane.add_style_class_name('lume-preview-left');
            else
                this._previewPane.remove_style_class_name('lume-preview-left');
        };
        placePreview();
        this._previewPositionId = settings.connect('changed::preview-position', placePreview);
        this._previewToken = 0;
        this._previewChangedId = settings.connect('changed::show-preview', () => {
            this._updateGeometry();
            this._updatePreview();
        });

        this._statusLabel = new St.Label({
            style_class: 'popup-inactive-menu-item lume-status',
            text: _('No results'),
            visible: false,
        });
        this._panel.add_child(this._statusLabel);

        const footerSeparator = new St.Widget({
            style_class: 'popup-separator-menu-item lume-separator',
            layout_manager: new Clutter.BinLayout(),
        });
        footerSeparator.add_child(new St.Widget({
            style_class: 'popup-separator-menu-item-separator',
            x_expand: true,
        }));
        this._panel.add_child(footerSeparator);
        this._panel.add_child(this._createFooter());

        this._labels = new Map(registry.providers.map(p => [p.id, p.label]));
        this._names = new Map(registry.providers.map(p => [p.id, p.name]));

        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());
        this._entry.clutter_text.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        // Enter: ClutterText emits 'activate' for Return/KP_Enter/ISO_Enter.
        // Matching it in key-press-event did not work on GNOME 51; the
        // Shell's own search entry uses this signal.
        this._entry.clutter_text.connect('activate', () =>
            this._activate(this._selected, Clutter.get_current_event()?.get_state() ?? 0));
        this.connect('button-press-event', (_a, event) => {
            // Clicks on the (reactive) panel bubble up here too; only close
            // for clicks that land on the backdrop itself.
            if (global.stage.get_event_actor(event) === this)
                this.close();
            return Clutter.EVENT_STOP;
        });
        this.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        // ClutterText's own bindings take Left and Right before its
        // key-press-event on GNOME 51, so folder keys are caught on the way down.
        this.connect('captured-event', (_a, event) =>
            event.type() === Clutter.EventType.KEY_PRESS && this._onFolderKey(event.get_key_symbol(), event.get_state())
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);
        this.connect('destroy', () => this._onDestroy());

    }

    _createFooter() {
        const footer = new St.BoxLayout({style_class: 'lume-footer'});
        const hint = (key, action) => {
            footer.add_child(new St.Label({
                style_class: 'lume-key',
                text: key,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            footer.add_child(new St.Label({
                style_class: 'popup-inactive-menu-item lume-hint',
                text: action,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        };
        // TRANSLATORS: key names in the footer hints
        hint(_('Ctrl K'), _('Actions'));
        hint(_('Ctrl P'), _('Preview'));
        footer.add_child(new St.Widget({x_expand: true}));
        // No arrow-key hint: it is the one everyone knows, and five hints
        // do not fit at large text sizes.
        hint('↵', _('Open'));
        hint(_('Esc'), _('Close'));

        const preferences = new St.Button({
            // The theme's menu item hover, so high contrast outlines it too.
            style_class: 'popup-menu-item lume-footer-button',
            child: new St.Icon({
                style_class: 'popup-inactive-menu-item lume-footer-icon',
                icon_name: 'emblem-system-symbolic',
            }),
            accessible_name: _('Preferences'),
            y_align: Clutter.ActorAlign.CENTER,
            // Out of the Tab order, which moves between rows; Ctrl+, is
            // the keyboard way (the GNOME convention).
            can_focus: false,
        });
        preferences.connect('clicked', () => this._showPreferences());
        footer.add_child(preferences);
        return footer;
    }

    _showPreferences() {
        this.close();
        this._openPreferences();
    }

    get isOpen() {
        return this._grab !== null;
    }

    toggle() {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.isOpen)
            return;

        rememberWindow();
        this._updateGeometry();
        this.show();

        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        // GNOME 45-47 can fail to take the grab (e.g. another client holds
        // it); later versions dropped this check from Shell's own dialogs.
        if (typeof grab.get_seat_state === 'function' &&
            grab.get_seat_state() !== Clutter.GrabState.ALL) {
            Main.popModal(grab);
            this.hide();
            return;
        }
        this._grab = grab;
        this._entry.grab_key_focus();
    }

    close() {
        if (!this.isOpen)
            return;

        this._cancelQuery();
        Main.popModal(this._grab);
        this._grab = null;
        this.hide();
        this._actionsOf = null;
        this._confirm = null;
        this._entry.text = '';
        this._clearResults();
    }

    _onDestroy() {
        // A preview still loading must not fill the destroyed pane.
        this._previewToken++;
        this._settings.disconnect(this._previewChangedId);
        this._settings.disconnect(this._previewPositionId);
        this._cancelRender();
        this._cancelQuery();
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    _updateGeometry() {
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const margin = SCREEN_MARGIN * scaleFactor;
        const preview = this._settings.get_boolean('show-preview') ? PREVIEW_WIDTH : 0;
        const width = Math.min(
            (this._settings.get_int('panel-width') + preview) * scaleFactor,
            monitor.width - 2 * margin);
        const top = Math.floor(monitor.height * this._settings.get_int('top-offset') / 100);

        this._panel.set_width(width);
        this._panel.set_position(
            monitor.x + Math.floor((monitor.width - width) / 2),
            monitor.y + top);

        // Keep the panel on screen. St CSS lengths are logical pixels, so
        // divide the physical space by the scale factor.
        const maxHeight = Math.max(100, (monitor.height - top) / scaleFactor - 140);
        this._scrollView.style = `max-height: ${Math.floor(maxHeight)}px;`;
        this._previewPane.style = `max-height: ${Math.floor(maxHeight)}px;`;
    }

    _cancelQuery() {
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _onTextChanged() {
        this._cancelQuery();
        // Typing leaves the action list.
        this._actionsOf = null;
        this._confirm = null;
        const text = this._entry.text.trim();
        this._scopeLabel.text = (text && this._registry.scopeFor(text)) || _('All results');

        if (!text) {
            this._clearResults();
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._resultsByProvider.clear();
        this._userMoved = false;
        // debug-timing: provider ids, counts and times only, never the query.
        const timing = this._settings.get_boolean('debug-timing')
            ? {start: GLib.get_monotonic_time(), renders: 0, renderUs: 0} : null;
        const elapsed = () => ((GLib.get_monotonic_time() - timing.start) / 1000).toFixed(1);
        this._timing = timing;

        this._registry.query(text, cancellable, (provider, results) => {
            this._resultsByProvider.set(provider.id, results);
            if (timing)
                console.log(`lume: timing ${provider.id} +${elapsed()} ms, ${results.length} rows`);
            this._scheduleRender();
        }).then(() => {
            // Every provider has answered: show "No results" if none did.
            if (cancellable.is_cancelled())
                return;
            if (this._renderLater)
                this._render();
            this._statusLabel.visible = this._rows.length === 0;
            this._separator.show();
            this._announce(this._rows.length === 0 ? _('No results')
                : ngettext('%d result', '%d results', this._rows.length).format(this._rows.length));
            if (timing) {
                console.log(`lume: timing settled +${elapsed()} ms, ${timing.renders} renders, ` +
                    `${(timing.renderUs / 1000).toFixed(1)} ms rendering`);
            }
        });
    }

    /** Have a screen reader speak `text` without moving focus (ATK 2.46+). */
    _announce(text) {
        const accessible = this._resultsBox.get_accessible();
        if (accessible && GObject.signal_lookup('announcement', Atk.Object.$gtype))
            accessible.emit('announcement', text);
    }

    _clearResults() {
        this._resultsByProvider.clear();
        this._render();
        this._statusLabel.hide();
        this._separator.hide();
    }

    /**
     * Render once before the next frame, however many providers answer
     * until then (most answer within the same main-loop turn).
     */
    _scheduleRender() {
        this._renderLater ||= global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._renderLater = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelRender() {
        if (this._renderLater)
            global.compositor.get_laters().remove(this._renderLater);
        this._renderLater = 0;
    }

    _render() {
        this._cancelRender();
        const started = this._timing ? GLib.get_monotonic_time() : 0;
        // Keep the selection only if the user put it there; otherwise a
        // late, better result (files, weather) must take the top spot, or
        // Enter would open whatever answered first (e.g. web search).
        const previous = this._userMoved ? this._rows[this._selected]?.key : undefined;
        const rowHadFocus = this._rows.some(r => r.actor.has_key_focus());

        const items = this._actionsOf ? this._actionItems(this._actionsOf) : this._grouped(this._mergedResults());

        this._resultsBox.destroy_all_children();
        this._rows = [];
        let header = null;
        for (const item of items) {
            if (item.header) {
                header = this._createHeader(item.header);
                this._resultsBox.add_child(header);
                continue;
            }
            const actor = this._createRow(item.result, item.type, this._rows.length, header);
            // `header` only on a group's first row: scrolling up to it shows the header.
            this._rows.push({key: item.key, result: item.result, actor, header});
            this._resultsBox.add_child(actor);
            header = null;
        }

        const hasRows = this._rows.length > 0;
        this._scrollView.visible = hasRows;
        if (hasRows) {
            this._statusLabel.hide();
            this._separator.show();
        }

        const keep = this._rows.findIndex(r => r.key === previous);
        this._selected = -1;
        this._select(keep >= 0 ? keep : 0, false);
        if (keep < 0)
            this._scrollAdjustment().value = 0;
        // The focused row was just destroyed; focus its replacement.
        if (rowHadFocus)
            (this._rows[this._selected]?.actor ?? this._entry).grab_key_focus();
        if (this._timing) {
            this._timing.renders++;
            this._timing.renderUs += GLib.get_monotonic_time() - started;
        }
    }

    _mergedResults() {
        const merged = [];
        for (const [providerId, results] of this._resultsByProvider) {
            for (const result of results) {
                merged.push({
                    key: `${providerId}:${result.id}`,
                    result,
                    type: result.type ?? this._labels.get(providerId),
                    group: result.group ?? this._names.get(providerId),
                });
            }
        }
        // Array.prototype.sort is stable, so equal scores keep provider order.
        merged.sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0));
        if (merged.filter(r => !r.result.fallback).length >= FALLBACK_HIDDEN_AT)
            merged.splice(0, merged.length, ...merged.filter(r => !r.result.fallback));
        merged.length = Math.min(merged.length, this._settings.get_int('max-results'));
        return merged;
    }

    /**
     * The best row under "Top Hit", then the others grouped by provider
     * (or `result.group`), groups ordered by their best row. Flat when
     * all rows are of one kind or a prefix scope is active.
     */
    _grouped(merged) {
        const text = this._entry.text.trim();
        if (new Set(merged.map(item => item.group)).size < 2 || (text && this._registry.scopeFor(text)))
            return merged;

        const groups = new Map();
        for (const item of merged.slice(1)) {
            if (!groups.has(item.group))
                groups.set(item.group, []);
            // The header names the group; keep a type label only when it
            // says more ("Folder" among files).
            groups.get(item.group).push({...item, type: item.result.type !== item.group ? item.result.type : undefined});
        }
        return [
            {header: _('Top Hit')}, merged[0],
            ...[...groups].flatMap(([group, items]) => [{header: group}, ...items]),
        ];
    }

    _createHeader(text) {
        return new St.Label({
            style_class: 'popup-inactive-menu-item lume-group-header',
            text,
            accessible_role: Atk.Role.HEADING,
        });
    }

    /** Rows for the actions of `result`: its own, or Open and Copy; and Paste. */
    _actionItems(result) {
        if (this._confirm) {
            return [{
                key: 'action:confirm',
                result: {
                    id: 'confirm',
                    title: this._confirm.text,
                    subtitle: _('Press Enter to confirm, Esc to go back'),
                    icon: 'dialog-warning-symbolic',
                    activate: this._confirm.run,
                },
            }];
        }
        const target = result.paste !== undefined ? pasteTargetName() : null;
        const actions = [
            ...result.actions?.length ? result.actions : [
                ...result.activate !== result.copy ? [{label: _('Open'), icon: 'document-open-symbolic', run: result.activate}] : [],
                ...result.copy ? [{label: _('Copy'), icon: 'edit-copy-symbolic', run: result.copy}] : [],
            ],
            // TRANSLATORS: %s is an app, e.g. "Firefox"
            ...target ? [{label: _('Paste into %s').format(target), icon: 'edit-paste-symbolic', run: () => paste(result.paste)}] : [],
        ];
        return actions.map((action, index) => ({
            key: `action:${index}:${action.label}`,
            result: {
                id: action.label,
                title: action.label,
                subtitle: index === 0 ? result.title : undefined,
                icon: action.icon ?? 'system-run-symbolic',
                activate: action.run,
                confirm: action.confirm,
            },
        }));
    }

    /**
     * Fill the preview pane for the selected row: the provider's preview
     * (async) or the row's icon, title and subtitle.
     */
    async _updatePreview() {
        const token = ++this._previewToken;
        const result = this._actionsOf ? null : this._rows[this._selected]?.result;
        const show = this._settings.get_boolean('show-preview') && Boolean(result);
        this._previewPane.visible = show;
        if (!show) {
            this._unlinkPreview();
            return;
        }

        let preview = null;
        try {
            preview = await result.preview?.();
        } catch (e) {
            console.debug(`lume: preview failed: ${e.message}`);
        }
        // The selection moved on while the preview loaded.
        if (token !== this._previewToken)
            return;
        this._fillPreview(result, preview ?? {});
    }

    /** Drop the selected row's link to the preview text (see _fillPreview). */
    _unlinkPreview() {
        const link = this._previewLink;
        this._previewLink = null;
        // A row destroyed by a render took its relations with it.
        if (!link || !this._rows.some(r => r.actor === link.row))
            return;
        for (const target of link.targets) {
            link.row.get_accessible().remove_relationship(
                Atk.RelationType.DESCRIBED_BY, target.get_accessible());
        }
    }

    _fillPreview(result, {gicon, icon, text, rows = []}) {
        this._unlinkPreview();
        this._previewPane.destroy_all_children();
        // Read to a screen reader as part of the selected row's description.
        const described = [];

        const image = gicon ?? icon ?? result.icon;
        if (result.glyph) {
            this._previewPane.add_child(new St.Label({style_class: 'lume-preview-glyph', text: result.glyph, x_align: Clutter.ActorAlign.CENTER}));
        } else if (image) {
            const actor = new St.Icon({icon_size: PREVIEW_ICON_SIZE, x_align: Clutter.ActorAlign.CENTER});
            if (typeof image === 'string')
                actor.icon_name = image;
            else
                actor.gicon = image;
            this._previewPane.add_child(actor);
        }

        const wrapped = (style, value) => {
            const label = new St.Label({style_class: style, text: value});
            label.clutter_text.line_wrap = true;
            label.clutter_text.ellipsize = 0;
            return label;
        };
        this._previewPane.add_child(wrapped('lume-preview-title', result.title));
        if (result.subtitle)
            this._previewPane.add_child(wrapped('popup-inactive-menu-item lume-preview-subtitle', result.subtitle));

        for (const [label, value] of rows) {
            const line = new St.BoxLayout({style_class: 'lume-preview-row'});
            const key = new St.Label({style_class: 'popup-inactive-menu-item lume-preview-label', text: label});
            const valueLabel = wrapped('lume-preview-value', String(value));
            line.add_child(key);
            line.add_child(valueLabel);
            this._previewPane.add_child(line);
            described.push(key, valueLabel);
        }
        if (text) {
            const lines = text.slice(0, PREVIEW_TEXT_LENGTH).split('\n');
            const cut = lines.length > PREVIEW_TEXT_LINES || text.length > PREVIEW_TEXT_LENGTH;
            const shown = `${lines.slice(0, PREVIEW_TEXT_LINES).join('\n')}${cut ? '…' : ''}`;
            const textLabel = wrapped('lume-preview-text', shown);
            this._previewPane.add_child(textLabel);
            described.push(textLabel);
        }

        // The pane can't take focus, so its text is reached through the row.
        const row = this._rows[this._selected]?.actor;
        if (row && described.length > 0) {
            for (const target of described)
                row.get_accessible().add_relationship(Atk.RelationType.DESCRIBED_BY, target.get_accessible());
            this._previewLink = {row, targets: described};
        }
    }

    /**
     * Right on a folder row lists it; Left at a trailing "/" goes up. With
     * the entry focused, only when its cursor is at the end, so editing
     * the text still works.
     *
     * @param {number} symbol
     * @param {Clutter.ModifierType} state
     * @returns {boolean} whether the key was used
     */
    _onFolderKey(symbol, state) {
        const right = symbol === Clutter.KEY_Right || symbol === Clutter.KEY_KP_Right;
        const left = symbol === Clutter.KEY_Left || symbol === Clutter.KEY_KP_Left;
        // Shift/Ctrl+arrows select and jump words as usual.
        const modifiers = state & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK);
        if ((!right && !left) || modifiers || this._actionsOf)
            return false;
        // Act on the rows for the current text, never on the last frame's.
        if (this._renderLater)
            this._render();
        const text = this._entry.clutter_text;
        const inEntry = text.has_key_focus();
        const atEnd = !text.get_selection() && [-1, text.text.length].includes(text.get_cursor_position());
        if (inEntry && !atEnd)
            return false;

        const complete = this._rows[this._selected]?.result.complete;
        if (right && complete) {
            this._setEntryText(complete);
            return true;
        }
        // Only while browsing: folder rows, or an empty folder.
        const parent = /^(.*\/)[^/]+\/$/.exec(this._entry.text)?.[1];
        if (left && parent && (this._rows.length === 0 || this._rows.some(r => r.result.complete))) {
            this._setEntryText(parent);
            return true;
        }
        return false;
    }

    _setEntryText(text) {
        this._entry.text = text;
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_cursor_position(-1);
        this._entry.clutter_text.set_selection_bound(-1);
    }

    _togglePreview() {
        this._settings.set_boolean('show-preview', !this._settings.get_boolean('show-preview'));
    }

    _toggleActions() {
        this._confirm = null;
        if (this._actionsOf) {
            this._actionsOf = null;
        } else {
            const result = this._rows[this._selected]?.result;
            // A row that only informs has nothing to do.
            if (!result || (result.activate === noAction && !result.actions?.length))
                return;
            this._actionsOf = result;
        }
        const text = this._entry.text.trim();
        this._scopeLabel.text = this._actionsOf
            ? _('Actions')
            : (text && this._registry.scopeFor(text)) || _('All results');
        this._userMoved = false;
        this._render();
    }

    _createRow(result, type, index, header = null) {
        // Rows take key focus during keyboard navigation, so screen readers
        // announce them, as in the overview's search results.
        const row = new St.BoxLayout({
            style_class: 'popup-menu-item lume-result',
            reactive: true,
            can_focus: true,
            x_expand: true,
            accessible_role: Atk.Role.LIST_ITEM,
        });

        // Remote search providers hand over a ready-made icon actor.
        const iconActor = result.createIcon?.(ICON_SIZE);
        // The colour comes from a parsed "#rrggbb" only; check again before
        // it reaches CSS.
        if (iconActor) {
            iconActor.y_align = Clutter.ActorAlign.CENTER;
            row.add_child(iconActor);
        } else if (result.glyph) {
            row.add_child(new St.Label({
                style_class: 'lume-glyph',
                text: result.glyph,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else if (/^#[0-9a-f]{6}$/i.test(result.swatch ?? '')) {
            row.add_child(new St.Widget({
                style_class: 'lume-swatch',
                style: `background-color: ${result.swatch};`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else if (result.icon) {
            const icon = new St.Icon({
                style_class: 'lume-result-icon',
                icon_size: ICON_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (typeof result.icon === 'string')
                icon.icon_name = result.icon;
            else
                icon.gicon = result.icon;
            row.add_child(icon);
        }

        const text = new St.BoxLayout({
            style_class: 'lume-result-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        setVertical(text);
        const title = new St.Label({
            style_class: 'lume-result-title',
            text: result.title,
        });
        text.add_child(title);
        row.label_actor = title;
        if (result.subtitle) {
            const subtitle = new St.Label({
                // Non-reactive labels are :insensitive, which this theme
                // class dims with the theme's own (HC-aware) color.
                style_class: 'popup-inactive-menu-item lume-result-subtitle',
                text: result.subtitle,
            });
            text.add_child(subtitle);
            row.get_accessible().add_relationship(
                Atk.RelationType.DESCRIBED_BY, subtitle.get_accessible());
        }
        row.add_child(text);

        // The first row of a group also announces the group's name.
        if (header) {
            row.get_accessible().add_relationship(
                Atk.RelationType.DESCRIBED_BY, header.get_accessible());
        }

        if (type) {
            const typeLabel = new St.Label({
                style_class: 'popup-inactive-menu-item lume-result-type',
                text: type,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(typeLabel);
            row.get_accessible().add_relationship(
                Atk.RelationType.DESCRIBED_BY, typeLabel.get_accessible());
        }

        // Selection follows the pointer only when it actually moves, so a
        // pointer resting where the panel opens does not steal it.
        row.connect('motion-event', () => {
            this._userMoved = true;
            this._select(index, false);
            // Keep key focus on the selected row once it is in the list, so
            // Enter opens what the screen reader announced.
            if (!this._entry.clutter_text.has_key_focus())
                row.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        row.connect('button-release-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._activate(index);
            return Clutter.EVENT_STOP;
        });
        return row;
    }

    _select(index, scroll = true) {
        if (this._rows.length === 0) {
            this._selected = -1;
            this._updatePreview();
            return;
        }
        index = Math.max(0, Math.min(index, this._rows.length - 1));
        if (index === this._selected)
            return;

        // GNOME 45-46 themes highlight menu items on :hover, 47+ on
        // :selected. Set both; track_hover stays off so St never clears them.
        const old = this._rows[this._selected]?.actor;
        old?.remove_style_pseudo_class('selected');
        old?.remove_style_pseudo_class('hover');
        old?.remove_accessible_state(Atk.StateType.SELECTED);

        this._selected = index;
        const actor = this._rows[index].actor;
        actor.add_style_pseudo_class('selected');
        actor.add_style_pseudo_class('hover');
        actor.add_accessible_state(Atk.StateType.SELECTED);
        this._updatePreview();

        if (scroll)
            this._ensureVisible(actor, this._rows[index].header);
    }

    /**
     * Keyboard navigation: move the selection and key focus together.
     * Moving above the first row returns focus to the entry.
     *
     * @param {number} index
     */
    _navigate(index) {
        if (index < 0) {
            this._entry.grab_key_focus();
            return;
        }
        this._select(index);
        this._rows[this._selected]?.actor.grab_key_focus();
    }

    _scrollAdjustment() {
        // 46+ has vadjustment; 45 only has vscroll.adjustment.
        return this._scrollView.vadjustment ?? this._scrollView.vscroll.adjustment;
    }

    _ensureVisible(actor, header = null) {
        const adjustment = this._scrollAdjustment();
        const box = actor.get_allocation_box();
        // Scrolling up to a group's first row also shows its header.
        const top = (header ?? actor).get_allocation_box().y1;
        const [value, , , , , pageSize] = adjustment.get_values();

        if (top < value)
            adjustment.value = top;
        else if (box.y2 > value + pageSize)
            adjustment.value = box.y2 - pageSize;
    }

    /**
     * @param {number} index
     * @param {Clutter.ModifierType} [modifiers] - Ctrl or Alt pick the
     *   row's second action, if it has one
     */
    _activate(index, modifiers = 0) {
        // Rows waiting for the next frame belong to the current text: act on them.
        if (this._renderLater) {
            this._render();
            index = this._selected;
        }
        const result = this._rows[index]?.result;
        if (!result || result.activate === noAction)
            return;
        // Holding Enter must not confirm as well: ignore its key repeat.
        if (this._confirm &&
            (Clutter.get_current_event()?.get_flags() ?? 0) & (Clutter.EventFlags.FLAG_REPEATED ?? 0))
            return;
        // A dangerous action first shows a confirm row; no modifier skips it.
        if (result.confirm) {
            this._confirm = {text: result.confirm, run: result.activate};
            this._userMoved = false;
            this._render();
            return;
        }
        let action = result.activate;
        if (modifiers & Clutter.ModifierType.CONTROL_MASK)
            action = result.ctrlActivate ?? action;
        else if (modifiers & Clutter.ModifierType.MOD1_MASK)
            action = result.altActivate ?? action;
        this._run(this._rows[index].key, action);
    }

    _run(key, action) {
        // Close first so the grab is released and focus can move to
        // whatever the result opens.
        this.close();
        try {
            action();
        } catch (e) {
            // Only the provider: a row's id can hold clipboard text or a file name.
            console.error(`lume: activating a "${key.split(':')[0]}" row failed: ${e}`);
        }
    }

    _onKeyPress(event) {
        // Keys act on the rows for the current text, never on the last frame's.
        if (this._renderLater)
            this._render();
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (NAVIGATION_KEYS.has(symbol))
            this._userMoved = true;
        // Up/Shift+Tab from the first row return to the entry; from the
        // entry they stop at the first row.
        const onRow = !this._entry.clutter_text.has_key_focus();
        const next = this._selected + 1;
        const previous = onRow ? this._selected - 1 : Math.max(0, this._selected - 1);

        if (ENTER_KEYS.has(symbol)) {
            this._activate(this._selected, state);
            return Clutter.EVENT_STOP;
        }

        if ((symbol === Clutter.KEY_k || symbol === Clutter.KEY_K) &&
            (state & Clutter.ModifierType.CONTROL_MASK)) {
            this._toggleActions();
            return Clutter.EVENT_STOP;
        }
        if ((symbol === Clutter.KEY_p || symbol === Clutter.KEY_P) &&
            (state & Clutter.ModifierType.CONTROL_MASK)) {
            this._togglePreview();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_comma && (state & Clutter.ModifierType.CONTROL_MASK)) {
            this._showPreferences();
            return Clutter.EVENT_STOP;
        }

        // Ctrl+C copies the selected row if it can be copied, unless text
        // is selected in the entry.
        const row = this._rows[this._selected];
        if ((symbol === Clutter.KEY_c || symbol === Clutter.KEY_C) &&
            (state & Clutter.ModifierType.CONTROL_MASK) && row?.result.copy &&
            (onRow || !this._entry.clutter_text.get_selection())) {
            this._run(row.key, row.result.copy);
            return Clutter.EVENT_STOP;
        }

        switch (symbol) {
        case Clutter.KEY_Escape:
            // Esc leaves the confirm row, then the action list.
            if (this._confirm) {
                this._confirm = null;
                this._render();
            } else if (this._actionsOf) {
                this._toggleActions();
            } else {
                this.close();
            }
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
        case Clutter.KEY_KP_Down:
            this._navigate(next);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
        case Clutter.KEY_KP_Up:
            this._navigate(previous);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._navigate(shift ? previous : next);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_ISO_Left_Tab:
            this._navigate(previous);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._navigate(this._rows.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._navigate(0);
            return Clutter.EVENT_STOP;
        }

        // Typing while a row has focus continues at the end of the entry.
        // Forwarding the event with clutter_text.event() inserts nothing on
        // GNOME 51, so apply the key here.
        const unicode = Clutter.keysym_to_unicode(symbol);
        const modifiers = state & (Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK);
        if (onRow && !modifiers && (unicode !== 0 || symbol === Clutter.KEY_BackSpace)) {
            this._entry.grab_key_focus();
            const text = this._entry.clutter_text;
            text.set_cursor_position(-1);
            if (unicode !== 0)
                text.insert_unichar(String.fromCodePoint(unicode));
            else
                this._entry.text = [...this._entry.text].slice(0, -1).join('');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});
