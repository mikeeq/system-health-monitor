#!/usr/bin/env bash
# docker-build.sh — Build the extension zip inside Docker.
# The source directory is mounted into the container; dist/ is written
# directly on the host. No files are copied into the image.
#
# Usage:
#   ./docker-build.sh        → build image (if needed) then run build.sh

set -euo pipefail

IMAGE="gnome-health-build"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ">>> Building Docker image ..."
docker build -t "${IMAGE}" "${SCRIPT_DIR}"

echo ">>> Running build inside container (source mounted from host) ..."
docker run --rm \
    -v "${SCRIPT_DIR}:/build" \
    -w /build \
    "${IMAGE}" \
    bash build.sh

echo ">>> Artifacts written to ${SCRIPT_DIR}/dist/"
ls -lh "${SCRIPT_DIR}/dist/"
