// SPDX-License-Identifier: GPL-3.0-or-later
//
// ECB reference exchange rates from the Frankfurter API (no key). Fetched
// at most every 12 hours, cached in $XDG_CACHE_HOME/lume/rates.json, and
// read from a stale cache when offline. Only this fixed request leaves the
// machine; the user's query never does.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
const MAX_AGE_SECONDS = 12 * 3600;

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export class Rates {
    constructor() {
        this._session = new Soup.Session({timeout: 10});
        this._file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'lume', 'rates.json']));
        /** @type {{date: string, fetched: number, rates: object}|null} */
        this._cache = null;
        this._pending = null;
    }

    /**
     * @param {boolean} offline - only use the cache, however old
     * @returns {Promise<{date: string, rates: Object<string, number>}>}
     *   rates per euro (EUR included); rejects only when there is neither
     *   a fresh answer nor any cache
     */
    get(offline) {
        this._pending ??= this._load(offline).finally(() => {
            this._pending = null;
        });
        return this._pending;
    }

    async _load(offline) {
        this._cache ??= await this._readCache();
        const now = GLib.get_real_time() / 1e6;
        if (this._cache && (offline || now - this._cache.fetched < MAX_AGE_SECONDS))
            return this._cache;
        if (offline)
            throw new Error('offline mode');

        try {
            const message = Soup.Message.new('GET', URL);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);
            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (typeof data.date !== 'string' || typeof data.rates !== 'object')
                throw new Error('unexpected answer');
            this._cache = {date: data.date, fetched: now, rates: {...data.rates, EUR: 1}};
            this._writeCache(this._cache);
        } catch (e) {
            if (!this._cache)
                throw e;
            console.debug(`lume: using cached exchange rates: ${e.message}`);
        }
        return this._cache;
    }

    async _readCache() {
        try {
            const [contents] = await this._file.load_contents_async(null);
            const cache = JSON.parse(new TextDecoder().decode(contents));
            return typeof cache.date === 'string' && typeof cache.rates === 'object' ? cache : null;
        } catch {
            return null;
        }
    }

    async _writeCache(cache) {
        try {
            GLib.mkdir_with_parents(this._file.get_parent().get_path(), 0o700);
            await this._file.replace_contents_bytes_async(
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(cache))),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.debug(`lume: could not cache exchange rates: ${e.message}`);
        }
    }

    destroy() {
        this._session.abort();
    }
}
