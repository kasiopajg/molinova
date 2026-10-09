/**
 * Retrouver un document : une seule recherche pour l'écran Drive et pour Telegram.
 * 1. Candidats : l'index local (nom, chemin, titre, mots de la fiche, début du texte) en OU, plus les fiches dont le Type,
 *    le Contexte ou la personne correspondent, plus la recherche de Google dans le contenu (documents sans fiche, ou sensibles).
 * 2. Score : rang de l'index, bonus quand la fiche correspond, malus quand elle concerne quelqu'un d'autre.
 * 3. Jev relit les 10 premiers : « ce document répond-il à la demande ? ». Restent ceux qui répondent, 5 au plus.
 * Pour un proche, les documents sensibles (sauf réglage) et ceux d'une personne qu'il ne suit pas sont écartés avant tout.
 */
import type { Experimental_EvaluationModel as EvaluationModel } from "ai";
import type { Context, Settings } from "../config.js";
import type { Db } from "../db.js";
import { householdMembers, type Member } from "./agenda.js";
import { contextName, loadDocTaxonomy, matchQuestion, typeName, type DocTaxonomy } from "./doc-questions.js";
import { askJev } from "./jev.js";

export interface DocQuery {
  /** La demande telle qu'elle a été dite : « ma carte d'identité ». */
  request: string;
  /** Mots et synonymes à chercher (« carte d'identité », « CNI », « DNI », « passeport ») ; à défaut, les mots de la demande. */
  words?: string[];
  type?: string | null;
  context?: string | null;
  /** Clés des membres concernés (« me », « child:leo »). */
  people?: string[];
  validOnly?: boolean;
}
export interface Viewer { sensitive: boolean; follows: string[] }
export interface DocResult {
  accountId: number; id: string; name: string; path: string; link: string | null; format: string | null; mime: string; size: number | null; modifiedAt: string | null;
  title: string | null; type: string | null; typeName: string; context: string | null; contextName: string; people: string[]; peopleNames: string[];
  party: string | null; expiry: string | null; valid: number | null; sensitive: boolean; by: string | null; classified: boolean; frozen: boolean;
  score: number; match: number | null;
}
export interface SearchDeps {
  db: Db; ctx: Context; settings: Settings;
  /** La recherche de Google dans le contenu, par compte ; absente = locale seulement. */
  google?: (accountId: number, words: string[]) => Promise<string[]>;
  /** Jev relit les meilleurs candidats ; false pour une recherche locale, sans coût. */
  rerank?: boolean;
  model?: EvaluationModel;
  viewer?: Viewer;
  accountId?: number;
  limit?: number;
}

const STOP = new Set(("les des une une pour avec dans sur par mon mes ton tes son ses notre nos votre vos leur leurs moi toi lui elle nous vous ils elles " +
  "cherche chercher trouve trouver envoie envoyer donne donner document documents fichier fichiers est etait qui que quoi dont " +
  "the and for with from find send give file files document documents please " +
  "los las del por con para una unos unas mis tus sus nuestro nuestra busca buscar encuentra envia enviar archivo archivos documento documentos").split(" "));
const strip = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Les mots utiles : trois lettres au moins (CNI, DNI comptent), sans mots de liaison, sans doublon. */
export function searchWords(q: DocQuery): string[] {
  const src = [...(q.words ?? []), q.request].join(" ");
  const out = new Set<string>();
  for (const w of strip(src).match(/[\p{L}\p{N}]+/gu) ?? []) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  return [...out].slice(0, 16);
}
/** Requête de l'index en OU, chaque mot en préfixe : un seul mot présent suffit à être candidat. */
export const ftsAny = (words: string[]): string | null => (words.length ? words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" OR ") : null);

type Row = { accountId: number; id: string; name: string; path: string; link: string | null; format: string | null; mime: string; size: number | null; modifiedAt: string | null;
  title: string | null; type: string | null; context: string | null; context2: string | null; people: string | null; party: string | null; expiry: string | null; valid: number | null;
  sensitive: number | null; by: string | null; excerpt: string | null; frozen: number };
