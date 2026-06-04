# System Health Monitor — GNOME Shell Extension

A GNOME Shell extension that displays AMD GPU and CPU metrics, RAM usage, system load, and network speeds directly in the top bar. Each metric can be toggled on/off by clicking the panel indicator or via the GNOME Extensions preferences window.

## Metrics

| Group | Metrics |
|-------|---------|
| **CPU** | Clock (avg GHz), Temperature (Tctl °C), Usage (%) |
| **GPU** | Clock (sclk MHz), VRAM used/total (GB), Temperature (edge °C), Usage (%), Power draw/cap (W) |
| **System** | RAM used/total (GB), 1-minute load average |
| **Network** | Download speed (↓), Upload speed (↑) — auto-scaled B/KB/MB/GB per second |

Metrics are read directly from `/sys` and `/proc` — no external tools required.

## Requirements

- Fedora 44 / GNOME Shell 47–50
- AMD GPU with `amdgpu` kernel driver (ROCm not required)
- `k10temp` or `zenpower` kernel module loaded for CPU temperature

## Installation

```bash
bash install.sh
```

Then **log out and back in** (Wayland) or press `Alt+F2 → r → Enter` (Xorg) to reload GNOME Shell.

To uninstall:

```bash
gnome-extensions disable system-health-monitor@mikeeq.github.io
rm ~/.local/share/gnome-shell/extensions/system-health-monitor@mikeeq.github.io
```

## Building

### Locally (requires `glib2-devel`, `nodejs`, `zip`)

```bash
bash build.sh
# → dist/system-health-monitor@mikeeq.github.io.zip
```

### Via Docker (recommended — no host deps needed)

```bash
bash docker-build.sh
# → dist/system-health-monitor@mikeeq.github.io.zip
```

The `Dockerfile` is based on Fedora 44 and contains only the build dependencies. The source directory is mounted into the container; the `dist/` output is written directly on the host.

## Testing

To test the extension in an isolated nested GNOME Shell session without touching your running desktop:

```bash
dbus-run-session gnome-shell --devkit --wayland
```

This spawns a self-contained Wayland compositor in a new window. Extensions installed under `~/.local/share/gnome-shell/extensions/` are picked up automatically. Check the Looking Glass console (`Alt+F2 → lg`) or the journal for errors:

```bash
journalctl /usr/bin/gnome-shell -f
```

## Publishing to GNOME Extensions (EGO)

1. Build the zip: `bash docker-build.sh`
2. Go to <https://extensions.gnome.org/upload/>
3. Upload `dist/system-health-monitor@mikeeq.github.io.zip`
4. The EGO team reviews submissions within 1–7 days

For subsequent releases, push a version tag — the release workflow builds and attaches the zip to a GitHub Release automatically:

```bash
git tag v2
git push --tags
```

## Development

Pre-commit hooks (requires `pre-commit`):

```bash
pre-commit install
```

Hooks run: trailing-whitespace/EOL fixes, JSON/YAML/XML validation, shellcheck, JS syntax checks, GSettings schema compilation.
