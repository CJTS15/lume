// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/devtools.test.js   (or `make test`)

import System from 'system';

import {base64Decode, base64Encode, checksum, parseColor, timestamp, uuid} from '../src/lib/devtools.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

check('uuid v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid()), true);
check('uuid differs', uuid() !== uuid(), true);

check('base64 encode', base64Encode('hello'), 'aGVsbG8=');
check('base64 utf-8', base64Encode('café ☕'), 'Y2Fmw6kg4piV');
check('base64 decode', base64Decode('aGVsbG8='), 'hello');
check('base64 decode utf-8', base64Decode('Y2Fmw6kg4piV'), 'café ☕');
check('base64 decode spaces', base64Decode(' aGVs bG8= '), 'hello');
check('base64 decode invalid chars', base64Decode('not base64!'), null);
check('base64 decode bad length', base64Decode('abc'), null);
check('base64 decode binary', base64Decode('/w=='), null);
check('base64 decode empty', base64Decode(''), null);

check('sha256', checksum('sha256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('md5', checksum('md5', 'abc'), '900150983cd24fb0d6963f7d28e17f72');
check('unknown checksum', checksum('crc', 'abc'), null);

check('hex', parseColor('#ff8800'), {hex: '#ff8800', rgb: 'rgb(255, 136, 0)'});
check('short hex', parseColor('#F80'), {hex: '#ff8800', rgb: 'rgb(255, 136, 0)'});
check('rgb', parseColor('rgb(255, 136, 0)'), {hex: '#ff8800', rgb: 'rgb(255, 136, 0)'});
check('rgb no spaces', parseColor('rgb(0,0,0)'), {hex: '#000000', rgb: 'rgb(0, 0, 0)'});
check('rgb out of range', parseColor('rgb(300, 0, 0)'), null);
check('bad hex', parseColor('#ggg'), null);
check('hex without #', parseColor('ff8800'), null);
check('css injection', parseColor('#fff; color: red'), null);

const now = 1794542554;
const ts = t => timestamp(t, now, 'UTC');
check('unix now', ts('unix'), {seconds: now, iso: '2026-11-13 04:02:34 UTC'});
check('timestamp now', ts('timestamp'), {seconds: now, iso: '2026-11-13 04:02:34 UTC'});
check('seconds', ts('1731456000'), {seconds: 1731456000, iso: '2024-11-13 00:00:00 UTC'});
check('milliseconds', ts('1731456000123'), {seconds: 1731456000.123, iso: '2024-11-13 00:00:00 UTC'});
check('short number', ts('42'), null);
check('11 digits', ts('17314560001'), null);
check('words', ts('unix time please'), null);

if (failures > 0) {
    print(`${failures} devtools test(s) failed`);
    System.exit(1);
}
print('devtools: all tests passed');
