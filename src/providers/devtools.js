// SPDX-License-Identifier: GPL-3.0-or-later
//
// Developer quick-tools: "uuid", "base64 encode|decode <text>" (or "b64"),
// "sha256 <text>" (also md5, sha1, sha512), colours ("#ff8800",
// "rgb(255, 136, 0)") and Unix time ("unix", "1731456000"). Enter and
// Ctrl+C copy the result.

import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CHECKSUM_TYPES, base64Decode, base64Encode, checksum, parseColor, timestamp, uuid} from '../lib/devtools.js';
import {Provider} from '../lib/provider.js';

const TITLE_LENGTH = 80;
const SCORE = 0.95;

const shorten = text => (text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text);

export class DevToolsProvider extends Provider {
    constructor() {
        super({id: 'devtools', name: _('Developer Tools'), label: _('Tool')});
    }

    query(text) {
        const [, word = '', rest = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? [];
        const command = word.toLowerCase();

        if (command === 'uuid' && !rest)
            return [this._row('uuid', _('UUID'), uuid(), _('Random UUID · Enter to copy'), 'dialog-password-symbolic')];

        if (command === 'base64' || command === 'b64')
            return this._base64(rest);

        if (CHECKSUM_TYPES.includes(command) && rest) {
            return [this._row(command, _('Hash'), checksum(command, rest),
                // TRANSLATORS: e.g. "SHA256 of “hello” · Enter to copy"
                _('%s of “%s” · Enter to copy').format(command.toUpperCase(), shorten(rest)),
                'security-high-symbolic')];
        }

        const color = parseColor(text);
        if (color) {
            const other = text.trim().startsWith('#') ? color.rgb : color.hex;
            const row = this._row('color', _('Color'), other,
                _('%s · Enter to copy').format(other === color.hex ? color.rgb : color.hex));
            row.swatch = color.hex;
            return [row];
        }

        const time = timestamp(text, GLib.get_real_time() / 1e6);
        if (time) {
            const isNow = /^\D/.test(text.trim());
            const utc = timestamp(text, GLib.get_real_time() / 1e6, 'UTC').iso;
            return [isNow
                ? this._row('time', _('Time'), String(time.seconds),
                    _('Unix time now · %s · Enter to copy').format(time.iso), 'preferences-system-time-symbolic')
                : this._row('time', _('Time'), time.iso,
                    _('%s · Enter to copy').format(utc), 'preferences-system-time-symbolic')];
        }
        return [];
    }

    _base64(rest) {
        const [, verb = '', input = ''] = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest) ?? [];
        const action = verb.toLowerCase();
        if (action === 'decode' && input) {
            const decoded = base64Decode(input);
            return decoded === null
                ? [this._row('base64', _('Base64'), _('Not valid Base64 text'), shorten(input), 'dialog-warning-symbolic', false)]
                : [this._row('base64', _('Base64'), decoded, _('Decoded · Enter to copy'))];
        }
        // "base64 hello" encodes too.
        const plain = action === 'encode' ? input : rest;
        if (!plain)
            return [];
        return [this._row('base64', _('Base64'), base64Encode(plain), _('Encoded · Enter to copy'))];
    }

    /**
     * @param {string} id
     * @param {string} type - row type label
     * @param {string} value - shown (shortened) and copied in full
     * @param {string} subtitle
     * @param {string} [icon]
     * @param {boolean} [copyable]
     */
    _row(id, type, value, subtitle, icon = 'accessories-text-editor-symbolic', copyable = true) {
        const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        return {
            id,
            type,
            title: shorten(value.replace(/\s+/g, ' ')),
            subtitle,
            icon,
            score: SCORE,
            activate: copyable ? copy : () => {},
            copy: copyable ? copy : undefined,
        };
    }
}
