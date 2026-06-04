/**
 * System Health Monitor - GNOME Shell Extension
 * Tracks AMD GPU (VRAM, temp, power), CPU (clock, usage, temp), RAM, and load.
 * Click the panel indicator to toggle individual metrics.
 *
 * GNOME Shell 47-50 (ESM / GJS)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const UPDATE_INTERVAL_SECONDS = 2;

// ---------------------------------------------------------------------------
// Sysfs helpers
// ---------------------------------------------------------------------------

const _decoder = new TextDecoder('utf-8');

/** Read a sysfs/procfs file, return trimmed string or null on failure. */
function sysRead(path) {
    try {
        const [ok, data] = GLib.file_get_contents(path);
        if (ok) return _decoder.decode(data).trim();
    } catch (_) {}
    return null;
}

/** Read a sysfs file as integer, or null. */
function sysReadInt(path) {
    const val = sysRead(path);
    if (val === null) return null;
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Hardware discovery
// ---------------------------------------------------------------------------

/**
 * Find the first AMD GPU with VRAM and power monitoring.
 * Returns { cardPath, hwmonPath } or null.
 */
function findGpuPaths() {
    for (let card = 0; card <= 5; card++) {
        const cardPath = `/sys/class/drm/card${card}/device`;
        if (!GLib.file_test(`${cardPath}/mem_info_vram_total`, GLib.FileTest.EXISTS))
            continue;
        for (let hw = 0; hw <= 9; hw++) {
            const hwmonPath = `${cardPath}/hwmon/hwmon${hw}`;
            if (GLib.file_test(`${hwmonPath}/power1_average`, GLib.FileTest.EXISTS))
                return { cardPath, hwmonPath };
        }
    }
    return null;
}

/**
 * Find the hwmon path for the CPU temperature sensor (k10temp / zenpower / coretemp).
 * Returns path string or null.
 */
function findCpuTempPath() {
    for (let i = 0; i <= 19; i++) {
        const path = `/sys/class/hwmon/hwmon${i}`;
        const name = sysRead(`${path}/name`);
        if (name === 'k10temp' || name === 'zenpower' || name === 'coretemp')
            return path;
    }
    return null;
}

/** Format a byte-per-second rate as a compact human-readable string. */
function _fmtBytes(bps) {
    if (bps >= 1073741824) return `${(bps / 1073741824).toFixed(1)}GB`;
    if (bps >= 1048576)    return `${(bps / 1048576).toFixed(1)}MB`;
    if (bps >= 1024)       return `${(bps / 1024).toFixed(0)}KB`;
    return `${Math.round(bps)}B`;
}

// ---------------------------------------------------------------------------
// Metric definitions (order determines display order in panel and menu)
// ---------------------------------------------------------------------------

const METRICS_DEF = [
    { id: 'cpu_clock', label: 'Clock',        key: 'show-cpu-clock', group: 'CPU'     },
    { id: 'cpu_temp',  label: 'Temperature',  key: 'show-cpu-temp',  group: 'CPU'     },
    { id: 'cpu_usage', label: 'Usage',        key: 'show-cpu-usage', group: 'CPU'     },
    { id: 'gpu_clock', label: 'Clock',        key: 'show-gpu-clock', group: 'GPU'     },
    { id: 'gpu_vram',  label: 'VRAM',         key: 'show-gpu-vram',  group: 'GPU'     },
    { id: 'gpu_temp',  label: 'Temperature',  key: 'show-gpu-temp',  group: 'GPU'     },
    { id: 'gpu_usage', label: 'Usage',        key: 'show-gpu-usage', group: 'GPU'     },
    { id: 'gpu_power', label: 'Power',        key: 'show-gpu-power', group: 'GPU'     },
    { id: 'ram_usage', label: 'Usage',        key: 'show-ram-usage', group: 'Memory'  },
    { id: 'load_1m',   label: '1 min',        key: 'show-load-1m',   group: 'System'  },
    { id: 'net_rx',    label: 'Download',     key: 'show-net-rx',    group: 'Network' },
    { id: 'net_tx',    label: 'Upload',       key: 'show-net-tx',    group: 'Network' },
];

// ---------------------------------------------------------------------------
// Custom sensor menu item  (icon + label left, monospace value right)
// ---------------------------------------------------------------------------

const SensorMenuItem = GObject.registerClass({
    Signals: {
        'sensor-toggled': { param_types: [GObject.TYPE_BOOLEAN] },
    },
}, class SensorMenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(label, value, active) {
        super._init({ reactive: true });
        this._active = active;
        this._updateOrnament();

        this._labelActor = new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._labelActor);

        this._valueLabel = new St.Label({
            text: value,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-health-value',
        });
        this._valueLabel.set_x_align(Clutter.ActorAlign.END);
        this._valueLabel.set_x_expand(true);
        this.add_child(this._valueLabel);
    }

    // Toggle active state on click without closing the menu
    activate(_event) {
        this._active = !this._active;
        this._updateOrnament();
        this.emit('sensor-toggled', this._active);
    }

    setActive(active) {
        if (this._active !== active) {
            this._active = active;
            this._updateOrnament();
        }
    }

    setValue(text) {
        this._valueLabel.text = text;
    }

    // Expose label widget (used by PopupMenu internals for focus)
    get label() {
        return this._labelActor;
    }

    _updateOrnament() {
        this.setOrnament(this._active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }
});

