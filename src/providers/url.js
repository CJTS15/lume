// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web addresses: "https://example.com", "example.com", "localhost:3000",
// "192.168.1.1". Enter opens the address in the default browser.

import Gio from 'gi://Gio';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';
import {toUrl} from '../lib/url.js';

export class UrlProvider extends Provider {
    constructor() {
        super({id: 'url', name: _('Web Address'), label: _('Link')});
    }

    query(text) {
        const url = toUrl(text);
        if (!url)
            return [];

        return [{
            id: 'open',
            title: _('Open %s').format(text),
            subtitle: url,
            icon: 'web-browser-symbolic',
            // A typed address is a clear intent: above apps and files.
            score: 0.96,
            activate: () => {
                Gio.AppInfo.launch_default_for_uri_async(url,
                    global.create_app_launch_context(0, -1), null, (_o, res) => {
                        try {
                            Gio.AppInfo.launch_default_for_uri_finish(res);
                        } catch (e) {
                            console.error(`lume: could not open ${url}: ${e.message}`);
                        }
                    });
            },
            copy: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, url),
        }];
    }
}
