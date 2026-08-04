#!/usr/bin/env bash
# Prepare squircle-masked PNG, then build build/icon.icns for A.L.B.E.R.T.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "${ROOT}/scripts/render-icon.py"
python3 "${ROOT}/scripts/prepare-icon.py"

SRC="${ROOT}/build/icon.png"
DEST="${ROOT}/build/icon.iconset"
OUT="${ROOT}/build/icon.icns"

rm -rf "$DEST"
mkdir -p "$DEST"

# sips mishandles @2x filenames; write plain temps then cp
TMP="${ROOT}/build/_icon_sizes"
rm -rf "$TMP"
mkdir -p "$TMP"

for px in 16 32 64 128 256 512 1024; do
  # Preserve alpha
  sips -s format png -z "$px" "$px" "$SRC" --out "${TMP}/${px}.png" >/dev/null
done

cp "${TMP}/16.png"   "${DEST}/icon_16x16.png"
cp "${TMP}/32.png"   "${DEST}/icon_16x16@2x.png"
cp "${TMP}/32.png"   "${DEST}/icon_32x32.png"
cp "${TMP}/64.png"   "${DEST}/icon_32x32@2x.png"
cp "${TMP}/128.png"  "${DEST}/icon_128x128.png"
cp "${TMP}/256.png"  "${DEST}/icon_128x128@2x.png"
cp "${TMP}/256.png"  "${DEST}/icon_256x256.png"
cp "${TMP}/512.png"  "${DEST}/icon_256x256@2x.png"
cp "${TMP}/512.png"  "${DEST}/icon_512x512.png"
cp "${TMP}/1024.png" "${DEST}/icon_512x512@2x.png"

echo "Iconset contents:"
ls -1 "$DEST"

iconutil -c icns "$DEST" -o "$OUT"
rm -rf "$DEST" "$TMP"

echo "Wrote $OUT"
file "$OUT"
sips -g hasAlpha "$SRC"
