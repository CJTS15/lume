#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Headless smoke test: starts a throwaway gnome-shell with its own config,
# data, cache and state directories (your dconf is never touched), enables
# Lume, cycles disable/enable, opens the search window (a search, a folder,
# the action list, the preview), opens the preferences, and fails on JS
# errors or a Shell crash.
#
# Run with: make smoke
# LUME_SRC=<dir> tests it on another copy, such as the unpacked release zip.

set -u
UUID=lume@cjts15.github.io
# Turns on Eval in the test Shell only; see its extension.js.
HELPER=lume-smoke-helper@cjts15.github.io

if [ -z "${LUME_SMOKE_DIR:-}" ]; then
    src=$(realpath "${LUME_SRC:-$(dirname "$0")/../src}")
    tmp=$(mktemp -d)
    # Removes only the temp dir; the symlinks inside it are not followed.
    trap 'rm -rf -- "$tmp"' EXIT
    mkdir -p "$tmp/data/gnome-shell/extensions"
    ln -s "$src" "$tmp/data/gnome-shell/extensions/$UUID"
    ln -s "$(realpath "$(dirname "$0")")/$HELPER" "$tmp/data/gnome-shell/extensions/$HELPER"

    XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data \
    XDG_CACHE_HOME=$tmp/cache XDG_STATE_HOME=$tmp/state \
    LUME_SMOKE_DIR=$tmp timeout --kill-after=10 300 dbus-run-session -- "$0" > "$tmp/session.log" 2>&1
    status=$?
    [ "$status" -eq 124 ] && echo "smoke: timed out after 300 s" >&2

    # Shell crashes, JS errors and unhandled rejections, Lume's own log
    # lines, and warnings from the prefs process. Ignored: GJS's own
    # property notes and the missing a11y bus.
    if grep -E 'Bail out!|core dumped|JS ERROR|Gjs-CRITICAL|Unhandled promise rejection|lume: |Extensions:[0-9]+\): (Gtk|Adw|Gjs)-(WARNING|CRITICAL)' "$tmp/session.log" |
        grep -vE 'Falling back to slow path|accessibility bus' >&2; then
        echo "smoke: errors or warnings above" >&2
        status=1
    fi
    if [ "$status" -ne 0 ]; then
        echo "smoke: FAILED; full log:" >&2
        cat "$tmp/session.log" >&2
        exit 1
    fi
    echo "smoke: passed ($(gnome-shell --version))"
    exit 0
fi

# Inside dbus-run-session.
gnome-shell --headless --virtual-monitor 1280x800 &
pid=$!
trap 'kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null' EXIT

for _ in $(seq 40); do
    gdbus introspect --session -d org.gnome.Shell -o /org/gnome/Shell >/dev/null 2>&1 && break
    sleep 0.5
done

gsettings set org.gnome.shell disable-user-extensions false
gnome-extensions enable "$UUID" || exit 1
sleep 3

for _ in 1 2 3 4 5; do
    gnome-extensions disable "$UUID"
    sleep 0.4
    gnome-extensions enable "$UUID"
    sleep 0.4
done
sleep 1

# ACTIVE on GNOME 46+, ENABLED on 45.
state=$(gnome-extensions info "$UUID" | grep -E '^ *State:')
echo "smoke-state:$state"
grep -qE 'ACTIVE|ENABLED' <<<"$state" || exit 1

# The search window, through its own methods (no input devices, which
# differ between versions). Errors it logs are caught by the grep outside.
gnome-extensions enable "$HELPER" || exit 1
sleep 1
window="const w = Main.extensionManager.lookup('$UUID').stateObj._window;"
step() {
    local out
    out=$(gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval "$window $2" 2>&1)
    echo "smoke-window:$1:$out"
    [[ $out == "(true,"* ]] || exit 1
}
step search "w.open(); w._entry.text = 'set'; 'ok'"
sleep 2
step folder "w._entry.text = '~/'; 'ok'"
sleep 2
step rows "String(w._rows.length)"
step actions "w._toggleActions(); w._toggleActions(); 'ok'"
sleep 0.5
step preview "w._togglePreview(); 'ok'"
sleep 1
step close "w._togglePreview(); w.close(); 'ok'"
sleep 0.5

gnome-extensions prefs "$UUID" || exit 1
sleep 4
