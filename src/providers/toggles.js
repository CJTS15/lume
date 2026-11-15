// SPDX-License-Identifier: GPL-3.0-or-later
//
// Quick toggles: Dark Style, Night Light, Do Not Disturb, sound and
// microphone mute, Bluetooth, and the power mode. The row says what Enter
// will do ("Turn On Night Light") and the current state. Hardware uses the
// same services as the Shell's quick settings.

import Gio from 'gi://Gio';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {keywordScore} from '../lib/match.js';
import {Provider} from '../lib/provider.js';

const MIN_QUERY_LENGTH = 2;
// Every word must match ("night light", "dark mode"); one stray word is
// not enough ("light mode" must not offer Night Light).
const MIN_MATCH = 0.75;
// N_ marks strings for translation; they are translated when used.
const N_ = s => s;

const TOGGLES = [{
    id: 'dark-style',
    name: N_('Dark Style'),
    keywords: ['dark', 'theme', 'mode', 'style', 'appearance'],
    // "light mode" only makes sense as a way to turn dark style off.
    keywordsWhenOn: ['light'],
    icon: 'dark-mode-symbolic',
    schema: 'org.gnome.desktop.interface',
    isOn: settings => settings.get_string('color-scheme') === 'prefer-dark',
    set: (settings, on) => settings.set_string('color-scheme', on ? 'prefer-dark' : 'default'),
}, {
    id: 'night-light',
    name: N_('Night Light'),
    keywords: ['night', 'light', 'blue', 'warm', 'redshift'],
    icon: 'night-light-symbolic',
    schema: 'org.gnome.settings-daemon.plugins.color',
    isOn: settings => settings.get_boolean('night-light-enabled'),
    set: (settings, on) => settings.set_boolean('night-light-enabled', on),
}, {
    id: 'do-not-disturb',
    name: N_('Do Not Disturb'),
    keywords: ['dnd', 'notifications', 'notification', 'focus', 'quiet', 'silence'],
    icon: 'notifications-disabled-symbolic',
    schema: 'org.gnome.desktop.notifications',
    isOn: settings => !settings.get_boolean('show-banners'),
    set: (settings, on) => settings.set_boolean('show-banners', !on),
}];

// power-profiles-daemon: the UPower name since 0.20, net.hadess before
// (GNOME 45's Fedora 39).
const PROFILE_SERVICES = [
    ['org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles'],
    ['net.hadess.PowerProfiles', '/net/hadess/PowerProfiles'],
];
const PROFILES = {
    'performance': {name: N_('Performance'), icon: 'power-profile-performance-symbolic'},
    'balanced': {name: N_('Balanced'), icon: 'power-profile-balanced-symbolic'},
    'power-saver': {name: N_('Power Saver'), icon: 'power-profile-power-saver-symbolic'},
};
const PROFILE_KEYWORDS = ['power', 'mode', 'profile', 'battery', 'energy'];

const profilesInterface = name => `<node><interface name="${name}">
<property name="ActiveProfile" type="s" access="readwrite"/>
<property name="Profiles" type="aa{sv}" access="read"/>
</interface></node>`;

export class TogglesProvider extends Provider {
    constructor() {
        super({id: 'toggles', name: _('Quick Toggles'), label: _('Toggle')});
        const source = Gio.SettingsSchemaSource.get_default();
        // A missing schema would abort gnome-shell, so look before creating.
        this._toggles = TOGGLES
            .filter(toggle => source?.lookup(toggle.schema, true))
            .map(toggle => {
                const settings = new Gio.Settings({schema_id: toggle.schema});
                return {
                    ...toggle,
                    isOn: () => toggle.isOn(settings),
                    set: on => toggle.set(settings, on),
                };
            });
        this._destroyed = false;
        this._addSound();
        this._addBluetooth();
        this._connectProfiles(0);
    }

    _addSound() {
        // The Shell's own mixer, already open for the volume menu.
        const mixer = Volume.getMixerControl();
        for (const [id, name, keywords, icon, stream] of [
            ['mute-sound', N_('Sound'), ['mute', 'volume', 'audio', 'speaker', 'speakers'],
                'audio-volume-muted-symbolic', () => mixer.get_default_sink()],
            ['mute-microphone', N_('Microphone'), ['mute', 'mic', 'input', 'audio'],
                'microphone-disabled-symbolic', () => mixer.get_default_source()],
        ]) {
            this._toggles.push({
                id, name, keywords, icon,
                available: () => Boolean(stream()),
                isOn: () => stream().is_muted,
                set: on => stream().change_is_muted(on),
                // TRANSLATORS: %s is "Sound" or "Microphone"
                title: on => (on ? _('Unmute %s') : _('Mute %s')).format(_(name)),
                subtitle: on => on ? _('Currently muted') : _('Currently not muted'),
            });
        }
    }

