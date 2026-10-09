/**
 * Ce que le code trouve seul dans le texte d'un document, avant Jev : les dates (Jev choisit parmi elles l'échéance,
 * il ne peut pas en inventer une), les tiers candidats, et, après Jev, le titre composé et les mots de la fiche.
 * Logique pure, sans réseau.
 */

export interface DateCandidate { date: string; snippet: string }

const MONTHS: Record<string, number> = {};
const addMonths = (names: string[][]) => names.forEach((alts, i) => alts.forEach((n) => (MONTHS[n] = i + 1)));
addMonths([
  // français, anglais, espagnol, puis allemand et italien (papiers d'une vie entre plusieurs pays)
  ["janvier", "janv", "jan", "january", "enero", "ene", "januar", "jaenner", "gennaio", "gen"],
  ["fevrier", "fevr", "fev", "february", "feb", "febrero", "februar", "febbraio"],
  ["mars", "mar", "march", "marzo", "marz", "maerz", "mrz"],
  ["avril", "avr", "april", "apr", "abril", "abr", "aprile"],
  ["mai", "may", "mayo", "maggio", "mag"],
  ["juin", "june", "jun", "junio", "juni", "giugno", "giu"],
  ["juillet", "juil", "jul", "july", "julio", "juli", "luglio", "lug"],
  ["aout", "aug", "august", "agosto", "ago"],
  ["septembre", "sept", "sep", "september", "septiembre", "setiembre", "settembre", "set"],
  ["octobre", "oct", "october", "octubre", "oktober", "okt", "ottobre", "ott"],
  ["novembre", "nov", "november", "noviembre"],
  ["decembre", "dec", "december", "diciembre", "dic", "dezember", "dez", "dicembre"],
]);
const strip = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Les dates du texte, dans l'ordre d'apparition, sans doublon : 12.03.2031, 12/03/2031, 2031-03-12, 12 mars 2031,
 * 12 MAR 2031 (passeport), 12 de marzo de 2031, March 12, 2031. Chacune avec les mots qui la précèdent.
 */
export function dateCandidates(text: string, max = 10): DateCandidate[] {
  const out: Array<DateCandidate & { at: number }> = [];
  const seen = new Set<string>();
  const push = (date: string | null, at: number, len: number) => {
    if (!date || seen.has(date)) return;
    seen.add(date);
    const snippet = text.slice(Math.max(0, at - 40), at + len).replace(/\s+/g, " ").trim();
    out.push({ date, snippet, at });
  };
  const flat = strip(text);
  for (const m of flat.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) push(iso(+m[3], +m[2], +m[1]), m.index!, m[0].length);
  for (const m of flat.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(iso(+m[1], +m[2], +m[3]), m.index!, m[0].length);
  // Passeports et cartes d'identité français : « 12 03 2031 », jour et mois sur deux chiffres, séparés par des espaces.
  for (const m of flat.matchAll(/\b(\d{2}) (\d{2}) (\d{4})\b/g)) push(iso(+m[3], +m[2], +m[1]), m.index!, m[0].length);
  for (const m of flat.matchAll(/\b(\d{1,2})(?:er|st|nd|rd|th|\.)?\s+(?:de\s+)?([a-z]{3,10})\.?\s+(?:de\s+|del\s+)?(\d{4})\b/g)) {
    const mo = MONTHS[m[2]];
    if (mo) push(iso(+m[3], mo, +m[1]), m.index!, m[0].length);
  }
  for (const m of flat.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1]];
    if (mo) push(iso(+m[3], mo, +m[2]), m.index!, m[0].length);
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max).map(({ date, snippet }) => ({ date, snippet }));
}

