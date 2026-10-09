/** Nettoyage du texte avant envoi au modèle : moins de tokens, moins de bruit. */

const QUOTE_MARKERS = [
  /^On .+ wrote:$/m,
  /^Le .+ a écrit\s?:$/m,
  /^El .+ escribió:$/m,
  /^-{2,}\s?Original Message\s?-{2,}$/im,
  /^-{2,}\s?Message d'origine\s?-{2,}$/im,
  /^De\s?:\s.+\nEnvoyé\s?:\s.+$/m,
  /^From:\s.+\nSent:\s.+$/m,
  /^_{5,}$/m,
];
// Toujours actifs, quelle que soit la langue de l'app : c'est la langue de l'email reçu qui compte.
const SIGNATURE_MARKERS = [
  /^--\s?$/m,
  /^Envoyé de mon iPhone/m, /^Sent from my iPhone/m, /^Enviado desde mi iPhone/m,
  /^Cordialement,?$/m, /^Bien à vous,?$/m,
  /^(Best|Kind|Warm) regards,?$/m, /^Regards,?$/m, /^Best,?$/m,
  /^Saludos( cordiales)?,?$/m, /^Un saludo,?$/m, /^Atentamente,?$/m,
];

export function stripQuotedHistory(text: string): string {
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  // Lignes commençant par ">" : on coupe au premier bloc cité.
  const quoted = /^\s*>/m.exec(text);
  if (quoted && quoted.index < cut) cut = quoted.index;
  return text.slice(0, cut);
}

export function stripSignature(text: string): string {
  let cut = text.length;
  for (const re of SIGNATURE_MARKERS) {
    const m = re.exec(text);
    // On ne coupe une signature que si elle arrive après un minimum de contenu.
    if (m && m.index > 80 && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/** Entités nommées courantes dans les emails (accents français et espagnols, typographie). Les numériques sont décodées à part. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", Eacute: "É", Egrave: "È", Ecirc: "Ê",
  agrave: "à", acirc: "â", auml: "ä", aacute: "á", Agrave: "À", Aacute: "Á",
  ccedil: "ç", Ccedil: "Ç", icirc: "î", iuml: "ï", iacute: "í", Iacute: "Í",
  ocirc: "ô", ouml: "ö", oacute: "ó", Oacute: "Ó", ugrave: "ù", ucirc: "û", uuml: "ü", uacute: "ú", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", oelig: "œ", OElig: "Œ", aelig: "æ", szlig: "ß", iexcl: "¡", iquest: "¿",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  zwnj: "", zwj: "", shy: "",
};
/** Décode les entités HTML en une seule passe : « &amp;lt; » reste « &lt; ». */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<title[\s\S]*?<\/title>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

/** Découpe un en-tête To/Cc sur les virgules qui séparent vraiment des adresses : « "Dupont, Jean" <j@x.fr> » reste entier. */
export function splitAddresses(header: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false, angle = 0;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function excerpt(text: string, maxChars: number): string {
  const clean = normalizeWhitespace(stripSignature(stripQuotedHistory(text)));
  return clip(clean, maxChars, "…");
}

/**
 * Coupe à `max` unités sans trancher un emoji (ou tout caractère hors du plan de base) en deux : une moitié
 * de paire de substitution est du Unicode invalide, que l'API du modèle refuse (« invalid Unicode text »).
 */
export function clip(text: string, max: number, ellipsis = ""): string {
  if (text.length <= max) return text;
  let cut = Math.max(0, max);
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return text.slice(0, cut) + ellipsis;
}
/** Remplace toute moitié orpheline de paire de substitution par U+FFFD (équivalent de String#toWellFormed). */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}
/** wellFormed() sur toutes les chaînes d'une valeur (objets et tableaux compris) : ce qui part vers un modèle. */
export function wellFormedDeep<T>(value: T): T {
  if (typeof value === "string") return wellFormed(value) as T;
  if (Array.isArray(value)) return value.map(wellFormedDeep) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wellFormedDeep(v)])) as T;
  }
  return value;
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

/** "Jean Dupont <jean@x.fr>" → { name, address } */
export function parseAddress(raw: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  return { name: "", address: raw.trim().toLowerCase() };
}
