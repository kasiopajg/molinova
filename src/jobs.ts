/**
 * Travaux de fond lancés depuis l'interface : aperçu, rattrapage, surveillance.
 * Un seul travail à la fois par compte ; l'interface lit l'état en continu.
 */
import { HistoryExpiredError, StoppedError, type GmailConnector } from "./connectors/gmail.js";
import type { Item } from "./connectors/types.js";
import { allLabels, classify, labelsFor, routeByChild, type Classifier } from "./core/classify.js";
import { findCategory, labelName } from "./core/taxonomy.js";
import { finishRun, logActivity, markApplied, rememberSender, saveDecision, startRun, upsertItem, type AccountRow, type Decision } from "./db.js";
import { settleProposal } from "./core/proposals.js";
import { t } from "./i18n/index.js";

export interface JobState {
  id: number;
  kind: "preview" | "backfill" | "watch" | "reclassify";
  accountId: number;
  status: "running" | "done" | "error" | "stopped";
  processed: number;
  /** Ce que fait le travail en ce moment. */
  phase: string;
  /** Emails sautés après une erreur (Jev ou Gmail) ; ils seront repris au prochain passage. */
  errors: number;
  lastError?: string;
  /** Emails dont la décision existait déjà : aucun appel à Jev. */
  reused: number;
  /** Reclassement à la demande : emails dont la catégorie, le « à revoir » ou les libellés Gmail ont changé. */
  changed?: number;
  /** Emails déjà connus, écartés avant lecture. */
  skipped: number;
  /** Emails parcourus (lus ou écartés) : sert à la progression. */
  scanned?: number;
  total: number | null;
  review: number;
  jevCalls: number;
  inputTokens: number;
  latencies: number[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** Surveillance : intervalle entre deux passages (s), pour la relancer à l'identique. */
  every?: number;
  /** Surveillance : fin du dernier passage et heure du prochain (ms), pour l'Accueil. */
  lastPassAt?: number;
  nextPassAt?: number;
  recent: Array<{ itemId: number; from: string; subject: string; category: string | null; confidence: number | null; needsReview: boolean; flags: Record<string, boolean> }>;
}

const jobs = new Map<number, JobState>();
const stops = new Map<number, boolean>();
const aborters = new Map<number, AbortController>();
let seq = 0;

/**
 * Panne réseau passagère (Wi-Fi coupé, Mac qui se réveille, DNS indisponible) : un rattrapage attend et réessaie le même
 * lot au lieu de s'arrêter. Attente croissante de `baseMs` à `maxMs` (modifiable par les tests).
 */
export const netRetry = { baseMs: 10_000, maxMs: 300_000 };
export function isNetworkError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const s = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].map((x) => String(x ?? "")).join(" ");
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN|socket hang up|fetch failed|network (is )?unreachable/i.test(s);
}
/** Attend `ms`, ou moins si le travail est arrêté entre-temps. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export function listJobs(): JobState[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10);
}
export function stopJob(id: number): void {
  stops.set(id, true);
  aborters.get(id)?.abort();
  const j = jobs.get(id);
  if (j && j.status === "running") j.phase = t("job.stopping");
}
export function getJob(id: number): JobState | undefined {
  return jobs.get(id);
}
/** Intervalle par défaut d'une surveillance (s). */
export const WATCH_EVERY_DEFAULT = 300;
/**
 * Les surveillances à relancer au démarrage : comptes Gmail dont la surveillance était en cours (watch_since
 * et watch_every posés, effacés par un arrêt depuis l'interface) et dont le jeton existe encore.
 */
export function watchesToResume(accounts: Array<Pick<AccountRow, "id" | "source" | "email" | "watch_since" | "watch_every">>, hasToken: (email: string) => boolean): Array<{ accountId: number; every: number }> {
  return accounts
    .filter((a) => a.source === "gmail" && a.watch_since && a.watch_every && hasToken(a.email))
    .map((a) => ({ accountId: a.id, every: Math.max(30, a.watch_every ?? WATCH_EVERY_DEFAULT) }));
}
/**
 * Fin d'un travail (hors veille) : le crochet du serveur peut enchaîner la suite (un reclassement en file) ; il reprend
 * alors `onDone` (la relance de la veille) à son compte, pour qu'elle ne reparte qu'une fois la file vide.
 */