const WEBMAIL = new Set(["gmail", "googlemail", "hotmail", "outlook", "live", "yahoo", "icloud", "me", "orange", "free", "wanadoo", "laposte", "proton", "protonmail", "gmx"]);
const LEGAL = /\b([A-Z][\p{L}&'.-]*(?:\s+[A-Z][\p{L}&'.-]*){0,3})\s+(S\.?A\.?U?|S\.?L\.?U?|SAS|SASU|SARL|EURL|GmbH|Ltd|LLC|Inc|S\.?p\.?A|SCI|SNC)\b\.?/gu;
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Un mot composé allemand qui finit par un nom d'organisme : Landesfischereiverband, Finanzamt, Krankenkasse, Stadtverwaltung. */
const ORG_COMPOUND = /\b\p{Lu}\p{Ll}*(?:verband|verein|amt|kasse|versicherung|bank|schule|klinik|gericht|verwaltung|behörde|kammer|anstalt|ministerium|universität)\b/gu;
/** Un nom d'organisme suivi de son complément : « Agencia Tributaria », « Caisse primaire d'assurance maladie », « Ministère de l'Intérieur ». */
const ORG_HEAD = /\b(?:Agencia|Ayuntamiento|Tesorería|Seguridad Social|Ministerio|Consulado|Embajada|Universidad|Hospital|Banco|Caja|Mutua|Caisse|Mutuelle|Banque|Ministère|Préfecture|Mairie|Consulat|Ambassade|Université|Hôpital|Assurance Maladie|Tribunal|Direction|Agence|Landratsamt|Bundesagentur|Deutsche Rentenversicherung)(?:[ \t]+(?:de|des|du|de la|del|de los|der|für|of|the)?[ \t]*[\p{L}'-]+){0,4}/gu;
/** Les mots en capitales qui sont des rubriques de formulaire, pas un émetteur. */
const HEADER_WORDS = new Set(("nom prenom prenoms date dates lieu sexe taille nationalite adresse signature titulaire numero valable jusqu " +
  "surname name names given birth place sex height nationality address holder number valid until expiry issue " +
  "apellidos apellido nombre fecha lugar sexo nacionalidad domicilio firma numero valido hasta " +
  "vorname nachname geburtsdatum geburtsort staatsangehorigkeit anschrift unterschrift gultig bis datum seite page pagina tel fax email www http https ref").split(" "));

/**
 * Les tiers possibles : d'abord des noms déjà connus de Molinova (expéditeurs d'emails) cités dans le texte,
 * puis les raisons sociales (« Mapfre España S.A. »), puis les domaines des adresses email. Au plus `max`.
 */
export function partyCandidates(text: string, known: string[] = [], max = 8): string[] {
  const out: string[] = [];
  const has = (n: string) => out.some((x) => strip(x) === strip(n));
  const add = (n: string) => { const v = n.trim().replace(/\s+/g, " "); if (v.length >= 3 && !has(v) && out.length < max) out.push(v); };
  const flat = ` ${strip(text).replace(/[^a-z0-9]+/g, " ")} `;
  for (const k of known) { const w = strip(k).replace(/[^a-z0-9]+/g, " ").trim(); if (w.length >= 4 && flat.includes(` ${w} `)) add(k); }
  for (const m of text.matchAll(LEGAL)) add(`${m[1]} ${m[2]}`);
  for (const m of text.matchAll(/[\w.+-]+@([a-z0-9-]+)\.[a-z.]{2,}/gi)) { const d = m[1].toLowerCase(); if (!WEBMAIL.has(d)) add(d.split("-").map(capitalize).join(" ")); }
  // Les organismes nommés en toutes lettres : « Landesfischereiverband », « Agencia Tributaria », « Caisse d'allocations familiales ».
  for (const m of text.matchAll(ORG_COMPOUND)) add(m[0]);
  for (const m of text.matchAll(ORG_HEAD)) add(m[0].replace(/[\s,.;:]+$/, ""));
  // L'émetteur s'écrit souvent en capitales en haut du document : « FINANZAMT MUSTERSTADT », « AGENCIA TRIBUTARIA ».
  for (const m of text.slice(0, 1500).matchAll(/\b[\p{Lu}][\p{Lu}'&-]{2,}(?:[ \t]+[\p{Lu}][\p{Lu}'&-]{1,}){0,3}\b/gu)) {
    const words = m[0].split(/\s+/).filter((w) => !HEADER_WORDS.has(strip(w)));
    if (words.length && words.join("").length >= 4) add(words.join(" "));
  }
  return out;
}

/**
 * La date d'un document pour son titre : la plus ancienne entre sa création sur Drive et sa dernière modification.
 * Un papier de 2012 mis sur Drive en 2019 garde 2012 (Drive date la création du jour de l'envoi).
 */
export function docDate(createdAt: string | null | undefined, modifiedAt: string | null | undefined): string | null {
  const ds = [createdAt, modifiedAt].filter((x): x is string => !!x).sort();
  return ds[0] ?? null;
}

/** Le titre d'une fiche : date, type, tiers, personnes, contexte. Pour l'affichage et la recherche ; aucun fichier n'est renommé. */
export function composeTitle(p: { date?: string | null; type?: string | null; party?: string | null; people?: string[]; context?: string | null }): string {
  const head = [p.date?.slice(0, 10), p.type, p.party].filter(Boolean).join(" ");
  const who = p.people?.length ? ` · ${p.people.join(", ")}` : "";
  return `${head}${who}${p.context ? ` – ${p.context}` : ""}`.trim();
}

/**
 * Un échantillon réparti sur les dossiers (premier niveau) et les années, pas « les plus récents » :
 * tour à tour un document de chaque groupe, dans un ordre stable. Ce qui n'est pas pris le sera au lancement suivant.
 */
export function spreadSample<T extends { id: string; path: string | null; modifiedAt: string | null }>(docs: T[], max: number): T[] {
  if (max >= docs.length) return docs;
  const groups = new Map<string, T[]>();
  for (const d of docs) {
    const key = `${(d.path ?? "").split("/")[0]}|${(d.modifiedAt ?? "").slice(0, 4)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const lists = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, l]) => l.sort((a, b) => hash(a.id) - hash(b.id)));
  const out: T[] = [];
  for (let i = 0; out.length < max; i++) {
    let took = false;
    for (const l of lists) if (i < l.length && out.length < max) { out.push(l[i]); took = true; }
    if (!took) break;
  }
  return out;
}
