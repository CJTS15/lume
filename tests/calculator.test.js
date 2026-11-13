// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/calculator.test.js   (or `make test`)

import System from 'system';

import {evaluate, formatResult} from '../src/lib/calculator.js';

let failures = 0;

function check(input, expected) {
    const value = evaluate(input);
    const actual = value === null ? null : formatResult(value);
    if (actual !== expected) {
        failures++;
        print(`FAIL ${JSON.stringify(input)}: expected ${expected}, got ${actual}`);
    }
}

// Arithmetic and precedence
check('1+2', '3');
check('2+3*4', '14');
check('(2+3)*4', '20');
check('10/4', '2.5');
check('10 % 3', '1');
check('0.1+0.2', '0.3');
check('2^10', '1024');
check('2**3', '8');
check('2^3^2', '512');
check('-2^2', '-4');
check('2^-1', '0.5');
check('--3', '3');
check('3 × 4 ÷ 2', '6');
check('.5*2', '1');
check('1e3+1', '1001');
check('2+2=', '4');

// Functions and constants
check('sqrt(16)', '4');
check('sqrt(2)', '1.41421356237');
check('2*pi', '6.28318530718');
check('cos(0)', '1');
check('ln(e)', '1');
check('log(1000)', '3');
check('abs(-5)+1', '6');
check('log10(1000)', '3');
check('log2(8)', '3');
check('4 + 3 * 8', '28');

// Implicit multiplication
check('2pi', '6.28318530718');
check('2(3+4)', '14');
check('(2)(3)', '6');
check('2sqrt(9)', '6');
check('2pi^2', '19.7392088022');
check('-2pi', '-6.28318530718');
check('3(2)^2', '12');

// More functions
check('round(2.5)', '3');
check('round(-2.5)', '-3');
check('rint(2.5)', '2');
check('rint(3.5)', '4');
check('fact(5)', '120');
check('fact(0)', '1');
check('rad(180)', '3.14159265359');
check('deg(pi)', '180');
check('sind(30)', '0.5');
check('cosd(60)', '0.5');
check('sind(180)', '0');
check('asind(0.5)', '30');
check('atand(1)', '45');
check('sinh(0)', '0');
check('acosh(1)', '0');
check('pow(2, 10)', '1024');
check('fmod(7, 3)', '1');
check('fmod(-7, 3)', '-1');
check('hypot(3, 4)', '5');
check('min(3, 1, 2)', '1');
check('max(3, 1, 2)', '3');

// Not a calculation: no row should appear
check('42', null);
check('pi', null);
check('(5)', null);
check('firefox', null);
check('pref', null);
check('2+', null);
check('(1+2', null);
check('1+2)', null);
check('sqrt 4', null);
check('1/0', null);
check('sqrt(-1)', null);
check('', null);
check('alert(1)', null);
check('constructor(1)', null);
check('2 3', null);
check('fact(2.5)', null);
check('fact(171)', null);
check('pow(2)', null);
check('sqrt(1, 2)', null);
check('min()', null);
check('10 km to mi', null);
check('192.168.1.1', null);
check('1+'.repeat(150), null);
check(`${'('.repeat(60)}1${')'.repeat(60)}+1`, null);

if (failures > 0) {
    print(`${failures} calculator test(s) failed`);
    System.exit(1);
}
print('calculator: all tests passed');
