// SPDX-License-Identifier: GPL-3.0-or-later
//
// ESLint for the extension's GJS code: `npm ci && npm run lint`.

import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            // What GJS and GNOME Shell provide.
            globals: {
                ...globals.es2021,
                global: 'readonly',
                imports: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
            },
        },
        plugins: {'@stylistic': stylistic},
        rules: {
            'no-unused-vars': ['error', {args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none'}],
            // As in GNOME Shell: a registerClass(class …) body is not indented
            // one more level, and case sits at the level of its switch.
            '@stylistic/indent': ['error', 4, {
                SwitchCase: 0,
                ignoredNodes: [
                    'CallExpression[callee.object.name=GObject][callee.property.name=registerClass] > ClassExpression:first-child',
                    'ConditionalExpression',
                ],
                MemberExpression: 'off',
            }],
            '@stylistic/no-multiple-empty-lines': ['error', {max: 1, maxEOF: 0}],
            '@stylistic/padded-blocks': ['error', 'never'],
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/eol-last': 'error',
            '@stylistic/semi': 'error',
            '@stylistic/quotes': ['error', 'single', {avoidEscape: true, allowTemplateLiterals: 'always'}],
        },
    },
];
