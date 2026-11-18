// SPDX-License-Identifier: GPL-3.0-or-later
//
// Your running processes, behind "ps" or "kill": CPU and memory, busiest
// first. Enter ends the process (SIGTERM); Force Kill (SIGKILL) is under
// Ctrl+K and asks first. GNOME Shell, the processes it runs under and the
// session's own (gnome-session, the session bus) are never listed: ending
// them ends the session.
// Command lines are shown in the preview only and never logged; they can
// hold passwords.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {matchScore} from '../lib/match.js';
import {matchPrefix} from '../lib/prefix.js';
import {cpuPercent, isSessionProcess, parseCmdline, parseStat, withAncestors} from '../lib/procs.js';
import {Provider} from '../lib/provider.js';

// A sample this fresh is reused while typing a filter.
const REUSE_SECONDS = 1;
// CPU use is measured over this long when there is no recent sample.
const MEASURE_MS = 500;
const MAX_COMMAND = 500;
const ICON = 'utilities-system-monitor-symbolic';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

const decoder = new TextDecoder();

async function read(path) {
    const [contents] = await Gio.File.new_for_path(path).load_contents_async(null);
    return decoder.decode(contents);
}

/**
 * @typedef {object} Process
 * @property {import('../lib/procs.js').Stat} stat
 * @property {string[]} argv
 * @property {string} name
 * @property {number|null} cpu - percent of one core, null until measured
 */