// ---------------------------------------------------------------------------
// Panel indicator
// ---------------------------------------------------------------------------

const SysHealthIndicator = GObject.registerClass(
class SysHealthIndicator extends PanelMenu.Button {

    _init(settings) {
        super._init(0.0, 'System Health Monitor');

        this._settings = settings;
        this._gpuPaths = findGpuPaths();
        this._cpuTempPath = findCpuTempPath();
        this._prevCpuStats = null;   // [totalTime, idleTime]
        this._prevNetStats = null;   // { rx, tx, ts } totals across interfaces
        this._menuItems = {};        // id → PopupSwitchMenuItem
        this._topSubmenus = {};      // id → PopupSubMenuMenuItem (top-5 procs)
        this._metrics = {};          // latest readings cache
        this._settingsHandlerIds = [];

        // Panel label
        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px;',
        });
        this.add_child(this._label);

        // Build dropdown menu with per-metric toggles
        this._buildMenu();

        // Connect GSettings change signals to keep check states and panel in sync
        for (const def of METRICS_DEF) {
            const id = this._settings.connect(`changed::${def.key}`, () => {
                const item = this._menuItems[def.id];
                if (item)
                    item.setActive(this._settings.get_boolean(def.key));
                this._updatePanelLabel();
            });
            this._settingsHandlerIds.push(id);
        }

        // First update immediately, then on interval
        this._update();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            UPDATE_INTERVAL_SECONDS,
            () => { this._update(); return GLib.SOURCE_CONTINUE; }
        );
    }

    // -----------------------------------------------------------------------
    // Menu
    // -----------------------------------------------------------------------

    _buildMenu() {
        // Title row
        const headerItem = new PopupMenu.PopupMenuItem('System Health Monitor', { reactive: false });
        headerItem.label.set_style('font-weight: bold; padding: 2px 0;');
        this.menu.addMenuItem(headerItem);

        const TOP_SUBTITLES = {
            cpu_usage: 'Top CPU Processes',
            gpu_vram:  'Top VRAM Processes',
            ram_usage: 'Top RAM Processes',
        };

        let lastGroup = null;
        for (const def of METRICS_DEF) {
            // Emit a labelled separator whenever the group changes
            if (def.group !== lastGroup) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(def.group));
                lastGroup = def.group;
            }

            const active = this._settings.get_boolean(def.key);
            const item = new SensorMenuItem(def.label, '…', active);
            item.connect('sensor-toggled', (_item, state) => {
                this._settings.set_boolean(def.key, state);
                this._updatePanelLabel();
            });
            this._menuItems[def.id] = item;
            this.menu.addMenuItem(item);

            // Top-process sub-menu after the relevant toggle
            if (def.id in TOP_SUBTITLES) {
                const sub = new PopupMenu.PopupSubMenuMenuItem(TOP_SUBTITLES[def.id]);
                sub.label.set_style('font-size: 11px;');
                for (let i = 0; i < 5; i++) {
                    const entry = new PopupMenu.PopupMenuItem('—', { reactive: false });
                    entry.label.set_style_class_name('system-health-process-row');
                    sub.menu.addMenuItem(entry);
                }
                this._topSubmenus[def.id] = sub;
                this.menu.addMenuItem(sub);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Top-5 process helpers
    // -----------------------------------------------------------------------

    _runScript(script, callback) {
        try {
            const proc = new Gio.Subprocess({
                argv: ['python3', '-c', script],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    const [, stdout] = _proc.communicate_utf8_finish(res);
                    if (stdout) callback(stdout.trim());
                } catch (_) {}
            });
        } catch (_) {}
    }

    _updateTopSubmenu(id, stdout, unit) {
        const sub = this._topSubmenus[id];
        if (!sub) return;
        const items = sub.menu._getMenuItems();
        const lines = stdout.split('\n').filter(l => l.includes(':'));
        for (let i = 0; i < 5; i++) {
            if (!items[i]) break;
            if (i < lines.length) {
                const colon = lines[i].lastIndexOf(':');
                const name = lines[i].slice(0, colon).slice(0, 18).padEnd(18);
                const raw  = parseFloat(lines[i].slice(colon + 1));
                let val;
                if (unit === 'KB') {
                    val = raw >= 1048576 ? `${(raw / 1048576).toFixed(1)} GB`
                        : raw >= 1024    ? `${(raw / 1024).toFixed(0)} MB`
                        : `${raw} KB`;
                } else {
                    val = `${raw.toFixed(1)}%`;
                }
                items[i].label.text = `${name}  ${val}`;
            } else {
                items[i].label.text = '—';
            }
        }
    }

    _refreshTopProcesses() {
        // Top VRAM consumers (reads drm-memory-vram from /proc/*/fdinfo)
        this._runScript(
            'import os,re,collections\n' +
            'totals=collections.defaultdict(int)\nnames={}\n' +
            'for pid in os.listdir("/proc"):\n' +
            '    if not pid.isdigit():continue\n' +
            '    fdpath="/proc/"+pid+"/fdinfo"\n' +
            '    try:\n' +
            '        for fd in os.listdir(fdpath):\n' +
            '            try:\n' +
            '                txt=open(fdpath+"/"+fd).read()\n' +
            '                m=re.search(r"drm-memory-vram:\\s+(\\d+)",txt)\n' +
            '                if m:totals[pid]+=int(m.group(1))\n' +
            '            except:pass\n' +
            '        if pid in totals:names[pid]=open("/proc/"+pid+"/comm").read().strip()\n' +
            '    except:pass\n' +
            'for pid,kb in sorted(totals.items(),key=lambda x:-x[1])[:5]:\n' +
            '    if kb>0:print(names.get(pid,"?")+":"+str(kb))\n',
            stdout => this._updateTopSubmenu('gpu_vram', stdout, 'KB')
        );

        // Top RAM consumers (VmRSS from /proc/*/status)
        this._runScript(
            'import os,re\n' +
            'procs=[]\n' +
            'for pid in os.listdir("/proc"):\n' +
            '    if not pid.isdigit():continue\n' +
            '    try:\n' +
            '        txt=open("/proc/"+pid+"/status").read()\n' +
            '        n=re.search(r"Name:\\s*(\\S+)",txt)\n' +
            '        m=re.search(r"VmRSS:\\s*(\\d+)",txt)\n' +
            '        if n and m:procs.append((n.group(1),int(m.group(1))))\n' +
            '    except:pass\n' +
            'for name,kb in sorted(procs,key=lambda x:-x[1])[:5]:\n' +
            '    print(name+":"+str(kb))\n',
            stdout => this._updateTopSubmenu('ram_usage', stdout, 'KB')
        );

        // Top CPU consumers (lifetime % from /proc/*/stat)
        this._runScript(
            'import os\n' +
            'hz=os.sysconf("SC_CLK_TCK")\n' +
            'up=float(open("/proc/uptime").read().split()[0])\n' +
            'procs=[]\n' +
            'for pid in os.listdir("/proc"):\n' +
            '    if not pid.isdigit():continue\n' +
            '    try:\n' +
            '        s=open("/proc/"+pid+"/stat").read().split()\n' +
            '        comm=open("/proc/"+pid+"/comm").read().strip()\n' +
            '        t=(int(s[13])+int(s[14]))/hz\n' +
            '        el=up-int(s[21])/hz\n' +
            '        if el>0:procs.append((comm,100*t/el))\n' +
            '    except:pass\n' +
            'for name,pct in sorted(procs,key=lambda x:-x[1])[:5]:\n' +
            '    print(name+":"+("%.1f"%pct))\n',
            stdout => this._updateTopSubmenu('cpu_usage', stdout, '%')
        );
    }

    // -----------------------------------------------------------------------
    // Reading metrics
    // -----------------------------------------------------------------------

    _readCpuUsage() {
        const content = sysRead('/proc/stat');
        if (!content) return null;

        // First line: "cpu  user nice system idle iowait irq softirq steal ..."
        const firstLine = content.split('\n')[0];
        const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
        if (parts.length < 8) return null;

        const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
        const totalIdle = idle + iowait;
        const total = user + nice + system + idle + iowait + irq + softirq + steal;

        let usage = null;
        if (this._prevCpuStats) {
            const [prevTotal, prevIdle] = this._prevCpuStats;
            const deltaTotal = total - prevTotal;
            const deltaIdle = totalIdle - prevIdle;
            if (deltaTotal > 0)
                usage = Math.round((1 - deltaIdle / deltaTotal) * 100);
        }

        this._prevCpuStats = [total, totalIdle];
        return usage;
    }

    _readCpuClockKHz() {
        let total = 0, count = 0;
        for (let i = 0; i < 64; i++) {
            const freq = sysReadInt(
                `/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`
            );
            if (freq === null) break;
            if (freq > 0) { total += freq; count++; }
        }
        return count > 0 ? total / count : null;
    }

    _readMetrics() {
        const m = {};

        // --- GPU ---
        if (this._gpuPaths) {
            const { cardPath, hwmonPath } = this._gpuPaths;

            // VRAM
            const vramUsedB  = sysReadInt(`${cardPath}/mem_info_vram_used`);
            const vramTotalB = sysReadInt(`${cardPath}/mem_info_vram_total`);
            if (vramUsedB !== null && vramTotalB !== null) {
                const usedGB  = vramUsedB  / 1073741824;
                const totalGB = vramTotalB / 1073741824;
                m.gpu_vram_short = `${usedGB.toFixed(1)}/${totalGB.toFixed(1)}GB`;
                m.gpu_vram_long  = `${usedGB.toFixed(1)} / ${totalGB.toFixed(1)} GB`;
            }

            // Clock (sclk = freq1_input, in Hz)
            const gpuClockHz = sysReadInt(`${hwmonPath}/freq1_input`);
            if (gpuClockHz !== null) {
                const mhz = gpuClockHz / 1e6;
                m.gpu_clock_short = `${Math.round(mhz)}MHz`;
                m.gpu_clock_long  = `${mhz.toFixed(0)} MHz`;
            }

            // Temperature (edge = temp1)
            const gpuTempRaw = sysReadInt(`${hwmonPath}/temp1_input`);
            if (gpuTempRaw !== null) {
                const gpuTempC = gpuTempRaw / 1000;
                m.gpu_temp_short = `${Math.round(gpuTempC)}°C`;
                m.gpu_temp_long  = `${gpuTempC.toFixed(1)} °C`;
            }

            // Usage (busy percent)
            const gpuBusy = sysReadInt(`${cardPath}/gpu_busy_percent`);
            if (gpuBusy !== null) {
                m.gpu_usage_short = `${gpuBusy}%`;
                m.gpu_usage_long  = `${gpuBusy} %`;
            }

            // Power current (average) and cap
            const powerNowUW = sysReadInt(`${hwmonPath}/power1_average`);
            const powerCapUW = sysReadInt(`${hwmonPath}/power1_cap`);
            if (powerNowUW !== null && powerCapUW !== null) {
                const nowW = powerNowUW / 1e6;
                const capW = powerCapUW / 1e6;
                m.gpu_power_short = `${Math.round(nowW)}/${Math.round(capW)}W`;
                m.gpu_power_long  = `${nowW.toFixed(0)} W / ${capW.toFixed(0)} W cap`;
            }
        }

        // --- CPU clock ---
        const cpuClockKHz = this._readCpuClockKHz();
        if (cpuClockKHz !== null) {
            const ghz = cpuClockKHz / 1e6;
            m.cpu_clock_short = `${ghz.toFixed(2)}GHz`;
            m.cpu_clock_long  = `${ghz.toFixed(3)} GHz`;
        }

        // --- CPU usage ---
        const cpuUsage = this._readCpuUsage();
        if (cpuUsage !== null) {
            m.cpu_usage_short = `${cpuUsage}%`;
            m.cpu_usage_long  = `${cpuUsage} %`;
        }

        // --- CPU temperature ---
        if (this._cpuTempPath) {
            const tempRaw = sysReadInt(`${this._cpuTempPath}/temp1_input`);
            if (tempRaw !== null) {
                const tempC = tempRaw / 1000;
                m.cpu_temp_short = `${Math.round(tempC)}°C`;
                m.cpu_temp_long  = `${tempC.toFixed(1)} °C`;
            }
        }

        // --- RAM ---
        const meminfo = sysRead('/proc/meminfo');
        if (meminfo) {
            const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
            const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
            if (totalMatch && availMatch) {
                const usedGB  = (parseInt(totalMatch[1]) - parseInt(availMatch[1])) / 1048576;
                const totalGB = parseInt(totalMatch[1]) / 1048576;
                m.ram_usage_short = `${usedGB.toFixed(1)}/${totalGB.toFixed(1)}GB`;
                m.ram_usage_long  = `${usedGB.toFixed(1)} / ${totalGB.toFixed(1)} GB`;
            }
        }

        // --- Load 1m ---
        const loadavg = sysRead('/proc/loadavg');
        if (loadavg) {
            const load1m = parseFloat(loadavg.split(' ')[0]);
            if (Number.isFinite(load1m)) {
                m.load_1m_short = load1m.toFixed(2);
                m.load_1m_long  = load1m.toFixed(2);
            }
        }

        // --- Network RX / TX ---
        const netDev = sysRead('/proc/net/dev');
        if (netDev) {
            let totalRx = 0, totalTx = 0;
            for (const line of netDev.split('\n').slice(2)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 10) continue;
                const iface = parts[0].replace(':', '');
                if (iface === 'lo') continue;
                totalRx += parseInt(parts[1],  10) || 0;  // receive bytes
                totalTx += parseInt(parts[9],  10) || 0;  // transmit bytes
            }
            const now = GLib.get_monotonic_time() / 1e6; // seconds
            if (this._prevNetStats) {
                const dt = now - this._prevNetStats.ts;
                if (dt > 0) {
                    const rxRate = (totalRx - this._prevNetStats.rx) / dt;
                    const txRate = (totalTx - this._prevNetStats.tx) / dt;
                    m.net_rx_short = _fmtBytes(rxRate) + '/s';
                    m.net_rx_long  = _fmtBytes(rxRate) + '/s';
                    m.net_tx_short = _fmtBytes(txRate) + '/s';
                    m.net_tx_long  = _fmtBytes(txRate) + '/s';
                }
            }
            this._prevNetStats = { rx: totalRx, tx: totalTx, ts: now };
        }

        return m;
    }

    // -----------------------------------------------------------------------
    // Update cycle
    // -----------------------------------------------------------------------

    _update() {
        const m = this._readMetrics();
        this._metrics = m;

        // Update the right-hand value label of each sensor row
        const menuValues = {
            cpu_clock: m.cpu_clock_long  ?? '–',
            cpu_temp:  m.cpu_temp_long   ?? '–',
            cpu_usage: m.cpu_usage_long  ?? '–',
            gpu_clock: m.gpu_clock_long  ?? '–',
            gpu_vram:  m.gpu_vram_long   ?? '–',
            gpu_temp:  m.gpu_temp_long   ?? '–',
            gpu_usage: m.gpu_usage_long  ?? '–',
            gpu_power: m.gpu_power_long  ?? '–',
            ram_usage: m.ram_usage_long  ?? '–',
            load_1m:   m.load_1m_long    ?? '–',
            net_rx:    m.net_rx_long     ?? '–',
            net_tx:    m.net_tx_long     ?? '–',
        };

        for (const def of METRICS_DEF) {
            const item = this._menuItems[def.id];
            if (item) item.setValue(menuValues[def.id]);
        }

        this._updatePanelLabel();
        this._refreshTopProcesses();
    }

    _updatePanelLabel() {
        const m = this._metrics;
        const show = key => this._settings.get_boolean(key);
        const parts = [];

        // CPU group
        const cpuParts = [];
        if (show('show-cpu-clock') && m.cpu_clock_short) cpuParts.push(m.cpu_clock_short);
        if (show('show-cpu-temp')  && m.cpu_temp_short)  cpuParts.push(m.cpu_temp_short);
        if (show('show-cpu-usage') && m.cpu_usage_short) cpuParts.push(m.cpu_usage_short);
        if (cpuParts.length) parts.push(`CPU: ${cpuParts.join(' ')}`);

        // GPU group
        const gpuParts = [];
        if (show('show-gpu-clock') && m.gpu_clock_short) gpuParts.push(m.gpu_clock_short);
        if (show('show-gpu-vram')  && m.gpu_vram_short)  gpuParts.push(m.gpu_vram_short);
        if (show('show-gpu-temp')  && m.gpu_temp_short)  gpuParts.push(m.gpu_temp_short);
        if (show('show-gpu-usage') && m.gpu_usage_short) gpuParts.push(m.gpu_usage_short);
        if (show('show-gpu-power') && m.gpu_power_short) gpuParts.push(m.gpu_power_short);
        if (gpuParts.length) parts.push(`GPU: ${gpuParts.join(' ')}`);

        // RAM
        if (show('show-ram-usage') && m.ram_usage_short) parts.push(`RAM: ${m.ram_usage_short}`);

        // Load
        if (show('show-load-1m') && m.load_1m_short) parts.push(`L: ${m.load_1m_short}`);

        // Network (combine into one token when both visible)
        const netParts = [];
        if (show('show-net-rx') && m.net_rx_short) netParts.push(`↓${m.net_rx_short}`);
        if (show('show-net-tx') && m.net_tx_short) netParts.push(`↑${m.net_tx_short}`);
        if (netParts.length) parts.push(netParts.join(' '));

        this._label.set_text(parts.length > 0 ? parts.join(' | ') : '…');
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        for (const id of this._settingsHandlerIds)
            this._settings.disconnect(id);
        this._settingsHandlerIds = [];
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default class SystemHealthExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new SysHealthIndicator(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