const COLS = `d.account_id accountId, d.file_id id, d.name, COALESCE(d.path, '') path, d.link, d.format, d.mime, d.size, d.modified_at modifiedAt, d.frozen,
  c.title, c.type, c.context, c.context2, c.people, c.party, c.expiry, c.valid, c.sensitive, c.by, c.excerpt`;
const JOIN = "FROM docs d LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id";

/** Un contexte et ses sous-contextes : « Voiture » couvre « Assurance voiture ». */
const ctxFamily = (tax: DocTaxonomy, key: string): string[] => [key, ...tax.contexts.filter((c) => c.parent === key).map((c) => c.key)];
const parentOf = (tax: DocTaxonomy, key: string | null): string | null => (key ? tax.contexts.find((c) => c.key === key)?.parent ?? null : null);

/** Le score d'un candidat : rang dans l'index, puis la fiche. Pure : testée sans base. */
export function scoreRow(r: Pick<Row, "type" | "context" | "context2" | "people" | "valid">, q: DocQuery, tax: DocTaxonomy, base: number): number {
  let s = base;
  if (q.type && r.type === q.type) s += 2;
  if (q.context) {
    if (r.context === q.context || r.context2 === q.context) s += 1.5;
    else if (parentOf(tax, r.context) === q.context || parentOf(tax, q.context) === r.context) s += 0.8;
  }
  const people = r.people ? r.people.split(",").filter(Boolean) : [];
  if (q.people?.length && people.length) s += q.people.some((k) => people.includes(k)) ? 2 : -1.5;
  if (q.validOnly && r.valid === 0) s -= 2;
  if (r.valid === 1) s += 0.2;
  return s;
}

/** Ce qu'un proche a le droit de voir : pas de document sensible sans réglage, pas celui d'une personne qu'il ne suit pas. */
export function visibleTo(r: Pick<Row, "sensitive" | "people">, v?: Viewer): boolean {
  if (!v) return true;
  if (r.sensitive && !v.sensitive) return false;
  const people = r.people ? r.people.split(",").filter(Boolean) : [];
  return !people.length || people.some((k) => v.follows.includes(k));
}

function resultOf(r: Row, tax: DocTaxonomy, ctx: Context, members: Member[], score: number, match: number | null): DocResult {
  const people = r.people ? r.people.split(",").filter(Boolean) : [];
  return {
    accountId: r.accountId, id: r.id, name: r.name, path: r.path, link: r.link, format: r.format, mime: r.mime, size: r.size, modifiedAt: r.modifiedAt,
    title: r.title, type: r.type, typeName: typeName(tax, r.type), context: r.context, contextName: contextName(tax, r.context), people,
    peopleNames: people.map((k) => (k === "me" ? ctx.owner.name.split(/\s+/)[0] : members.find((m) => m.key === k)?.name ?? k)),
    party: r.party, expiry: r.expiry, valid: r.valid, sensitive: !!r.sensitive, by: r.by, classified: !!r.type, frozen: !!r.frozen, score: Math.round(score * 100) / 100, match,
  };
}

/** Un document du périmètre par son identifiant, s'il est visible pour cette personne (avant de l'envoyer). */
export function docById(d: { db: Db; ctx: Context; viewer?: Viewer }, accountId: number, fileId: string): DocResult | null {
  const r = d.db.prepare(`SELECT ${COLS} ${JOIN} WHERE d.account_id = ? AND d.file_id = ? AND d.in_scope = 1`).get(accountId, fileId) as Row | undefined;
  if (!r || !visibleTo(r, d.viewer)) return null;
  return resultOf(r, loadDocTaxonomy(), d.ctx, householdMembers(d.ctx), 0, null);
}

