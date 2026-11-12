// SPDX-License-Identifier: GPL-3.0-or-later
//
// The search window: a centered panel with an entry and a result list.
//
// Styling comes from the Shell theme's own classes (popup-menu-content,
// popup-menu-item, StEntry, ...), so the window follows light, dark and
// high-contrast styles and any custom Shell theme. stylesheet.css only sets
// layout, never colors.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ICON_SIZE = 24;
const SCREEN_MARGIN = 16;

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

        this._panel = new St.BoxLayout({
            style_class: 'popup-menu popup-menu-content lume-panel',
            reactive: true,
        });
        setVertical(this._panel);
        this.add_child(this._panel);

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
        this._panel.add_child(this._entry);

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

        this._resultsBox = new St.BoxLayout({style_class: 'lume-results'});
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
        this._panel.add_child(this._scrollView);

        this._statusLabel = new St.Label({
            style_class: 'popup-inactive-menu-item lume-status',
            text: _('No results'),
            visible: false,
        });
        this._panel.add_child(this._statusLabel);

        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());
        this._entry.clutter_text.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        // Enter: ClutterText emits 'activate' for Return/KP_Enter/ISO_Enter.
        // Matching it in key-press-event did not work on GNOME 51; the
        // Shell's own search entry uses this signal.
        this._entry.clutter_text.connect('activate', () => this._activate(this._selected));
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
        this._entry.text = '';
        this._clearResults();
    }

    _onDestroy() {
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
        const width = Math.min(
            this._settings.get_int('panel-width') * scaleFactor,
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
        const text = this._entry.text.trim();

        if (!text) {
            this._clearResults();
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._resultsByProvider.clear();

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
        const previous = this._rows[this._selected]?.key;

        const merged = [];
        for (const [providerId, results] of this._resultsByProvider) {
            for (const result of results)
                merged.push({key: `${providerId}:${result.id}`, result});
        }
        // Array.prototype.sort is stable, so equal scores keep provider order.
        merged.sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0));
        merged.length = Math.min(merged.length, this._settings.get_int('max-results'));

        this._resultsBox.destroy_all_children();
        this._rows = merged.map(({key, result}, index) => ({
            key,
            result,
            actor: this._createRow(result, index),
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
    }

    _createRow(result, index) {
        const row = new St.BoxLayout({
            style_class: 'popup-menu-item lume-result',
            reactive: true,
            x_expand: true,
        });

        if (result.icon) {
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
        text.add_child(new St.Label({
            style_class: 'lume-result-title',
            text: result.title,
        }));
        if (result.subtitle) {
            text.add_child(new St.Label({
                // Non-reactive labels are :insensitive, which this theme
                // class dims with the theme's own (HC-aware) color.
                style_class: 'popup-inactive-menu-item lume-result-subtitle',
                text: result.subtitle,
            }));
        }
        row.add_child(text);

        row.accessible_name = result.subtitle
            ? `${result.title}, ${result.subtitle}`
            : result.title;

        // Selection follows the pointer only when it actually moves, so a
        // pointer resting where the panel opens does not steal it.
        row.connect('motion-event', () => {
            this._select(index, false);
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

        this._selected = index;
        const actor = this._rows[index].actor;
        actor.add_style_pseudo_class('selected');
        actor.add_style_pseudo_class('hover');

        if (scroll)
            this._ensureVisible(actor);
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

    _activate(index) {
        const row = this._rows[index];
        if (!row)
            return;

        // Close first so the grab is released and focus can move to
        // whatever the result opens.
        this.close();
        try {
            row.result.activate();
        } catch (e) {
            console.error(`lume: activating "${row.key}" failed: ${e}`);
        }
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
        case Clutter.KEY_KP_Down:
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
        case Clutter.KEY_KP_Up:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._select(this._selected + (shift ? -1 : 1));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_ISO_Left_Tab:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._select(this._rows.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._select(0);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }
});
