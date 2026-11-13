// SPDX-License-Identifier: GPL-3.0-or-later
//
// Unit conversion: "10 km to mi", "100 eur to usd". Enter copies the
// converted number. Currencies use ECB rates (lib/rates.js).

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatResult} from '../lib/calculator.js';
import {Provider} from '../lib/provider.js';
import {Rates} from '../lib/rates.js';
import {convert, needsRates} from '../lib/units.js';

export class UnitsProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'units', name: _('Unit Conversion'), label: _('Conversion')});
        this._settings = settings;
        this._rates = new Rates();
    }

    query(text) {
        if (needsRates(text))
            return this._currency(text);

        const result = convert(text, {viewport: this._viewport()});
        if (!result)
            return [];
        // TRANSLATORS: e.g. "10 km in mi · Enter to copy"
        return [this._toResult(result, formatResult(result.value), _('%s %s in %s · Enter to copy').format(
            formatResult(result.amount), result.from, result.to))];
    }

    async _currency(text) {
        let rates;
        const offline = this._settings.get_boolean('offline-mode');
        try {
            rates = await this._rates.get(offline);
        } catch (e) {
            return [{
                id: 'conversion-error',
                title: _('Exchange rates unavailable'),
                subtitle: offline ? _('Offline mode is on and no rates are saved yet') : e.message,
                icon: 'network-offline-symbolic',
                score: 0.95,
                activate: () => {},
            }];
        }
        const result = convert(text, {rates: rates.rates});
        if (!result)
            return [];
        // Money: two decimals, or four significant digits below 1 (1 JPY).
        const value = formatResult(Math.abs(result.value) >= 1
            ? Math.round(result.value * 100) / 100
            : parseFloat(result.value.toPrecision(4)));
        // TRANSLATORS: %s is a date; the rates are the ECB's of that day
        return [this._toResult(result, value, _('ECB rates of %s · Enter to copy').format(rates.date))];
    }

    _toResult(result, value, subtitle) {
        const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        return {
            id: 'conversion',
            title: `= ${value} ${result.to}`,
            subtitle,
            icon: 'accessories-calculator-symbolic',
            score: 0.95,
            activate: copy,
            copy,
        };
    }

    destroy() {
        this._rates.destroy();
    }

    /** The monitor Lume opens on, in logical pixels (CSS px for vw/vh). */
    _viewport() {
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        if (!monitor)
            return undefined;
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        return {width: monitor.width / scaleFactor, height: monitor.height / scaleFactor};
    }
}
