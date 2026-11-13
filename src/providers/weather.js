// SPDX-License-Identifier: GPL-3.0-or-later
//
// Weather from Open-Meteo (no API key), behind the "weather" keyword:
// "weather" uses the default city from preferences, "weather <city>" any
// other. The city is sent to Open-Meteo only when the keyword is typed.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';

const KEYWORD = 'weather';
const MIN_CITY_LENGTH = 2;
// Wait for typing to pause before hitting the network.
const DEBOUNCE_MS = 400;
const FORECAST_TTL_SECONDS = 600;
const SCORE = 0.97;

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// WMO weather interpretation codes, as documented by Open-Meteo. N_ marks
// strings for translation; they are translated when used, because gettext
// only works once the extension is loaded.
const N_ = s => s;
const CONDITIONS = [
    {codes: [0], text: N_('Clear sky'), icon: 'weather-clear', night: 'weather-clear-night'},
    {codes: [1], text: N_('Mainly clear'), icon: 'weather-few-clouds', night: 'weather-few-clouds-night'},
    {codes: [2], text: N_('Partly cloudy'), icon: 'weather-few-clouds', night: 'weather-few-clouds-night'},
    {codes: [3], text: N_('Overcast'), icon: 'weather-overcast'},
    {codes: [45, 48], text: N_('Fog'), icon: 'weather-fog'},
    {codes: [51, 53, 55, 56, 57], text: N_('Drizzle'), icon: 'weather-showers-scattered'},
    {codes: [61, 63, 65, 66, 67, 80, 81, 82], text: N_('Rain'), icon: 'weather-showers'},
    {codes: [71, 73, 75, 77, 85, 86], text: N_('Snow'), icon: 'weather-snow'},
    {codes: [95, 96, 99], text: N_('Thunderstorm'), icon: 'weather-storm'},
];

function describe(code, isDay) {
    const condition = CONDITIONS.find(c => c.codes.includes(code));
    if (!condition)
        return {text: _('Unknown'), icon: 'weather-severe-alert-symbolic'};
    const icon = !isDay && condition.night ? condition.night : condition.icon;
    return {text: _(condition.text), icon: `${icon}-symbolic`};
}

