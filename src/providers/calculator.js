// SPDX-License-Identifier: GPL-3.0-or-later
//
// Calculator: shows the result of an arithmetic query; Enter copies it.

import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {evaluate, formatResult} from '../lib/calculator.js';
import {Provider} from '../lib/provider.js';

export class CalculatorProvider extends Provider {
    constructor() {
        super({id: 'calculator', name: _('Calculator'), label: _('Calculator')});
    }

    query(text) {
        const value = evaluate(text);
        if (value === null)
            return [];

        const result = formatResult(value);
        const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, result);
        return [{
            id: 'result',
            title: `= ${result}`,
            subtitle: _('Copy to clipboard'),
            icon: 'accessories-calculator-symbolic',
            // Above apps: an expression is never meant as an app name.
            score: 0.95,
            activate: copy,
            copy,
        }];
    }
}
