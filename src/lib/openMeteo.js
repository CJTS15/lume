// SPDX-License-Identifier: GPL-3.0-or-later
//
// Open-Meteo requests (no API key), shared by weather and time zones.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

/**
 * GET `url` and parse its JSON. Errors name the server, since geocoding and
 * forecasts use different ones.
 *
 * @param {Soup.Session} session
 * @param {string} url
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<object>}
 */
export async function getJson(session, url, cancellable) {
    const message = Soup.Message.new('GET', url);
    const host = message.get_uri().get_host();
    let bytes;
    try {
        bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        throw new Error(`${host}: ${e.message}`, {cause: e});
    }
    if (message.get_status() !== Soup.Status.OK)
        // TRANSLATORS: %s is a server name, %d an HTTP status code
        throw new Error(_('%s answered with HTTP %d').format(host, message.get_status()));
    try {
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    } catch (e) {
        throw new Error(`${host}: ${e.message}`, {cause: e});
    }
}

/**
 * The best match for a city name, in the user's language.
 *
 * @param {Soup.Session} session
 * @param {string} city
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<{name: string, country: string, latitude: number,
 *   longitude: number, timezone: string|null}|null>} null if not found
 */
export async function geocode(session, city, cancellable) {
    const language = GLib.get_language_names()[0].split(/[_.@]/)[0];
    const data = await getJson(session, 'https://geocoding-api.open-meteo.com/v1/search' +
        `?name=${encodeURIComponent(city)}&count=1&format=json&language=${encodeURIComponent(language)}`,
    cancellable);

    const result = data.results?.[0];
    if (!result || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude))
        return null;
    return {
        name: String(result.name),
        country: result.country ? String(result.country) : '',
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: typeof result.timezone === 'string' ? result.timezone : null,
    };
}