export async function findDocs(d: SearchDeps, q: DocQuery): Promise<DocResult[]> {
  const tax = loadDocTaxonomy();
  const members = householdMembers(d.ctx);
  const words = searchWords(q);
  const acc = d.accountId ? " AND d.account_id = ?" : "";
  const accP = d.accountId ? [d.accountId] : [];
  const cands = new Map<string, { row: Row; score: number }>();
  const add = (row: Row, base: number) => {
    const k = `${row.accountId}:${row.id}`;
    const s = scoreRow(row, q, tax, base);
    const cur = cands.get(k);
    // Trouvé par deux chemins (index et Google, ou index et fiche) : un peu plus probable.
    cands.set(k, cur ? { row: cur.row, score: Math.max(cur.score, s) + 0.5 } : { row, score: s });
  };
  // 1a. L'index local, en OU : rang 0 → 3 points, puis décroissant.
  const fq = ftsAny(words);
  if (fq) {
    const rows = d.db.prepare(`SELECT ${COLS} FROM docs_fts f JOIN docs d ON d.account_id = f.account_id AND d.file_id = f.file_id LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id
      WHERE docs_fts MATCH ? AND d.in_scope = 1${acc} ORDER BY bm25(docs_fts, 0, 0, 4, 1, 3, 3, 1), d.modified_at DESC LIMIT 80`).all(fq, ...accP) as Row[];
    rows.forEach((r, i) => add(r, 3 / (1 + i * 0.15)));
  }
  // 1b. Les fiches qui correspondent par Type, Contexte ou personne, même sans un seul mot en commun.
  const facet: string[] = [], fp: unknown[] = [];
  if (q.type) { facet.push("c.type = ?"); fp.push(q.type); }
  if (q.context) { const fam = ctxFamily(tax, q.context); facet.push(`(c.context IN (${fam.map(() => "?").join(",")}) OR c.context2 = ?)`); fp.push(...fam, q.context); }
  if (facet.length) {
    const rows = d.db.prepare(`SELECT ${COLS} ${JOIN} WHERE d.in_scope = 1 AND c.type IS NOT NULL AND (${facet.join(" OR ")})${acc} ORDER BY d.modified_at DESC LIMIT 80`).all(...fp, ...accP) as Row[];
    rows.forEach((r) => add(r, 0.5));
  }
  // 1c. Google cherche dans le contenu : utile pour ce qui n'a pas encore de fiche, et pour les documents sensibles (texte non gardé).
  if (d.google && words.length) {
    const accounts = d.accountId ? [d.accountId] : (d.db.prepare("SELECT DISTINCT account_id id FROM docs WHERE in_scope = 1").all() as Array<{ id: number }>).map((a) => a.id);
    for (const a of accounts) {
      let ids: string[] = [];
      try { ids = await d.google(a, q.words?.length ? q.words : words); } catch { ids = []; }
      if (!ids.length) continue;
      const rows = d.db.prepare(`SELECT ${COLS} ${JOIN} WHERE d.account_id = ? AND d.in_scope = 1 AND d.file_id IN (${ids.map(() => "?").join(",")})`).all(a, ...ids) as Row[];
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.forEach((r) => add(r, 1.5 / (1 + (order.get(r.id) ?? 0) * 0.2)));
    }
  }
  const ranked = [...cands.values()].filter((c) => visibleTo(c.row, d.viewer)).sort((a, b) => b.score - a.score);
  const limit = d.limit ?? 5;
  const toResult = (c: { row: Row; score: number }, match: number | null): DocResult => resultOf(c.row, tax, d.ctx, members, c.score, match);
  if (!d.rerank || !ranked.length) return ranked.slice(0, limit).map((c) => toResult(c, null));
  // 3. Jev relit les 10 premiers, en parallèle. La fiche et le début du texte, jamais le texte d'un document sensible.
  const top = ranked.slice(0, 10);
  const questions = matchQuestion(d.ctx, q.request);
  const judged = await Promise.all(top.map(async (c) => {
    const r = toResult(c, null);
    const state = { request: q.request, document: { name: r.name, folder: r.path, title: r.title ?? "", type: r.typeName, context: r.contextName, concerns: r.peopleNames, party: r.party ?? "", expiry: r.expiry ?? "", stillValid: r.valid == null ? "unknown" : r.valid ? "yes" : "no", excerpt: c.row.sensitive ? "" : (c.row.excerpt ?? "").slice(0, 1200) } };
    try { const out = await askJev(state, questions, d.settings, d.model, { purpose: "doc_search", accountId: r.accountId }); return { c, p: (out.answers.match as { probability?: number }).probability ?? 0 }; }
    catch { return { c, p: null }; }
  }));
  // Jev indisponible : l'ordre du score, sans filtre.
  if (judged.every((j) => j.p == null)) return top.slice(0, limit).map((c) => toResult(c, null));
  return judged.filter((j) => (j.p ?? 0) >= 0.5).sort((a, b) => (b.p ?? 0) - (a.p ?? 0) || b.c.score - a.c.score).slice(0, limit).map((j) => toResult(j.c, j.p));
}

