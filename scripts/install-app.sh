#!/usr/bin/env bash
# Build A.L.B.E.R.T. and install/replace ~/Applications/ALBERT.app
# (Bundle folder must stay period-free — Electron Helper lookup breaks on dots.)
set -euo pipefail

RELAUNCH=0
for arg in "$@"; do
  case "$arg" in
    --relaunch) RELAUNCH=1 ;;
    --no-relaunch) RELAUNCH=0 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEST_DIR="${HOME}/Applications"
APP_NAME="ALBERT.app"
DEST="${DEST_DIR}/${APP_NAME}"
# Older Electron builds used a dotted bundle name under ~/Applications
DOTTED_DEST="${DEST_DIR}/A.L.B.E.R.T.app"
# Do NOT touch /Applications/A.L.B.E.R.T..app — that can be the iOS companion on Mac.

echo "==> Building A.L.B.E.R.T.…"
ELECTRON_RUN_AS_NODE= npm run build

echo "==> Packaging macOS app…"
# Electron Builder can reuse a partially renamed Electron.app after an interrupted
# packaging run. Remove only generated macOS staging folders before rebuilding.
if [[ -d "${ROOT}/dist" ]]; then
  find "${ROOT}/dist" -maxdepth 1 -type d -name 'mac*' -exec rm -rf {} +
fi
# `dir` is faster than dmg for local install loops
npx electron-builder --mac dir --publish never

BUILT="$(find "${ROOT}/dist/mac"* -maxdepth 1 -name 'ALBERT.app' -print -quit 2>/dev/null || true)"
if [[ -z "${BUILT}" ]]; then
  echo "ERROR: Could not find packaged ALBERT.app under dist/"
  find "${ROOT}/dist" -name '*.app' 2>/dev/null || true
  exit 1
fi

mkdir -p "${DEST_DIR}"

# Quit the packaged app only — never pkill a regex that can match this script.
if pgrep -f "ALBERT.app/Contents/MacOS/" >/dev/null 2>&1; then
  echo "==> Quitting running A.L.B.E.R.T.…"
  osascript -e 'tell application "ALBERT" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -f "ALBERT.app/Contents/MacOS/" >/dev/null 2>&1 || true
  sleep 1
fi

# Snapshot the outgoing bundle first — a bad build should never be one-way.
if [[ -d "${DEST}" ]]; then
  bash "${ROOT}/scripts/archive-app.sh" || echo "WARN: archive step failed; continuing install"
fi

echo "==> Installing to ${DEST}"
rm -rf "${DEST}" "${DOTTED_DEST}"
cp -R "${BUILT}" "${DEST}"

# Clear quarantine so first launch is less painful (still unsigned)
xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true

VERSION="$(node -p "require('./package.json').version")"
echo ""
echo "A.L.B.E.R.T. v${VERSION} installed:"
echo "  ${DEST}"
echo "  (Dock / Spotlight label: A.L.B.E.R.T.)"
echo ""
echo "Open with:  open \"${DEST}\""
echo ""
echo "While iterating: edit code, then run  npm run install:app  again."

if [[ "$RELAUNCH" == "1" ]]; then
  echo "==> Relaunching ${APP_NAME}…"
  open "${DEST}"
fi
