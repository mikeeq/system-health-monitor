/**
 * System Health Monitor - Preferences
 * Allows toggling individual metrics from the GNOME Extensions manager.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const METRIC_ROWS = [
    { key: 'show-cpu-clock', title: 'CPU Clock',          subtitle: 'Average CPU clock frequency (GHz)' },
    { key: 'show-cpu-temp',  title: 'CPU Temperature',    subtitle: 'CPU Tctl temperature (°C)' },
    { key: 'show-cpu-usage', title: 'CPU Usage',          subtitle: 'Total CPU utilisation (%)' },
    { key: 'show-gpu-clock', title: 'GPU Clock',          subtitle: 'AMD GPU shader clock sclk (MHz)' },
    { key: 'show-gpu-vram',  title: 'GPU VRAM',           subtitle: 'AMD GPU VRAM used / total (GB)' },
    { key: 'show-gpu-temp',  title: 'GPU Temperature',    subtitle: 'AMD GPU edge temperature (°C)' },
    { key: 'show-gpu-usage', title: 'GPU Usage',          subtitle: 'AMD GPU busy percentage (%)' },
    { key: 'show-gpu-power', title: 'GPU Power',          subtitle: 'AMD GPU power draw / cap (W)' },
    { key: 'show-ram-usage', title: 'RAM Usage',          subtitle: 'RAM used / total (GB)' },
    { key: 'show-load-1m',   title: '1-Minute Load',      subtitle: 'System load average over 1 minute' },
    { key: 'show-net-rx',    title: 'Network Download',    subtitle: 'Total receive speed across all interfaces' },
    { key: 'show-net-tx',    title: 'Network Upload',      subtitle: 'Total transmit speed across all interfaces' },
];

export default class SystemHealthPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Metrics'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Visible Metrics'),
            description: _('Choose which metrics appear in the top bar. You can also toggle them by clicking the panel indicator.'),
        });
        page.add(group);

        for (const row of METRIC_ROWS) {
            const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            settings.bind(row.key, toggle, 'active', 0 /* GET | SET */);

            const adwRow = new Adw.ActionRow({
                title: _(row.title),
                subtitle: _(row.subtitle),
                activatable_widget: toggle,
            });
            adwRow.add_suffix(toggle);
            group.add(adwRow);
        }
    }
}
