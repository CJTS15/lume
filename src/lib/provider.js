// SPDX-License-Identifier: GPL-3.0-or-later
//
// Provider interface and registry.
//
// Every Lume feature (apps, calculator, files, clipboard, web search, weather,
// AI agents, ...) is a Provider. The search window never knows about specific
// features: it hands the query to the registry and renders whatever comes
// back. Providers report results independently, so a slow provider (network,
// disk) never delays a fast one (apps, calculator).

import Gio from 'gi://Gio';

// Caps for text from untrusted sources (remote apps, scripts, the network).
const MAX_TITLE = 256;
const MAX_SUBTITLE = 512;
const MAX_TYPE = 32;
const MAX_GROUP = 64;

const cap = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The boundary check every provider's rows pass before they are shown:
 * rows without a title or activate are dropped, text is capped and the
 * score made a finite number, so one bad row can never break rendering.
 * Fixes rows in place.
 *
 * @param {Result[]} results
 * @returns {Result[]}
 */
export function checkResults(results) {
    return results.filter(r => typeof r?.title === 'string' && r.title.trim() &&
        typeof r.activate === 'function')
        .map(r => {
            r.title = cap(r.title, MAX_TITLE);
            r.subtitle = typeof r.subtitle === 'string' ? cap(r.subtitle, MAX_SUBTITLE) : undefined;
            r.type = typeof r.type === 'string' ? cap(r.type, MAX_TYPE) : undefined;
            r.group = typeof r.group === 'string' ? cap(r.group, MAX_GROUP) : undefined;
            r.paste = typeof r.paste === 'string' ? r.paste : undefined;
            r.score = Number.isFinite(r.score) ? r.score : 0;
            return r;
        });
}

/**
 * A single row in the search window.
 *
 * @typedef {object} Result
 * @property {string} id - Stable within its provider; used to keep the
 *   selection on the same row when results refresh.
 * @property {string} title - Main text.
 * @property {string} [subtitle] - Secondary text, shown dimmed.
 * @property {Gio.Icon|string} [icon] - A Gio.Icon or a themed icon name.
 * @property {number} [score] - Relevance from 0 to 1. Higher sorts first.
 *   Defaults to 0.
 * @property {() => void} activate - Runs when the row is chosen. The window
 *   is already closed when this is called.
 * @property {() => void} [ctrlActivate] - Ctrl+Enter, if the row has a
 *   second action (open the containing folder, run in a terminal).
 *   Without it, Ctrl+Enter does what Enter does.
 * @property {() => void} [altActivate] - Alt+Enter (show properties).
 *   Without it, Alt+Enter does what Enter does.
 * @property {() => void} [copy] - Ctrl+C on the row. Without it, Ctrl+C
 *   copies the entry's selected text as usual.
 * @property {string} [paste] - text the Ctrl+K menu offers to paste into
 *   the window that was in front before Lume opened.
 * @property {Array<{label: string, icon?: string, run: () => void, confirm?: string}>} [actions]
 *   - the Ctrl+K menu; an action with `confirm` first shows that question
 *   on a row of its own, and runs on Enter there. Without it the menu offers Open and, if there is
 *   `copy`, Copy; with `paste`, it also offers Paste.
 * @property {boolean} [fallback] - Shown only when few other rows match
 *   (web search).
 * @property {(size: number) => Clutter.Actor|null} [createIcon] - an icon
 *   actor, used before `icon` (remote search providers).
 * @property {string} [glyph] - text (an emoji) drawn large instead of the
 *   icon.
 * @property {string} [swatch] - "#rrggbb": drawn as a colour square instead
 *   of the icon.
 * @property {string} [type] - Short type shown on the row's right; defaults
 *   to the provider's label ("Folder" instead of "File").
 * @property {string} [group] - Header the row is grouped under; defaults
 *   to the provider's name (remote search providers use the app's name).
 */

/**
 * Base class for providers. Subclass it and override `query()`.
 */
export class Provider {
    /**
     * @param {object} params
     * @param {string} params.id - Unique, stable provider id (e.g. 'apps').
     * @param {string} params.name - Human-readable name.
     * @param {string} [params.label] - Short type shown on each row ("App").
     */
    constructor({id, name, label}) {
        if (!id)
            throw new Error('Provider needs an id');
        this.id = id;
        this.name = name ?? id;
        this.label = label ?? this.name;
    }

    /**
     * The scope shown in the search field's pill when a keyword of this
     * provider owns the query ("clip" -> "Clipboard"), else null.
     *
     * @param {string} _text - The trimmed, non-empty query.
     * @returns {string|null}
     */
    scope(_text) {
        return null;
    }

    /**
     * Whether this provider's prefix leads the query ("clip …", "b …").
     * The registry then asks only this provider, so its rows are the only
     * ones shown.
     *
     * @param {string} _text - The trimmed, non-empty query.
     * @returns {boolean}
     */
    owns(_text) {
        return false;
    }

    /**
     * Return results for `text`. May be synchronous or return a Promise.
     * Async providers should stop work and reject (or return []) when
     * `cancellable` is cancelled; a newer query has replaced theirs.
     *
     * @param {string} _text - The trimmed, non-empty query.
     * @param {Gio.Cancellable} _cancellable
     * @param {(results: Result[]) => void} _update - shows interim rows
     *   ("Fetching…") until the returned results replace them
     * @returns {Result[]|Promise<Result[]>}
     */
    query(_text, _cancellable, _update) {
        return [];
    }

    /**
     * Release resources (signals, timeouts, subprocesses). Called on disable.
     */
    destroy() {
    }
}

export class ProviderRegistry {
    /** @type {Provider[]} */
    #providers = [];

    /**
     * @param {Provider} provider
     */
    register(provider) {
        if (this.#providers.some(p => p.id === provider.id))
            throw new Error(`Provider "${provider.id}" is already registered`);
        this.#providers.push(provider);
    }

    get providers() {
        return [...this.#providers];
    }

    /**
     * @param {string} text
     * @returns {string|null} the first provider scope for `text`
     */
    scopeFor(text) {
        for (const provider of this.#providers) {
            const scope = provider.scope(text);
            if (scope)
                return scope;
        }
        return null;
    }

    /**
     * Query every provider. `onResults(provider, results)` is called once per
     * provider as soon as it answers, unless the query was cancelled first,
     * and also for each interim update the provider sends before that.
     *
     * @param {string} text
     * @param {Gio.Cancellable} cancellable
     * @param {(provider: Provider, results: Result[]) => void} onResults
     * @returns {Promise<void>} resolves when every provider has answered
     */
    async query(text, cancellable, onResults) {
        const owner = this.#providers.find(p => p.owns(text));
        await Promise.all((owner ? [owner] : this.#providers).map(async provider => {
            let results;
            const update = interim => {
                if (!cancellable.is_cancelled() && Array.isArray(interim))
                    onResults(provider, checkResults(interim));
            };
            try {
                results = await provider.query(text, cancellable, update);
            } catch (e) {
                if (!cancellable.is_cancelled() &&
                    !e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`lume: provider "${provider.id}" failed: ${e}`);
                return;
            }
            if (cancellable.is_cancelled() || !Array.isArray(results))
                return;
            onResults(provider, checkResults(results));
        }));
    }

    destroy() {
        for (const provider of this.#providers) {
            try {
                provider.destroy();
            } catch (e) {
                console.error(`lume: destroying provider "${provider.id}" failed: ${e}`);
            }
        }
        this.#providers = [];
    }
}
