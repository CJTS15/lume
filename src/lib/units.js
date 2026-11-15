// SPDX-License-Identifier: GPL-3.0-or-later
//
// Unit conversion: "10 km to mi", "5 ft in cm", "cup to qt",
// "100 kph -> mph", "32 F to C", "16px to rem", "100 eur to usd". No gi://
// imports, so tests run under plain gjs.

// [category, factor to the category's base unit, names...]. The first name
// is the symbol shown in results. Names are matched without case; a name
// in two categories ("pt": pint and point) resolves by the other unit's
// category. US customary volumes.
const LINEAR_UNITS = [
    ['length', 0.001, 'mm', 'millimeter', 'millimetre'],
    ['length', 0.01, 'cm', 'centimeter', 'centimetre'],
    ['length', 1, 'm', 'meter', 'metre'],
    ['length', 1000, 'km', 'kilometer', 'kilometre'],
    ['length', 0.0254, 'in', 'inch', 'inches'],
    ['length', 0.3048, 'ft', 'foot', 'feet'],
    ['length', 0.9144, 'yd', 'yard'],
    ['length', 1609.344, 'mi', 'mile'],
    ['length', 1852, 'nmi'],
    // CSS units: 96 px per inch; rem and em assume the browser default
    // 16 px root size (em ignores any parent font size).
    ['length', 0.0254 / 96, 'px', 'pixel'],
    ['length', 0.0254 / 72, 'pt', 'point'],
    ['length', 0.0254 / 6, 'pc', 'pica'],
    ['length', 0.0254 / 6, 'rem'],
    ['length', 0.0254 / 6, 'em'],

    ['mass', 0.001, 'mg', 'milligram'],
    ['mass', 1, 'g', 'gram'],
    ['mass', 1000, 'kg', 'kilogram', 'kilo'],
    ['mass', 1e6, 't', 'tonne'],
    ['mass', 28.349523125, 'oz', 'ounce'],
    ['mass', 453.59237, 'lb', 'lbs', 'pound'],
    ['mass', 6350.29318, 'st', 'stone'],

    ['volume', 0.001, 'ml', 'milliliter', 'millilitre'],
    ['volume', 0.01, 'cl'],
    ['volume', 0.1, 'dl'],
    ['volume', 1, 'l', 'liter', 'litre'],
    ['volume', 1000, 'm3'],
    ['volume', 0.001, 'cm3', 'cc'],
    ['volume', 0.00492892159375, 'tsp', 'teaspoon'],
    ['volume', 0.01478676478125, 'tbsp', 'tablespoon'],
    ['volume', 0.0295735295625, 'floz', 'fl-oz'],
    ['volume', 0.2365882365, 'cup'],
    ['volume', 0.473176473, 'pt', 'pint'],
    ['volume', 0.946352946, 'qt', 'quart'],
    ['volume', 3.785411784, 'gal', 'gallon'],

    ['time', 0.001, 'ms', 'millisecond'],
    ['time', 1, 's', 'sec', 'second'],
    ['time', 60, 'min', 'minute'],
    ['time', 3600, 'h', 'hr', 'hour'],
    ['time', 86400, 'd', 'day'],
    ['time', 604800, 'wk', 'week'],
    // Average Gregorian month and year (365.2425 days).
    ['time', 2629746, 'month'],
    ['time', 31556952, 'yr', 'year'],

    ['area', 1e-4, 'cm2'],
    ['area', 1, 'm2', 'sqm'],
    ['area', 1e6, 'km2'],
    ['area', 1e4, 'ha', 'hectare'],
    ['area', 0.00064516, 'in2', 'sqin'],
    ['area', 0.09290304, 'ft2', 'sqft'],
    ['area', 0.83612736, 'yd2'],
    ['area', 4046.8564224, 'ac', 'acre'],
    ['area', 2589988.110336, 'mi2', 'sqmi'],

    ['speed', 1, 'm/s', 'mps'],
    ['speed', 1 / 3.6, 'km/h', 'kph', 'kmh', 'kmph'],
    ['speed', 0.44704, 'mph', 'mi/h'],
    ['speed', 1852 / 3600, 'kn', 'kt', 'knot'],
    ['speed', 0.3048, 'ft/s', 'fps'],

    // Decimal (kB = 1000 B) and binary (KiB = 1024 B) prefixes.
    ['storage', 0.125, 'bit'],
    ['storage', 125, 'kbit'],
    ['storage', 125e3, 'mbit'],
    ['storage', 125e6, 'gbit'],
    ['storage', 1, 'B', 'b', 'byte'],
    ['storage', 1e3, 'kB', 'kb', 'kilobyte'],
    ['storage', 1e6, 'MB', 'megabyte'],
    ['storage', 1e9, 'GB', 'gigabyte'],
    ['storage', 1e12, 'TB', 'terabyte'],
    ['storage', 1e15, 'PB', 'petabyte'],
    ['storage', 1024, 'KiB', 'kibibyte'],
    ['storage', 1024 ** 2, 'MiB', 'mebibyte'],
    ['storage', 1024 ** 3, 'GiB', 'gibibyte'],
    ['storage', 1024 ** 4, 'TiB', 'tebibyte'],
];

