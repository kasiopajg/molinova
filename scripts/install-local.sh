#!/bin/sh
# pnpm app:install — installe la dernière compilation (release/mac-arm64/Molinova.app) dans /Applications sur CE Mac.
# 1. quitte Molinova s'il tourne ; 2. garde une copie de la version installée ; 3. copie la nouvelle ;
# 4. la signe avec « Molinova Local Signing » si ce certificat existe (pnpm app:cert), sinon elle reste signée ad hoc ;
# 5. relance Molinova.
# Avec le certificat, macOS reconnaît la même app d'une version à l'autre : l'accès à « Molinova Safe Storage »
# (trousseau) n'est pas redemandé après chaque mise à jour.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/release/mac-arm64/Molinova.app"
DEST=/Applications/Molinova.app
NAME="Molinova Local Signing"
BACKUPS="${MOLINOVA_BACKUPS:-$HOME/Library/Application Support/Molinova Backups}"
[ -d "$SRC" ] || { echo "Pas de compilation : lance d'abord pnpm app:dist." >&2; exit 1; }

if pgrep -f "$DEST/Contents/MacOS/Molinova" >/dev/null; then
  osascript -e 'tell application "Molinova" to quit' >/dev/null 2>&1 || true
  i=0; while pgrep -f "$DEST/Contents/MacOS/Molinova" >/dev/null && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
fi
if [ -d "$DEST" ]; then
  mkdir -p "$BACKUPS"
  rm -rf "$BACKUPS/Molinova-previous.app"
  ditto "$DEST" "$BACKUPS/Molinova-previous.app"
  rm -rf "$DEST"
fi
ditto "$SRC" "$DEST"

HASH=$(security find-certificate -c "$NAME" -Z 2>/dev/null | awk '/SHA-1/ { print $3 }' | head -1)
if [ -n "$HASH" ]; then
  codesign --force --deep --sign "$HASH" "$DEST"
  echo "Signé avec « $NAME »."
else
  echo "Certificat « $NAME » absent : signature ad hoc (pnpm app:cert pour le créer)."
fi
codesign --verify --deep --strict "$DEST"
open -a "$DEST"
echo "Molinova installé ($DEST) ; version précédente : $BACKUPS/Molinova-previous.app"