// ---------- parcourir : la page Documents (dossiers, filtres, liste, détail)
export type BrowseFlag = "sensitive" | "expiring" | "expired" | "unclassified" | "action" | "corrected";
export interface BrowseFilter {
  accountId: number;
  /** Chemin du dossier (« 0 Documents Famille/01 Civil ») : lui et ses sous-dossiers. Absent = tout le périmètre. */
  folder?: string | null;
  type?: string | null; context?: string | null; person?: string | null; flag?: BrowseFlag | null;
  q?: string | null;
  sort?: "modified" | "name" | "expiry";
  limit?: number; offset?: number;
}
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
/** Les conditions SQL d'un filtre (sans le filtre lui-même : `skip` sert aux comptes de chaque groupe de filtres). */
function browseWhere(f: BrowseFilter, tax: DocTaxonomy, skip?: "type" | "context" | "person" | "flag", now = new Date()): { sql: string; params: unknown[] } {
  const w = ["d.account_id = ?", "d.in_scope = 1"], p: unknown[] = [f.accountId];
  if (f.folder) { w.push("(d.path = ? OR d.path LIKE ? ESCAPE '\\')"); p.push(f.folder, `${f.folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`); }
  if (f.type && skip !== "type") { w.push("c.type = ?"); p.push(f.type); }
  if (f.context && skip !== "context") { const fam = ctxFamily(tax, f.context); w.push(`(c.context IN (${fam.map(() => "?").join(",")}) OR c.context2 = ?)`); p.push(...fam, f.context); }
  if (f.person && skip !== "person") { w.push("(',' || c.people || ',') LIKE ?"); p.push(`%,${f.person},%`); }
  if (f.flag && skip !== "flag") {
    const today = ymdOf(now), soon = ymdOf(new Date(now.getTime() + 90 * 86_400_000));
    if (f.flag === "sensitive") w.push("c.sensitive = 1");
    else if (f.flag === "action") w.push("c.action = 1");
    else if (f.flag === "unclassified") w.push("c.type IS NULL");
    else if (f.flag === "corrected") w.push("c.by = 'user'");
    else if (f.flag === "expiring") { w.push("c.expiry >= ? AND c.expiry <= ?"); p.push(today, soon); }
    else if (f.flag === "expired") { w.push("(c.expiry < ? OR c.valid = 0)"); p.push(today); }
  }
  const fq = f.q ? ftsAny(searchWords({ request: f.q })) : null;
  if (fq) { w.push("EXISTS (SELECT 1 FROM docs_fts x WHERE x.account_id = d.account_id AND x.file_id = d.file_id AND docs_fts MATCH ?)"); p.push(fq); }
  return { sql: w.join(" AND "), params: p };
}

