// SPDX-License-Identifier: GPL-3.0-or-later
//
// Power and session: lock, suspend, restart, power off, log out, switch
// user, screenshot. Uses the Shell's own system actions, the same ones the
// overview search offers: names and keywords are translated, unavailable
// actions are left out, and power off, restart and log out open GNOME's
// confirmation dialog instead of acting at once.

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 3;

export class SystemProvider extends Provider {
    constructor() {
        super({id: 'system', name: _('System'), label: _('System')});
        this._actions = SystemActions.getDefault();
    }

    query(text) {
        if (text.length < MIN_QUERY_LENGTH)
            return [];

        return this._actions.getMatchingActions(text.toLowerCase().split(/\s+/))
            .map(id => ({
                id,
                title: this._actions.getName(id),
                icon: this._actions.getIconName(id),
                // Below an exact app match, above Settings panels.
                score: 0.88,
                activate: () => this._actions.activateAction(id),
            }));
    }
}
