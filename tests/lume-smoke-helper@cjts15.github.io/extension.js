// SPDX-License-Identifier: GPL-3.0-or-later
//
// Test-only: turns on org.gnome.Shell.Eval in the throwaway Shell that
// tests/smoke.sh starts, so it can open Lume's search window. Never install
// it in a real session: Eval runs any code it is sent.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class LumeSmokeHelper extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
