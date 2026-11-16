// SPDX-License-Identifier: GPL-3.0-or-later
//
// Time zones and dates: "time in tokyo", "3pm est in london", "in 3 hours",
// "next monday", "days until dec 25", "unix 2026-12-25". Enter copies the
// answer. Places come from GNOME's own city list first (offline); a city
// it lacks, or a name several cities share (London, Paris), is looked up
// with Open-Meteo, unless offline mode is on.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {parseDateQuery, parseTimeQuery, zoneForAbbreviation} from '../lib/dates.js';
import {geocode} from '../lib/openMeteo.js';
import {noAction, Provider} from '../lib/provider.js';

const SCORE = 0.95;
// Wait for typing to pause before asking Open-Meteo.
const DEBOUNCE_MS = 400;
// Rows for a name several cities share, when it can't be looked up.
const MAX_PLACES = 4;
const GEOCODE_CACHE_SIZE = 50;

/** @typedef {{label: string, zone: string|null}} Place - zone null: the local one */

const timeZone = zone => zone ? GLib.TimeZone.new_identifier(zone) : GLib.TimeZone.new_local();

export class TimeProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'time', name: _('Time and Dates'), label: _('Time')});
        this._settings = settings;
        this._clock = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._session = new Soup.Session({timeout: 5});
        /** @type {Map<string, Place[]>|null} lower-case name -> places, built on first use */
        this._index = null;
        /** @type {Map<string, Place|null>} */
        this._geocoded = new Map();
        this._debounce = null;
        this._destroyed = false;
    }

    async query(text, cancellable, update) {
        const date = parseDateQuery(text, GLib.DateTime.new_now_local());
        if (date)
            return [this._dateRow(date)];

        const time = parseTimeQuery(text);
        if (!time)
            return [];
        const target = time.place ?? time.to;
        let places, from = null;
        try {
            places = await this._resolve(target, cancellable, update);
            if (time.from)
                from = (await this._resolve(time.from, cancellable, update))?.[0] ?? null;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return [this._infoRow(_('Time zone lookup failed'), e.message)];
        }
        if (!places || cancellable.is_cancelled())
            return [];
        if (places.length === 0 || (time.from && !from)) {
            const missing = places.length === 0 ? target : time.from;
            return [this._infoRow(_('No time zone found for “%s”').format(missing),
                this._settings.get_boolean('offline-mode') ? _('Offline mode is on: only GNOME’s own city list is searched') : '')];
        }
        return places.map((place, index) => time.place
            ? this._nowRow(place, index)
            : this._convertRow(time, from, place, index));
    }

    /**
     * @returns {Promise<Place[]|null>} empty if not found, null if a newer
     *   query replaced this one
     */
    async _resolve(name, cancellable, update) {
        // The local zone's own abbreviation means it: "PST" in Manila is
        // Philippine, not US Pacific, time.
        const local = GLib.DateTime.new_now_local();
        if (name.toUpperCase() === local.get_timezone_abbreviation().toUpperCase())
            return [{label: name.toUpperCase(), zone: null}];
        const zone = zoneForAbbreviation(name) ??
            (name.includes('/') && GLib.TimeZone.new_identifier(name) ? name : null);
        if (zone)
            return [{label: name.includes('/') ? name : name.toUpperCase(), zone}];

        const places = this._lookup(name);
        if (places.length === 1 || this._settings.get_boolean('offline-mode'))
            return places.slice(0, MAX_PLACES);

        const key = name.toLowerCase();
        if (!this._geocoded.has(key)) {
            update([this._infoRow(_('Looking up “%s”…').format(name), _('Time zones by Open-Meteo.com'))]);
            await this._wait();
            if (cancellable.is_cancelled() || this._destroyed)
                return null;
            // Offline mode may have been turned on during the wait.
            if (this._settings.get_boolean('offline-mode'))
                return places.slice(0, MAX_PLACES);
            const found = await geocode(this._session, name, cancellable);
            this._geocoded.set(key, found?.timezone
                ? {label: found.country ? `${found.name}, ${found.country}` : found.name, zone: found.timezone}
                : null);
            if (this._geocoded.size > GEOCODE_CACHE_SIZE)
                this._geocoded.delete(this._geocoded.keys().next().value);
        }
        const found = this._geocoded.get(key);
        return found ? [found] : places.slice(0, MAX_PLACES);
    }

    /**
     * Places named `name` in GNOME's city list ("london"), optionally
     * narrowed by country ("london, canada"); a country with one time zone
     * ("japan") also counts.
     *
     * @returns {Place[]}
     */
    _lookup(name) {
        this._index ??= this._buildIndex();
        const [city, country] = name.toLowerCase().split(',').map(part => part.trim());
        return (this._index.get(city) ?? [])
            .filter(place => !country || place.country.toLowerCase().startsWith(country));
    }

    _buildIndex() {
        const index = new Map();
        const add = (key, place) => {
            const places = index.get(key) ?? [];
            if (!places.some(p => p.zone === place.zone && p.country === place.country))
                places.push(place);
            index.set(key, places);
        };
        const walk = location => {
            for (let child = location.next_child(null); child; child = location.next_child(child)) {
                const level = child.get_level();
                const zone = child.get_timezone_str();
                if (zone && level === GWeather.LocationLevel.CITY) {
                    const country = child.get_country_name() ?? '';
                    add(child.get_name().toLowerCase(),
                        {label: country ? `${child.get_name()}, ${country}` : child.get_name(), zone, country});
                } else if (zone && level === GWeather.LocationLevel.COUNTRY) {
                    add(child.get_name().toLowerCase(), {label: child.get_name(), zone, country: child.get_name()});
                }
                walk(child);
            }
        };
        walk(GWeather.Location.get_world());
        return index;
    }

    _format(date, withDay) {
        const time = this._clock.get_string('clock-format') === '12h' ? '%l:%M %p' : '%H:%M';
        return date.format(withDay ? `%A, %e %B ${time}` : time).replace(/\s+/g, ' ').trim();
    }

    _nowRow(place, index) {
        const here = GLib.DateTime.new_now_local();
        const there = here.to_timezone(timeZone(place.zone));
        const hours = (there.get_utc_offset() - here.get_utc_offset()) / 3.6e9;
        const amount = String(Number(Math.abs(hours).toFixed(2)));
        const relation = hours === 0 ? _('Same time as here')
            // TRANSLATORS: %s is a number of hours, e.g. "13" or "5.5"
            : hours > 0 ? ngettext('%s hour ahead', '%s hours ahead', Math.ceil(Math.abs(hours))).format(amount)
                : ngettext('%s hour behind', '%s hours behind', Math.ceil(Math.abs(hours))).format(amount);
        // TRANSLATORS: "10:42 PM in Tokyo, Japan"
        const title = _('%s in %s').format(this._format(there, false), place.label);
        return this._row(`now:${index}`, title,
            `${there.format('%A, %e %B').replace(/\s+/g, ' ')} · ${relation} · ${place.zone ?? place.label}`,
            this._format(there, false));
    }

    _convertRow(time, from, place, index) {
        const source = timeZone(from?.zone);
        const today = GLib.DateTime.new_now(source);
        const start = GLib.DateTime.new(source, today.get_year(), today.get_month(),
            today.get_day_of_month(), time.hour, time.minute, 0);
        const end = start.to_timezone(timeZone(place.zone));
        const title = _('%s in %s').format(this._format(end, false), place.label);
        // TRANSLATORS: "3:00 PM EST · Monday, 16 November"; "here" is the local time zone
        const subtitle = `${this._format(start, false)} ${from?.label ?? _('here')} · ` +
            end.format('%A, %e %B').replace(/\s+/g, ' ');
        return this._row(`convert:${index}`, title, subtitle, this._format(end, false));
    }

    _dateRow({kind, time, days, seconds, date}) {
        const day = date.format('%A, %e %B %Y').replace(/\s+/g, ' ');
        if (kind === 'days') {
            const count = ngettext('%d day', '%d days', Math.abs(days)).format(Math.abs(days));
            // TRANSLATORS: %s is a date
            return this._row('days', count, (days >= 0 ? _('Until %s') : _('Since %s')).format(day), String(Math.abs(days)));
        }
        if (kind === 'unix')
            return this._row('unix', String(seconds), _('%s, 00:00 local time · Unix time').format(day), String(seconds));
        const title = time ? `${day}, ${this._format(date, false)}` : day;
        return this._row('moment', title, _('Enter to copy'), title);
    }

    _row(id, title, subtitle, copyText) {
        const copy = () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
        return {id, title, subtitle, icon: 'preferences-system-time-symbolic', score: SCORE, activate: copy, copy};
    }

    _infoRow(title, subtitle) {
        return {id: 'info', title, subtitle: subtitle || undefined, icon: 'preferences-system-time-symbolic', score: SCORE, activate: noAction};
    }

    /**
     * Resolve after DEBOUNCE_MS, or right away when a newer query replaces
     * this one (the caller then sees its cancellable is cancelled).
     */
    _wait() {
        if (this._debounce) {
            GLib.source_remove(this._debounce.id);
            this._debounce.resolve();
        }
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._debounce = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._debounce = {id, resolve};
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._debounce) {
            GLib.source_remove(this._debounce.id);
            this._debounce.resolve();
            this._debounce = null;
        }
        this._session.abort();
        this._index = null;
    }
}
