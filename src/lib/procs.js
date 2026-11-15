// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reading /proc/PID/stat (proc(5)). No gi:// imports, so tests run under
// plain gjs.
// ponytail: assumes 100 clock ticks per second and 4 KiB pages, true on
// every Linux desktop Lume runs on; GJS has no sysconf().

export const CLOCK_TICKS = 100;
export const PAGE_SIZE = 4096;

/**
 * @typedef {object} Stat
 * @property {number} pid
 * @property {string} comm - the kernel's short name (15 characters)
 * @property {string} state - "R", "S", "Z", …
 * @property {number} ppid
 * @property {number} ticks - user + system CPU time, in clock ticks
 * @property {number} start - start time after boot, in clock ticks; with
 *   the pid, identifies the process (pids are reused)
 * @property {number} rss - resident memory, in bytes
 */

/**
 * @param {string} text - the contents of /proc/PID/stat
 * @returns {Stat|null}
 */
export function parseStat(text) {
    // comm is in parentheses and may itself hold spaces and ")": split at
    // the first "(" and the last ")".
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open < 0 || close < open)
        return null;
    const fields = text.slice(close + 2).trim().split(/\s+/);
    if (fields.length < 22)
        return null;
    // fields[0] is field 3 of proc(5).
    const stat = {
        pid: Number(text.slice(0, open)),
        comm: text.slice(open + 1, close),
        state: fields[0],
        ppid: Number(fields[1]),
        ticks: Number(fields[11]) + Number(fields[12]),
        start: Number(fields[19]),
        rss: Number(fields[21]) * PAGE_SIZE,
    };
    return [stat.pid, stat.ppid, stat.ticks, stat.start, stat.rss].every(Number.isFinite) ? stat : null;
}

/**
 * @param {string} cmdline - /proc/PID/cmdline: arguments ending in NUL
 * @returns {string[]}
 */
export function parseCmdline(cmdline) {
    return cmdline.split('\0').filter(arg => arg !== '');
}

/**
 * CPU use between two samples of the same process, as a percentage of one
 * core (a busy two-thread process can show 200).
 *
 * @param {number} ticksBefore
 * @param {number} ticksNow
 * @param {number} seconds - between the samples
 * @returns {number}
 */
export function cpuPercent(ticksBefore, ticksNow, seconds) {
    return seconds > 0 ? Math.max(0, (ticksNow - ticksBefore) / CLOCK_TICKS / seconds * 100) : 0;
}

/**
 * The pid and every ancestor's, as far as `parents` knows them.
 *
 * @param {number} pid
 * @param {Map<number, number>} parents - pid -> parent pid
 * @returns {Set<number>}
 */
export function withAncestors(pid, parents) {
    const pids = new Set();
    while (pid > 0 && !pids.has(pid)) {
        pids.add(pid);
        pid = parents.get(pid) ?? 0;
    }
    return pids;
}
