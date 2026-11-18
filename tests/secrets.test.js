// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/secrets.test.js   (or `make test`)

import System from 'system';

import {looksPrivate, looksSecret} from '../src/lib/secrets.js';

let failures = 0;

function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// Built at run time so the test file itself never looks like it holds keys.
const repeat = (s, n) => s.repeat(n);

// Secrets: skipped by clipboard history.
check('GitHub token', looksSecret(`ghp_${repeat('a1B2', 9)}`), true);
check('GitHub token in a line', looksSecret(`export GH_TOKEN=gho_${repeat('Z9', 18)}`), true);
check('GitHub fine-grained token', looksSecret(`github_pat_${repeat('A1_b', 6)}`), true);
check('AWS access key', looksSecret(`AKIA${repeat('ABCD2345', 2)}`), true);
check('Slack token', looksSecret(`xoxb-${repeat('1234-', 3)}abcdef`), true);
check('JWT', looksSecret(`eyJ${repeat('hbGciOi', 2)}.eyJ${repeat('zdWIiOi', 2)}.${repeat('SflKxwRJ', 2)}`), true);
check('private key', looksSecret('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n'), true);
check('RSA private key', looksSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
check('AI API key', looksSecret(`sk-ant-api03-${repeat('xY7_', 8)}`), true);
check('OpenAI-style key', looksSecret(`sk-proj-${repeat('Ab3d', 8)}`), true);
check('card number', looksSecret('4111 1111 1111 1111'), true);
check('card number with dashes', looksSecret('5500-0000-0000-0004'), true);

// Not secrets: kept.
check('plain text', looksSecret('meeting at 3pm in room 4'), false);
check('public key', looksSecret('-----BEGIN PUBLIC KEY-----'), false);
check('short sk- word', looksSecret('sk-learn is a library'), false);
check('ghp_ too short', looksSecret('ghp_abc'), false);
check('failing Luhn', looksSecret('4111 1111 1111 1112'), false);
check('phone number', looksSecret('+63 912 345 6789'), false);
check('card number inside text', looksSecret('order 4111111111111111 shipped'), false);
// Passes Luhn, but card numbers start with 2–6 and millisecond timestamps with 1.
check('millisecond timestamp', looksSecret('1794560000009'), false);
check('JWT-like words', looksSecret('eyJ.eyJ.x'), false);
check('empty', looksSecret(''), false);

check('.env', looksPrivate('.env', 0o644), true);
check('.env.local', looksPrivate('.env.local', 0o644), true);
check('.netrc', looksPrivate('.netrc', 0o644), true);
check('.pgpass', looksPrivate('.pgpass', 0o644), true);
check('aws credentials', looksPrivate('credentials', 0o644), true);
check('gcloud credentials file', looksPrivate('application_default_credentials.json', 0o644), true);
check('owner-only file', looksPrivate('notes.txt', 0o600), true);
check('owner-only, group can write', looksPrivate('notes.txt', 0o620), true);
check('readable file', looksPrivate('notes.txt', 0o644), false);
check('group-readable file', looksPrivate('notes.txt', 0o640), false);
check('environment.md', looksPrivate('environment.md', 0o644), false);
check('.envrc', looksPrivate('.envrc', 0o644), false);

if (failures > 0) {
    print(`${failures} secrets test(s) failed`);
    System.exit(1);
}
print('secrets: all tests passed');