// Temperatures are not proportional: convert through kelvin.
const TEMPERATURES = [
    [{toKelvin: c => c + 273.15, fromKelvin: k => k - 273.15}, '°C', 'c', 'celsius'],
    [{toKelvin: f => (f - 32) * 5 / 9 + 273.15, fromKelvin: k => (k - 273.15) * 9 / 5 + 32}, '°F', 'f', 'fahrenheit'],
    [{toKelvin: k => k, fromKelvin: k => k}, 'K', 'k', 'kelvin'],
];

const linear = (category, factor, symbol) =>
    ({category, symbol, toBase: v => v * factor, fromBase: v => v / factor});

/** @type {Map<string, object[]>} name -> units with that name */
const UNITS = new Map();
function add(map, name, unit) {
    const key = name.toLowerCase();
    map.set(key, [...map.get(key) ?? [], unit]);
}
for (const [category, factor, ...names] of LINEAR_UNITS) {
    const unit = linear(category, factor, names[0]);
    for (const name of names)
        add(UNITS, name, unit);
}
for (const [{toKelvin, fromKelvin}, ...names] of TEMPERATURES) {
    const unit = {category: 'temperature', symbol: names[0], toBase: toKelvin, fromBase: fromKelvin};
    for (const name of names)
        add(UNITS, name, unit);
}

const PX = 0.0254 / 96;

