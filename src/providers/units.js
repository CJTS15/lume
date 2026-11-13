// SPDX-License-Identifier: GPL-3.0-or-later
//
// Unit conversion: "10 km to mi". Enter copies the converted number.

import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatResult} from '../lib/calculator.js';
import {Provider} from '../lib/provider.js';
import {convert} from '../lib/units.js';

export class UnitsProvider extends Provider {
    constructor() {
        super({id: 'units', name: _('Unit Conversion'), label: _('Conversion')});
    }

    query(text) {
        const result = convert(text);
        if (!result)
            return [];

        const value = formatResult(result.value);
        const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        return [{
            id: 'conversion',
            title: `= ${value} ${result.to}`,
            // TRANSLATORS: e.g. "10 km in mi · Enter to copy"
            subtitle: _('%s %s in %s · Enter to copy').format(
                formatResult(result.amount), result.from, result.to),
            icon: 'accessories-calculator-symbolic',
            score: 0.95,
            activate: copy,
            copy,
        }];
    }
}
