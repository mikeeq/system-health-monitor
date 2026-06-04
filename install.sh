#!/usr/bin/env bash
# install.sh — Install the system-health@mikee GNOME extension
# Run this script from the gnome-health-view/ directory (or any location).

set -euo pipefail

UUID="system-health-monitor@mikeeq.github.io"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="${HOME}/.local/share/gnome-shell/extensions"
TARGET="${EXTENSIONS_DIR}/${UUID}"

echo ">>> Installing ${UUID} ..."

# 1. Compile GSettings schema into the extension schemas/ directory
echo "    Compiling GSettings schema ..."
glib-compile-schemas "${SCRIPT_DIR}/schemas/"

# 2. Create or update the symlink (development-friendly: edits are live)
mkdir -p "${EXTENSIONS_DIR}"
if [[ -L "${TARGET}" ]]; then
    echo "    Updating symlink: ${TARGET} -> ${SCRIPT_DIR}"
    ln -sfn "${SCRIPT_DIR}" "${TARGET}"
elif [[ -d "${TARGET}" ]]; then
    echo "    WARNING: ${TARGET} already exists as a real directory."
    echo "    Remove it first if you want to replace it with a symlink:"
    echo "      rm -rf '${TARGET}'"
    exit 1
else
    echo "    Creating symlink: ${TARGET} -> ${SCRIPT_DIR}"
    ln -s "${SCRIPT_DIR}" "${TARGET}"
fi

# 3. Enable the extension (gnome-extensions CLI)
echo "    Enabling extension ..."
gnome-extensions enable "${UUID}" 2>/dev/null || true

echo ""
echo ">>> Done!"
echo ""
echo "    If GNOME Shell does not pick up the extension immediately, reload it:"
echo "      Alt+F2 → type 'r' → Enter    (Xorg only)"
echo "    or log out and back in (Wayland)."
echo ""
echo "    To disable:   gnome-extensions disable ${UUID}"
echo "    To uninstall: rm '${TARGET}' && gnome-extensions disable ${UUID}"