/** Currencies with ECB reference rates (the Frankfurter API's set). */
export const CURRENCIES = new Set([
    'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
    'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
    'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

/** Currency units from rates per euro ({USD: 1.1, ...}). */
function currencyUnits(rates) {
    const units = new Map();
    for (const [code, perEuro] of Object.entries(rates)) {
        if (CURRENCIES.has(code) && Number.isFinite(perEuro) && perEuro > 0)
            add(units, code, linear('currency', 1 / perEuro, code));
    }
    return units;
}

/** vw, vh, vmin, vmax for a viewport in CSS pixels. */
function viewportUnits({width, height}) {
    const units = new Map();
    for (const [name, size] of [['vw', width], ['vh', height],
        ['vmin', Math.min(width, height)], ['vmax', Math.max(width, height)]])
        add(units, name, linear('length', size / 100 * PX, name));
    return units;
}

/**
 * @param {string} name
 * @param {Map<string, object[]>} extra - units for this query only
 * @returns {object[]} every unit with that name (empty if none)
 */
function lookup(name, extra) {
    const key = name.toLowerCase().replace('²', '2').replace('³', '3').replace(/^°(?=[cf]$)/, '');
    const find = k => [...UNITS.get(k) ?? [], ...extra.get(k) ?? []];
    const units = find(key);
    // Plurals: "cups", "miles", "kilometers".
    return units.length > 0 || key.length <= 3 || !key.endsWith('s') ? units : find(key.slice(0, -1));
}

// [amount] unit (to|in|into|as|->) unit. The amount is optional ("cup to
// qt" converts 1 cup). The source unit may follow the number directly
// ("32F to C").
const PATTERN = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)?\s*([^\s\d.-]\S*?)\s*(?:\s(?:to|in|into|as)\s|->)\s*(\S+)\s*$/i;

/**
 * Parse and convert a conversion query.
 *
 * @param {string} text
 * @param {object} [context]
 * @param {{width: number, height: number}} [context.viewport] - in CSS px;
 *   without it vw/vh/vmin/vmax are not recognised
 * @param {Object<string, number>} [context.rates] - units per euro; without
 *   them currencies are not recognised
 * @returns {{amount: number, value: number, from: string, to: string}|null}
 *   from/to are display symbols; null if `text` is not a conversion between
 *   two known units of the same category
 */
export function convert(text, {viewport, rates} = {}) {
    const match = PATTERN.exec(text);
    if (!match)
        return null;

    const amount = match[1] === undefined ? 1 : parseFloat(match[1]);
    const extra = new Map([
        ...viewport ? viewportUnits(viewport) : [],
        ...rates ? currencyUnits(rates) : [],
    ]);
    const tos = lookup(match[3], extra);
    let from, to;
    for (const candidate of lookup(match[2], extra)) {
        to = tos.find(t => t.category === candidate.category);
        if (to) {
            from = candidate;
            break;
        }
    }
    if (!from || !Number.isFinite(amount))
        return null;

    const value = to.fromBase(from.toBase(amount));
    return Number.isFinite(value) ? {amount, value, from: from.symbol, to: to.symbol} : null;
}

/**
 * Whether `text` converts between two currencies, so rates are needed.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function needsRates(text) {
    const match = PATTERN.exec(text);
    return Boolean(match) && CURRENCIES.has(match[2].toUpperCase()) &&
        CURRENCIES.has(match[3].toUpperCase());
}

// Currency symbols; the longest prefixes first so "US$" wins over "$".
// "$" and "¥" mean the home currency when it uses them, else USD and JPY.
const SYMBOLS = new Map([
    ['NZ$', 'NZD'], ['HK$', 'HKD'], ['US$', 'USD'], ['A$', 'AUD'], ['C$', 'CAD'],
    ['S$', 'SGD'], ['R$', 'BRL'], ['€', 'EUR'], ['£', 'GBP'], ['₱', 'PHP'],
    ['₹', 'INR'], ['₩', 'KRW'], ['₺', 'TRY'], ['₪', 'ILS'], ['฿', 'THB'], ['zł', 'PLN'],
]);
const DOLLARS = new Set(['USD', 'AUD', 'CAD', 'NZD', 'HKD', 'SGD', 'MXN']);
const SYMBOL = `(${[...SYMBOLS.keys(), '$', '¥'].map(s => s.replace('$', '\\$')).join('|')})`;
const AMOUNT = '(\\d[\\d,]*(?:\\.\\d+)?)';
const TARGET_SYMBOL = new RegExp(`(\\s(?:to|in|into|as)\\s+|->\\s*)${SYMBOL}\\s*$`, 'i');

function symbolCode(symbol, home) {
    if (symbol === '$')
        return DOLLARS.has(home) ? home : 'USD';
    if (symbol === '¥')
        return home === 'CNY' ? 'CNY' : 'JPY';
    return SYMBOLS.get(symbol);
}

/**
 * Rewrite currency shorthand into a conversion `convert` understands:
 * "$100" -> "100 USD to PHP", "€50 to $" -> "50 EUR to USD",
 * "100 eur" -> "100 EUR to PHP" (home PHP). Anything else is returned
 * unchanged.
 *
 * @param {string} text
 * @param {string} home - the home currency code
 * @returns {string}
 */
export function expandCurrency(text, home) {
    const trimmed = text.trim();
    let amount, code, rest;
    const symbol = new RegExp(`^${SYMBOL}\\s*${AMOUNT}(.*)$`).exec(trimmed);
    const word = new RegExp(`^${AMOUNT}\\s*([a-z]{3})\\b(.*)$`, 'i').exec(trimmed);
    if (symbol) {
        [, , amount, rest] = symbol;
        code = symbolCode(symbol[1], home);
    } else if (word && CURRENCIES.has(word[2].toUpperCase())) {
        [, amount, , rest] = word;
        code = word[2].toUpperCase();
        // "100 eur to usd" needs no rewriting.
        if (rest.trim() && !TARGET_SYMBOL.test(rest))
            return text;
    } else {
        return text;
    }

    amount = amount.replace(/,/g, '');
    if (!rest.trim())
        return code === home ? `${amount} ${code}` : `${amount} ${code} to ${home}`;
    return `${amount} ${code}${rest.replace(TARGET_SYMBOL, (_m, sep, s) => sep + symbolCode(s, home))}`;
}

// Regions whose currency has ECB rates; the rest fall back to USD.
const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK';
const REGION_CURRENCY = {
    ...Object.fromEntries(EURO.split(' ').map(region => [region, 'EUR'])),
    AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY', CZ: 'CZK', DK: 'DKK', GB: 'GBP',
    HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IS: 'ISK', JP: 'JPY', KR: 'KRW',
    MX: 'MXN', MY: 'MYR', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON', SE: 'SEK',
    SG: 'SGD', TH: 'THB', TR: 'TRY', US: 'USD', ZA: 'ZAR',
};

/**
 * @param {string[]} languageNames - GLib.get_language_names()
 * @returns {string} the currency of the locale's region (en_PH -> PHP), or USD
 */
export function homeCurrency(languageNames) {
    const region = /^[a-z]{2,3}_([A-Z]{2})/.exec(languageNames[0] ?? '')?.[1];
    return REGION_CURRENCY[region] ?? 'USD';
}