/** Une page de documents, filtrée et triée, avec le total. */
export function listDocs(d: { db: Db; ctx: Context }, f: BrowseFilter): { total: number; rows: DocResult[] } {
  const tax = loadDocTaxonomy(), members = householdMembers(d.ctx);
  const { sql, params } = browseWhere(f, tax);
  const order = f.sort === "name" ? "d.name COLLATE NOCASE" : f.sort === "expiry" ? "c.expiry IS NULL, c.expiry" : "d.modified_at DESC";
  const total = (d.db.prepare(`SELECT COUNT(*) n ${JOIN} WHERE ${sql}`).get(...params) as { n: number }).n;
  const rows = d.db.prepare(`SELECT ${COLS} ${JOIN} WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, Math.min(200, f.limit ?? 60), f.offset ?? 0) as Row[];
  return { total, rows: rows.map((r) => resultOf(r, tax, d.ctx, members, 0, null)) };
}

export interface FacetCount { key: string; name: string; n: number; parent?: string }
/** Les comptes de chaque filtre, selon les autres filtres choisis : on voit ce qu'un clic donnerait. */
export function facetCounts(d: { db: Db; ctx: Context }, f: BrowseFilter): { types: FacetCount[]; contexts: FacetCount[]; people: FacetCount[]; flags: Record<BrowseFlag, number>; total: number; classified: number } {
  const tax = loadDocTaxonomy(), members = householdMembers(d.ctx);
  const count = (skip: "type" | "context" | "person" | "flag", select: string, group: string) => {
    const { sql, params } = browseWhere(f, tax, skip);
    return d.db.prepare(`SELECT ${select} k, COUNT(*) n ${JOIN} WHERE ${sql} AND ${group} IS NOT NULL GROUP BY k`).all(...params) as Array<{ k: string; n: number }>;
  };
  const byType = new Map(count("type", "c.type", "c.type").map((r) => [r.k, r.n]));
  const byCtx = new Map(count("context", "c.context", "c.context").map((r) => [r.k, r.n]));
  // Un domaine parent compte aussi ses sous-domaines.
  const ctxN = (key: string) => (byCtx.get(key) ?? 0) + tax.contexts.filter((c) => c.parent === key).reduce((s, c) => s + (byCtx.get(c.key) ?? 0), 0);
  const { sql: ps, params: pp } = browseWhere(f, tax, "person");
  const peopleRows = d.db.prepare(`SELECT c.people ${JOIN} WHERE ${ps} AND c.people IS NOT NULL AND c.people != ''`).all(...pp) as Array<{ people: string }>;
  const byPerson = new Map<string, number>();
  for (const r of peopleRows) for (const k of r.people.split(",").filter(Boolean)) byPerson.set(k, (byPerson.get(k) ?? 0) + 1);
  const flags = {} as Record<BrowseFlag, number>;
  for (const fl of ["sensitive", "expiring", "expired", "unclassified", "action", "corrected"] as BrowseFlag[]) {
    const { sql, params } = browseWhere({ ...f, flag: fl }, tax);
    flags[fl] = (d.db.prepare(`SELECT COUNT(*) n ${JOIN} WHERE ${sql}`).get(...params) as { n: number }).n;
  }
  const { sql, params } = browseWhere(f, tax, "flag");
  const tot = d.db.prepare(`SELECT COUNT(*) n, SUM(c.type IS NOT NULL) k ${JOIN} WHERE ${sql}`).get(...params) as { n: number; k: number | null };
  return {
    types: tax.types.filter((x) => byType.has(x.key)).map((x) => ({ key: x.key, name: x.name, n: byType.get(x.key)! })),
    contexts: tax.contexts.filter((x) => ctxN(x.key) > 0).map((x) => ({ key: x.key, name: x.name, n: ctxN(x.key), ...(x.parent ? { parent: x.parent } : {}) })),
    people: members.filter((m) => byPerson.has(m.key)).map((m) => ({ key: m.key, name: m.key === "me" ? d.ctx.owner.name.split(/\s+/)[0] : m.name, n: byPerson.get(m.key)! })),
    flags, total: tot.n, classified: tot.k ?? 0,
  };
}

/** Le détail d'une fiche : tout ce que Molinova sait du document, avec le début du texte s'il est gardé (jamais pour un sensible). */
export function docDetail(d: { db: Db; ctx: Context }, accountId: number, fileId: string) {
  const r = d.db.prepare(`SELECT ${COLS}, c.type_p typeP, c.context_p contextP, c.action, c.importance, c.method, c.error, c.classified_at classifiedAt, d.created_at createdAt ${JOIN} WHERE d.account_id = ? AND d.file_id = ?`).get(accountId, fileId) as (Row & { typeP: number | null; contextP: number | null; action: number | null; importance: number | null; method: string | null; error: string | null; classifiedAt: string | null; createdAt: string | null }) | undefined;
  if (!r) return null;
  const tax = loadDocTaxonomy();
  return { ...resultOf(r, tax, d.ctx, householdMembers(d.ctx), 0, null), context2Name: contextName(tax, r.context2), excerpt: r.sensitive ? null : r.excerpt, typeP: r.typeP, contextP: r.contextP, action: !!r.action, importance: r.importance, method: r.method, error: r.error, classifiedAt: r.classifiedAt, createdAt: r.createdAt };
}
