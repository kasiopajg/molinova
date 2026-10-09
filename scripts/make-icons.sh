#!/bin/sh
# pnpm icons — build/icon.svg → build/icon.png (1024) + build/icon.icns ; build/trayTemplate.svg → trayTemplate.png (18 px) et @2x (36 px).
# Rendu SVG : l'Electron du projet (scripts/render-svg.mjs), car qlmanage pose un fond blanc opaque — inutilisable pour
# les coins d'une icône et pour une image « template ». Puis sips et iconutil, livrés avec macOS.
set -eu
cd "$(dirname "$0")/.."
BUILD=build
ELECTRON=node_modules/.bin/electron
TMP=$(mktemp -d "${TMPDIR:-/tmp}/molinova-icons.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

"$ELECTRON" scripts/render-svg.mjs "$BUILD/icon.svg" 1024 "$BUILD/icon.png"
"$ELECTRON" scripts/render-svg.mjs "$BUILD/trayTemplate.svg" 18 "$BUILD/trayTemplate.png"
"$ELECTRON" scripts/render-svg.mjs "$BUILD/trayTemplate.svg" 36 "$BUILD/trayTemplate@2x.png"

ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$BUILD/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$BUILD/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"

ls -l "$BUILD/icon.png" "$BUILD/icon.icns" "$BUILD/trayTemplate.png" "$BUILD/trayTemplate@2x.png"
