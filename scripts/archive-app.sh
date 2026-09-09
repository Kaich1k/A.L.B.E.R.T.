#!/usr/bin/env bash
# Snapshot the currently installed A.L.B.E.R.T. bundle before a risky upgrade.
# Keeps a dated copy under ~/Applications/.albert-backups/ so a bad build is
# always one `cp -R` away from being reverted.
set -euo pipefail

DEST_DIR="${HOME}/Applications"
APP_NAME="ALBERT.app"
SRC="${DEST_DIR}/${APP_NAME}"
BACKUP_DIR="${DEST_DIR}/.albert-backups"
# Keep this many historical bundles; older ones are pruned.
KEEP="${ALBERT_BACKUP_KEEP:-5}"

if [[ ! -d "${SRC}" ]]; then
  echo "No installed app at ${SRC} — nothing to archive."
  exit 0
fi

mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
# Bundle version if readable, else "unknown" — helps identify a snapshot later.
VERSION="$(/usr/bin/defaults read "${SRC}/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown)"
LABEL="ALBERT-${VERSION}-${STAMP}.app"
TARGET="${BACKUP_DIR}/${LABEL}"

echo "==> Archiving ${SRC}"
echo "    -> ${TARGET}"
cp -R "${SRC}" "${TARGET}"

# Dated sibling next to the live app so the pre-upgrade bundle is easy to find
# without digging through .albert-backups.
if [[ "${ALBERT_LEGACY_COPY:-1}" != "0" ]]; then
  LEGACY="${DEST_DIR}/ALBERT-legacy-$(date +%Y-%m-%d).app"
  if [[ ! -d "${LEGACY}" ]]; then
    echo "==> Dated snapshot ${LEGACY}"
    cp -R "${SRC}" "${LEGACY}"
  fi
fi

# Prune oldest snapshots beyond KEEP.
# shellcheck disable=SC2012
COUNT="$(ls -1d "${BACKUP_DIR}"/ALBERT-*.app 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${COUNT}" -gt "${KEEP}" ]]; then
  REMOVE="$((COUNT - KEEP))"
  echo "==> Pruning ${REMOVE} old snapshot(s) (keeping ${KEEP})"
  # shellcheck disable=SC2012
  ls -1dt "${BACKUP_DIR}"/ALBERT-*.app | tail -n "${REMOVE}" | while read -r old; do
    echo "    removing ${old}"
    rm -rf "${old}"
  done
fi

echo ""
echo "Archived snapshots:"
ls -1dt "${BACKUP_DIR}"/ALBERT-*.app 2>/dev/null || true
echo ""
echo "Restore with:"
echo "  rm -rf \"${SRC}\" && cp -R \"${TARGET}\" \"${SRC}\""