let jobEndHook: ((accountId: number, onDone?: () => void) => boolean) | undefined;
export function setJobEndHook(fn: typeof jobEndHook): void { jobEndHook = fn; }
function finishThen(kind: JobState["kind"], accountId: number, onDone?: () => void): void {
  if (kind !== "watch" && jobEndHook?.(accountId, onDone)) return;
  onDone?.();
}

export function runningFor(accountId: number): JobState | undefined {
  return [...jobs.values()].find((j) => j.accountId === accountId && j.status === "running");
}
/** Arrête un travail et attend qu'il soit vraiment fini (au plus `timeoutMs`). */
export async function stopAndWait(id: number, timeoutMs = 30_000): Promise<void> {
  stopJob(id);
  const until = Date.now() + timeoutMs;
  while (jobs.get(id)?.status === "running" && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** Ce qu'un lot a produit de neuf (décisions prises pendant ce passage) : pour le fil d'activité. */
interface PassCounts { n: number; todo: number; review: number; toCal: number }
async function processItems(c: Classifier, gm: GmailConnector, items: Item[], job: JobState, apply: boolean): Promise<PassCounts> {
  const counts: PassCounts = { n: 0, todo: 0, review: 0, toCal: 0 };
  await pool(items, c.settings.concurrency, async (item) => {
    if (stops.get(job.id)) return;
    const itemId = upsertItem(c.db, item);
    // Déjà décidé (aperçu précédent, ou correction) : on réutilise, sans rappeler Jev.
    const prev = c.db.prepare("SELECT decided_by, category, confidence, needs_review, flags_json FROM decisions WHERE item_id = ?").get(itemId) as
      | { decided_by: Decision["decidedBy"]; category: string | null; confidence: number | null; needs_review: number; flags_json: string | null } | undefined;
    let o;
    try {
      o = prev
        ? { decidedBy: prev.decided_by, category: prev.category, confidence: prev.confidence, needsReview: !!prev.needs_review, flags: prev.flags_json ? JSON.parse(prev.flags_json) : { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false } }
        : await classify(c, item, { usage: { purpose: "classify", itemId } });
    } catch (err) {
      // Une erreur sur un email n'arrête pas le passage : on le saute, il sera repris plus tard.
      job.errors++;
      job.lastError = (err as Error).message.slice(0, 160);
      return;
    }
    if (!prev) {
      saveDecision(c.db, { itemId, ...o });
      counts.n++;
      if (o.needsReview) counts.review++;
      const f = o.flags as Record<string, boolean | undefined>;
      if (!item.isOutgoing && (f.important || f.reply || f.toPay || f.event || f.task)) counts.todo++;
      if (f.event || f.task) counts.toCal++;
    } else job.reused++;
    job.processed++;
    // Une date déjà passée à la lecture : l'email sort de la file tout seul, personne n'a d'action à faire pour rien.
    if (!prev && apply && (o.flags.event || o.flags.task)) {
      try { await settleProposal(c, itemId, o.flags, () => gm.getFull(item.externalId)); } catch (err) { job.lastError = t("job.proposalError", { error: (err as Error).message.slice(0, 120) }); }
    }
    if ("jev" in o && o.jev) {
      job.jevCalls++;
      job.inputTokens += ("inputTokens" in o && o.inputTokens) || 0;
      job.latencies.push(("latencyMs" in o && o.latencyMs) || 0);
      if (job.latencies.length > 60) job.latencies.shift();
    }
    if (o.needsReview) job.review++;
    if (!prev && o.category && !o.needsReview && o.decidedBy === "jev") rememberSender(c.db, item.accountId, item.fromAddress, o.category);
    const labels = labelsFor(c, o);
    if (apply && labels.length) {
      // Un libellé qui n'a pas pu être posé n'arrête pas le passage : l'email reste « non appliqué » et sera repris.
      try { await gm.applyLabels(item.externalId, labels, []); markApplied(c.db, itemId, labels); }
      catch (err) { if (err instanceof StoppedError) throw err; job.errors++; job.lastError = (err as Error).message.slice(0, 160); }
    }
    job.recent.unshift({ itemId, from: item.fromAddress, subject: item.subject, category: o.category, confidence: o.confidence, needsReview: o.needsReview, flags: o.flags });
    if (job.recent.length > 20) job.recent.pop();
  });
  return counts;
}

/** Comment traiter les emails d'une catégorie touchée par un changement de taxonomie. */
export type ReclassMode = "jev" | "child" | "review" | "keep" | "refresh";
export interface ReclassPlan {
  modes: Record<string, ReclassMode>;
  /** Libellés Gmail des catégories retirées, pour les enlever. */
  oldLabels?: Record<string, string>;
  /** « Reclasser » ou « Relancer Jev » à la demande : tous les emails passent en mode « refresh ». */
  refresh?: boolean;
}

export type StoredItem = { id: number; account_id: number; external_id: string; thread_id: string | null; from_name: string | null; from_address: string | null; subject: string | null; date: string | null; body_excerpt: string | null; has_attachments: number | null; has_list_unsubscribe: number | null; is_outgoing: number | null; labels_json: string | null; category: string | null; decided_by: string; needs_review: number; answers_json: string | null; flags_json: string | null; applied_at: string | null; applied_labels_json?: string | null };
function itemFromRow(r: StoredItem): Item {
  return { externalId: r.external_id, threadId: r.thread_id ?? undefined, accountId: r.account_id, source: "gmail", fromName: r.from_name ?? "", fromAddress: r.from_address ?? "", to: [], subject: r.subject ?? "", date: new Date(r.date ?? Date.now()), bodyExcerpt: r.body_excerpt ?? "", hasAttachments: !!r.has_attachments, hasListUnsubscribe: !!r.has_list_unsubscribe, isOutgoing: !!r.is_outgoing, labels: r.labels_json ? JSON.parse(r.labels_json) : [] };
}

/**
 * Reclassement après un changement de taxonomie. Tout part de la base locale : l'extrait
 * stocké suffit à Jev, aucune relecture Gmail. Le libellé Gmail n'est déplacé que s'il avait été posé.
 * Les emails corrigés à la main ou « à revoir » ne sont pas retouchés, sauf si leur catégorie a disparu.
 */
async function reclassifyItems(c: Classifier, gm: GmailConnector, rows: StoredItem[], plan: ReclassPlan, job: JobState): Promise<void> {
  const p = c.taxonomy.prefix, s = c.settings.specialLabels;
  const labelNameFor = (key: string | null) => { const cat = findCategory(c.taxonomy, key); return cat ? labelName(c.taxonomy, cat) : undefined; };
  await pool(rows, c.settings.concurrency, async (r) => {
    if (stops.get(job.id)) return;
    const mode = plan.refresh ? "refresh" : plan.modes[r.category ?? ""] ?? "keep";
    const item = itemFromRow(r);
    // La taxonomie chargée est déjà la nouvelle : pour une catégorie retirée, l'ancien libellé vient du plan.
    const prevLabel = labelNameFor(r.category) ?? plan.oldLabels?.[r.category ?? ""] ?? null;
    try {
      let next: string | null = r.category, review = !!r.needs_review, decidedBy = r.decided_by, o: Awaited<ReturnType<typeof classify>> | undefined;
      if (mode === "refresh") {
        // À la demande : les nouvelles réponses de Jev sont toujours gardées (urgence, portée dans le temps, signaux),
        // même quand la catégorie ne change pas. Une catégorie choisie par l'utilisateur reste la sienne ; une règle
        // « Sans Jev » ne part jamais à l'IA (classify s'arrête à la règle).
        const fresh = await classify(c, item, { ignoreMemory: true, usage: { purpose: "reclassify", itemId: r.id } });
        if (fresh.inputTokens != null) { job.jevCalls++; job.inputTokens += fresh.inputTokens; job.latencies.push(fresh.latencyMs ?? 0); if (job.latencies.length > 60) job.latencies.shift(); }
        // Les drapeaux d'état (relance suivie, « ignoré »…) ne viennent pas de Jev : on les garde.
        const kept = (r.flags_json ? JSON.parse(r.flags_json) : {}) as Record<string, unknown>;
        if (!("ephemeral" in fresh.flags)) delete kept.ephemeral;
        o = { ...fresh, flags: { ...kept, ...fresh.flags } as typeof fresh.flags, ...(r.decided_by === "user" ? { category: r.category, needsReview: false, decidedBy: "user" as const, confidence: 1 } : {}) };
        saveDecision(c.db, { itemId: r.id, ...o });
        next = o.category; review = o.needsReview;
        let moved = next !== r.category || review !== !!r.needs_review;
        if (r.applied_at) {
          const add = labelsFor(c, o);
          const before = (r.applied_labels_json ? JSON.parse(r.applied_labels_json) : []) as string[];
          const remove = [...new Set([...before, prevLabel, `${p}/${s.review}`])].filter((x): x is string => !!x && x.startsWith(`${p}/`) && !add.includes(x));
          // Gmail seulement si les libellés changent vraiment.
          if (add.some((x) => !before.includes(x)) || remove.some((x) => before.includes(x) || x === prevLabel)) { await gm.applyLabels(r.external_id, add, remove); moved = true; }
          markApplied(c.db, r.id, add);
        }
        if (moved) job.changed = (job.changed ?? 0) + 1;
        if (review) job.review++;
      } else if (mode === "jev") {
        o = await classify(c, item, { ignoreMemory: true, usage: { purpose: "reclassify", itemId: r.id } });
        next = o.category; review = o.needsReview; decidedBy = o.decidedBy;
        job.jevCalls++; job.inputTokens += o.inputTokens ?? 0; job.latencies.push(o.latencyMs ?? 0); if (job.latencies.length > 60) job.latencies.shift();
      } else if (mode === "child") {
        const answers = r.answers_json ? (JSON.parse(r.answers_json) as Record<string, unknown>) : undefined;
        next = routeByChild(c, r.category, answers, c.settings.thresholds.categoryConfidence);
      } else if (mode === "review") {
        review = true;
      }
      const changed = mode !== "refresh" && (next !== r.category || review !== !!r.needs_review);
      if (changed) {
        if (o) saveDecision(c.db, { itemId: r.id, ...o });
        else c.db.prepare("UPDATE decisions SET category = ?, needs_review = ?, decided_by = ?, decided_at = datetime('now') WHERE item_id = ?").run(next, review ? 1 : 0, decidedBy, r.id);
        if (r.applied_at) {
          const add = o ? labelsFor(c, o) : [labelNameFor(next), review ? `${p}/${s.review}` : undefined].filter((x): x is string => !!x);
          const remove = [prevLabel, review ? undefined : `${p}/${s.review}`].filter((x): x is string => !!x && !add.includes(x));
          await gm.applyLabels(r.external_id, add, remove);
          markApplied(c.db, r.id, add);
        }
        if (review) job.review++;
      }
      job.processed++;
      job.recent.unshift({ itemId: r.id, from: item.fromAddress, subject: item.subject, category: next, confidence: o?.confidence ?? null, needsReview: review, flags: o?.flags ?? (r.flags_json ? JSON.parse(r.flags_json) : {}) });
      if (job.recent.length > 20) job.recent.pop();
    } catch (err) {
      job.errors++;
      job.lastError = (err as Error).message.slice(0, 160);
    }
  });
}

/**
 * Les emails à relancer à la demande, par compte, les plus récents d'abord : une liste cochée (`ids`), ou une boîte
 * avec une période (« 30d », « all »…) et, si on veut, une seule catégorie. `max` garde les plus récents (curseur du coût).
 */
export function refreshTargets(c: Classifier, sel: { ids?: number[]; accountId?: number; period?: string; category?: string; max?: number }): Map<number, StoredItem[]> {
  const where = ["a.source = 'gmail'"], params: unknown[] = [];
  if (sel.ids?.length) { const ids = sel.ids.slice(0, 5000).map(Number); where.push(`i.id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  else {
    where.push("i.account_id = ?"); params.push(Number(sel.accountId));
    const days = /^(\d+)d$/.exec(sel.period ?? "")?.[1];
    if (days) where.push(`julianday(i.date) >= julianday('now', '-${Number(days)} days')`);
    if (sel.category) { where.push("d.category = ?"); params.push(sel.category); }
  }
  let rows = c.db.prepare(`SELECT i.*, d.category, d.decided_by, d.needs_review, d.answers_json, d.flags_json, d.applied_at, d.applied_labels_json
    FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${where.join(" AND ")} ORDER BY i.date DESC`).all(...params) as StoredItem[];
  if (sel.max != null && sel.max >= 0) rows = rows.slice(0, sel.max);
  const out = new Map<number, StoredItem[]>();
  for (const r of rows) out.set(r.account_id, [...(out.get(r.account_id) ?? []), r]);
  return out;
}

/** Les emails d'un compte concernés par un plan de reclassement. */
export function reclassRows(c: Classifier, accountId: number, plan: ReclassPlan, removedKeys: string[]): StoredItem[] {
  const keys = Object.entries(plan.modes).filter(([, m]) => m !== "keep").map(([k]) => k);
  if (!keys.length) return [];
  const rows = c.db.prepare(`SELECT i.*, d.category, d.decided_by, d.needs_review, d.answers_json, d.flags_json, d.applied_at FROM items i JOIN decisions d ON d.item_id = i.id
     WHERE i.account_id = ? AND d.category IN (${keys.map(() => "?").join(",")}) ORDER BY i.date DESC`).all(accountId, ...keys) as StoredItem[];
  // Une correction manuelle ou un « à revoir » se respecte, sauf si la catégorie n'existe plus.
  return rows.filter((r) => removedKeys.includes(r.category ?? "") || (r.decided_by !== "user" && !r.needs_review));
}

export function startReclassify(c: Classifier, gm: GmailConnector, accountId: number, rows: StoredItem[], plan: ReclassPlan, onDone?: () => void): JobState {
  if (runningFor(accountId)) throw Object.assign(new Error(t("err.jobBusy")), { code: "err.jobBusy" });
  const job: JobState = { id: ++seq, kind: "reclassify", accountId, status: "running", phase: t("job.reclassify"), errors: 0, processed: 0, reused: 0, skipped: 0, total: rows.length, review: 0, jevCalls: 0, inputTokens: 0, latencies: [], startedAt: Date.now(), recent: [], ...(plan.refresh ? { changed: 0 } : {}) };
  jobs.set(job.id, job);
  const runId = startRun(c.db, "reclassify", accountId);
  void (async () => {
    try {
      await gm.ensureLabels(allLabels(c));
      await reclassifyItems(c, gm, rows, plan, job);
      job.status = stops.get(job.id) ? "stopped" : "done";
      job.phase = t("job.done");
    } catch (err) {
      job.status = "error"; job.error = (err as Error).message;
    } finally {
      job.finishedAt = Date.now();
      finishRun(c.db, runId, { processed: job.processed, jevCalls: job.jevCalls, inputTokens: job.inputTokens, note: job.error });
      // Au fil d'activité : combien relus, combien ont changé (un reclassement de quelques secondes doit laisser une trace).
      const email = (c.db.prepare("SELECT email FROM accounts WHERE id = ?").get(accountId) as { email: string } | undefined)?.email ?? "";
      if (job.status === "error") logActivity(c.db, "gmail", "jobError", { kind: "reclassify", email, error: (job.error ?? "").slice(0, 200), auth: isAuthError(job.error) });
      else logActivity(c.db, "gmail", "jobDone", { kind: "reclassify", email, n: job.processed, review: job.review, status: job.status, ...(job.changed != null ? { changed: job.changed } : {}) });
      try { finishThen(job.kind, accountId, onDone); } catch (err) { console.error("[reclassement]", (err as Error).message); }
    }
  })();
  return job;
}

/** Requête Gmail pour une période : "7d", "30d", "90d", "365d", "all", ou "YYYY-MM-DD..YYYY-MM-DD". */
export function periodQuery(period?: string): string {
  if (!period || period === "all") return "";
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (m) return `after:${m[1].replace(/-/g, "/")} before:${m[2].replace(/-/g, "/")}`;
  const d = /^(\d+)d$/.exec(period);
  return d ? `newer_than:${d[1]}d` : "";
}

/** Refus d'authentification Google qui ne passera pas tout seul : il faut reconnecter la boîte. */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /invalid_grant|unauthorized_client|invalid_client/i.test(msg);
}

/**
 * Les emails qu'un aperçu ou un rattrapage lirait, comptés exactement (500 identifiants par appel, 5 unités) : sert au
 * passage lui-même et à l'estimation de coût montrée avant de le lancer. `keep` : ceux qui passeront par l'IA.
 */
export async function idsToProcess(c: Classifier, gm: GmailConnector, accountId: number, kind: "preview" | "backfill", opts: { period?: string; onlyNew?: boolean } = {}, run: { signal?: AbortSignal; onPage?: (n: number) => void } = {}): Promise<{ ids: string[]; keep: string[] }> {
  const apply = kind === "backfill";
  const query = [apply ? `-label:${c.taxonomy.prefix}` : "", periodQuery(opts.period)].filter(Boolean).join(" ");
  const ids = await gm.listIds(query, run);
  if (opts.onlyNew === false) return { ids, keep: ids };
  const known = new Set((c.db.prepare("SELECT external_id FROM items WHERE account_id = ?").all(accountId) as Array<{ external_id: string }>).map((r) => r.external_id));
  // Déjà connus mais pas finis : sans décision (classement en échec) ou, pour un rattrapage, libellés pas encore posés.
  const pending = new Set((c.db.prepare(`SELECT i.external_id FROM items i LEFT JOIN decisions d ON d.item_id = i.id WHERE i.account_id = ? AND (d.item_id IS NULL${apply ? " OR d.applied_at IS NULL" : ""})`).all(accountId) as Array<{ external_id: string }>).map((r) => r.external_id));
  return { ids, keep: ids.filter((id) => !known.has(id) || pending.has(id)) };
}

/** `onDone` : appelé à la fin du travail, quelle qu'elle soit (fini, arrêté, en erreur) ; sert à relancer une surveillance mise en pause. */
export function startJob(kind: JobState["kind"], c: Classifier, gm: GmailConnector, accountId: number, opts: { max?: number; every?: number; period?: string; onlyNew?: boolean; onDone?: () => void } = {}): JobState {
  if (runningFor(accountId)) throw Object.assign(new Error(t("err.jobBusy")), { code: "err.jobBusy" });
  const job: JobState = { id: ++seq, kind, accountId, status: "running", phase: t("job.starting"), errors: 0, processed: 0, reused: 0, skipped: 0, total: opts.max ?? null, review: 0, jevCalls: 0, inputTokens: 0, latencies: [], startedAt: Date.now(), recent: [], every: kind === "watch" ? opts.every ?? WATCH_EVERY_DEFAULT : undefined };
  jobs.set(job.id, job);
  const ac = new AbortController();
  aborters.set(job.id, ac);
  const signal = ac.signal;
  const runId = startRun(c.db, kind, accountId);
  const email = (c.db.prepare("SELECT email FROM accounts WHERE id = ?").get(accountId) as { email: string } | undefined)?.email ?? "";

  void (async () => {
    try {
      if (kind === "preview" || kind === "backfill") {
        const apply = kind === "backfill";
        if (apply) await gm.ensureLabels(allLabels(c));
        // 1. Comptage exact : on liste les identifiants (500 par appel, 5 unités). Le total en jeu est connu avant de lire.
        job.phase = t("job.counting");
        const { ids, keep } = await idsToProcess(c, gm, accountId, kind, opts, { signal, onPage: (n) => { job.phase = t("job.countingN", { n }); } });
        // Un échantillon (curseur « classer x % ») : les plus récents d'abord, jamais plus que demandé.
        const todo = opts.max != null && opts.max < keep.length ? keep.slice(0, Math.max(0, opts.max)) : keep;
        job.skipped = ids.length - keep.length;
        job.total = job.skipped + todo.length;
        job.scanned = job.skipped;
        // 2. Lecture et classement par lots de 25, du plus récent au plus ancien.
        // Un lot qui échoue ne tue pas des heures de rattrapage : panne réseau → attente puis même lot ; autre erreur → lot
        // compté en erreur, on continue (ses emails restent « à faire » pour le prochain rattrapage).
        let offline = 0;
        for (let i = 0; i < todo.length && !stops.get(job.id); ) {
          const chunk = todo.slice(i, i + 25);
          const scannedBefore: number = job.scanned ?? 0;
          try {
            job.phase = t("job.reading", { done: scannedBefore, total: job.total });
            const items = (await Promise.all(chunk.map((id) => gm.fetch(id, signal).then((it) => { job.scanned = (job.scanned ?? 0) + 1; return it; })))).filter((x): x is Item => x !== undefined);
            job.phase = apply ? t("job.classifyApply") : t("job.classifyPreview");
            await processItems(c, gm, items, job, apply);
            offline = 0;
            i += 25;
          } catch (err) {
            if (err instanceof StoppedError || stops.get(job.id) || isAuthError(err)) throw err;
            job.scanned = scannedBefore;
            if (isNetworkError(err)) {
              const wait = Math.min(netRetry.maxMs, netRetry.baseMs * 2 ** offline++);
              job.phase = job.lastError = t("job.offline", { s: Math.round(wait / 1000) });
              await pause(wait, signal);
              continue;
            }
            job.errors += chunk.length;
            job.lastError = (err as Error).message.slice(0, 160);
            job.scanned = scannedBefore + chunk.length;
            i += 25;
          }
        }
        // L'historique n'est « fini » que si tout a été lu : pas après un échantillon ni un arrêt.
        if (apply && !stops.get(job.id) && todo.length === keep.length && (!opts.period || opts.period === "all")) c.db.prepare("UPDATE accounts SET backfill_done = 1 WHERE id = ?").run(accountId);
      } else {
        const acc = c.db.prepare("SELECT history_id FROM accounts WHERE id = ?").get(accountId) as { history_id: string | null };
        let historyId = acc.history_id;
        let labelsReady = false;
        const saveHistory = (h: string) => c.db.prepare("UPDATE accounts SET history_id = ? WHERE id = ?").run(h, accountId);
        while (!stops.get(job.id)) {
          // Une erreur (réseau au réveil du Mac ou avant le Wi-Fi à l'ouverture de session, Gmail indisponible) ne tue pas
          // la surveillance : on note et on réessaie au passage suivant, préparation (libellés, point de départ) comprise.
          try {
            if (!labelsReady) { await gm.ensureLabels(allLabels(c)); labelsReady = true; }
            if (!historyId) { historyId = await gm.currentHistoryId(); saveHistory(historyId); }
            job.phase = t("job.waiting");
            const { ids, historyId: next } = await gm.newMessagesSince(historyId);
            if (ids.length) {
              job.phase = t("job.newEmails", { n: ids.length });
              // Les brouillons (un par sauvegarde automatique), le spam et la corbeille ne sont pas du courrier à classer. Les envoyés, si : la relance en dépend.
              const items = (await Promise.all(ids.map((id) => gm.fetch(id, signal)))).filter((x): x is Item => x !== undefined && !x.labels.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH"));
              const got = await processItems(c, gm, items, job, true);
              if (got.n) logActivity(c.db, "gmail", "pass", { email, ...got });
            }
            historyId = next;
            saveHistory(historyId);
            job.lastPassAt = Date.now();
          } catch (err) {
            if (err instanceof StoppedError || stops.get(job.id)) throw err;
            // Jeton révoqué ou client refusé : rien ne changera sans reconnexion, la surveillance finit en erreur (signalée au menu de l'app).
            if (isAuthError(err)) throw err;
            if (err instanceof HistoryExpiredError) {
              try { historyId = await gm.currentHistoryId(); saveHistory(historyId); job.lastError = t("job.historyReset"); }
              catch (e) { job.errors++; job.lastError = t("job.retrying", { error: (e as Error).message.slice(0, 140) }); }
            } else {
              job.errors++;
              job.lastError = t("job.retrying", { error: (err as Error).message.slice(0, 140) });
            }
          }
          // Pause jusqu'au prochain passage ; l'écouteur d'arrêt est retiré à chaque réveil (sinon ils s'accumulent pendant des jours).
          job.nextPassAt = Date.now() + (opts.every ?? WATCH_EVERY_DEFAULT) * 1000;
          await new Promise<void>((r) => {
            const onAbort = () => { clearTimeout(id); r(); };
            const id = setTimeout(() => { signal.removeEventListener("abort", onAbort); r(); }, (opts.every ?? WATCH_EVERY_DEFAULT) * 1000);
            signal.addEventListener("abort", onAbort, { once: true });
          });
        }
      }
      job.status = stops.get(job.id) ? "stopped" : "done";
      job.phase = job.processed === 0 && job.skipped ? t("job.nothingNew", { n: job.skipped }) : t("job.done");
      if (job.status === "done" && job.scanned) job.total = job.scanned;
    } catch (err) {
      if (err instanceof StoppedError || stops.get(job.id)) { job.status = "stopped"; job.phase = t("job.stopped"); }
      else { job.status = "error"; job.error = (err as Error).message; }
    } finally {
      aborters.delete(job.id);
      job.finishedAt = Date.now();
      job.nextPassAt = undefined;
      // Une surveillance qui s'arrête à la demande n'a rien à raconter ; sa panne, si.
      if (job.status === "error") logActivity(c.db, "gmail", "jobError", { kind, email, error: (job.error ?? "").slice(0, 200), auth: isAuthError(job.error) });
      else if (kind !== "watch") logActivity(c.db, "gmail", "jobDone", { kind, email, n: job.processed, review: job.review, status: job.status });
      finishRun(c.db, runId, { processed: job.processed, jevCalls: job.jevCalls, inputTokens: job.inputTokens, note: job.error });
      try { finishThen(kind, accountId, opts.onDone); } catch (err) { console.error(`[${kind}]`, (err as Error).message); }
    }
  })();
  return job;
}
