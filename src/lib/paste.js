// SPDX-License-Identifier: GPL-3.0-or-later
//
// Paste text into the window that had focus before Lume opened: put it on
// the clipboard, wait until that window has focus again, then press
// Ctrl+V (Ctrl+Shift+V in a terminal) with a virtual keyboard inside the
// compositor, as the Shell's on-screen keyboard does. No portal needed.
// ponytail: the key is sent as the "v" keyval, which a layout without a
// Latin "v" (Russian, Greek) cannot type; the text is then only copied.
// ponytail: the user's clipboard is replaced (and the text added to the
// clipboard history); restoring the old contents after the paste would race
// with the app reading it.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// How long to wait for the window to get focus back after Lume closes.
const FOCUS_TIMEOUT_MS = 500;

/** @type {Meta.Window|null} */
let target = null;
/** @type {Clutter.VirtualInputDevice|null} */
let keyboard = null;
/** @type {{focusId: number, timeoutId: number}|null} */
let waiting = null;

/** Call before Lume takes the keyboard: the window to paste into later. */
export function rememberWindow() {
    target = Main.overview.visible ? null : global.display.focus_window;
}

/** @returns {Meta.Window|null} the remembered window, if it still exists */
function targetWindow() {
    return target?.get_compositor_private() ? target : null;
}

/** @returns {string|null} the app (or title) Enter would paste into */
export function pasteTargetName() {
    const window = targetWindow();
    if (!window)
        return null;
    return Shell.WindowTracker.get_default().get_window_app(window)?.get_name() ?? window.get_title();
}

function isTerminal(window) {
    const categories = Shell.WindowTracker.get_default().get_window_app(window)
        ?.get_app_info()?.get_categories() ?? '';
    return categories.split(';').includes('TerminalEmulator');
}

/**
 * Copy `text`, then paste it into the remembered window; copy only without
 * one. Call after Lume has closed.
 *
 * @param {string} text
 */
export function paste(text) {
    cancelWait();
    const window = targetWindow();
    const terminal = window !== null && isTerminal(window);
    // A shell without bracketed paste would run a line that ends in a newline.
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD,
        terminal ? text.replace(/[\r\n]+$/, '') : text);
    if (!window)
        return;

    if (global.display.focus_window === window) {
        // Lume's grab has just ended; let the window get keyboard focus first.
        waiting = {focusId: 0, timeoutId: GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            waiting = null;
            pressPaste(terminal);
            return GLib.SOURCE_REMOVE;
        })};
        return;
    }
    const focusId = global.display.connect('notify::focus-window', () => {
        if (global.display.focus_window !== window)
            return;
        cancelWait();
        pressPaste(terminal);
    });
    const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FOCUS_TIMEOUT_MS, () => {
        waiting.timeoutId = 0;
        cancelWait();
        return GLib.SOURCE_REMOVE;
    });
    waiting = {focusId, timeoutId};
    window.activate(global.get_current_time());
}

function pressPaste(terminal) {
    // GNOME 48+ has stage.context; 45-47 only the default backend.
    keyboard ??= (global.stage.context?.get_backend() ?? Clutter.get_default_backend()).get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const keys = terminal
        ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
        : [Clutter.KEY_Control_L, Clutter.KEY_v];
    for (const key of keys)
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
    for (const key of keys.reverse())
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
}

function cancelWait() {
    if (!waiting)
        return;
    if (waiting.focusId)
        global.display.disconnect(waiting.focusId);
    if (waiting.timeoutId)
        GLib.source_remove(waiting.timeoutId);
    waiting = null;
}

/** Call on disable. */
export function destroy() {
    cancelWait();
    target = null;
    keyboard = null;
}
