/**
 * La fiche des documents de Drive : chaque document du périmètre est lu sur le Mac (doc-extract), puis Jev répond
 * à toutes les questions de la fiche en un seul appel (doc-questions). Le titre et les mots de recherche sont composés
 * par le code. Rien n'est écrit dans Drive.
 *
 * Coût : montré avant tout lancement (estimate.ts, source « drive ») ; ensuite, le passage de fond ne classe seul
 * que les nouveautés, au plus AUTO_MAX par passage. Une fiche corrigée par l'utilisateur n'est plus réécrite par Jev.
 */
import crypto from "node:crypto";
import type { Experimental_EvaluationModel as EvaluationModel } from "ai";
import type { Context, Settings } from "../config.js";
import type { Db } from "../db.js";
import { kvGet, kvSet, logActivity, refreshDocFts } from "../db.js";
import { householdMembers, type Member } from "./agenda.js";
import { extractText, textBin, type ReadDoc, type TextSource } from "./doc-extract.js";
import { composeTitle, dateCandidates, docDate, partyCandidates, spreadSample } from "./doc-facts.js";
import { buildDocQuestions, contextName, decideCard, docExamples, loadDocTaxonomy, typeName, type DocTaxonomy } from "./doc-questions.js";
import { askJev } from "./jev.js";
import { LANGUAGES } from "../i18n/index.js";
import { defaultDocTaxonomy } from "../i18n/doc-taxonomy-defaults.js";

/** Au-delà, le passage de fond ne classe pas seul : il faut relancer depuis l'écran Drive, avec le coût sous les yeux. */
export const AUTO_MAX = 50;

export interface PendingDoc extends ReadDoc { path: string | null; modifiedAt: string | null; createdAt: string | null; stamp: string }
/** Les documents du périmètre sans fiche, dont le fichier a changé depuis, ou dont la fiche a échoué. Jamais une fiche corrigée. */
export function pendingDocs(db: Db, accountId: number): PendingDoc[] {
  return db.prepare(`SELECT d.file_id id, d.name, d.mime, d.format, d.size, d.path, d.modified_at modifiedAt, d.created_at createdAt, COALESCE(d.md5, d.modified_at, '') stamp
    FROM docs d LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id
    WHERE d.account_id = ? AND d.in_scope = 1 AND (c.file_id IS NULL OR (c.by = 'jev' AND (c.type IS NULL OR c.md5 IS NOT COALESCE(d.md5, d.modified_at, ''))))
    ORDER BY d.modified_at DESC`).all(accountId) as PendingDoc[];
}
/** « Refaire les fiches » : celles de Jev redeviennent à classer (pas celles que l'utilisateur a corrigées). */
export function markCardsStale(db: Db, accountId: number): number {
  return db.prepare("UPDATE doc_cards SET md5 = NULL WHERE account_id = ? AND by = 'jev'").run(accountId).changes;
}
export function cardCounts(db: Db, accountId: number): { inScope: number; classified: number; pending: number } {
  const r = db.prepare(`SELECT COUNT(*) inScope, SUM(c.type IS NOT NULL) classified FROM docs d LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id WHERE d.account_id = ? AND d.in_scope = 1`).get(accountId) as { inScope: number; classified: number | null };
  return { inScope: r.inScope, classified: r.classified ?? 0, pending: pendingDocs(db, accountId).length };
}

/**
 * Les mots de la fiche pour la recherche : libellés du Type (avec ce qu'il recouvre), du Contexte, des personnes, du tiers.
 * Type et Contexte dans les trois langues : on cherche « impôts » même quand l'app est en anglais (« Taxes »).
 */
export function facetsText(tax: DocTaxonomy, members: Member[], f: { type: string | null; context: string | null; context2: string | null; people: string[]; party: string | null }): string {
  const ty = tax.types.find((x) => x.key === f.type);
  const others = LANGUAGES.map((l) => defaultDocTaxonomy(l));
  const words = new Set<string>();
  for (const t of [tax, ...others]) {
    const x = t.types.find((y) => y.key === f.type);
    if (x) words.add(x.name);
    for (const k of [f.context, f.context2]) { const n = contextName(t, k); if (n) words.add(n); }
  }
  return [ty ? ty.criteria : "", ...words, ...f.people.map((k) => members.find((m) => m.key === k)?.name ?? ""), f.party ?? ""].filter(Boolean).join(" · ");
}

/**
 * Remet à jour les mots de recherche de toutes les fiches (sans Jev, sans coût) quand leur forme change.
 * Version 2 : libellés dans les trois langues. Version 3 : la date du titre est la plus ancienne (création, modification).
 */
