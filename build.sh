#!/usr/bin/env bash
# build.sh — Compile schema and produce a distributable .zip for EGO submission.
# Usage:
#   ./build.sh            → creates dist/system-health-monitor@mikeeq.github.io.zip
#   ./build.sh --install  → also installs into ~/.local/share/gnome-shell/extensions/

set -euo pipefail

UUID="system-health-monitor@mikeeq.github.io"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/dist"

# ---------------------------------------------------------------------------
# 1. Compile GSettings schema
# ---------------------------------------------------------------------------
echo ">>> Compiling GSettings schema ..."
glib-compile-schemas "${SCRIPT_DIR}/schemas/"

# ---------------------------------------------------------------------------
# 2. Package
# ---------------------------------------------------------------------------
mkdir -p "${DIST_DIR}"
ZIP="${DIST_DIR}/${UUID}.zip"

echo ">>> Creating ${ZIP} ..."
cd "${SCRIPT_DIR}"
zip -r "${ZIP}" \
    extension.js \
    prefs.js \
    metadata.json \
    schemas/ \
    --exclude "*.sh" \
    --exclude "dist/*" \
    --exclude ".git/*" \
    --exclude ".gitignore"

echo ">>> Package size: $(du -sh "${ZIP}" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. Optional: install locally
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--install" ]]; then
    TARGET="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
    echo ">>> Installing to ${TARGET} ..."
    rm -rf "${TARGET}"
    mkdir -p "${TARGET}"
    cd "${TARGET}"
    unzip -q "${ZIP}"
    echo ">>> Enabling ..."
    gnome-extensions enable "${UUID}" 2>/dev/null || true
    echo ">>> Done! Log out/in to activate on Wayland."
fi

echo ""
echo ">>> Build complete: ${ZIP}"
echo "    Submit this zip at https://extensions.gnome.org/upload/"
