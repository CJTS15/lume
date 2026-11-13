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
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ICON_SIZE = 24;
const SCREEN_MARGIN = 16;
// Fallback rows (web search) are hidden once this many other rows match.
const FALLBACK_HIDDEN_AT = 3;
// The preview pane (Ctrl+P) adds this much width, in logical pixels.
const PREVIEW_WIDTH = 340;
const PREVIEW_ICON_SIZE = 96;
const PREVIEW_TEXT_LENGTH = 2000;

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
     */
    _init(settings, registry) {
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
        this._grab = null;
        this._cancellable = null;
        this._resultsByProvider = new Map();
        this._rows = [];
        this._selected = -1;
        // Whether the user moved the selection since the query changed.
        this._userMoved = false;
        // The result whose actions (Ctrl+K) replace the list, or null.
        this._actionsOf = null;

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
        // St.ScrollView is an St.Bin on 45 and has its own `child` on 46+;
        // `child` works on both (add_actor() was removed in 46).
        this._scrollView.child = this._resultsBox;

        // Results on the left, the preview pane (Ctrl+P) on the right.
        const body = new St.BoxLayout({style_class: 'lume-body', x_expand: true});
        this._scrollView.x_expand = true;
        body.add_child(this._scrollView);
        this._previewPane = new St.BoxLayout({
            style_class: 'lume-preview',
            width: PREVIEW_WIDTH,
            visible: false,
        });
        setVertical(this._previewPane);
        body.add_child(this._previewPane);
        this._panel.add_child(body);
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
        hint('↑↓', _('Navigate'));
        hint('↵', _('Open'));
        hint(_('Esc'), _('Close'));
        return footer;
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
        this._entry.text = '';
        this._clearResults();
    }

    _onDestroy() {
        this._settings.disconnect(this._previewChangedId);
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
    }

    _cancelQuery() {
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _onTextChanged() {
        this._cancelQuery();
        // Typing leaves the action list.
        this._actionsOf = null;
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

        this._registry.query(text, cancellable, (provider, results) => {
            this._resultsByProvider.set(provider.id, results);
            this._render();
        }).then(() => {
            // Every provider has answered: show "No results" if none did.
            if (cancellable.is_cancelled())
                return;
            this._statusLabel.visible = this._rows.length === 0;
            this._separator.show();
        });
    }

    _clearResults() {
        this._resultsByProvider.clear();
        this._render();
        this._statusLabel.hide();
        this._separator.hide();
    }

    _render() {
        // Keep the selection only if the user put it there; otherwise a
        // late, better result (files, weather) must take the top spot, or
        // Enter would open whatever answered first (e.g. web search).
        const previous = this._userMoved ? this._rows[this._selected]?.key : undefined;
        const rowHadFocus = this._rows.some(r => r.actor.has_key_focus());

        const merged = this._actionsOf ? this._actionItems(this._actionsOf) : this._mergedResults();

        this._resultsBox.destroy_all_children();
        this._rows = merged.map(({key, result, type}, index) => ({
            key,
            result,
            actor: this._createRow(result, type, index),
        }));
        for (const row of this._rows)
            this._resultsBox.add_child(row.actor);

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
    }

    _mergedResults() {
        const merged = [];
        for (const [providerId, results] of this._resultsByProvider) {
            for (const result of results)
                merged.push({key: `${providerId}:${result.id}`, result, type: result.type ?? this._labels.get(providerId)});
        }
        // Array.prototype.sort is stable, so equal scores keep provider order.
        merged.sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0));
        if (merged.filter(r => !r.result.fallback).length >= FALLBACK_HIDDEN_AT)
            merged.splice(0, merged.length, ...merged.filter(r => !r.result.fallback));
        merged.length = Math.min(merged.length, this._settings.get_int('max-results'));
        return merged;
    }

    /** Rows for the actions of `result`: its own, or Open and Copy. */
    _actionItems(result) {
        const actions = result.actions?.length ? result.actions : [
            ...result.activate !== result.copy ? [{label: _('Open'), icon: 'document-open-symbolic', run: result.activate}] : [],
            ...result.copy ? [{label: _('Copy'), icon: 'edit-copy-symbolic', run: result.copy}] : [],
        ];
        return actions.map((action, index) => ({
            key: `action:${index}:${action.label}`,
            result: {
                id: action.label,
                title: action.label,
                subtitle: index === 0 ? result.title : undefined,
                icon: action.icon ?? 'system-run-symbolic',
                activate: action.run,
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
        if (!show)
            return;

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

    _fillPreview(result, {gicon, icon, text, rows = []}) {
        this._previewPane.destroy_all_children();

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
            line.add_child(new St.Label({style_class: 'popup-inactive-menu-item lume-preview-label', text: label}));
            line.add_child(wrapped('lume-preview-value', String(value)));
            this._previewPane.add_child(line);
        }
        if (text) {
            const shown = text.length > PREVIEW_TEXT_LENGTH ? `${text.slice(0, PREVIEW_TEXT_LENGTH)}…` : text;
            this._previewPane.add_child(wrapped('lume-preview-text', shown));
        }
    }

    _togglePreview() {
        this._settings.set_boolean('show-preview', !this._settings.get_boolean('show-preview'));
    }

    _toggleActions() {
        if (this._actionsOf) {
            this._actionsOf = null;
        } else {
            const result = this._rows[this._selected]?.result;
            if (!result)
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

    _createRow(result, type, index) {
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
            this._ensureVisible(actor);
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

    _ensureVisible(actor) {
        const adjustment = this._scrollAdjustment();
        const box = actor.get_allocation_box();
        const [value, , , , , pageSize] = adjustment.get_values();

        if (box.y1 < value)
            adjustment.value = box.y1;
        else if (box.y2 > value + pageSize)
            adjustment.value = box.y2 - pageSize;
    }

    /**
     * @param {number} index
     * @param {Clutter.ModifierType} [modifiers] - Ctrl or Alt pick the
     *   row's second action, if it has one
     */
    _activate(index, modifiers = 0) {
        const result = this._rows[index]?.result;
        if (!result)
            return;
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
            console.error(`lume: activating "${key}" failed: ${e}`);
        }
    }

    _onKeyPress(event) {
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
            // Esc leaves the action list first.
            if (this._actionsOf)
                this._toggleActions();
            else
                this.close();
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
