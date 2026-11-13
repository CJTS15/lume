// SPDX-License-Identifier: GPL-3.0-or-later
//
// Results from apps' GNOME search providers (Calendar, Contacts, Software,
// Firefox, ...), loaded by the Shell's own remote search code, so Settings →
// Search decides which are on and in what order. Providers that duplicate
// Lume's own (Settings, Files, Calculator, Weather) are skipped.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as RemoteSearch from 'resource:///org/gnome/shell/ui/remoteSearch.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Provider} from '../lib/provider.js';

const SEARCH_SCHEMA = 'org.gnome.desktop.search-providers';
const SKIPPED = new Set([
    'org.gnome.Settings.desktop',
    'org.gnome.Nautilus.desktop',
    'org.gnome.Calculator.desktop',
    'org.gnome.Weather.desktop',
]);
const MIN_QUERY_LENGTH = 3;
const MAX_PER_PROVIDER = 3;
// Each query wakes several D-Bus services: wait for typing to pause.
const DEBOUNCE_MS = 200;
// A provider that has not answered by then (a service still starting, a
// hung app) is left out of this query instead of holding back the rest.
const PROVIDER_TIMEOUT_MS = 2000;

export class RemoteProvider extends Provider {
    constructor() {
        super({id: 'remote', name: _('Search Providers'), label: _('Search')});
        this._providers = [];
        this._debounce = null;
        this._destroyed = false;

        // A missing schema would abort gnome-shell, so look before creating.
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(SEARCH_SCHEMA, true);
        if (!schema)
            return;
        this._searchSettings = new Gio.Settings({settings_schema: schema});
        this._changedId = this._searchSettings.connect('changed', () => this._load());
        this._load();
    }

    _load() {
        try {
            this._providers = RemoteSearch.loadRemoteSearchProviders(this._searchSettings)
                .filter(provider => !SKIPPED.has(provider.appInfo.get_id()));
        } catch (e) {
            console.warn(`lume: could not load search providers: ${e.message}`);
            this._providers = [];
        }
    }

    async query(text, cancellable) {
        if (text.length < MIN_QUERY_LENGTH || this._providers.length === 0)
            return [];

        await this._wait();
        if (cancellable.is_cancelled() || this._destroyed)
            return [];

        const terms = text.toLowerCase().split(/\s+/).filter(t => t);
        const perProvider = await Promise.all(this._providers.map(
            (provider, rank) => this._withTimeout(this._queryOne(provider, rank, terms, cancellable))));
        return perProvider.flat();
    }

    /** `promise`, or [] once PROVIDER_TIMEOUT_MS have passed. */
    _withTimeout(promise) {
        let id;
        const timeout = new Promise(resolve => {
            id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROVIDER_TIMEOUT_MS, () => {
                resolve([]);
                return GLib.SOURCE_REMOVE;
            });
        });
        return Promise.race([promise, timeout]).finally(() => GLib.source_remove(id));
    }

    async _queryOne(provider, rank, terms, cancellable) {
        try {
            const ids = (await provider.getInitialResultSet(terms, cancellable)).slice(0, MAX_PER_PROVIDER);
            if (ids.length === 0 || cancellable.is_cancelled())
                return [];
            const metas = await provider.getResultMetas(ids, cancellable);
            const name = provider.appInfo.get_name();
            return metas.map((meta, index) => ({
                id: `${provider.id}:${meta.id}`,
                type: name,
                title: meta.name,
                subtitle: meta.description || undefined,
                createIcon: meta.createIcon,
                icon: provider.appInfo.get_icon(),
                // Below Lume's own matches, above the web fallback.
                score: Math.max(0.1, 0.42 - 0.02 * rank - 0.002 * index),
                activate: () => provider.activateResult(meta.id, terms),
            }));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`lume: search provider ${provider.id} failed: ${e.message}`);
            return [];
        }
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

    destroy() {
        this._destroyed = true;
        this._cancelWait();
        if (this._changedId)
            this._searchSettings.disconnect(this._changedId);
        this._providers = [];
    }
}
