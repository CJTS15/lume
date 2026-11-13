// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/units.test.js   (or `make test`)

import System from 'system';

import {formatResult} from '../src/lib/calculator.js';
import {convert, needsRates} from '../src/lib/units.js';

let failures = 0;

function check(input, expected, context) {
    const result = convert(input, context);
    const actual = result && `${formatResult(result.amount)} ${result.from} = ${formatResult(result.value)} ${result.to}`;
    if (actual !== expected) {
        failures++;
        print(`FAIL ${JSON.stringify(input)}: expected ${expected}, got ${actual}`);
    }
}

// Examples from the README
check('10 km to mi', '10 km = 6.21371192237 mi');
check('5 ft in cm', '5 ft = 152.4 cm');
check('cup to qt', '1 cup = 0.25 qt');
check('100 kph -> mph', '100 km/h = 62.1371192237 mph');
check('32 F to C', '32 °F = 0 °C');

// Syntax
check('100 kph->mph', '100 km/h = 62.1371192237 mph');
check('32F to C', '32 °F = 0 °C');
check('10 in in cm', '10 in = 25.4 cm');
check('1 mile into km', '1 mi = 1.609344 km');
check('2 cups as ml', '2 cup = 473.176473 ml');
check('3 kilometers to m', '3 km = 3000 m');
check('-40 c to f', '-40 °C = -40 °F');
check('0 k to °c', '0 K = -273.15 °C');
check('1.5 h to min', '1.5 h = 90 min');

// Categories
check('1 kg to lb', '1 kg = 2.20462262185 lb');
check('1 gal to l', '1 gal = 3.785411784 l');
check('1 day to s', '1 d = 86400 s');
check('1 acre to m²', '1 ac = 4046.8564224 m2');
check('1 ha to sqft', '1 ha = 107639.104167 ft2');
check('1 GB to MB', '1 GB = 1000 MB');
check('1 GiB to MiB', '1 GiB = 1024 MiB');
check('1 gib to b', '1 GiB = 1073741824 B');
check('8 bit to b', '8 bit = 1 B');
check('1 kn to km/h', '1 kn = 1.852 km/h');

// Web units (CSS: 96 px per inch, 16 px per rem/em)
const viewport = {viewport: {width: 1920, height: 1080}};
check('16px to rem', '16 px = 1 rem');
check('1in to px', '1 in = 96 px');
check('12pt to px', '12 pt = 16 px');
check('2em in px', '2 em = 32 px');
check('1 pc to pt', '1 pc = 12 pt');
check('qt to pt', '1 qt = 2 pt');
check('1.5rem to px', '1.5 rem = 24 px');
check('50vh to px', '50 vh = 540 px', viewport);
check('10vw to px', '10 vw = 192 px', viewport);
check('10vmin to px', '10 vmin = 108 px', viewport);
check('10vmax to px', '10 vmax = 192 px', viewport);
check('1080px to vh', '1080 px = 100 vh', viewport);
check('50vh to px', null);

// Currency (rates per euro)
const rates = {rates: {EUR: 1, USD: 1.1, PHP: 64}};
check('100 eur to usd', '100 EUR = 110 USD', rates);
check('11 usd in eur', '11 USD = 10 EUR', rates);
check('1 usd to php', '1 USD = 58.1818181818 PHP', rates);
check('100 EUR -> PHP', '100 EUR = 6400 PHP', rates);
check('100 eur to usd', null);
check('100 eur to gbp', null, rates);
check('100 eur to km', null, rates);
const needs = (text, expected) => {
    if (needsRates(text) !== expected) {
        failures++;
        print(`FAIL needsRates(${JSON.stringify(text)}): expected ${expected}`);
    }
};
needs('100 eur to usd', true);
needs('usd to php', true);
needs('10 km to mi', false);
needs('100 eur to km', false);
needs('100 abc to usd', false);

// Not conversions
check('10 km to kg', null);
check('10 km to', null);
check('km', null);
check('10 foo to bar', null);
check('go to bed', null);
check('2 + 2', null);
check('weather in paris', null);

if (failures > 0) {
    print(`${failures} units test(s) failed`);
    System.exit(1);
}
print('units: all tests passed');