export function upgradeFacets(db: Db, ctx: Context): number {
  if (kvGet<number>(db, "drive.facetsVersion", 1) >= 3) return 0;
  const tax = loadDocTaxonomy(), members = householdMembers(ctx);
  const rows = db.prepare("SELECT c.account_id a, c.file_id f, c.type, c.context, c.context2, c.people, c.party, d.created_at createdAt, d.modified_at modifiedAt FROM doc_cards c JOIN docs d ON d.account_id = c.account_id AND d.file_id = c.file_id WHERE c.type IS NOT NULL").all() as Array<{ a: number; f: string; type: string; context: string | null; context2: string | null; people: string | null; party: string | null; createdAt: string | null; modifiedAt: string | null }>;
  const upd = db.prepare("UPDATE doc_cards SET facets = ?, title = ? WHERE account_id = ? AND file_id = ?");
  const nameOf = (k: string) => (k === "me" ? ctx.owner.name.split(/\s+/)[0] : members.find((m) => m.key === k)?.name ?? k);
  db.transaction(() => {
    for (const r of rows) {
      const people = (r.people ?? "").split(",").filter(Boolean);
      const title = composeTitle({ date: docDate(r.createdAt, r.modifiedAt), type: typeName(tax, r.type), party: r.party, people: people.map(nameOf), context: contextName(tax, r.context) });
      upd.run(facetsText(tax, members, { ...r, people }), title, r.a, r.f);
      refreshDocFts(db, r.a, r.f);
    }
  })();
  kvSet(db, "drive.facetsVersion", 3);
  return rows.length;
}

export interface ClassifyDeps {
  db: Db; ctx: Context; settings: Settings; accountId: number; reader: TextSource;
  /** Faux modèle dans les tests. */
  model?: EvaluationModel;
}

/** Les noms d'expéditeurs vus au moins deux fois : des tiers que Molinova connaît déjà. */
function knownParties(db: Db): string[] {
  return (db.prepare("SELECT from_name n FROM items WHERE from_name IS NOT NULL AND length(from_name) >= 4 GROUP BY lower(from_name) HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 500").all() as Array<{ n: string }>).map((r) => r.n);
}

/** Une seule lecture par l'assistant natif à la fois (OCR) : le Mac reste réactif. Jev, lui, tourne en parallèle. */
let ocrChain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = ocrChain.then(fn, fn);
  ocrChain = run.catch(() => undefined);
  return run;
}

/** Lit un document, demande sa fiche à Jev, l'enregistre et met à jour l'index. Renvoie la méthode de lecture. */
export async function classifyDoc(d: ClassifyDeps, doc: PendingDoc, shared: { tax: DocTaxonomy; members: Member[]; known: string[]; examples: { type: Record<string, string[]>; context: Record<string, string[]> } }): Promise<{ method: string | null; error: string | null }> {
  let text = "", method: string | null = null, error: string | null = null;
  try {
    const needsBin = doc.format === "pdf" || doc.format === "image";
    const r = needsBin ? await oneAtATime(() => extractText(d.reader, doc, textBin())) : await extractText(d.reader, doc, null);
    if (r) { text = r.text; method = r.method; }
  } catch (e) { error = (e as Error).message.slice(0, 200); }
  const cand = { dates: dateCandidates(text), parties: partyCandidates(text, shared.known) };
  const { questions, people } = buildDocQuestions(shared.tax, d.ctx, shared.members, cand, shared.examples);
  const state = {
    owner: d.ctx.owner.name,
    today: new Date().toISOString().slice(0, 10),
    file: { name: doc.name, folder: doc.path ?? "", format: doc.format ?? "", created: doc.createdAt?.slice(0, 10) ?? "", modified: doc.modifiedAt?.slice(0, 10) ?? "" },
    // Le texte est une donnée : Jev ne répond qu'à des questions fermées, rien de ce qu'il contient ne déclenche quoi que ce soit.
    text: text || "",
    textRead: method ?? "none",
  };
  const upsert = d.db.prepare(`INSERT INTO doc_cards (account_id, file_id, type, type_p, context, context2, context_p, people, valid, sensitive, action, importance, expiry, party, title, facets, excerpt, text_hash, method, md5, classified_at, by, error)
    VALUES (@account_id, @file_id, @type, @type_p, @context, @context2, @context_p, @people, @valid, @sensitive, @action, @importance, @expiry, @party, @title, @facets, @excerpt, @text_hash, @method, @md5, datetime('now'), 'jev', @error)
    ON CONFLICT(account_id, file_id) DO UPDATE SET type = excluded.type, type_p = excluded.type_p, context = excluded.context, context2 = excluded.context2, context_p = excluded.context_p,
      people = excluded.people, valid = excluded.valid, sensitive = excluded.sensitive, action = excluded.action, importance = excluded.importance, expiry = excluded.expiry, party = excluded.party,
      title = excluded.title, facets = excluded.facets, excerpt = excluded.excerpt, text_hash = excluded.text_hash, method = excluded.method, md5 = excluded.md5, classified_at = excluded.classified_at, error = excluded.error`);
  const base = { account_id: d.accountId, file_id: doc.id, text_hash: text ? crypto.createHash("sha1").update(text).digest("hex") : null, method, md5: doc.stamp };
  try {
    const out = await askJev(state, questions, d.settings, d.model, { purpose: "doc_classify", accountId: d.accountId });
    const f = decideCard(out.answers as Record<string, never>, people, cand);
    const names = f.people.map((k) => (k === "me" ? d.ctx.owner.name.split(/\s+/)[0] : shared.members.find((m) => m.key === k)?.name ?? k));
    const title = composeTitle({ date: docDate(doc.createdAt, doc.modifiedAt), type: typeName(shared.tax, f.type), party: f.party, people: names, context: contextName(shared.tax, f.context) });
    upsert.run({
      ...base, type: f.type, type_p: f.typeP, context: f.context, context2: f.context2, context_p: f.contextP, people: f.people.join(","), valid: f.valid, sensitive: f.sensitive, action: f.action,
      importance: f.importance, expiry: f.expiry, party: f.party, title, facets: facetsText(shared.tax, shared.members, f),
      // Document sensible : la fiche reste, le texte lu ne se garde pas.
      excerpt: f.sensitive ? null : text || null, error,
    });
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
    upsert.run({ ...base, type: null, type_p: null, context: null, context2: null, context_p: null, people: "", valid: null, sensitive: 0, action: 0, importance: null, expiry: null, party: null, title: null, facets: null, excerpt: null, error });
  }
  refreshDocFts(d.db, d.accountId, doc.id);
  return { method, error };
}

