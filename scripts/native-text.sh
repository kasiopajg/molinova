#!/bin/sh
# pnpm native:text — compile l'assistant natif molinova-text (texte des PDF, OCR de macOS) dans build/native/darwin-<arch>/.
# Il part dans l'app via extraResources (electron-builder.yml) ; le serveur le trouve par MOLINOVA_TEXT_BIN, ou dans build/native en dev.
# Sans lui, Molinova fonctionne : les documents gardent leur nom, et la recherche passe par celle de Google.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARCH=$(uname -m)
OUT="$ROOT/build/native/darwin-$ARCH"
mkdir -p "$OUT"
swiftc -O -target "$ARCH-apple-macos13" "$ROOT/native/molinova-text/main.swift" -o "$OUT/molinova-text"
echo "molinova-text → $OUT/molinova-text"