    _addBluetooth() {
        this._bluetooth = new GnomeBluetooth.Client();
        // gsd-rfkill holds the Bluetooth switch, as for the Shell's toggle.
        const info = Gio.DBusInterfaceInfo.new_for_xml(loadInterfaceXML('org.gnome.SettingsDaemon.Rfkill'));
        this._rfkill = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: 'org.gnome.SettingsDaemon.Rfkill',
            g_object_path: '/org/gnome/SettingsDaemon/Rfkill',
            g_interface_name: info.name,
            g_interface_info: info,
        });
        this._rfkill.init_async(0, null).catch(e => console.debug(`lume: no rfkill service: ${e.message}`));
        this._toggles.push({
            id: 'bluetooth',
            name: N_('Bluetooth'),
            keywords: ['bt', 'wireless', 'headphones', 'devices'],
            icon: 'bluetooth-active-symbolic',
            // A hardware switch can't be turned back on from software.
            available: () => this._bluetooth.default_adapter_state !== GnomeBluetooth.AdapterState.ABSENT &&
                Boolean(this._rfkill.BluetoothHasAirplaneMode) && !this._rfkill.BluetoothHardwareAirplaneMode,
            isOn: () => this._bluetooth.default_adapter_powered,
            set: on => {
                this._rfkill.BluetoothAirplaneMode = !on;
                if (on && !this._bluetooth.default_adapter_powered)
                    this._bluetooth.default_adapter_powered = true;
            },
        });
    }

    _connectProfiles(index) {
        const [name, path] = PROFILE_SERVICES[index] ?? [];
        if (!name)
            return;
        const ProfilesProxy = Gio.DBusProxy.makeProxyWrapper(profilesInterface(name));
        new ProfilesProxy(Gio.DBus.system, name, path, (proxy, error) => {
            if (this._destroyed)
                return;
            if (!error && proxy.g_name_owner)
                this._profiles = proxy;
            else
                this._connectProfiles(index + 1);
        });
    }

    query(text) {
        if (text.length < MIN_QUERY_LENGTH)
            return [];

        return [...this._toggles
            .filter(toggle => toggle.available?.() ?? true)
            .map(toggle => {
                const on = toggle.isOn();
                const keywords = on ? [...toggle.keywords, ...toggle.keywordsWhenOn ?? []] : toggle.keywords;
                return {toggle, on, match: keywordScore(_(toggle.name), keywords, text)};
            })
            .filter(({match}) => match >= MIN_MATCH)
            .map(({toggle, on, match}) => {
                const name = _(toggle.name);
                return {
                    id: toggle.id,
                    // TRANSLATORS: %s is a setting, e.g. "Night Light"
                    title: toggle.title?.(on) ?? (on ? _('Turn Off %s').format(name) : _('Turn On %s').format(name)),
                    subtitle: toggle.subtitle?.(on) ?? (on ? _('Currently on') : _('Currently off')),
                    icon: toggle.icon,
                    score: 0.6 + 0.26 * match,
                    activate: () => toggle.set(!on),
                };
            }), ...this._profileRows(text)];
    }

    /** One row per power mode the daemon offers, matched by its name. */
    _profileRows(text) {
        const active = this._profiles?.ActiveProfile;
        if (!active)
            return [];
        return (this._profiles.Profiles ?? [])
            .map(profile => profile.Profile?.unpack())
            .filter(id => PROFILES[id])
            .map(id => ({id, match: keywordScore(_(PROFILES[id].name), PROFILE_KEYWORDS, text)}))
            .filter(({match}) => match >= MIN_MATCH)
            .map(({id, match}) => ({
                id: `power-${id}`,
                // TRANSLATORS: %s is a power mode, e.g. "Power Saver"
                title: _('Power Mode: %s').format(_(PROFILES[id].name)),
                subtitle: id === active ? _('Current power mode') : _('Enter to switch'),
                icon: PROFILES[id].icon,
                score: 0.6 + 0.26 * match,
                activate: () => {
                    this._profiles.ActiveProfile = id;
                },
            }));
    }

    destroy() {
        this._destroyed = true;
        this._profiles = null;
        this._bluetooth = null;
        this._rfkill = null;
    }
}