export interface DocJob { accountId: number; total: number; done: number; errors: number; ocr: number; startedAt: string; finishedAt: string | null; lastError: string | null; stopped: boolean; auto: boolean }
/** Le classement en cours ou le dernier, par compte : l'écran Drive en affiche l'avancement. */
export const docJobs = new Map<number, DocJob>();
const stops = new Set<number>();
export const classifying = (accountId: number): boolean => docJobs.get(accountId)?.finishedAt === null;
export function stopClassify(accountId: number): void { stops.add(accountId); }

/** Classe les documents en attente d'un compte ; `max` : un échantillon réparti (dossiers, années), sinon tout. */
export async function classifyDocs(d: ClassifyDeps, opts: { max?: number | null; auto?: boolean; email?: string } = {}): Promise<DocJob> {
  if (classifying(d.accountId)) return docJobs.get(d.accountId)!;
  const all = pendingDocs(d.db, d.accountId);
  const docs = opts.max != null ? spreadSample(all, opts.max) : all;
  const job: DocJob = { accountId: d.accountId, total: docs.length, done: 0, errors: 0, ocr: 0, startedAt: new Date().toISOString(), finishedAt: null, lastError: null, stopped: false, auto: !!opts.auto };
  docJobs.set(d.accountId, job);
  stops.delete(d.accountId);
  // L'utilisateur a lancé un classement : les nouveautés seront classées d'elles-mêmes, par petits passages.
  if (!opts.auto) kvSet(d.db, `drive.classify:${d.accountId}`, true);
  const shared = { tax: loadDocTaxonomy(), members: householdMembers(d.ctx), known: knownParties(d.db), examples: { type: docExamples(d.db, "type"), context: docExamples(d.db, "context") } };
  let next = 0;
  const worker = async () => {
    while (next < docs.length && !stops.has(d.accountId)) {
      const doc = docs[next++];
      const r = await classifyDoc(d, doc, shared);
      job.done++;
      if (r.method === "ocr") job.ocr++;
      if (r.error) { job.errors++; job.lastError = r.error; }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(Math.max(1, d.settings.concurrency), 8, docs.length) }, worker)); }
  finally {
    job.stopped = stops.has(d.accountId);
    job.finishedAt = new Date().toISOString();
    stops.delete(d.accountId);
    if (job.done) logActivity(d.db, "drive", "classified", { email: opts.email ?? "", n: job.done, errors: job.errors });
  }
  return job;
}
export const autoClassifyOn = (db: Db, accountId: number): boolean => kvGet<boolean>(db, `drive.classify:${accountId}`, false);