export class ProcessesProvider extends Provider {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        super({id: 'processes', name: _('Processes'), label: _('Process')});
        this._settings = settings;
        const credentials = new Gio.Credentials();
        this._uid = credentials.get_unix_user();
        this._shellPid = credentials.get_unix_pid();
        /** @type {{time: number, processes: Map<number, Process>}|null} */
        this._sample = null;
        this._sampling = null;
        /** @type {{id: number, resolve: () => void}|null} */
        this._measuring = null;
        this._destroyed = false;
    }

    _filter(text) {
        return matchPrefix(text, this._settings.get_strv('prefix-processes'));
    }

    owns(text) {
        return this._filter(text) !== null;
    }

    scope(text) {
        return this.owns(text) ? _('Processes') : null;
    }

    async query(text, cancellable, update) {
        const filter = this._filter(text);
        if (filter === null)
            return [];

        const now = GLib.get_monotonic_time() / 1e6;
        let processes;
        if (this._sample && now - this._sample.time < REUSE_SECONDS) {
            processes = this._sample.processes;
        } else {
            const previous = this._sample;
            processes = await this._take(previous);
            if (cancellable.is_cancelled())
                return [];
            // No sample to compare with: show the list, measure, then refresh.
            if (!previous || now - previous.time > 10) {
                update(this._rows(processes, filter));
                await this._measure();
                if (cancellable.is_cancelled() || this._destroyed)
                    return [];
                processes = await this._take(this._sample);
            }
        }
        if (cancellable.is_cancelled())
            return [];
        return this._rows(processes, filter);
    }

    _rows(processes, filter) {
        const pid = /^\d+$/.test(filter) ? Number(filter) : null;
        return [...processes.values()]
            .map(process => ({
                process,
                match: !filter ? 1 : pid !== null ? Number(process.stat.pid === pid)
                    : Math.max(matchScore(process.name, filter), matchScore(process.stat.comm, filter)),
            }))
            .filter(({match}) => match >= 0.6)
            .sort((a, b) => b.match - a.match || (b.process.cpu ?? 0) - (a.process.cpu ?? 0) ||
                b.process.stat.rss - a.process.stat.rss)
            .slice(0, this._settings.get_int('max-results'))
            .map(({process}, index) => this._row(process, 0.99 - 0.001 * index));
    }

    _row({stat, argv, name, cpu}, score) {
        const memory = GLib.format_size(stat.rss);
        // TRANSLATORS: CPU use, e.g. "12.5%"
        const cpuText = cpu === null ? '…' : _('%s%%').format(cpu.toFixed(1));
        const end = () => this._signal(stat, name, 'TERM');
        const kill = () => this._signal(stat, name, 'KILL');
        return {
            id: `${stat.pid}:${stat.start}`,
            title: name,
            // TRANSLATORS: "PID 1234 · CPU 12.5% · 120 MB"
            subtitle: _('PID %d · CPU %s · %s').format(stat.pid, cpuText, memory),
            icon: ICON,
            score,
            activate: end,
            copy: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(stat.pid)),
            actions: [
                {label: _('End Process'), icon: 'process-stop-symbolic', run: end},
                {
                    label: _('Force Kill…'),
                    icon: 'dialog-warning-symbolic',
                    run: kill,
                    // TRANSLATORS: %s is a process name
                    confirm: _('Force kill %s? Unsaved work in it is lost.').format(name),
                },
                {
                    label: _('Copy PID'),
                    icon: 'edit-copy-symbolic',
                    run: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(stat.pid)),
                },
            ],
            preview: () => ({
                gicon: Gio.ThemedIcon.new(ICON),
                text: argv.join(' ').slice(0, MAX_COMMAND),
                rows: [[_('PID'), String(stat.pid)], [_('CPU'), cpuText], [_('Memory'), memory]],
            }),
        };
    }

    /**
     * Read your processes once; CPU use is measured against `previous`.
     *
     * @param {{time: number, processes: Map<number, Process>}|null} previous
     * @returns {Promise<Map<number, Process>>}
     */
    _take(previous) {
        this._sampling ??= this._read(previous).finally(() => {
            this._sampling = null;
        });
        return this._sampling;
    }

    async _read(previous) {
        const enumerator = await Gio.File.new_for_path('/proc').enumerate_children_async(
            'standard::name,unix::uid', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null);
        const pids = [];
        try {
            let infos;
            while ((infos = await enumerator.next_files_async(500, GLib.PRIORITY_DEFAULT, null)).length > 0) {
                for (const info of infos) {
                    if (/^\d+$/.test(info.get_name()) && info.get_attribute_uint32('unix::uid') === this._uid)
                        pids.push(info.get_name());
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
        const time = GLib.get_monotonic_time() / 1e6;
        const read_ = await Promise.all(pids.map(async pid => {
            try {
                const [stat, cmdline] = await Promise.all([read(`/proc/${pid}/stat`), read(`/proc/${pid}/cmdline`)]);
                return {stat: parseStat(stat), argv: parseCmdline(cmdline)};
            } catch {
                return null; // Ended while being read.
            }
        }));

        const all = read_.filter(p => p?.stat);
        const parents = new Map(all.map(({stat}) => [stat.pid, stat.ppid]));
        const hidden = withAncestors(this._shellPid, parents);
        const processes = new Map();
        for (const {stat, argv} of all) {
            // Kernel threads have no command line; zombies are already gone.
            if (hidden.has(stat.pid) || isSessionProcess(stat.comm) || argv.length === 0 || stat.state === 'Z')
                continue;
            const before = previous?.processes.get(stat.pid);
            // The program's file name, unless the process rewrote its command
            // line (Chromium and Electron helpers put every argument in one
            // string) or runs a script ("sh" for "./build"): then the
            // kernel's name, cut at 15 characters.
            const program = GLib.path_get_basename(argv[0]);
            processes.set(stat.pid, {
                stat, argv,
                name: !program.includes(' ') && program.startsWith(stat.comm) ? program : stat.comm,
                cpu: before?.stat.start === stat.start
                    ? cpuPercent(before.stat.ticks, stat.ticks, time - previous.time) : null,
            });
        }
        if (!this._destroyed)
            this._sample = {time, processes};
        return processes;
    }

    /** Resolve after MEASURE_MS, or at once on destroy. */
    _measure() {
        this._stopMeasuring();
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MEASURE_MS, () => {
                this._measuring = null;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._measuring = {id, resolve};
        });
    }

    _stopMeasuring() {
        if (!this._measuring)
            return;
        GLib.source_remove(this._measuring.id);
        this._measuring.resolve();
        this._measuring = null;
    }

    /** Send `signal`, unless the pid now belongs to another process. */
    async _signal(stat, name, signal) {
        try {
            const now = parseStat(await read(`/proc/${stat.pid}/stat`));
            if (now?.start !== stat.start)
                throw new Error('gone');
        } catch {
            Main.notify(_('%s has already ended').format(name));
            return;
        }
        try {
            // GJS has no kill(2); the pid and start time were checked above.
            const kill = Gio.Subprocess.new(['kill', '-s', signal, '--', String(stat.pid)],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            await kill.wait_check_async(null);
        } catch (e) {
            // TRANSLATORS: %s is a process name
            Main.notifyError(_('Could not end %s').format(name), e.message);
        }
        this._sample = null;
    }

    destroy() {
        this._destroyed = true;
        this._stopMeasuring();
        this._sample = null;
    }
}
