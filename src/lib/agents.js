// SPDX-License-Identifier: GPL-3.0-or-later
//
// AI agent CLIs and terminals, as argv arrays. No shell is involved: the
// prompt is always exactly one argv element. No gi:// imports, so tests run
// under plain gjs.

/**
 * A prompt with no whitespace could equal a subcommand name ("update",
 * "login"), which some CLIs dispatch even after `--`. A trailing space
 * makes it a plain prompt.
 *
 * @param {string} prompt
 * @returns {string}
 */
function guardWord(prompt) {
    return /\s/.test(prompt) ? prompt : `${prompt} `;
}

export const AGENTS = {
    claude: {
        name: 'Claude Code',
        command: 'claude',
        // `--` keeps a prompt starting with "-" from being read as a flag.
        promptArgs: prompt => ['--', guardWord(prompt)],
    },
    codex: {
        name: 'Codex',
        command: 'codex',
        promptArgs: prompt => ['--', guardWord(prompt)],
    },
    agy: {
        name: 'agy',
        command: 'agy',
        // A string flag: as its value the prompt is never a flag or subcommand.
        promptArgs: prompt => [`--prompt-interactive=${prompt}`],
    },
};

/**
 * @param {string} id - a key of AGENTS
 * @param {string} path - absolute path of the agent's executable
 * @param {string} prompt - may be empty: the agent then starts without one
 * @returns {string[]}
 */
export function agentArgv(id, path, prompt) {
    return prompt ? [path, ...AGENTS[id].promptArgs(prompt)] : [path];
}

/** Terminals that run the argv after these arguments, in a new window. */
const KNOWN_TERMINALS = [
    ['ptyxis', '--new-window', '--'],
    ['kgx', '--'],
    ['gnome-terminal', '--'],
    ['konsole', '-e'],
    ['kitty'],
    ['alacritty', '-e'],
    ['foot'],
    ['wezterm', 'start', '--'],
    ['xterm', '-e'],
];

/**
 * Argv that runs a typed line in the user's shell, so its aliases and
 * functions work ("ff" in fish), then leaves that shell open so the
 * output can be read.
 *
 * @param {string|null} shell - $SHELL
 * @param {string} line - kept as typed, one argv element
 * @returns {string[]}
 */
export function shellLineArgv(shell, line) {
    switch (shell?.split('/').pop()) {
    case 'fish':
        // -C runs the line after config.fish, then shows the prompt.
        return [shell, '-C', line];
    case 'bash':
    case 'zsh':
        // -i loads the rc file, where aliases live; $0 is the shell.
        return [shell, '-i', '-c', 'eval "$1"; exec "$0"', shell, line];
    default:
        return ['/bin/sh', '-c', 'eval "$1"; exec "${SHELL:-/bin/sh}"', 'sh', line];
    }
}

/**
 * Pick the terminal command prefix: the user's override, then
 * xdg-terminal-exec, then GNOME's default-applications setting, then known
 * terminals. The first whose program exists wins.
 *
 * @param {object} params
 * @param {string[]|null} params.override - parsed prefs override, if any
 * @param {string[]|null} params.desktopDefault - [exec, exec-arg], if set
 * @param {(program: string) => string|null} params.findProgram - absolute
 *   path of a program on PATH, or null
 * @returns {string[]|null} prefix with argv[0] made absolute, or null
 */
export function terminalPrefix({override, desktopDefault, findProgram}) {
    const candidates = [
        override,
        ['xdg-terminal-exec'],
        desktopDefault,
        ...KNOWN_TERMINALS,
    ];
    for (const candidate of candidates) {
        if (!candidate?.length || !candidate[0])
            continue;
        const path = findProgram(candidate[0]);
        if (path)
            return [path, ...candidate.slice(1).filter(arg => arg !== '')];
    }
    return null;
}