export class WeatherProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     * @param {() => void} openPreferences
     */
    constructor(settings, openPreferences) {
        super({id: 'weather', name: _('Weather'), label: _('Weather')});
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._session = new Soup.Session({timeout: 10});
        /** @type {Map<string, object|null>} city -> place, null if not found */
        this._places = new Map();
        /** @type {Map<string, {time: number, forecast: object}>} */
        this._forecasts = new Map();
        this._debounce = null;
        this._destroyed = false;
    }

    scope(text) {
        const lower = text.toLowerCase();
        return lower === KEYWORD || lower.startsWith(`${KEYWORD} `) ? _('Weather') : null;
    }

    async query(text, cancellable) {
        const lower = text.toLowerCase();
        if (lower !== KEYWORD && !lower.startsWith(`${KEYWORD} `))
            return [];

        const city = text.slice(KEYWORD.length).trim() || this._settings.get_string('weather-city').trim();
        if (city.length < MIN_CITY_LENGTH) {
            return [{
                id: 'hint',
                title: _('Weather'),
                subtitle: _('Type “weather <city>”, or set a default city in Preferences'),
                icon: 'weather-few-clouds-symbolic',
                score: SCORE,
                activate: () => this._openPreferences(),
            }];
        }

        const imperial = this._settings.get_string('weather-units') === 'imperial';
        let place, forecast;
        try {
            place = this._places.get(city.toLowerCase());
            forecast = place && this._cachedForecast(place, imperial);
            if (place === undefined || (place && !forecast)) {
                await this._wait();
                if (cancellable.is_cancelled() || this._destroyed)
                    return [];
            }
            if (place === undefined)
                place = await this._geocode(city, cancellable);
            if (place && !forecast)
                forecast = await this._fetchForecast(place, imperial, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return [{
                id: 'error',
                title: _('Weather unavailable'),
                subtitle: e.message,
                icon: 'network-offline-symbolic',
                score: SCORE,
                activate: () => {},
            }];
        }

        if (!place) {
            return [{
                id: 'not-found',
                title: _('No place called “%s”').format(city),
                subtitle: _('Weather data by Open-Meteo.com'),
                icon: 'weather-severe-alert-symbolic',
                score: SCORE,
                activate: () => {},
            }];
        }
        return [this._toResult(place, forecast)];
    }

    /**
     * Resolve after DEBOUNCE_MS, or right away when a newer query replaces
     * this one (the caller then sees its cancellable is cancelled).
     */
    _wait() {
        this._cancelWait();
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._debounce = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._debounce = {id, resolve};
        });
    }

    _cancelWait() {
        if (!this._debounce)
            return;
        GLib.source_remove(this._debounce.id);
        this._debounce.resolve();
        this._debounce = null;
    }

    async _getJson(url, cancellable) {
        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(_('Open-Meteo answered with HTTP %d').format(message.get_status()));
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _geocode(city, cancellable) {
        const language = GLib.get_language_names()[0].split(/[_.@]/)[0];
        const data = await this._getJson('https://geocoding-api.open-meteo.com/v1/search' +
            `?name=${encodeURIComponent(city)}&count=1&format=json&language=${encodeURIComponent(language)}`,
        cancellable);

        const result = data.results?.[0];
        const place = result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
            ? {
                name: String(result.name),
                country: result.country ? String(result.country) : '',
                latitude: result.latitude,
                longitude: result.longitude,
            }
            : null;
        this._places.set(city.toLowerCase(), place);
        return place;
    }

    _forecastKey(place, imperial) {
        return `${place.latitude},${place.longitude},${imperial ? 'imperial' : 'metric'}`;
    }

    _cachedForecast(place, imperial) {
        const cached = this._forecasts.get(this._forecastKey(place, imperial));
        const now = GLib.get_monotonic_time() / 1e6;
        return cached && now - cached.time < FORECAST_TTL_SECONDS ? cached.forecast : null;
    }

    async _fetchForecast(place, imperial, cancellable) {
        const units = imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
        const data = await this._getJson('https://api.open-meteo.com/v1/forecast' +
            `?latitude=${place.latitude}&longitude=${place.longitude}` +
            '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
            '&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5' +
            units, cancellable);

        const {current, daily} = data;
        if (!Number.isFinite(current?.temperature_2m))
            throw new Error(_('Unexpected answer from Open-Meteo'));

        const forecast = {
            temperature: current.temperature_2m,
            feelsLike: current.apparent_temperature,
            code: current.weather_code,
            isDay: current.is_day === 1,
            high: daily?.temperature_2m_max?.[0],
            low: daily?.temperature_2m_min?.[0],
            // The preview's 5-day forecast.
            days: (daily?.time ?? []).map((date, i) => ({
                date,
                high: daily.temperature_2m_max?.[i],
                low: daily.temperature_2m_min?.[i],
                code: daily.weather_code?.[i],
            })),
        };
        this._forecasts.set(this._forecastKey(place, imperial),
            {time: GLib.get_monotonic_time() / 1e6, forecast});
        return forecast;
    }

    _toResult(place, forecast) {
        const degrees = value => (Number.isFinite(value) ? `${Math.round(value)}°` : '–');
        const {text, icon} = describe(forecast.code, forecast.isDay);
        const where = place.country ? `${place.name}, ${place.country}` : place.name;
        const title = `${where}: ${degrees(forecast.temperature)}, ${text}`;

        return {
            id: `${place.latitude},${place.longitude}`,
            title,
            // Open-Meteo's CC BY 4.0 license asks for attribution.
            subtitle: _('High %s · Low %s · Feels like %s · Open-Meteo.com').format(
                degrees(forecast.high), degrees(forecast.low), degrees(forecast.feelsLike)),
            icon,
            score: SCORE,
            preview: () => ({
                rows: forecast.days.map(day => {
                    const [y, m, d] = day.date.split('-').map(Number);
                    // %a: the day's short name in the user's language.
                    const name = GLib.DateTime.new_local(y, m, d, 12, 0, 0)?.format('%a %e') ?? day.date;
                    return [name, `${degrees(day.high)} / ${degrees(day.low)} · ${describe(day.code, true).text}`];
                }),
            }),
            activate: () => {
                const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Weather.desktop');
                if (app)
                    app.activate();
                else
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, title);
            },
        };
    }

    destroy() {
        this._destroyed = true;
        this._cancelWait();
        this._session.abort();
        this._places.clear();
        this._forecasts.clear();
    }
}
