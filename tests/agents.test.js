// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run with: gjs -m tests/agents.test.js   (or `make test`)

import System from 'system';

import {agentArgv, shellLineArgv, terminalPrefix} from '../src/lib/agents.js';

let failures = 0;

function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        print(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// The prompt is always one argv element, never split or shell-parsed.
check('no prompt', agentArgv('claude', '/bin/claude', ''), ['/bin/claude']);
check('prompt', agentArgv('claude', '/bin/claude', 'explain this'), ['/bin/claude', '--', 'explain this']);
check('subcommand word', agentArgv('claude', '/bin/claude', 'update'), ['/bin/claude', '--', 'update ']);
check('codex subcommand word', agentArgv('codex', '/bin/codex', 'logout'), ['/bin/codex', '--', 'logout ']);
check('leading dash', agentArgv('codex', '/bin/codex', '-p foo'), ['/bin/codex', '--', '-p foo']);
check('shell metacharacters', agentArgv('claude', '/bin/claude', 'a; rm -rf ~ && $(id)'),
    ['/bin/claude', '--', 'a; rm -rf ~ && $(id)']);
check('quotes', agentArgv('claude', '/bin/claude', 'say "hi" it\'s'), ['/bin/claude', '--', 'say "hi" it\'s']);
check('agy value flag', agentArgv('agy', '/bin/agy', '-x update'), ['/bin/agy', '--prompt-interactive=-x update']);
check('agy no prompt', agentArgv('agy', '/bin/agy', ''), ['/bin/agy']);

const find = installed => program => (installed.includes(program) ? `/usr/bin/${program}` : null);

check('override wins', terminalPrefix({
    override: ['kitty', '--single-instance'],
    desktopDefault: ['gnome-terminal', '--'],
    findProgram: find(['kitty', 'ptyxis', 'xdg-terminal-exec']),
}), ['/usr/bin/kitty', '--single-instance']);
check('missing override falls through', terminalPrefix({
    override: ['nope'],
    desktopDefault: null,
    findProgram: find(['xdg-terminal-exec', 'ptyxis']),
}), ['/usr/bin/xdg-terminal-exec']);
check('desktop default needs its program', terminalPrefix({
    override: null,
    desktopDefault: ['xdg-terminal-exec', '--'],
    findProgram: find(['ptyxis']),
}), ['/usr/bin/ptyxis', '--new-window', '--']);
check('desktop default', terminalPrefix({
    override: null,
    desktopDefault: ['gnome-terminal', '--'],
    findProgram: find(['gnome-terminal', 'ptyxis']),
}), ['/usr/bin/gnome-terminal', '--']);
check('empty exec-arg dropped', terminalPrefix({
    override: null,
    desktopDefault: ['foot', ''],
    findProgram: find(['foot']),
}), ['/usr/bin/foot']);
check('none', terminalPrefix({override: null, desktopDefault: null, findProgram: find([])}), null);

check('fish runs the line after its config', shellLineArgv('/usr/bin/fish', 'ff'), ['/usr/bin/fish', '-C', 'ff']);
check('bash loads its rc file', shellLineArgv('/bin/bash', 'll -a'),
    ['/bin/bash', '-i', '-c', 'eval "$1"; exec "$0"', '/bin/bash', 'll -a']);
check('zsh too', shellLineArgv('/usr/bin/zsh', 'gs')[1], '-i');
check('other shells fall back to sh', shellLineArgv('/usr/bin/nu', 'ls'),
    ['/bin/sh', '-c', 'eval "$1"; exec "${SHELL:-/bin/sh}"', 'sh', 'ls']);
check('no SHELL', shellLineArgv(null, 'ls')[0], '/bin/sh');

if (failures > 0) {
    print(`${failures} agents test(s) failed`);
    System.exit(1);
}
print('agents: all tests passed');
