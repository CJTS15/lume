// SPDX-License-Identifier: GPL-3.0-or-later
//
// Unit conversion: "10 km to mi", "5 ft in cm", "cup to qt",
// "100 kph -> mph", "32 F to C". No gi:// imports, so tests run under
// plain gjs.

// [category, factor to the category's base unit, names...]. The first name
// is the symbol shown in results. Names are matched without case, so they
// must be unique across categories. US customary volumes.
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

const UNITS = new Map();
for (const [category, factor, ...names] of LINEAR_UNITS) {
    const unit = {category, symbol: names[0], toBase: v => v * factor, fromBase: v => v / factor};
    for (const name of names)
        UNITS.set(name.toLowerCase(), unit);
}
for (const [{toKelvin, fromKelvin}, ...names] of TEMPERATURES) {
    const unit = {category: 'temperature', symbol: names[0], toBase: toKelvin, fromBase: fromKelvin};
    for (const name of names)
        UNITS.set(name.toLowerCase(), unit);
}

/**
 * @param {string} name
 * @returns {object|undefined}
 */
function lookup(name) {
    const key = name.toLowerCase().replace('²', '2').replace('³', '3').replace(/^°(?=[cf]$)/, '');
    // Plurals: "cups", "miles", "kilometers".
    return UNITS.get(key) ?? (key.length > 3 && key.endsWith('s') ? UNITS.get(key.slice(0, -1)) : undefined);
}

// [amount] unit (to|in|into|as|->) unit. The amount is optional ("cup to
// qt" converts 1 cup). The source unit may follow the number directly
// ("32F to C").
const PATTERN = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)?\s*([^\s\d.-]\S*?)\s*(?:\s(?:to|in|into|as)\s|->)\s*(\S+)\s*$/i;

/**
 * Parse and convert a conversion query.
 *
 * @param {string} text
 * @returns {{amount: number, value: number, from: string, to: string}|null}
 *   from/to are display symbols; null if `text` is not a conversion between
 *   two known units of the same category
 */
export function convert(text) {
    const match = PATTERN.exec(text);
    if (!match)
        return null;

    const amount = match[1] === undefined ? 1 : parseFloat(match[1]);
    const from = lookup(match[2]);
    const to = lookup(match[3]);
    if (!from || !to || from.category !== to.category || !Number.isFinite(amount))
        return null;

    const value = to.fromBase(from.toBase(amount));
    return Number.isFinite(value) ? {amount, value, from: from.symbol, to: to.symbol} : null;
}
