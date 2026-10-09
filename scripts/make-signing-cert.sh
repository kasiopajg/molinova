#!/bin/sh
# pnpm app:cert — crée, une seule fois, un certificat de signature auto-signé « Molinova Local Signing » dans le
# trousseau de session.
#
# Pourquoi : sans certificat Apple, Molinova est signé « ad hoc » et sa signature change à chaque compilation. macOS
# prend alors chaque nouvelle version pour une autre app et redemande l'accès à « Molinova Safe Storage » (la clé qui
# chiffre les secrets). Signé avec ce certificat, Molinova garde la même identité d'une version à l'autre : on autorise
# une fois (« Toujours autoriser »), c'est fini. Ne remplace pas un Developer ID (Gatekeeper, notarisation).
#
# Rien n'est ajouté aux réglages de confiance du système : le certificat sert seulement à signer sur ce Mac.
set -eu
NAME="Molinova Local Signing"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "Le certificat « $NAME » existe déjà."
  security find-certificate -c "$NAME" -Z | grep SHA-1
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" 2>/dev/null
PASS=$(openssl rand -hex 16)
# -legacy : le trousseau de macOS ne lit pas les PKCS#12 chiffrés à la mode d'OpenSSL 3.
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/cert.p12" -passout "pass:$PASS" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/cert.p12" -passout "pass:$PASS"
# -T : codesign peut utiliser la clé sans redemander à chaque signature.
security import "$TMP/cert.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "Certificat « $NAME » créé :"
security find-certificate -c "$NAME" -Z | grep SHA-1
