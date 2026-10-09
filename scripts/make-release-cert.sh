#!/bin/sh
# À lancer UNE fois, au moment de publier : crée le certificat de signature des versions publiées, « Molinova »
# (auto-signé, gratuit), et le prépare pour les secrets GitHub.
#
#   sh scripts/make-release-cert.sh [dossier]      (défaut : un dossier temporaire)
#
# Produit dans le dossier : molinova-signing.p12 (clé privée + certificat, chiffré), molinova-signing.p12.base64 (le même,
# pour le secret GitHub) et molinova-signing.password. Ensuite :
#   1. Range molinova-signing.p12 et le mot de passe dans ton gestionnaire de mots de passe (copie de secours).
#   2. GitHub › kasiopajg/molinova › Settings › Environments › « release » (avec toi comme « Required reviewer ») :
#      secret MOLINOVA_SIGNING_P12 = contenu de molinova-signing.p12.base64, secret MOLINOVA_SIGNING_PASSWORD = le mot de passe.
#   3. Supprime le dossier. La clé privée ne doit vivre que dans GitHub et dans ton gestionnaire.
#
# Les utilisateurs ne reçoivent que la partie publique du certificat, dans la signature de l'app. Toutes les
# versions signées avec cette clé sont la même app pour macOS : l'accès au trousseau survit aux mises à jour.
# En cas de fuite : nouveau certificat (relancer ce script, remplacer les secrets) ; chaque utilisateur
# réautorise une fois le trousseau à la mise à jour suivante.
set -eu
NAME="Molinova"
OUT=${1:-$(mktemp -d)}
mkdir -p "$OUT"
chmod 700 "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
O = Kasiopa SAS
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
# 20 ans : une signature qui change obligerait chaque utilisateur à réautoriser le trousseau.
openssl req -x509 -newkey rsa:3072 -nodes -days 7300 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" 2>/dev/null
PASS=$(openssl rand -hex 24)
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$OUT/molinova-signing.p12" -passout "pass:$PASS" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$OUT/molinova-signing.p12" -passout "pass:$PASS"
base64 -i "$OUT/molinova-signing.p12" > "$OUT/molinova-signing.p12.base64"
printf '%s\n' "$PASS" > "$OUT/molinova-signing.password"
chmod 600 "$OUT"/molinova-signing.*
echo "Certificat « $NAME » prêt dans $OUT"
openssl x509 -in "$TMP/cert.pem" -noout -fingerprint -sha1
echo "Suis les étapes en tête de ce script, puis supprime $OUT."
