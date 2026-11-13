// SPDX-License-Identifier: GPL-3.0-or-later
//
// Media players (MPRIS2): one row per playing or paused player. Enter
// toggles play/pause, Ctrl+Enter skips to the next track, Alt+Enter goes
// back. Shown for media words ("music", "pause", ...) or a player or track
// name. A small client of its own: the Shell's ui/mpris.js changed shape
// across GNOME 45-51.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fuzzyScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const KEYWORDS = new Set(['media', 'music', 'play', 'pause', 'next', 'previous', 'song', 'track']);

export class MediaProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'media', name: _('Media'), label: _('Media')});
        this._settings = settings;
        /** @type {Map<string, {proxy: Gio.DBusProxy, identity: string}>} */
        this._players = new Map();
        this._cancellable = new Gio.Cancellable();
        this._bus = Gio.DBus.session;

        this._ownerChangedId = this._bus.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                const [name, , newOwner] = params.deep_unpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                this._players.delete(name);
                if (newOwner)
                    this._addPlayer(name);
            });

        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deep_unpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`lume: could not list media players: ${e.message}`);
                }
            });
    }

    async _addPlayer(name) {
        try {
            const proxy = await new Promise((resolve, reject) => Gio.DBusProxy.new(this._bus,
                Gio.DBusProxyFlags.NONE, null, name, MPRIS_PATH, PLAYER_INTERFACE,
                this._cancellable, (_o, res) => {
                    try {
                        resolve(Gio.DBusProxy.new_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }));
            if (this._cancellable.is_cancelled())
                return;
            this._players.set(name, {proxy, identity: await this._identity(name)});
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`lume: ignoring media player ${name}: ${e.message}`);
        }
    }

    _identity(name) {
        const fallback = name.slice(MPRIS_PREFIX.length).split('.')[0];
        return new Promise(resolve => this._bus.call(name, MPRIS_PATH,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'Identity']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 1000, this._cancellable,
            (bus, res) => {
                try {
                    resolve(bus.call_finish(res).deep_unpack()[0].deep_unpack() || fallback);
                } catch {
                    resolve(fallback);
                }
            }));
    }

    query(text) {
        const keyword = KEYWORDS.has(text.toLowerCase().split(/\s+/)[0]);
        const level = this._settings.get_string('fuzzy-matching');
        const results = [];

        for (const [name, {proxy, identity}] of this._players) {
            // Gone: it quit while its proxy was being set up.
            if (!proxy.get_name_owner())
                continue;
            const status = proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status !== 'Playing' && status !== 'Paused')
                continue;
            const metadata = proxy.get_cached_property('Metadata')?.deep_unpack() ?? {};
            const title = metadata['xesam:title']?.unpack() ?? '';
            const artists = metadata['xesam:artist']?.deep_unpack() ?? [];
            const artist = Array.isArray(artists) ? artists.join(', ') : String(artists);

            const match = keyword ? 1 : Math.max(
                fuzzyScore(identity, text, level),
                fuzzyScore(title, text, level),
                fuzzyScore(artist, text, level));
            if (match === 0)
                continue;

            const playing = status === 'Playing';
            const call = method => () => proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null,
                (p, res) => {
                    try {
                        p.call_finish(res);
                    } catch (e) {
                        console.error(`lume: ${identity} ${method} failed: ${e.message}`);
                    }
                });
            results.push({
                id: name,
                title: [title, artist].filter(s => s).join(' — ') || identity,
                // TRANSLATORS: e.g. "Playing · Spotify · Ctrl+Enter next, Alt+Enter previous"
                subtitle: _('%s · %s · Ctrl+Enter next, Alt+Enter previous').format(
                    playing ? _('Playing') : _('Paused'), identity),
                icon: playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
                score: keyword ? 0.9 : 0.5 + 0.35 * Math.min(match, 0.9),
                activate: call('PlayPause'),
                ctrlActivate: call('Next'),
                altActivate: call('Previous'),
            });
        }
        return results;
    }

    scope(text) {
        return KEYWORDS.has(text.toLowerCase().split(/\s+/)[0]) && this._players.size > 0
            ? _('Media') : null;
    }

    destroy() {
        this._cancellable.cancel();
        this._bus.signal_unsubscribe(this._ownerChangedId);
        this._players.clear();
    }
}
