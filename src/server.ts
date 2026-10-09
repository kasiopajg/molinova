/**
 * Interface locale : http://127.0.0.1:4310
 * Un serveur minimal, sans dépendance, qui sert ui/ et une API JSON.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import open from "open";
import { GatewayAuthenticationError, GatewayForbiddenError, createGateway } from "@ai-sdk/gateway";
import { APP_MODE, MOLINOVA_PAGES, PATHS, ROOT, TERMS_VERSION, isLanguage, loadAppSettings, loadContext, postToMain, saveAppSettings, setupState, systemTimeZone, loadRules, loadSettings, loadTaxonomy, parseContext, parseRules, parseSettings, parseTaxonomy, saveRules, saveSettings, saveTaxonomy, type Rule, type Settings } from "./config.js";
import { GmailConnector, MAX_ATTACH_BYTES, SCOPE_CALENDAR, SCOPE_CALENDAR_CREATE, SCOPE_CALENDAR_LIST, SCOPE_DRAFTS, SCOPE_DRIVE_READ, authorizeNewAccount, cancelPendingAuthorization, currentGoogleClientId, gmailStatus, googleClientSource, hasToken, parseGoogleClient, scopesForAccount } from "./connectors/gmail.js";
import { calendarTemplateUrl, createCalendar, createCalendarEvent, findByIcalUid, listCalendars, listEvents, respondToInvite, type CalendarInfo, type EventDraft, type RsvpStatus, deleteCalendarEvent, patchEventProps } from "./connectors/calendar.js";
import { myPartstat, parseIcs, type IcsInvite } from "./core/ics.js";
import { addDays, buildLanes, eventDescription, findConflicts, householdMembers, parseYmd, titleFor, weekStart, ymd, type CalEvent } from "./core/agenda.js";
import { slug } from "./core/questions.js";
import { mailCount, mailWhere, obsoleteSql, priorityScoreSql } from "./core/mail-query.js";
import { declutter, toCalRows } from "./core/declutter.js";
import { agendaAccount, agendaCalendars, agendaMap, calendarsCache, ensureFamilyCalendar, forgetUpcoming, toCalWhere, type AgendaMap } from "./core/agenda-access.js";
import { changedFields } from "./core/event-match.js";
import { AUTO_MAX, autoClassifyOn, cardCounts, classifyDocs, classifying, docJobs, facetsText, markCardsStale, pendingDocs, stopClassify, upgradeFacets } from "./core/doc-classify.js";
import { contextName, loadDocTaxonomy, typeName } from "./core/doc-questions.js";
import { docById, docDetail, facetCounts, findDocs, listDocs, type BrowseFilter, type BrowseFlag } from "./core/doc-search.js";
import { textBin } from "./core/doc-extract.js";
import { downloadFile, previewHtml, previewInfo, previewPage, type PreviewDoc } from "./core/doc-preview.js";
import { composeTitle, docDate } from "./core/doc-facts.js";
import { cursorAfter, ingestWhatsApp, ingesting, whatsappAccountId, windows, type IngestStats } from "./core/wa-ingest.js";
import { aiRate, estimateFor, type EstimateSource } from "./core/estimate.js";
import { sweepQueue } from "./core/ephemeral.js";
import { applyUpdate, cacheProposal, cachedProposal, extractEventProposal, isPast, markPast, settleProposal, STATE_PAST, type EventProposal } from "./core/proposals.js";
import { allLabels, classify, labelsFor, makeClassifier, type Classifier } from "./core/classify.js";
import type { Item } from "./connectors/types.js";
import { saveDecision } from "./db.js";
import { askJev } from "./core/jev.js";
import { buildState } from "./core/questions.js";
import { isGmailColor, labelPairs } from "./core/palette.js";
import { currentLanguage, keyOf, t, type Key, type Language, type Params } from "./i18n/index.js";
import { planLanguageChange } from "./core/language.js";
import { diff as taxonomyDiff, labelName, normalize as normalizeTaxonomy } from "./core/taxonomy.js";
import { domainOf } from "./core/text.js";
import { KEY_PARAM, checkRequest, hasSession, sameKey, sessionCookie } from "./core/http-guard.js";
import { composeDraft, extractTask, quoted, subjectFor, type ComposeMode, type SourceText } from "./core/writer.js";
import { getAccount, kvGet, kvSet, refreshDocFts, listAccounts, listActivity, logActivity, openDb, rememberSender, upsertAccount, type AccountRow } from "./db.js";
import { getSecret, secretSource, setSecret } from "./secrets.js";
import * as wa from "./connectors/whatsapp.js";
import { DriveReader } from "./connectors/drive.js";
import { DRIVE_EVERY_MIN, FOLDER_MODES, FORMATS, driveBusy, driveEnabled, driveSettings, driveState, folderChildren, forgetDrive, formatCounts, nextDriveSync, refreshScope, rootSummary, saveDriveSettings, setDriveEnabled, setFolderMode, syncDrive, type Format, type FolderMode, type SyncResult } from "./core/drive-index.js";
import { checkToken, migrateTgToken, newPairing, refreshCommands, sendNow, startTelegram, stopTelegram, tgContacts, tgSchedule, tgState, tgToken, TG_DEFAULTS, type DriveDeps, type TgSchedule } from "./channels/telegram.js";
import { WATCH_EVERY_DEFAULT, getJob, idsToProcess, isAuthError, listJobs, reclassRows, refreshTargets, runningFor, setJobEndHook, startJob, startReclassify, stopAndWait, stopJob, watchesToResume, type ReclassMode, type StoredItem } from "./jobs.js";
import { ensureSeeded, gatewayCredits, gatewayModels, pricingFor, usageReport } from "./core/usage.js";

/** Erreur adressée à l'interface, dans la langue de l'app ; `code` garde la clé, `status` le code HTTP. */
function fail(key: Key, params?: Params, status?: number): never { throw Object.assign(new Error(t(key, params)), { code: key, ...(status ? { status } : {}) }); }

/** MOLINOVA_PORT (choisi par l'app), sinon 4310. */
const PORT = Number(process.env.MOLINOVA_PORT || 4310);
const UI = path.join(ROOT, "ui");
/**
 * Clé de session de l'interface : donnée par l'app à chaque lancement (MOLINOVA_SESSION_KEY), sinon gardée dans data/session.key
 * (mode dev, lisible par l'utilisateur seul). Sans elle, /api/ ne répond à personne : ni autre compte du Mac, ni autre app.
 */
function sessionKey(): string {
  const fromApp = process.env.MOLINOVA_SESSION_KEY;
  delete process.env.MOLINOVA_SESSION_KEY; // pas transmise aux outils lancés par le serveur
  if (fromApp && fromApp.length >= 32) return fromApp;
  const file = path.join(PATHS.data, "session.key");
  try { const k = fs.readFileSync(file, "utf8").trim(); if (k.length >= 32) return k; } catch { /* première fois */ }
  const k = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(file, k, { mode: 0o600 });
  return k;
}
const SESSION_KEY = sessionKey();

const connectors = new Map<number, GmailConnector>();
const totalsRefreshed = new Map<number, number>();
function classifier(): Classifier {
  // settings d'abord : loadSettings() pose la langue, les messages de validation de la taxonomie la suivent.
  return makeClassifier({ settings: loadSettings(), taxonomy: loadTaxonomy(), rules: loadRules(), ctx: loadContext(), db: openDb() });
}
function connector(accountId: number, c: Classifier): GmailConnector {
  let gm = connectors.get(accountId);
  if (!gm) {
    const acc = getAccount(c.db, String(accountId));
    if (!acc) fail("err.unknownAccount");
    if (acc.source !== "gmail") fail("err.notGmail");
    gm = new GmailConnector(acc.id, acc.email, c.ctx.owner.emails.map((e) => e.toLowerCase()), c.settings.bodyExcerptChars);
    connectors.set(accountId, gm);
  }
  return gm;
}

/** Lance la surveillance d'un compte et la note en base (watch_since, watch_every) : elle repartira au prochain démarrage. */
function startWatch(accountId: number, every?: number) {
  const c = classifier();
  const job = startJob("watch", c, connector(accountId, c), accountId, { every });
  c.db.prepare("UPDATE accounts SET watch_since = datetime('now'), watch_every = ? WHERE id = ?").run(job.every ?? WATCH_EVERY_DEFAULT, accountId);
  return job;
}
/** Oublie la surveillance d'un compte : arrêtée par l'utilisateur, elle ne repart pas au démarrage. */
function forgetWatch(accountId: number): void {
  openDb().prepare("UPDATE accounts SET watch_since = NULL, watch_every = NULL WHERE id = ?").run(accountId);
}

/** Objet sans ses préfixes de réponse ou de transfert, pour reconnaître une même conversation. */
function conversationSubject(subject: string | null): string {
  return String(subject ?? "").toLowerCase().replace(/^(\s*(re|fwd?|tr|aw|wg)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
}
/**
 * Pour un envoi de ma part : y a-t-il, depuis, un email plus récent de la même conversation (même objet nettoyé,
 * même interlocuteur) ? « sent » si j'ai réécrit, « received » si l'interlocuteur a répondu, sinon null.
 */
function newerInConversation(c: Classifier, r: { id: number; account_id: number; date: string; subject: string | null; to_json: string | null }): "sent" | "received" | null {
  let to: string[] = []; try { to = JSON.parse(r.to_json || "[]"); } catch { /* pas de destinataires connus */ }
  const who = (to[0] ?? "").toLowerCase();
  const subj = conversationSubject(r.subject);
  if (!who || !subj) return null;
  const rows = c.db.prepare("SELECT is_outgoing, subject, to_json, from_address FROM items WHERE account_id = ? AND id <> ? AND date > ? ORDER BY date DESC LIMIT 200").all(r.account_id, r.id, r.date) as Array<{ is_outgoing: number; subject: string | null; to_json: string | null; from_address: string | null }>;
  for (const x of rows) {
    if (conversationSubject(x.subject) !== subj) continue;
    if (x.is_outgoing && String(x.to_json ?? "").toLowerCase().includes(who)) return "sent";
    if (!x.is_outgoing && String(x.from_address ?? "").toLowerCase() === who) return "received";
  }
  return null;
}

/** Le groupe d'une décision dans la file Actions, du plus urgent au moins urgent. Un email compte une fois. */
type FlagRow = { flags_json: string | null; needs_review?: number };
function groupOf(r: FlagRow): "important" | "reply" | "followUp" | "toPay" | "event" | "task" | "read" {
  const f = (r.flags_json ? JSON.parse(r.flags_json) : {}) as Record<string, boolean>;
  return f.important ? "important" : f.reply ? "reply" : f.followUp ? "followUp" : f.toPay ? "toPay" : f.event ? "event" : f.task ? "task" : "read";
}

type Handler = (req: http.IncomingMessage, url: URL, body: unknown) => Promise<unknown> | unknown;
const routes: Array<{ method: string; pattern: RegExp; handler: (m: RegExpMatchArray, ...rest: Parameters<Handler>) => ReturnType<Handler> }> = [];
const route = (method: string, pattern: string, handler: (m: RegExpMatchArray, ...rest: Parameters<Handler>) => ReturnType<Handler>) =>
  routes.push({ method, pattern: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler });

// ---------- vue d'ensemble
route("GET", "/api/overview", () => {
  const c = classifier();
  for (const a of listAccounts(c.db).filter((x) => x.source === "gmail")) {
    const last = totalsRefreshed.get(a.id) ?? 0;
    if (Date.now() - last > 5 * 60_000) {
      totalsRefreshed.set(a.id, Date.now());
      // Client Google absent ou jeton illisible : le total reste l'ancien, la page s'affiche quand même.
      try { connector(a.id, c).messagesTotal().then((n) => c.db.prepare("UPDATE accounts SET messages_total = ? WHERE id = ?").run(n, a.id)).catch(() => {}); } catch { /* voir ci-dessus */ }
    }
  }
  const accounts = listAccounts(c.db).map((a) => {
    const n = c.db.prepare("SELECT COUNT(*) n FROM items WHERE account_id = ?").get(a.id) as { n: number };
    const decided = c.db.prepare("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.needs_review = 0").get(a.id) as { n: number };
    const review = c.db.prepare("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.needs_review = 1").get(a.id) as { n: number };
    const applied = c.db.prepare("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.applied_at IS NOT NULL").get(a.id) as { n: number };
    const corrected = c.db.prepare("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.decided_by = 'user'").get(a.id) as { n: number };
    const watching = listJobs().find((j) => j.accountId === a.id && j.kind === "watch" && j.status === "running");
    const pending = c.db.prepare("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.applied_at IS NULL").get(a.id) as { n: number };
    return { ...a, items: n.n, decided: decided.n, review: review.n, applied: applied.n, corrected: corrected.n, pending: pending.n, watching: watching ? watching.startedAt : null };
  });
  const byCategory = c.db
    .prepare("SELECT category, COUNT(*) n, SUM(COALESCE(json_extract(flags_json, '$.important'), 0)) important FROM decisions WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC")
    .all() as Array<{ category: string; n: number; important: number }>;
  // Partition des emails lus : chaque email compte dans une seule tuile.
  const total = (c.db.prepare("SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id").get() as { n: number }).n;
  const review = mailCount(c, "review");
  const todo = mailCount(c, "todo");
  const noise = mailCount(c, "noise");
  const done = mailCount(c, "done");
  const filed = mailCount(c, "filed");
  // Détail de « à traiter » par groupe d'action, même précédence que la liste Actions.
  const { where, params } = mailWhere(c, "todo", null, "");
  const rows = c.db.prepare(`SELECT d.flags_json, d.needs_review FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")}`).all(...params) as FlagRow[];
  const groups = { important: 0, reply: 0, followUp: 0, toPay: 0, event: 0, task: 0, read: 0 };
  for (const r of rows) groups[groupOf(r)]++;
  const kpi = { total, review, todo, noise, done, filed, other: total - review - todo - noise - done - filed, groups, unread: mailCount(c, "unread") };
  ensureSeeded(c.db, c.settings);
  // Appels Jev et coût total : depuis le suivi d'usage (coût réel de la passerelle quand il est connu, sinon au tarif du modèle).
  const totals = c.db.prepare("SELECT COALESCE(SUM(CASE WHEN purpose IN ('classify','reclassify','test') THEN 1 ELSE 0 END),0) jev, COALESCE(SUM(input_tokens),0) tokens, COALESCE(SUM(cost),0) cost FROM usage").get();
  return { accounts, byCategory, kpi, totals, jobs: listJobs(), queued: Object.fromEntries(accounts.map((a) => [a.id, queuedCount(a.id)]).filter(([, n]) => n)), taxonomy: c.taxonomy, settings: c.settings, gmail: { throttledFor: Math.max(0, Math.round((gmailStatus.throttledUntil - Date.now()) / 1000)), quotaHits: gmailStatus.quotaHits } };
});

// ---------- éléments
/** `review=1` : la page « À classer », mêmes critères que le filtre `review` (et que son compteur). */
route("GET", "/api/items", (_m, _req, url) => {
  const c = classifier();
  const review = url.searchParams.get("review") === "1";
  const account = url.searchParams.get("account");
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const rows = c.db
    .prepare(
      `SELECT i.id, i.account_id, i.external_id, i.from_name, i.from_address, i.subject, i.date, i.body_excerpt, i.labels_json, d.category, d.confidence, d.needs_review, d.flags_json, d.answers_json, d.decided_by
       FROM items i JOIN decisions d ON d.item_id = i.id
       WHERE (? = 0 OR (d.needs_review = 1 AND d.action_state = 0 AND COALESCE(i.is_outgoing, 0) = 0)) AND (? IS NULL OR i.account_id = ?)
       ORDER BY i.date DESC LIMIT ?`,
    )
    .all(review ? 1 : 0, account, account, limit);
  return rows;
});


route("GET", "/api/mail", (_m, _req, url) => {
  const c = classifier();
  const q = url.searchParams;
  const filter = q.get("filter") ?? "all";
  const account = q.get("account");
  const search = (q.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(200, Number(q.get("limit") ?? 80));
  const offset = Number(q.get("offset") ?? 0);
  const { where, params } = mailWhere(c, filter, account, search);
  // Tri : date (défaut), importants d'abord, non lus d'abord, priorité Jev.
  const sort = q.get("sort") ?? "date";
  const sortSql =
    sort === "important" ? "COALESCE(json_extract(d.flags_json, '$.important'), 0) DESC, "
    : sort === "unread" ? "(i.labels_json LIKE '%UNREAD%') DESC, "
    : sort === "priority" ? "prio DESC, "
    : "";
  const rows = c.db
    .prepare(
      `SELECT i.id, i.account_id, i.from_name, i.from_address, i.subject, i.date, i.labels_json, i.body_excerpt, i.has_attachments, i.is_outgoing, i.to_json, a.source,
              ${priorityScoreSql(c.settings.thresholds)} prio, ${obsoleteSql(c)} obsolete, d.category, d.confidence, d.needs_review, d.flags_json, d.answers_json, d.decided_by, d.applied_at, d.action_state, d.thread_note, d.thread_last_at,
              json_extract(e.draft_json, '$.kind') prop_kind, json_extract(e.draft_json, '$.found') prop_found, json_extract(e.draft_json, '$.title') prop_title,
              json_extract(e.draft_json, '$.due') prop_due, json_extract(e.draft_json, '$.start') prop_start, json_extract(e.draft_json, '$.allDay') prop_all_day
       FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id LEFT JOIN event_drafts e ON e.item_id = i.id WHERE ${where.join(" AND ")}
       ORDER BY ${sortSql}${filter === "queue" ? "(json_extract(d.flags_json, '$.important') = 1) DESC, (json_extract(d.flags_json, '$.reply') = 1) DESC, (json_extract(d.flags_json, '$.toPay') = 1) DESC, d.needs_review DESC," : ""} i.date DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const total = (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
  return { rows, total };
});

/** Onglet Brouillons : lus chez Gmail à l'ouverture, boîte par boîte (une boîte en erreur n'empêche pas les autres). */
route("GET", "/api/drafts", async (_m, _req, url) => {
  const c = classifier();
  const only = url.searchParams.get("account");
  const accounts = listAccounts(openDb()).filter((a) => a.source === "gmail" && (!only || String(a.id) === only));
  const rows: Array<Record<string, unknown>> = [], errors: string[] = [];
  for (const a of accounts) {
    try { for (const d of await connector(a.id, c).listDrafts()) rows.push({ ...d, accountId: a.id, accountEmail: a.email }); }
    catch (err) { errors.push(`${a.email} : ${(err as Error).message.slice(0, 160)}`); }
  }
  rows.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  return { rows, errors };
});
/** Un brouillon en entier, pour le volet de lecture (le message d'un brouillon se lit comme un autre). */
route("GET", "/api/drafts/:account/:message", async (m) => {
  const c = classifier();
  return connector(Number(m.groups!.account), c).getFull(decodeURIComponent(m.groups!.message));
});
/** Tous les identifiants d'un filtre, pour une action en bloc. */
route("GET", "/api/mail/ids", (_m, _req, url) => {
  const c = classifier();
  const q = url.searchParams;
  const { where, params } = mailWhere(c, q.get("filter") ?? "all", q.get("account"), (q.get("q") ?? "").trim().toLowerCase());
  const rows = c.db.prepare(`SELECT i.id FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")} ORDER BY i.date DESC LIMIT 2000`).all(...params) as Array<{ id: number }>;
  return rows.map((r) => r.id);
});

/**
 * Carte de la boîte : de quoi parlent les emails, agrégé en SQL, sans appel à Jev.
 * lens=category : une ligne par (domaine, catégorie). lens=domain : la même chose, plus une ligne par (expéditeur, catégorie)
 * pour les domaines les plus actifs. Les emails « à revoir » (catégorie NULL) comptent dans review, pas dans les liens.
 */
route("GET", "/api/map", (_m, _req, url) => {
  const c = classifier();
  const q = url.searchParams;
  const lens = q.get("lens") === "domain" ? "domain" : "category";
  const account = q.get("account");
  const period = q.get("period") ?? "all";
  const topDomains = Math.min(120, Math.max(10, Number(q.get("top") ?? 44)));
  const where: string[] = ["i.from_address IS NOT NULL", "i.from_address LIKE '%@%'"];
  const params: unknown[] = [];
  if (account) { where.push("i.account_id = ?"); params.push(Number(account)); }
  const days = /^(\d+)d$/.exec(period)?.[1];
  if (days) { where.push("i.date >= ?"); params.push(new Date(Date.now() - Number(days) * 86400000).toISOString()); }
  const W = where.join(" AND ");
  const domainExpr = "lower(substr(i.from_address, instr(i.from_address, '@') + 1))";
  // « Important » ici = encore à traiter (action_state = 0), même sens que le filtre « important » de la Boîte.
  const imp = "SUM(CASE WHEN COALESCE(json_extract(d.flags_json, '$.important'), 0) = 1 AND d.action_state = 0 THEN 1 ELSE 0 END) important";
  const agg = `COUNT(*) n, ${imp}, SUM(d.needs_review) review`;
  const rows = c.db
    .prepare(`SELECT ${domainExpr} domain, d.category, ${agg} FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${W} GROUP BY domain, d.category`)
    .all(...params) as Array<{ domain: string; category: string | null; n: number; important: number; review: number }>;
  let senders: Array<{ from_address: string; domain: string; category: string | null; n: number; important: number }> = [];
  if (lens === "domain") {
    senders = c.db
      .prepare(
        `WITH top AS (SELECT ${domainExpr} domain, COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${W} GROUP BY domain ORDER BY n DESC LIMIT ?)
         SELECT lower(i.from_address) from_address, ${domainExpr} domain, d.category, COUNT(*) n, ${imp}
         FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${W} AND ${domainExpr} IN (SELECT domain FROM top)
         GROUP BY from_address, d.category`,
      )
      .all(...params, topDomains, ...params) as typeof senders;
  }
  const total = rows.reduce((s, r) => s + r.n, 0);
  const domains = new Set(rows.map((r) => r.domain)).size;
  return { lens, rows, senders, total, domains, topDomains, taxonomy: c.taxonomy };
});

/**
 * « Ignorer » : sort de la file (action_state = 2) et, pour un email encore non lu, le marque lu dans Gmail.
 * Rien d'autre : pas d'archivage, pas de libellé. Une fenêtre WhatsApp sort simplement de la file.
 */
async function ignoreItem(c: Classifier, id: number): Promise<void> {
  const item = c.db.prepare("SELECT i.id, i.account_id, i.external_id, i.labels_json, a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id = ?").get(id) as { id: number; account_id: number; external_id: string; labels_json: string; source: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  c.db.prepare("UPDATE decisions SET action_state = 2 WHERE item_id = ?").run(item.id);
  const labels = JSON.parse(item.labels_json || "[]") as string[];
  if (item.source === "gmail" && labels.includes("UNREAD")) {
    await connector(item.account_id, c).markRead(item.external_id, true);
    c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels.filter((l) => l !== "UNREAD")), item.id);
  }
}
/**
 * Action en bloc : archiver, marquer lu, ignorer, ou changer de catégorie.
 * Déclenchée par un clic confirmé. Rien n'est jamais supprimé.
 */
route("POST", "/api/mail/bulk", async (_m, _req, _url, body) => {
  const c = classifier();
  const { ids, action, category } = body as { ids: number[]; action: "archive" | "read" | "quiet" | "category"; category?: string };
  const cat = action === "category" ? c.taxonomy.categories.find((x) => x.key === category) : undefined;
  if (action === "category" && !cat) fail("err.unknownCategory");
  const p = c.taxonomy.prefix;
  let n = 0;
  type BulkItem = { id: number; account_id: number; external_id: string; from_address: string; labels_json: string };
  const sel = c.db.prepare("SELECT id, account_id, external_id, from_address, labels_json FROM items WHERE id = ?");
  // Archiver ou marquer comme lu : un appel Gmail par compte et par tranche de 1 000, prioritaire sur un rattrapage en cours,
  // au lieu d'un appel par email (le nettoyage de milliers d'emails prenait des minutes, sans nouvelles).
  if (action === "archive" || action === "read") {
    const label = action === "archive" ? "INBOX" : "UNREAD";
    const items = ids.slice(0, 5000).map((id) => sel.get(id) as BulkItem | undefined).filter((x): x is BulkItem => !!x);
    const byAccount = new Map<number, BulkItem[]>();
    for (const it of items) byAccount.set(it.account_id, [...(byAccount.get(it.account_id) ?? []), it]);
    const upd = c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?");
    for (const [accountId, list] of byAccount) {
      await connector(accountId, c).batchModify(list.map((x) => x.external_id), [], [label]);
      c.db.transaction(() => { for (const it of list) upd.run(JSON.stringify((JSON.parse(it.labels_json || "[]") as string[]).filter((l) => l !== label)), it.id); })();
      n += list.length;
    }
    return { ok: true, n };
  }
  for (const id of ids.slice(0, 2000)) {
    const item = sel.get(id) as BulkItem | undefined;
    if (!item) continue;
    if (action === "quiet") { await ignoreItem(c, item.id); n++; continue; }
    const gm = connector(item.account_id, c);
    const labels = JSON.parse(item.labels_json || "[]") as string[];
    if (cat) {
      const prev = c.db.prepare("SELECT category, applied_at FROM decisions WHERE item_id = ?").get(item.id) as { category: string | null; applied_at: string | null } | undefined;
      if (prev?.category !== cat.key) {
        c.db.prepare("INSERT INTO corrections (item_id, from_category, to_category) VALUES (?, ?, ?)").run(item.id, prev?.category ?? null, cat.key);
        rememberSender(c.db, item.account_id, item.from_address, cat.key);
      }
      c.db.prepare("UPDATE decisions SET category = ?, needs_review = 0, decided_by = 'user', confidence = 1 WHERE item_id = ?").run(cat.key, item.id);
      if (prev?.applied_at) {
        await gm.ensureLabels(allLabels(c));
        const prevCat = c.taxonomy.categories.find((x) => x.key === prev.category);
        const remove = [`${p}/${c.settings.specialLabels.review}`, ...(prevCat && prevCat.key !== cat.key ? [labelName(c.taxonomy, prevCat)] : [])];
        await gm.applyLabels(item.external_id, [labelName(c.taxonomy, cat)], remove);
      }
    }
    c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels), item.id);
    n++;
  }
  return { ok: true, n };
});

// ---------- lecture complète, pièces jointes, actions sur l'email
route("GET", "/api/items/:id/full", async (m) => {
  const c = classifier();
  const item = c.db.prepare("SELECT id, account_id, external_id, labels_json FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; external_id: string; labels_json: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  const full = await gm.getFull(item.external_id);
  // Lire dans l'outil = lire dans Gmail : on retire « non lu », comme le ferait Gmail.
  if (full.labels.includes("UNREAD")) {
    await gm.markRead(item.external_id, true);
    full.labels = full.labels.filter((l) => l !== "UNREAD");
  }
  c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?").run(JSON.stringify(full.labels), item.id);
  return full;
});
/** Le fil complet de l'email : tous les messages, envoyés compris. */
route("GET", "/api/items/:id/thread", async (m) => {
  const c = classifier();
  const item = c.db.prepare("SELECT account_id, external_id, thread_id FROM items WHERE id = ?").get(m.groups!.id) as { account_id: number; external_id: string; thread_id: string | null } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  const msgs = item.thread_id ? await gm.getThread(item.thread_id) : [await gm.getFull(item.external_id)];
  const mine = c.ctx.owner.emails.map((e) => e.toLowerCase());
  return msgs.map((x) => ({ ...x, fromMe: mine.some((e) => x.from.toLowerCase().includes(e)) || x.labels.includes("SENT") }));
});
route("GET", "/api/items/:id/attachments/:att", async (m, _req, url) => {
  const c = classifier();
  const item = c.db.prepare("SELECT account_id, external_id, thread_id FROM items WHERE id = ?").get(m.groups!.id) as { account_id: number; external_id: string; thread_id: string | null } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  // Une pièce jointe d'un autre message du fil est permise ; celle d'un message sans rapport, non.
  const msg = url.searchParams.get("msg") || item.external_id;
  if (msg !== item.external_id && (!item.thread_id || (await gm.threadOf(msg)) !== item.thread_id)) fail("err.unknownItem", undefined, 404);
  const data = await gm.getAttachment(msg, decodeURIComponent(m.groups!.att));
  return { __raw: data, name: url.searchParams.get("name") ?? "piece-jointe", mime: url.searchParams.get("mime") ?? "application/octet-stream" };
});
route("POST", "/api/items/:id/read", async (m, _req, _url, body) => {
  const c = classifier();
  const { read } = body as { read: boolean };
  const item = c.db.prepare("SELECT id, account_id, external_id, labels_json FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; external_id: string; labels_json: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  await connector(item.account_id, c).markRead(item.external_id, read);
  const labels = (JSON.parse(item.labels_json || "[]") as string[]).filter((l) => l !== "UNREAD");
  if (!read) labels.push("UNREAD");
  c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels), item.id);
  return { ok: true };
});
route("POST", "/api/items/:id/archive", async (m) => {
  const c = classifier();
  const item = c.db.prepare("SELECT id, account_id, external_id, labels_json FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; external_id: string; labels_json: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  await connector(item.account_id, c).archive(item.external_id);
  const labels = (JSON.parse(item.labels_json || "[]") as string[]).filter((l) => l !== "INBOX");
  c.db.prepare("UPDATE items SET labels_json = ? WHERE id = ?").run(JSON.stringify(labels), item.id);
  return { ok: true };
});

async function styleSamples(c: Classifier, accountId: number): Promise<string[]> {
  const rows = c.db.prepare("SELECT text FROM style_samples WHERE account_id = ? ORDER BY fetched_at DESC LIMIT ?").all(accountId, c.settings.styleSamples) as Array<{ text: string }>;
  if (rows.length >= Math.min(5, c.settings.styleSamples) || c.settings.styleSamples === 0) return rows.map((r) => r.text);
  const fresh = await connector(accountId, c).recentSentExcerpts(c.settings.styleSamples);
  const ins = c.db.prepare("INSERT OR REPLACE INTO style_samples (account_id, external_id, text) VALUES (?, ?, ?)");
  for (const s of fresh) ins.run(accountId, s.id, s.text);
  return fresh.map((s) => s.text);
}

/** Brouillon proposé par le modèle texte. Rien n'est envoyé. */
route("POST", "/api/items/:id/compose", async (m, _req, _url, body) => {
  const c = classifier();
  const { mode, instructions } = body as { mode: ComposeMode; instructions?: string };
  const item = c.db.prepare("SELECT account_id, external_id FROM items WHERE id = ?").get(m.groups!.id) as { account_id: number; external_id: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  const message = await gm.getFull(item.external_id);
  const samples = await styleSamples(c, item.account_id);
  return composeDraft({ mode, message, instructions, styleSamples: samples, ctx: c.ctx, settings: c.settings, itemId: Number(m.groups!.id) });
});

/** Dernier passage de la vérification des fils (relances), pour l'Accueil. */
let threadsCheckedAt: string | null = null;
const THREADS_EVERY_MIN = 30;
/**
 * État des fils : pour les emails où une réponse est attendue (ou importants),
 * on regarde qui a écrit en dernier. Toi en dernier → fait ; sans réponse depuis
 * N jours → relance ; eux en dernier → réponse attendue à nouveau.
 */
async function refreshThreads(c: Classifier, opts: { maxAgeMinutes?: number; limit?: number } = {}) {
  const { maxAgeMinutes = 30, limit = 60 } = opts;
  const rows = c.db
    .prepare(
      `SELECT i.id, i.account_id, i.thread_id, i.date, i.is_outgoing, i.subject, i.to_json, d.flags_json, d.action_state, d.thread_checked_at FROM items i JOIN decisions d ON d.item_id = i.id
       WHERE i.thread_id IS NOT NULL
         AND ((i.labels_json LIKE '%INBOX%' AND (json_extract(d.flags_json, '$.reply') = 1 OR json_extract(d.flags_json, '$.followUp') = 1 OR json_extract(d.flags_json, '$.important') = 1 OR d.thread_note = 'replied'))
              OR COALESCE(json_extract(d.flags_json, '$.awaitReply'), 0) = 1)
         AND (d.thread_checked_at IS NULL OR d.thread_checked_at < datetime('now', ?))
       ORDER BY i.date DESC LIMIT ?`,
    )
    .all(`-${maxAgeMinutes} minutes`, limit) as Array<{ id: number; account_id: number; thread_id: string; date: string; is_outgoing: number; subject: string | null; to_json: string | null; flags_json: string; action_state: number; thread_checked_at: string | null }>;
  const stats = { checked: 0, replied: 0, followUp: 0, reopened: 0, answered: 0 };
  threadsCheckedAt = new Date().toISOString();
  for (const r of rows) {
    try {
      const st = await connector(r.account_id, c).threadState(r.thread_id);
      const flags = JSON.parse(r.flags_json || "{}") as Record<string, boolean>;
      const days = (Date.now() - st.lastAt.getTime()) / 86_400_000;
      let note: string | null = null;
      let actionState = r.action_state;
      if (r.is_outgoing && flags.awaitReply) {
        // Un envoi de ma part qui attend un retour : silence prolongé = relance ; réponse arrivée = suivi terminé
        // (la réponse elle-même arrive comme un nouvel email, classé normalement).
        // Un seul suivi par conversation. Certains correspondants cassent le fil Gmail à chaque réponse (« Re :Re: … ») :
        // la conversation, c'est le même objet (sans les Re:) avec le même interlocuteur, quel que soit le fil.
        const later = newerInConversation(c, r);
        if (later === "sent") { flags.awaitReply = false; flags.followUp = false; note = "superseded"; if (actionState === 0) actionState = 1; }
        else if (later === "received" || !st.lastFromMe) { flags.awaitReply = false; flags.followUp = false; note = "answered"; if (actionState === 0) actionState = 1; stats.answered++; }
        else if (days >= c.settings.followUpDays) { if (!flags.followUp) stats.followUp++; flags.followUp = true; note = "followUp"; if (actionState !== 2) actionState = 0; }
        else { flags.followUp = false; note = "awaiting"; }
      } else if (st.lastFromMe) {
        // Tu as répondu : plus de réponse attendue. Relance si le silence dure. Un email ignoré ne revient pas tout seul.
        flags.reply = false;
        if (days >= c.settings.followUpDays) { if (!flags.followUp) stats.followUp++; flags.followUp = true; note = "followUp"; if (actionState !== 2) actionState = 0; }
        else { flags.followUp = false; note = "replied"; if (actionState === 0) actionState = 1; stats.replied++; }
      } else if (st.count > 1 && flags.followUp) {
        // Ils ont répondu après ta relance ou ta réponse : retour dans « Répondre ».
        flags.followUp = false; flags.reply = true; note = "reopened"; actionState = 0; stats.reopened++;
      }
      // Mise à jour seulement si personne n'a touché l'email pendant l'appel Gmail (ignoré, reclassé…) : sinon on laisse son geste.
      const upd = c.db.prepare("UPDATE decisions SET flags_json = ?, action_state = ?, thread_last_from_me = ?, thread_last_at = ?, thread_checked_at = datetime('now'), thread_note = ? WHERE item_id = ? AND action_state IS ? AND flags_json IS ?")
        .run(JSON.stringify(flags), actionState, st.lastFromMe ? 1 : 0, st.lastAt.toISOString(), note, r.id, r.action_state, r.flags_json);
      if (upd.changes) stats.checked++;
    } catch { /* fil supprimé ou inaccessible : on passe */ }
  }
  if (stats.followUp || stats.reopened) logActivity(c.db, "threads", "check", { followUp: stats.followUp, reopened: stats.reopened, answered: stats.answered });
  return stats;
}
route("POST", "/api/threads/refresh", async (_m, _req, _url, body) => refreshThreads(classifier(), (body ?? {}) as { maxAgeMinutes?: number; limit?: number }));
// En tâche de fond aussi : les relances (et les rappels Telegram qui en découlent) n'attendent pas l'ouverture de la page Actions.
setInterval(() => { refreshThreads(classifier()).catch((e) => console.error("[fils]", (e as Error).message)); }, THREADS_EVERY_MIN * 60_000).unref();

// ---------- nettoyage de la file Actions (core/ephemeral.ts) : sans IA, rien n'est supprimé
/**
 * Chaque minute : codes et alertes de connexion de plus de 30 min, événements et tâches passés → « dépassé ».
 * Toutes les 30 min : relecture des libellés Gmail (lus ou archivés ailleurs), et un bilan au fil d'activité
 * s'il y a eu du ménage. Au démarrage, un premier passage traite l'existant et le dit tout de suite.
 */
const swept = { codes: 0, signins: 0, past: 0, read: 0, archived: 0 };
let sweptLoggedAt = 0;
function flushSweep(force = false): void {
  if (!force && Date.now() - sweptLoggedAt < THREADS_EVERY_MIN * 60_000) return;
  sweptLoggedAt = Date.now();
  if (Object.values(swept).some((n) => n > 0)) logActivity(openDb(), "app", "sweep", { ...swept });
  for (const k of Object.keys(swept) as Array<keyof typeof swept>) swept[k] = 0;
}
function sweepNow(): void {
  try {
    const r = sweepQueue(openDb());
    swept.codes += r.codes; swept.signins += r.signins; swept.past += r.past;
  } catch (e) { console.error("[nettoyage]", (e as Error).message); }
}
setTimeout(() => { sweepNow(); flushSweep(true); }, 5_000).unref();
setInterval(() => { sweepNow(); flushSweep(); }, 60_000).unref();
setInterval(() => { void refreshActions(false).catch((e) => console.error("[nettoyage]", (e as Error).message)); }, THREADS_EVERY_MIN * 60_000).unref();
/**
 * « Actualiser » la file Actions, et toutes les 30 min en arrière-plan : libellés Gmail (lus ou archivés ailleurs),
 * propositions jamais extraites (20 au plus), puis le nettoyage. `withThreads` : aussi l'état des fils (le passage de
 * fond a déjà le sien, toutes les 30 min). Rien n'est supprimé.
 */
let actionsRefreshing: Promise<Record<string, number>> | null = null;
function refreshActions(withThreads: boolean): Promise<Record<string, number>> {
  if (actionsRefreshing) return actionsRefreshing;
  actionsRefreshing = (async () => {
    const c = classifier();
    const before = { ...swept };
    const threads = withThreads ? await refreshThreads(c, { maxAgeMinutes: 10 }).catch(() => null) : null;
    const labels = await refreshQueueLabels(c, withThreads ? 10 : THREADS_EVERY_MIN, 80).catch(() => ({ checked: 0, read: 0, archived: 0 }));
    swept.read += labels.read; swept.archived += labels.archived;
    const settled = await settleOpen(c, { onlyMissing: true, limit: 20 }).catch(() => ({ past: 0 }));
    swept.past += settled.past;
    sweepNow();
    const diff = Object.fromEntries((Object.keys(swept) as Array<keyof typeof swept>).map((k) => [k, swept[k] - before[k]]));
    return { ...diff, replied: threads?.replied ?? 0, followUp: threads?.followUp ?? 0, reopened: threads?.reopened ?? 0, answered: threads?.answered ?? 0 };
  })().finally(() => { actionsRefreshing = null; });
  return actionsRefreshing;
}
route("POST", "/api/actions/refresh", async () => {
  const r = await refreshActions(true);
  flushSweep(true);
  return { ...r, at: new Date().toISOString() };
});

/** La mise à jour proposée, avec les champs qui changent vraiment (vide = l'agenda est déjà à jour). */
function withChanges(p: Omit<EventProposal, "kind">): (NonNullable<EventProposal["update"]> & { changed: ReturnType<typeof changedFields> }) | null {
  return p.update ? { ...p.update, changed: changedFields(p.update, p) } : null;
}
/** Le modèle texte propose un événement à partir de l'email. Rien n'est créé. */
route("POST", "/api/items/:id/event/extract", async (m) => {
  const c = classifier();
  const item = c.db.prepare("SELECT i.account_id, i.external_id, i.from_address, d.answers_json FROM items i LEFT JOIN decisions d ON d.item_id = i.id WHERE i.id = ?").get(m.groups!.id) as { account_id: number; external_id: string; from_address: string; answers_json: string | null } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const acc = getAccount(c.db, String(item.account_id))!;
  const message = await connector(item.account_id, c).getFull(item.external_id);
  const proposal = await extractEventProposal(c, Number(m.groups!.id), message);
  // Gardée en cache : « Mettre à jour » relit l'événement visé côté serveur, jamais depuis le navigateur.
  cacheProposal(c.db, Number(m.groups!.id), proposal);
  const { kind: _kind, ...ev } = proposal;
  // Même choix que sur la carte « À caler » : pour qui (enfant suggéré par Jev ou règle du domaine), et dans quel agenda.
  const members = householdMembers(c.ctx);
  const answers = item.answers_json ? (JSON.parse(item.answers_json) as Record<string, { probabilities?: Record<string, number> }>) : {};
  const probs: Record<string, number> = {};
  for (const [k, p] of Object.entries(answers.child?.probabilities ?? {})) if (k !== "none") probs[`child:${k}`] = p;
  const domain = domainOf(item.from_address);
  const rule = c.db.prepare("SELECT for_member FROM member_rules WHERE domain = ?").get(domain) as { for_member: string } | undefined;
  const best = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  const suggested = rule ? [rule.for_member] : best && best[1] >= 0.5 ? [best[0]] : [];
  const canPrimary = scopesForAccount(acc.email).includes(SCOPE_CALENDAR);
  const canFamily = !!agendaAccount(c.db);
  return { ...ev, update: withChanges(ev), members, probs, suggested, rule: rule?.for_member ?? null, domain, canPrimary, canFamily, canCreate: canPrimary || canFamily, templateUrl: calendarTemplateUrl(ev) };
});
/** Création dans Google Agenda, sur clic explicite. */
route("POST", "/api/items/:id/event/create", async (m, _req, _url, body) => {
  const c = classifier();
  const { forKeys = [], present = [], always = false, dest, ...ev } = body as EventDraft & { forKeys?: string[]; present?: string[]; always?: boolean; dest?: { family?: boolean; primary?: boolean } };
  if (!ev.title?.trim() || !ev.start) fail("err.titleStartRequired");
  // Où : l'agenda Famille (l'événement apparaît dans les couloirs des membres choisis) et/ou l'agenda Google principal.
  const toFamily = dest?.family ?? true, toPrimary = dest?.primary ?? false;
  if (!toFamily && !toPrimary) fail("err.pickCalendar");
  const item = c.db.prepare("SELECT id, account_id, from_address FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; from_address: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const timezone = ev.timezone || c.ctx.owner.timezone;
  const links: { family?: string; primary?: string } = {};
  if (toFamily) {
    const members = householdMembers(c.ctx);
    const fam = await ensureFamilyCalendar(c.db, c.ctx.owner.timezone);
    const who = forKeys.length ? forKeys : ["family"];
    const names = (keys: string[]) => keys.map((k) => members.find((x) => x.key === k)?.name ?? k).join(", ");
    const description = eventDescription(ev.description, names(who), present.length ? names(present) : "");
    const r = await createCalendarEvent(fam.email, { ...ev, calendarId: fam.id, timezone, title: titleFor(ev.title, who, members), description, props: { ea_for: who.join(","), ea_present: present.join(","), ea_source: `gmail:${item.id}` } });
    links.family = r.link;
    if (always && who.length === 1 && who[0] !== "family") c.db.prepare("INSERT INTO member_rules (domain, for_member) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET for_member = excluded.for_member").run(domainOf(item.from_address), who[0]);
  }
  if (toPrimary) {
    const acc = getAccount(c.db, String(item.account_id))!;
    if (!scopesForAccount(acc.email).includes(SCOPE_CALENDAR)) fail("err.calendarScope");
    const r = await createCalendarEvent(acc.email, { ...ev, calendarId: "primary", timezone, props: { ea_source: `gmail:${item.id}` } });
    links.primary = r.link;
  }
  // L'événement existe : l'email sort de la file, constaté par l'outil.
  c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(item.id);
  forgetUpcoming();
  return { ok: true, link: links.family ?? links.primary, links, templateUrl: calendarTemplateUrl(ev) };
});
route("GET", "/api/accounts/:id/scopes", (m) => {
  const acc = getAccount(openDb(), m.groups!.id);
  if (!acc) fail("err.unknownAccount");
  const s = scopesForAccount(acc.email);
  return { scopes: s, drafts: s.includes("https://www.googleapis.com/auth/gmail.compose"), calendar: s.includes(SCOPE_CALENDAR), drive: s.includes(SCOPE_DRIVE_READ) };
});

/** Envoi ou brouillon Gmail. Appelé uniquement par le bouton Envoyer / Enregistrer de l'utilisateur. */
/** Brouillon de relance prêt à confirmer : destinataire d'origine si c'est un envoi de ma part, ton appris sur mes envoyés. */
async function followUpDraft(c: Classifier, itemId: number): Promise<{ to: string; subject: string; text: string }> {
  const item = c.db.prepare("SELECT id, account_id, external_id, is_outgoing, to_json FROM items WHERE id = ?").get(itemId) as { id: number; account_id: number; external_id: string; is_outgoing: number; to_json: string | null } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  const message = await gm.getFull(item.external_id);
  const addr = (s: string) => (/<([^>]+)>/.exec(s || "")?.[1] ?? s ?? "").trim();
  let to: string[] = []; try { to = JSON.parse(item.to_json || "[]"); } catch { /* pas de destinataires connus */ }
  const dest = item.is_outgoing ? to.join(", ") : addr(message.replyTo || message.from);
  if (!dest) fail("err.recipientNotFound");
  const samples = await styleSamples(c, item.account_id);
  const d = await composeDraft({ mode: "followUp", message, instructions: t("draft.followUpInstruction"), styleSamples: samples, ctx: c.ctx, settings: c.settings, itemId });
  return { to: dest, subject: subjectFor("reply", message.subject), text: d.text };
}
/** Envoi (ou brouillon Gmail) à partir d'un élément : réponse, transfert ou relance. Ne part que sur un geste explicite. */
async function sendForItem(c: Classifier, itemId: number, body: { mode: ComposeMode; to: string; cc?: string; subject?: string; text: string; asDraft?: boolean; withAttachments?: boolean; files?: Array<{ name?: unknown; mime?: unknown; data?: unknown }> }) {
  const { mode, to, cc, subject, text, asDraft, withAttachments } = body;
  if (!to?.trim()) fail("err.recipientMissing");
  if (!text?.trim()) fail("err.emptyMessage");
  // Fichiers joints depuis le Mac (base64) : 20 au plus, 25 Mo au total avec ceux d'un transfert (limite de Gmail).
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 20).map((f) => ({ name: String(f.name ?? "fichier").slice(0, 200), mimeType: String(f.mime || "application/octet-stream"), data: Buffer.from(String(f.data ?? ""), "base64") }));
  const item = c.db.prepare("SELECT id, account_id, external_id FROM items WHERE id = ?").get(itemId) as { id: number; account_id: number; external_id: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const gm = connector(item.account_id, c);
  const orig = await gm.getFull(item.external_id);
  const forwarded = mode === "forward" && withAttachments ? await Promise.all(orig.attachments.map(async (a) => ({ name: a.name, mimeType: a.mimeType, data: await gm.getAttachment(item.external_id, a.id) }))) : [];
  const all = [...forwarded, ...files];
  if (all.reduce((s, a) => s + a.data.length, 0) > MAX_ATTACH_BYTES) fail("err.attachTooBig", undefined, 413);
  const attachments = all.length ? all : undefined;
  const out = {
    to: to.trim(),
    cc: cc?.trim() || undefined,
    subject: subject?.trim() || subjectFor(mode, orig.subject),
    body: text + quoted(mode, orig),
    threadId: mode === "forward" ? undefined : orig.threadId,
    inReplyTo: mode === "forward" ? undefined : orig.messageId || undefined,
    references: mode === "forward" ? undefined : [orig.references, orig.messageId].filter(Boolean).join(" ") || undefined,
    attachments,
  };
  const id = asDraft ? await gm.saveDraft(out) : await gm.send(out);
  if (!asDraft) c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(item.id);
  return { ok: true, id, asDraft: !!asDraft };
}
route("POST", "/api/items/:id/send", async (m, _req, _url, body) => sendForItem(classifier(), Number(m.groups!.id), body as Parameters<typeof sendForItem>[2]));
/** Ce que le bot Telegram peut faire sur le courrier, toujours après un clic du propriétaire. */
const telegramMail = {
  followUpDraft,
  send: async (c: Classifier, itemId: number, mm: { to: string; subject: string; text: string }) => { await sendForItem(c, itemId, { mode: "followUp", ...mm }); },
  ignore: ignoreItem,
};
/** Ce que le bot peut faire des documents du Drive : chercher (Google et Jev compris), relire un document, et le fichier lui-même. */
const telegramDrive: DriveDeps = {
  search: (c, q, viewer) => findDocs({ db: c.db, ctx: c.ctx, settings: c.settings, rerank: true, google: driveFullText, viewer, limit: 5 }, q),
  get: async (c, accountId, fileId, viewer) => docById({ db: c.db, ctx: c.ctx, viewer }, accountId, fileId),
  async file(accountId, fileId) {
    const a = getAccount(openDb(), String(accountId));
    if (!a || !hasDriveScope(a.email)) fail("drive.scopeMissing");
    const doc = openDb().prepare("SELECT name, mime, size FROM docs WHERE account_id = ? AND file_id = ? AND in_scope = 1").get(accountId, fileId) as { name: string; mime: string; size: number | null } | undefined;
    if (!doc) fail("drive.unknownDoc", undefined, 404);
    const reader = new DriveReader(a.email);
    // Un fichier Google (Docs, Sheets, Slides) part en PDF ; le reste tel quel, dans la limite de Telegram (50 Mo).
    if (doc.mime.startsWith("application/vnd.google-apps.")) return { data: await reader.exportAs(fileId, "application/pdf"), name: `${doc.name}.pdf`, mime: "application/pdf" };
    if (doc.size != null && doc.size > 50 * 1024 * 1024) fail("drive.tooBigForTelegram");
    return { data: await reader.download(fileId), name: doc.name, mime: doc.mime };
  },
};

// ---------- file Actions
/**
 * Les comptes qui alimentent les filtres de la page Actions : par importance (sous le filtre
 * de libellé courant), par libellé (sous le filtre d'importance courant), et par groupe.
 */
route("GET", "/api/actions/counts", (_m, _req, url) => {
  const c = classifier();
  const q = url.searchParams;
  const imp = q.get("imp") || "";
  const cats = (q.get("cat") || "").split(",").filter(Boolean);
  const date = q.get("date") ? `date:${q.get("date")}` : "";
  const th = c.settings.thresholds;
  const { where, params } = mailWhere(c, ["queue", date].filter(Boolean).join("+"), q.get("account"), "");
  const rows = c.db
    .prepare(`SELECT d.category, d.flags_json, d.needs_review, ${priorityScoreSql(th)} score FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")}`)
    .all(...params) as Array<FlagRow & { category: string | null; score: number }>;
  const lvl = (s: number) => (s >= th.urgentScore ? "urgent" : s >= th.highScore ? "high" : s >= th.normalScore ? "normal" : "low");
  const byImp: Record<string, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
  const byCat: Record<string, number> = {};
  const groups: Record<string, number> = { important: 0, reply: 0, followUp: 0, toPay: 0, event: 0, task: 0, read: 0 };
  let total = 0;
  for (const r of rows) {
    const l = lvl(r.score), k = r.category ?? "";
    const okImp = !imp || l === imp, okCat = !cats.length || cats.includes(k);
    if (okCat) byImp[l]++;
    if (okImp) byCat[k] = (byCat[k] ?? 0) + 1;
    if (okImp && okCat) { total++; groups[groupOf(r)]++; }
  }
  // Les obsolètes ne sont plus dans la file : comptés à part (sous le filtre de libellé courant), pour leur pastille.
  const ob = mailWhere(c, ["obsolete", cats.length ? "cat:" + cats.join(",") : "", date].filter(Boolean).join("+"), q.get("account"), "");
  byImp.obsolete = (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${ob.where.join(" AND ")}`).get(...ob.params) as { n: number }).n;
  return { total, byImp, byCat, groups, thresholds: { urgent: th.urgentScore, high: th.highScore, normal: th.normalScore }, ignoreBefore: c.settings.ignoreBefore };
});
/** Sortie explicite : 2 = ignoré (lu dans Gmail, hors de la file). 0 remet dans la file. */
/** Reclasse un élément avec les questions et seuils du moment, puis règle sa proposition (dépassée ou non). */
route("POST", "/api/items/:id/reclassify", async (m) => {
  const c = classifier();
  const row = c.db.prepare("SELECT i.*, a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id = ?").get(m.groups!.id) as Record<string, unknown> | undefined;
  if (!row) fail("err.unknownItem", undefined, 404);
  const item = { ...itemFromRow(row), source: row.source as "gmail" | "whatsapp" };
  const o = await classify(c, item, { ignoreMemory: true, usage: { purpose: "reclassify", itemId: row.id as number } });
  const isWa = item.source === "whatsapp";
  const useful = !!(o.flags.event || o.flags.task);
  const flags = isWa ? (useful ? { ...o.flags, reply: false, spam: false, urgent: false, important: false } : { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false, task: false }) : o.flags;
  saveDecision(c.db, { itemId: row.id as number, ...o, needsReview: isWa ? false : o.needsReview, flags });
  c.db.prepare("UPDATE decisions SET action_state = ? WHERE item_id = ?").run(isWa && !useful ? 2 : 0, row.id);
  c.db.prepare("DELETE FROM event_drafts WHERE item_id = ?").run(row.id);
  const settled = useful ? await settleProposal(c, row.id as number, flags, async () => (isWa ? { from: item.fromName, subject: item.subject, date: item.date.toISOString(), text: item.bodyExcerpt, channel: "whatsapp" as const } : await connector(item.accountId, c).getFull(item.externalId))) : { proposal: null, past: false };
  return { flags, category: o.category, confidence: o.confidence, answers: o.answers, past: settled.past, proposal: settled.proposal };
});
route("POST", "/api/actions/:id/state", async (m, _req, _url, body) => {
  const { state } = body as { state: 0 | 2 };
  if (state === 2) await ignoreItem(classifier(), Number(m.groups!.id));
  else openDb().prepare("UPDATE decisions SET action_state = ? WHERE item_id = ?").run(state, m.groups!.id);
  return { ok: true };
});
/**
 * « Plus jamais cet expéditeur » : une règle quiet par expéditeur (ou domaine) des emails
 * choisis, et tout ce qu'ils ont déjà dans la file sort tout de suite.
 */
route("POST", "/api/actions/quiet-rule", (_m, _req, _url, body) => {
  const c = classifier();
  const { ids, by = "address" } = body as { ids: number[]; by?: "address" | "domain" };
  const rules = loadRules();
  const seen = new Set<string>();
  let added = 0, n = 0;
  for (const id of ids.slice(0, 2000)) {
    const row = c.db.prepare("SELECT i.from_address, d.category FROM items i JOIN decisions d ON d.item_id = i.id WHERE i.id = ?").get(id) as { from_address: string; category: string | null } | undefined;
    if (!row) continue;
    const key = by === "domain" ? domainOf(row.from_address) : row.from_address.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!rules.some((r) => r.quiet && (r.when.fromAddress === key || r.when.fromDomain === key))) {
      rules.push({ id: `quiet-${key}-${Date.now()}`, when: by === "domain" ? { fromDomain: key } : { fromAddress: key }, category: row.category ?? c.taxonomy.categories[0].key, origin: "learned", stop: true, quiet: true });
      added++;
    }
    n += c.db.prepare(`UPDATE decisions SET action_state = 2 WHERE action_state = 0 AND item_id IN (SELECT id FROM items WHERE lower(from_address) ${by === "domain" ? "LIKE ?" : "= ?"})`).run(by === "domain" ? `%@${key}` : key).changes;
  }
  if (added) saveRules(rules);
  return { ok: true, rules: added, n };
});
/**
 * Relit les libellés Gmail des emails en file (lu ? encore en boîte de réception ?) pour
 * constater ce que tu as fait ailleurs : un email lu ou archivé depuis Gmail sort de la file.
 */
route("POST", "/api/labels/refresh", async (_m, _req, _url, body) => {
  const { maxAgeMinutes = 10, limit = 80 } = (body ?? {}) as { maxAgeMinutes?: number; limit?: number };
  return refreshQueueLabels(classifier(), maxAgeMinutes, limit);
});
/**
 * Relit dans Gmail les libellés des emails de la file : lus ou archivés ailleurs (téléphone, Gmail), ils en sortent.
 * À l'ouverture de la page Actions, et toutes les 30 minutes en arrière-plan (nettoyage de la file).
 */
async function refreshQueueLabels(c: Classifier, maxAgeMinutes: number, limit: number): Promise<{ checked: number; read: number; archived: number }> {
  const { where, params } = mailWhere(c, "queue", null, "");
  const rows = c.db
    .prepare(`SELECT i.id, i.account_id, i.external_id, i.labels_json FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")} AND (i.labels_checked_at IS NULL OR i.labels_checked_at < datetime('now', ?)) ORDER BY i.date DESC LIMIT ?`)
    .all(...params, `-${maxAgeMinutes} minutes`, limit) as Array<{ id: number; account_id: number; external_id: string; labels_json: string | null }>;
  const stats = { checked: 0, read: 0, archived: 0 };
  for (const r of rows) {
    try {
      const labels = await connector(r.account_id, c).labelsOf(r.external_id);
      const before = JSON.parse(r.labels_json || "[]") as string[];
      if (before.includes("UNREAD") && !labels.includes("UNREAD")) stats.read++;
      if (before.includes("INBOX") && !labels.includes("INBOX")) stats.archived++;
      c.db.prepare("UPDATE items SET labels_json = ?, labels_checked_at = datetime('now') WHERE id = ?").run(JSON.stringify(labels), r.id);
      stats.checked++;
    } catch {
      // Message supprimé ou inaccessible : on ne réessaie pas à chaque ouverture.
      c.db.prepare("UPDATE items SET labels_checked_at = datetime('now') WHERE id = ?").run(r.id);
    }
  }
  return stats;
}

route("GET", "/api/items/:id", (m) => {
  const c = classifier();
  const row = c.db
    .prepare(
      `SELECT i.*, ${priorityScoreSql(c.settings.thresholds)} prio, CASE WHEN d.item_id IS NULL THEN 0 ELSE ${obsoleteSql(c)} END obsolete, a.email account_email, a.source, d.category, d.confidence, d.needs_review, d.flags_json, d.answers_json, d.decided_by, d.rule_id, d.applied_at, d.applied_labels_json, d.latency_ms, d.input_tokens, d.action_state, d.thread_note, d.thread_last_at
       FROM items i JOIN accounts a ON a.id = i.account_id LEFT JOIN decisions d ON d.item_id = i.id WHERE i.id = ?`,
    )
    .get(m.groups!.id);
  if (!row) fail("err.unknownItem", undefined, 404);
  return row;
});

// ---------- correction (file « À revoir » et tableau)
route("POST", "/api/items/:id/category", async (m, _req, _url, body) => {
  const c = classifier();
  const { category, makeRule, apply } = body as { category: string; makeRule?: boolean; apply?: boolean };
  const cat = c.taxonomy.categories.find((x) => x.key === category);
  if (!cat) fail("err.unknownCategory");
  const item = c.db.prepare("SELECT * FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; external_id: string; from_address: string } | undefined;
  if (!item) fail("err.unknownItem");
  const prev = c.db.prepare("SELECT category, applied_at FROM decisions WHERE item_id = ?").get(item.id) as { category: string | null; applied_at: string | null } | undefined;
  c.db.prepare("INSERT INTO corrections (item_id, from_category, to_category) VALUES (?, ?, ?)").run(item.id, prev?.category ?? null, cat.key);
  c.db.prepare("UPDATE decisions SET category = ?, needs_review = 0, decided_by = 'user', confidence = 1 WHERE item_id = ?").run(cat.key, item.id);
  rememberSender(c.db, item.account_id, item.from_address, cat.key);
  if (apply || prev?.applied_at) {
    const gm = connector(item.account_id, c);
    await gm.ensureLabels(allLabels(c));
    const p = c.taxonomy.prefix;
    const remove = [`${p}/${c.settings.specialLabels.review}`];
    const prevCat = c.taxonomy.categories.find((x) => x.key === prev?.category);
    if (prevCat && prevCat.key !== cat.key) remove.push(labelName(c.taxonomy, prevCat));
    await gm.applyLabels(item.external_id, [labelName(c.taxonomy, cat)], remove, true); // un clic : devant un rattrapage en cours
    c.db.prepare("UPDATE decisions SET applied_at = datetime('now') WHERE item_id = ?").run(item.id);
  }
  if (makeRule) {
    const rules = loadRules();
    const domain = domainOf(item.from_address);
    rules.push({ id: `learned-${domain}-${Date.now()}`, when: { fromDomain: domain }, category: cat.key, origin: "learned", stop: false, quiet: false });
    saveRules(rules);
  }
  return { ok: true };
});

/** Pose dans Gmail les libellés de tout ce qui est classé en aperçu. Pas de lecture, pas d'appel à Jev. */
route("POST", "/api/labels/apply-pending", async (_m, _req, _url, body) => {
  const c = classifier();
  const { accountId } = body as { accountId: number };
  const gm = connector(accountId, c);
  await gm.ensureLabels(allLabels(c));
  const rows = c.db
    .prepare(`SELECT i.id, i.external_id, d.category, d.needs_review, d.flags_json FROM items i JOIN decisions d ON d.item_id = i.id WHERE i.account_id = ? AND d.applied_at IS NULL ORDER BY i.date DESC LIMIT 5000`)
    .all(accountId) as Array<{ id: number; external_id: string; category: string | null; needs_review: number; flags_json: string | null }>;
  let n = 0, errors = 0;
  for (const r of rows) {
    const o = { decidedBy: "jev" as const, category: r.category, confidence: null, needsReview: !!r.needs_review, flags: r.flags_json ? JSON.parse(r.flags_json) : { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false } };
    const labels = labelsFor(c, o);
    try {
      if (labels.length) await gm.applyLabels(r.external_id, labels, []);
      c.db.prepare("UPDATE decisions SET applied_at = datetime('now'), applied_labels_json = ? WHERE item_id = ?").run(JSON.stringify(labels), r.id);
      n++;
    } catch { errors++; }
  }
  return { ok: true, n, errors };
});

// ---------- travaux
route("GET", "/api/jobs", () => listJobs());
route("POST", "/api/jobs", async (_m, _req, _url, body) => {
  const { kind, accountId, max, every, period, onlyNew } = (body ?? {}) as { kind: "preview" | "backfill" | "watch"; accountId: number; max?: number; every?: number; period?: string; onlyNew?: boolean };
  if (kind !== "preview" && kind !== "backfill" && kind !== "watch") fail("err.badJobKind", undefined, 400);
  if (kind === "watch") return startWatch(accountId, every);
  const c = classifier();
  // Surveillance en cours sur ce compte : en pause le temps de l'aperçu ou du rattrapage, puis relancée à l'identique
  // (elle reste enregistrée : un redémarrage pendant le rattrapage la relance aussi).
  const watch = runningFor(accountId);
  let resume: (() => void) | undefined;
  if (watch?.kind === "watch") {
    await stopAndWait(watch.id);
    const watchEvery = watch.every;
    resume = () => { if (!runningFor(accountId)) startWatch(accountId, watchEvery); };
  }
  try { return startJob(kind, c, connector(accountId, c), accountId, { max, period, onlyNew, onDone: resume }); }
  catch (err) { try { resume?.(); } catch { /* la surveillance reprendra au prochain démarrage */ } throw err; }
});
// ---------- estimation avant un lancement en masse (core/estimate.ts) : l'interface la montre avant tout appel à l'IA
async function withCredits<T extends object>(o: T) { return { ...o, credits: await gatewayCredits() }; }
/** Le taux mesuré d'une source : l'interface s'en sert quand elle connaît déjà le nombre d'éléments (reclassement). */
route("GET", "/api/estimate/rate", async (_m, _req, url) => {
  const source = (url.searchParams.get("source") ?? "gmail") as EstimateSource;
  if (!["gmail", "whatsapp", "drive"].includes(source)) fail("err.badBody", undefined, 400);
  const c = classifier();
  return withCredits({ rate: aiRate(c.db, c.settings, source) });
});
/** Aperçu ou rattrapage Gmail : compte exactement les emails qui passeraient par l'IA (comme le passage lui-même), puis le coût. */
route("POST", "/api/estimate/gmail", async (_m, _req, _url, body) => {
  const { kind, accountId, period, onlyNew } = (body ?? {}) as { kind: "preview" | "backfill"; accountId: number; period?: string; onlyNew?: boolean };
  if (kind !== "preview" && kind !== "backfill") fail("err.badJobKind", undefined, 400);
  const c = classifier();
  const { ids, keep } = await idsToProcess(c, connector(accountId, c), accountId, kind, { period, onlyNew });
  const rate = aiRate(c.db, c.settings, "gmail");
  return withCredits({ total: ids.length, skipped: ids.length - keep.length, rate, estimate: estimateFor(rate, keep.length) });
});
/** « Reclasser » (boîte, période, catégorie) ou « Relancer Jev » (emails cochés) : combien d'emails, et ce que Jev coûtera. */
type RefreshBody = { ids?: number[]; accountId?: number; period?: string; category?: string; max?: number };
route("POST", "/api/estimate/reclass", (_m, _req, _url, body) => {
  const c = classifier();
  const n = [...refreshTargets(c, { ...(body as RefreshBody), max: undefined }).values()].reduce((s, rows) => s + rows.length, 0);
  const rate = aiRate(c.db, c.settings, "gmail");
  // Prudent : chaque email compté comme un appel à Jev (seuls ceux d'une règle « Sans Jev » n'y vont pas).
  return withCredits({ total: n, rate, estimate: estimateFor(rate, n, { allJev: true }) });
});
/**
 * Reclassements demandés pendant un autre travail sur la même boîte (rattrapage, reclassement) : ils attendent ici et
 * partent l'un après l'autre, dans l'ordre. « Arrêter » sur le travail en cours vide aussi la file de sa boîte.
 */
const reclassQueue = new Map<number, StoredItem[][]>();
const queuedCount = (accountId: number) => (reclassQueue.get(accountId) ?? []).reduce((s, rows) => s + rows.length, 0);
setJobEndHook((accountId, onDone) => {
  const next = reclassQueue.get(accountId)?.shift();
  if (!next) return false;
  const c = classifier();
  startReclassify(c, connector(accountId, c), accountId, next, { modes: {}, refresh: true }, onDone);
  return true;
});
/** Lance la relecture par Jev, un travail par boîte ; la veille de chaque boîte se met en pause, puis repart. */
route("POST", "/api/reclass", async (_m, _req, _url, body) => {
  const c = classifier();
  const targets = refreshTargets(c, body as RefreshBody);
  if (!targets.size) fail("err.nothingToReclass", undefined, 400);
  const jobs = [];
  let queued = 0;
  for (const [accountId, rows] of targets) {
    // Un autre travail tourne sur cette boîte : en file, il partira juste après.
    const busy = runningFor(accountId);
    if (busy && busy.kind !== "watch") { reclassQueue.set(accountId, [...(reclassQueue.get(accountId) ?? []), rows]); queued += rows.length; continue; }
    const watch = runningFor(accountId);
    let resume: (() => void) | undefined;
    if (watch?.kind === "watch") {
      await stopAndWait(watch.id);
      const watchEvery = watch.every;
      resume = () => { if (!runningFor(accountId)) startWatch(accountId, watchEvery); };
    }
    try { jobs.push(startReclassify(c, connector(accountId, c), accountId, rows, { modes: {}, refresh: true }, resume)); }
    catch (err) { try { resume?.(); } catch { /* reprendra au prochain démarrage */ } throw err; }
  }
  return { ok: true, n: jobs.reduce((s, j) => s + (j.total ?? 0), 0), queued, jobs: jobs.map((j) => j.id) };
});
/**
 * Une conversation WhatsApp qu'on s'apprête à écouter : ses fenêtres à lire depuis le dernier passage (ou sur l'historique
 * choisi), découpées comme à la lecture. Une fenêtre = un appel à Jev au plus.
 */
route("GET", "/api/estimate/whatsapp/:pk", async (m) => {
  const db = openDb();
  if (!kvGet(db, "wa.enabled", false)) fail("err.waNotConnected");
  const pk = Number(m.groups!.pk);
  const settings = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(db, "wa.settings", {}) };
  await wa.snapshot();
  const cursor = cursorAfter(kvGet<number>(db, `wa.cursor:${pk}`, 0));
  const msgs: Array<Item & { at: number }> = [];
  let from: { after?: number; since?: Date } = cursor ? { after: cursor } : { since: new Date(Date.now() - settings.historyDays * 86_400_000) };
  for (let guard = 0; guard < 50; guard++) {
    const page = wa.readMessagesPage(pk, 0, { captions: settings.captions, ...from, limit: 2000, order: "asc" });
    msgs.push(...page.items);
    if (!page.truncated || !page.items.length) break;
    from = { after: page.items[page.items.length - 1].at };
  }
  const n = windows(msgs).length;
  const c = classifier();
  const rate = aiRate(c.db, c.settings, "whatsapp");
  return withCredits({ messages: msgs.length, historyDays: cursor ? null : settings.historyDays, rate, estimate: estimateFor(rate, n) });
});
route("POST", "/api/jobs/:id/stop", (m) => {
  const id = Number(m.groups!.id);
  const job = getJob(id);
  // Arrêter un travail ponctuel vide aussi la file de sa boîte : sinon le reclassement suivant démarrerait aussitôt.
  if (job && job.kind !== "watch") reclassQueue.delete(job.accountId);
  stopJob(id);
  if (job?.kind === "watch") forgetWatch(job.accountId);
  return { ok: true };
});

// ---------- configuration
const files = { taxonomy: "taxonomy.json", rules: "rules.json", settings: "settings.json", context: "context.json" } as const;
route("GET", "/api/config/:name", (m) => {
  const name = m.groups!.name as keyof typeof files;
  if (!files[name]) fail("err.unknownFile");
  // Toujours via les chargeurs : une installation neuve n'a pas encore ces fichiers, les défauts s'appliquent.
  if (name === "context") return loadContext();
  if (name === "settings") return loadSettings();
  if (name === "rules") return { rules: loadRules() };
  return loadTaxonomy();
});
/**
 * Ce qu'un enregistrement de taxonomie changerait pour les emails déjà classés, avant d'écrire quoi que ce soit.
 * L'interface s'en sert pour proposer le reclassement, catégorie par catégorie.
 */
function taxonomyPlan(candidate: unknown) {
  const c = classifier();
  const next = normalizeTaxonomy(parseTaxonomy(candidate));
  for (const cat of next.categories) if (!isGmailColor(cat.color.background) || !isGmailColor(cat.color.text)) fail("err.gmailColor", { name: cat.name });
  const changes = taxonomyDiff(c.taxonomy, next);
  const count = (key: string, all: boolean) => (c.db.prepare(`SELECT COUNT(*) n FROM decisions WHERE category = ?${all ? "" : " AND decided_by != 'user' AND needs_review = 0"}`).get(key) as { n: number }).n;
  const rows = changes.map((ch) => {
    const n = ch.kind === "removed" ? count(ch.key, true) : ch.kind === "gained" ? count(ch.key, false) : ch.kind === "moved" ? count(ch.key, true) : 0;
    const kids = ch.kind === "gained" ? next.categories.filter((k) => k.parent === ch.key) : [];
    // « Répartir sans Jev » : possible si chaque nouvelle sous-catégorie est liée à un enfant du contexte.
    const childRoutable = kids.length > 0 && kids.every((k) => !!k.child);
    const modes: ReclassMode[] = ch.kind === "gained" ? (childRoutable ? ["child", "jev", "keep", "review"] : ["jev", "keep", "review"]) : ch.kind === "removed" ? ["jev", "review"] : [];
    return { ...ch, count: n, modes };
  });
  const rules = loadRules().filter((r) => changes.some((ch) => ch.kind === "removed" && ch.key === r.category)).map((r) => r.id);
  return { taxonomy: next, changes: rows, rulesToDrop: rules };
}
route("POST", "/api/config/taxonomy/plan", (_m, _req, _url, body) => {
  const plan = taxonomyPlan(body);
  return { changes: plan.changes, rulesToDrop: plan.rulesToDrop };
});

/**
 * Enregistre la taxonomie, renomme dans Gmail les libellés dont le chemin change (les emails suivent
 * sans être touchés un par un), puis lance le reclassement demandé, compte par compte.
 */
route("PUT", "/api/config/taxonomy", async (_m, _req, _url, body) => {
  const { taxonomy: candidate, reclass = {} } = body as { taxonomy: unknown; reclass?: Record<string, ReclassMode> };
  const plan = taxonomyPlan(candidate ?? body);
  const removed = plan.changes.filter((ch) => ch.kind === "removed");
  // Rien n'est écrit si un rattrapage ou un reclassement tourne : il travaille avec l'ancienne taxonomie. Une surveillance, elle, sera mise en pause.
  const gmailAccounts = listAccounts(openDb()).filter((a) => a.source === "gmail");
  if (gmailAccounts.some((a) => { const j = runningFor(a.id); return j && j.kind !== "watch"; })) fail("err.jobBusy");
  saveTaxonomy(plan.taxonomy);
  const c = classifier();
  // Les règles qui pointaient sur une catégorie retirée tombent : une règle vers nulle part bloquerait la cascade.
  if (plan.rulesToDrop.length) saveRules(loadRules().filter((r) => !plan.rulesToDrop.includes(r.id)));
  c.db.prepare(`DELETE FROM sender_memory WHERE category IN (${removed.map(() => "?").join(",") || "''"})`).run(...removed.map((r) => r.key));
  const renamed: string[] = [], warnings: string[] = [];
  const moved = plan.changes.filter((ch) => ch.kind === "moved" && ch.from && ch.to);
  for (const a of gmailAccounts) {
    const gm = connector(a.id, c);
    // Parents d'abord : renommer « AI/Maison » avant « AI/Maison/Jardinage ».
    for (const ch of [...moved].sort((x, y) => x.to!.split("/").length - y.to!.split("/").length)) {
      try { if (await gm.renameLabel(ch.from!, ch.to!)) renamed.push(`${a.email} : ${ch.from} → ${ch.to}`); }
      catch (err) { warnings.push(`${a.email} : ${(err as Error).message}`); }
    }
  }
  const modes = Object.fromEntries(Object.entries(reclass).filter(([k, m]) => plan.changes.some((ch) => ch.key === k && ch.modes.includes(m))));
  const oldLabels = Object.fromEntries(removed.map((r) => [r.key, r.from!]));
  const jobs = [];
  for (const a of gmailAccounts) {
    const rows = reclassRows(c, a.id, { modes, oldLabels }, removed.map((r) => r.key));
    if (!rows.length) continue;
    // Surveillance en cours : on l'arrête le temps du reclassement, puis on la relance à l'identique.
    const watch = runningFor(a.id);
    let resume: (() => void) | undefined;
    if (watch?.kind === "watch") {
      await stopAndWait(watch.id);
      const every = watch.every;
      resume = () => { try { startWatch(a.id, every); } catch (err) { console.error("[surveillance]", (err as Error).message); } };
    }
    jobs.push(startReclassify(c, connector(a.id, c), a.id, rows, { modes, oldLabels }, resume));
  }
  return { ok: true, renamed, warnings, reclassifying: jobs.reduce((n, j) => n + (j.total ?? 0), 0) };
});

route("PUT", "/api/config/:name", async (m, _req, _url, body) => {
  const name = m.groups!.name as keyof typeof files;
  if (!files[name]) fail("err.unknownFile");
  if (body === undefined || body === null || typeof body !== "object") fail("err.badBody", undefined, 400);
  // Un changement de langue passe par applyLanguage : les libellés Gmail par défaut suivent, rien n'est orphelin.
  if (name === "settings") {
    const next = body as Partial<Settings>;
    const cur = loadSettings();
    if (isLanguage(next.language) && next.language !== cur.language) {
      const { language, specialLabels: _ignored, ...rest } = next;
      void _ignored;
      fs.writeFileSync(path.join(PATHS.config, files.settings), JSON.stringify({ ...cur, ...rest, language: cur.language }, null, 2) + "\n");
      return applyLanguage(language);
    }
  }
  // Validation avant écriture : un contenu invalide ne doit jamais arriver sur disque (toute l'API en dépend).
  if (name === "rules") parseRules(body);
  else if (name === "settings") parseSettings(body);
  else if (name === "context") parseContext(body);
  else parseTaxonomy(body);
  fs.writeFileSync(path.join(PATHS.config, files[name]), JSON.stringify(body, null, 2) + "\n");
  // Les connecteurs gardent en mémoire les adresses du propriétaire et la longueur des extraits : on les recrée.
  if (name === "settings" || name === "context") connectors.clear();
  classifier();
  return { ok: true };
});

// ---------- langue
/** Ce que changer de langue renommerait dans Gmail, sans rien écrire. */
route("POST", "/api/language/plan", (_m, _req, _url, body) => {
  const to = (body as { language?: unknown })?.language;
  if (!isLanguage(to)) fail("err.unknownLanguage");
  const c = classifier();
  return planLanguageChange(c.settings.language, to, c.taxonomy, c.settings.specialLabels);
});
route("POST", "/api/language", (_m, _req, _url, body) => {
  const b = body as { language?: unknown; renameCategories?: boolean; renameSpecial?: boolean } | undefined;
  if (!isLanguage(b?.language)) fail("err.unknownLanguage");
  return applyLanguage(b!.language as Language, { renameCategories: b?.renameCategories !== false, renameSpecial: b?.renameSpecial !== false });
});
/**
 * Change la langue : settings.json, la taxonomie (noms encore par défaut), les libellés spéciaux, puis les libellés
 * Gmail correspondants sur chaque compte (parents d'abord), et le menu du bot Telegram. Un conflit Gmail devient un
 * avertissement, jamais un abandon : les libellés se recalculent à l'exécution, rien n'est réécrit en base.
 */
async function applyLanguage(to: Language, opts: { renameCategories?: boolean; renameSpecial?: boolean } = {}) {
  const before = classifier();
  const from = before.settings.language;
  const plan = planLanguageChange(from, to, before.taxonomy, before.settings.specialLabels);
  const renameCategories = opts.renameCategories !== false, renameSpecial = opts.renameSpecial !== false;
  saveSettings({ ...before.settings, language: to, specialLabels: renameSpecial ? plan.specialLabels : before.settings.specialLabels });
  if (renameCategories && plan.categories.length) saveTaxonomy(normalizeTaxonomy(plan.taxonomy));
  const c = classifier();
  const renamed: string[] = [], warnings: string[] = [];
  const moves = [...(renameCategories ? plan.categories.map((r) => r.label) : []), ...(renameSpecial ? plan.specials.map((r) => r.label) : [])];
  for (const a of listAccounts(c.db).filter((x) => x.source === "gmail")) {
    const gm = connector(a.id, c);
    for (const mv of moves) {
      try { if (await gm.renameLabel(mv.from, mv.to)) renamed.push(`${a.email} : ${mv.from} → ${mv.to}`); }
      catch (err) { warnings.push(`${a.email} : ${(err as Error).message}`); }
    }
  }
  await refreshCommands(to).catch((err) => warnings.push(`Telegram : ${(err as Error).message}`));
  return { ok: true as const, from, to, renamed, warnings, plan };
}
route("DELETE", "/api/rules/:id", (m) => {
  const rules = loadRules().filter((r: Rule) => r.id !== m.groups!.id);
  saveRules(rules);
  return { ok: true };
});

/** Reconstruit un élément depuis la base, sans rappeler Gmail. */
function itemFromRow(row: Record<string, unknown>): Item {
  return {
    externalId: String(row.external_id), threadId: row.thread_id ? String(row.thread_id) : undefined, accountId: Number(row.account_id), source: "gmail", fromName: String(row.from_name ?? ""), fromAddress: String(row.from_address ?? ""),
    to: (() => { try { return JSON.parse(String(row.to_json ?? "[]")); } catch { return []; } })(), subject: String(row.subject ?? ""), date: new Date(String(row.date)), bodyExcerpt: String(row.body_excerpt ?? ""), hasAttachments: !!row.has_attachments,
    hasListUnsubscribe: !!row.has_list_unsubscribe, isOutgoing: !!row.is_outgoing, labels: (() => { try { return JSON.parse(String(row.labels_json ?? "[]")); } catch { return []; } })(),
  };
}

/**
 * Relance l'analyse des emails « à revoir » avec les règles, la mémoire et les
 * exemples appris depuis. Ceux dont Jev est maintenant sûr sortent de la file.
 */
route("POST", "/api/review/rerun", async (_m, _req, _url, body) => {
  const c = classifier();
  const { account } = (body ?? {}) as { account?: number };
  const rows = c.db
    .prepare(`SELECT i.*, d.applied_at, d.category prev_category FROM items i JOIN decisions d ON d.item_id = i.id WHERE d.needs_review = 1 AND d.action_state = 0 ${account ? "AND i.account_id = ?" : ""} ORDER BY i.date DESC LIMIT 5000`)
    .all(...(account ? [account] : [])) as Array<Record<string, unknown>>;
  const stats = { total: rows.length, resolved: 0, still: 0, jevCalls: 0, errors: 0 };
  const p = c.taxonomy.prefix;
  const reviewLabel = `${p}/${c.settings.specialLabels.review}`;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(c.settings.concurrency, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        try {
          const item = itemFromRow(row);
          const o = await classify(c, item, { usage: { purpose: "reclassify", itemId: Number(row.id) } });
          if (o.jev) stats.jevCalls++;
          saveDecision(c.db, { itemId: Number(row.id), ...o });
          if (o.needsReview) { stats.still++; continue; }
          stats.resolved++;
          if (o.category && o.decidedBy === "jev") rememberSender(c.db, item.accountId, item.fromAddress, o.category);
          if (row.applied_at) {
            const gm = connector(item.accountId, c);
            await gm.ensureLabels(allLabels(c));
            await gm.applyLabels(item.externalId, labelsFor(c, o), [reviewLabel]);
            c.db.prepare("UPDATE decisions SET applied_at = datetime('now'), applied_labels_json = ? WHERE item_id = ?").run(JSON.stringify(labelsFor(c, o)), row.id);
          }
        } catch { stats.errors++; }
      }
    }),
  );
  return stats;
});

/** Valide la catégorie proposée par Jev pour une liste d'emails « à revoir » (choix le plus probable). */
route("POST", "/api/review/accept", async (_m, _req, _url, body) => {
  const c = classifier();
  // `category` : « Classer ces N en… », la même catégorie pour tous ; sinon la proposition de Jev, email par email.
  const { ids, makeRule, category } = body as { ids: number[]; makeRule?: boolean; category?: string };
  const forced = category ? c.taxonomy.categories.find((x) => x.key === category) : undefined;
  if (category && !forced) fail("err.unknownCategory");
  const p = c.taxonomy.prefix;
  const review = `${p}/${c.settings.specialLabels.review}`;
  // 1. Ce qui change. Rien n'est encore écrit.
  type Row = { id: number; account_id: number; external_id: string; from_address: string; category: string | null; answers_json: string | null; applied_at: string | null; needs_review: number };
  const sel = c.db.prepare("SELECT i.id, i.account_id, i.external_id, i.from_address, d.category, d.answers_json, d.applied_at, d.needs_review FROM items i JOIN decisions d ON d.item_id = i.id WHERE i.id = ?");
  const todo: Array<{ row: Row; cat: (typeof c.taxonomy.categories)[number] }> = [];
  for (const id of ids.slice(0, 5000)) {
    const row = sel.get(id) as Row | undefined;
    if (!row || !row.needs_review) continue;
    const answers = row.answers_json ? (JSON.parse(row.answers_json) as { category?: { choice?: string } }) : undefined;
    const key = answers?.category?.choice ?? row.category;
    const cat = forced ?? c.taxonomy.categories.find((x) => x.key === key);
    if (cat) todo.push({ row, cat });
  }
  // 2. Gmail d'abord : un appel par compte et par catégorie (1 000 emails par appel), prioritaire sur un rattrapage en cours.
  //    Si Gmail refuse, rien n'est validé dans Molinova et le même clic peut être refait.
  const groups = new Map<string, { accountId: number; label: string; ids: string[] }>();
  for (const { row, cat } of todo) {
    if (!row.applied_at) continue; // libellés pas encore posés dans Gmail : la base suffit
    const label = labelName(c.taxonomy, cat), k = `${row.account_id}|${label}`;
    const g = groups.get(k) ?? { accountId: row.account_id, label, ids: [] };
    g.ids.push(row.external_id);
    groups.set(k, g);
  }
  const ensured = new Set<number>();
  for (const g of groups.values()) {
    const gm = connector(g.accountId, c);
    if (!ensured.has(g.accountId)) { await gm.ensureLabels(allLabels(c)); ensured.add(g.accountId); }
    await gm.batchModify(g.ids, [g.label], [review]);
  }
  // 3. Puis la base, d'un bloc.
  const ruleDomains = new Map<string, string>();
  c.db.transaction(() => {
    for (const { row, cat } of todo) {
      c.db.prepare("INSERT INTO corrections (item_id, from_category, to_category) VALUES (?, ?, ?)").run(row.id, row.category, cat.key);
      c.db.prepare("UPDATE decisions SET category = ?, needs_review = 0, decided_by = 'user', confidence = 1 WHERE item_id = ?").run(cat.key, row.id);
      rememberSender(c.db, row.account_id, row.from_address, cat.key);
      if (makeRule) ruleDomains.set(domainOf(row.from_address), cat.key);
    }
  })();
  if (ruleDomains.size) {
    const rules = loadRules();
    for (const [domain, category] of ruleDomains) if (!rules.some((r) => r.when.fromDomain === domain)) rules.push({ id: `learned-${domain}-${Date.now()}`, when: { fromDomain: domain }, category, origin: "learned", stop: false, quiet: false });
    saveRules(rules);
  }
  return { ok: true, n: todo.length, rules: ruleDomains.size };
});

/**
 * Remise à zéro : retire les libellés de l'agent dans Gmail (par suppression des libellés AI/…)
 * et vide les compteurs de l'app. La taxonomie, les règles et le contexte sont conservés.
 */
route("POST", "/api/reset", async (_m, _req, _url, body) => {
  const c = classifier();
  const { confirm: word, keepMemory, forgetTasks, forgetMemberRules, forgetCalendarMap } = body as { confirm?: string; keepMemory?: boolean; forgetTasks?: boolean; forgetMemberRules?: boolean; forgetCalendarMap?: boolean };
  if (word !== "RESET") fail("err.confirmationMissing");
  if (listJobs().some((j) => j.status === "running") || ingesting()) fail("err.jobRunning");
  const result: Record<string, unknown> = { labels: {} as Record<string, string[]> };
  // Les libellés AI/ ne vivent que dans Gmail ; WhatsApp n'en a pas.
  for (const a of listAccounts(c.db).filter((x) => x.source === "gmail")) {
    const deleted = await connector(a.id, c).deleteAgentLabels(c.taxonomy.prefix);
    (result.labels as Record<string, string[]>)[a.email] = deleted;
  }
  const counts = {
    items: (c.db.prepare("SELECT COUNT(*) n FROM items").get() as { n: number }).n,
    whatsapp: (c.db.prepare("SELECT COUNT(*) n FROM items i JOIN accounts a ON a.id = i.account_id WHERE a.source = 'whatsapp'").get() as { n: number }).n,
    decisions: (c.db.prepare("SELECT COUNT(*) n FROM decisions").get() as { n: number }).n,
    tasks: forgetTasks ? (c.db.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n : 0,
  };
  c.db.exec("DELETE FROM corrections; DELETE FROM event_drafts; DELETE FROM decisions; DELETE FROM items; DELETE FROM runs; DELETE FROM style_samples;");
  if (!keepMemory) c.db.exec("DELETE FROM sender_memory;");
  // WhatsApp : les curseurs de lecture repartent de zéro, le prochain passage relit l'historique. Les groupes écoutés restent.
  c.db.exec("DELETE FROM kv WHERE key LIKE 'wa.cursor:%' OR key IN ('wa.lastIngest', 'wa.lastError');");
  if (forgetTasks) c.db.exec("DELETE FROM tasks;");
  if (forgetMemberRules) c.db.exec("DELETE FROM member_rules;");
  if (forgetCalendarMap) c.db.exec("DELETE FROM kv WHERE key IN ('agenda.calendarMap', 'agenda.familyCalendar', 'agenda.account');");
  c.db.exec("UPDATE accounts SET history_id = NULL, backfill_page_token = NULL, backfill_done = 0, messages_total = NULL, watch_since = NULL, watch_every = NULL;");
  connectors.clear();
  totalsRefreshed.clear();
  calendarsCache.clear();
  return { ok: true, ...result, cleared: counts, memoryKept: !!keepMemory };
});

// ---------- questions Jev
route("GET", "/api/palette", () => labelPairs());
route("GET", "/api/questions", () => classifier().questions);
route("POST", "/api/questions/test", async (_m, _req, _url, body) => {
  const c = classifier();
  const { itemId } = body as { itemId: number };
  const row = c.db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as Record<string, unknown> | undefined;
  if (!row) fail("err.unknownItem");
  return askJev(buildState(itemFromRow(row), c.ctx), c.questions, c.settings, undefined, { purpose: "test", itemId, accountId: row.account_id as number });
});

// ---------- réglages : connexions et coûts
const started = Date.now();
/** Ce qui relie l'app au monde : passerelle Vercel et modèles, comptes Google, WhatsApp, Telegram, stockage local. */
route("GET", "/api/connections", async (_m, _req, url) => {
  const c = classifier();
  const check = url.searchParams.get("check") === "1";
  const refresh = url.searchParams.get("refresh") === "1";
  ensureSeeded(c.db, c.settings);
  const key = getSecret("AI_GATEWAY_API_KEY") ?? "";
  const models = await gatewayModels(c.db, refresh);
  const credits = check || refresh ? await gatewayCredits() : null;
  const use30 = c.db.prepare("SELECT model, COUNT(*) calls, COALESCE(SUM(input_tokens),0) inputTokens, COALESCE(SUM(output_tokens),0) outputTokens, COALESCE(SUM(cost),0) cost, MAX(at) lastAt FROM usage WHERE at >= datetime('now', '-30 days') GROUP BY model").all() as Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; cost: number; lastAt: string }>;
  const roles = [
    { role: t("srv.roleClassify"), detail: t("srv.roleClassifyDetail"), setting: "jevModel", id: c.settings.jevModel },
    { role: t("srv.roleWriter"), detail: t("srv.roleWriterDetail"), setting: "writerModel", id: c.settings.writerModel },
    { role: t("srv.roleChat"), detail: t("srv.roleChatDetail"), setting: "chatModel", id: c.settings.chatModel },
  ].map((r) => {
    const m = models.models.find((x) => x.id === r.id);
    const p = pricingFor(c.db, r.id);
    return { ...r, name: m?.name ?? null, available: models.models.length ? !!m : null, pricing: p ? { inputPerM: p.input * 1e6, outputPerM: p.output * 1e6 } : null, usage30: use30.find((u) => u.model === r.id) ?? null };
  });
  const gatewayInfo = { keySet: !!key, keyHint: key ? key.slice(0, 4) + "…" + key.slice(-3) : null, keySource: key ? secretSource("AI_GATEWAY_API_KEY") : null, zeroDataRetention: c.settings.zeroDataRetention, models: { count: models.models.length, fetchedAt: models.fetchedAt, error: models.error ?? null }, credits, roles };

  const secretsSource = googleClientSource();
  const accounts = await Promise.all(listAccounts(c.db).filter((a) => a.source === "gmail").map(async (a) => {
    const scopes = scopesForAccount(a.email);
    const watching = listJobs().find((j) => j.accountId === a.id && j.kind === "watch" && j.status === "running");
    const items = (c.db.prepare("SELECT COUNT(*) n, MAX(fetched_at) last FROM items WHERE account_id = ?").get(a.id) as { n: number; last: string | null });
    let live: { ok: boolean; error?: string; messagesTotal?: number } | null = null;
    if (check) { try { const n = await connector(a.id, c).messagesTotal(); c.db.prepare("UPDATE accounts SET messages_total = ? WHERE id = ?").run(n, a.id); live = { ok: true, messagesTotal: n }; } catch (e) { live = { ok: false, error: (e as Error).message }; } }
    return { id: a.id, email: a.email, tokenSet: scopes.length > 0, scopes: { mail: scopes.some((s) => s.includes("gmail.modify")), drafts: scopes.includes(SCOPE_DRAFTS), calendar: scopes.includes(SCOPE_CALENDAR) }, messagesTotal: live?.messagesTotal ?? a.messages_total, items: items.n, lastFetch: items.last, backfillDone: !!a.backfill_done, watching: watching?.startedAt ?? null, live };
  }));
  const agendaMapKeys = Object.keys(kvGet<Record<string, unknown>>(c.db, "agenda.calendarMap", {})).length;
  const google = { secretsSource, accounts, agendaCalendars: agendaMapKeys };

  const was = await waState();
  const whatsapp = { enabled: was.enabled, supported: was.supported, appInstalled: was.appInstalled, appRunning: was.appRunning, dbFound: was.dbFound, probed: was.probed, dbUpdatedAt: was.dbUpdatedAt, listened: was.listened, lastIngest: was.lastIngest, schemaOk: was.schemaOk };
  const tg = tgState();
  const telegram = { enabled: tg.enabled, tokenSet: tg.tokenSet, tokenSource: tg.tokenSource, botName: tg.botName, running: tg.running, lastError: tg.lastError, lastPollAt: tg.lastPollAt, owner: tg.owner ? { name: tg.owner.name } : null, contacts: tg.contacts.length, stats: tg.stats };

  const size = (f: string) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const mtime = (f: string) => { try { return fs.statSync(f).mtime.toISOString(); } catch { return null; } };
  const local = {
    port: PORT, startedAt: new Date(started).toISOString(), node: process.version,
    db: { path: PATHS.db, bytes: size(PATHS.db) + size(PATHS.db + "-wal"), items: (c.db.prepare("SELECT COUNT(*) n FROM items").get() as { n: number }).n, decisions: (c.db.prepare("SELECT COUNT(*) n FROM decisions").get() as { n: number }).n },
    config: ["settings.json", "taxonomy.json", "rules.json", "context.json"].map((f) => ({ file: f, exists: fs.existsSync(path.join(PATHS.config, f)), updatedAt: mtime(path.join(PATHS.config, f)) })),
    tokensDir: PATHS.tokens,
  };
  return { gateway: gatewayInfo, google, whatsapp, telegram, local };
});
/** Tokens et coût par sujet, modèle, catégorie, source et jour. */
route("GET", "/api/usage", (_m, _req, url) => {
  const c = classifier();
  ensureSeeded(c.db, c.settings);
  const raw = url.searchParams.get("days");
  const days = raw === "all" ? null : Math.max(1, Number(raw) || 30);
  const models = kvGet<{ fetchedAt: string; models: unknown[] } | null>(c.db, "gateway.models", null);
  return { ...usageReport(c.db, days), pricingKnown: [c.settings.jevModel, c.settings.writerModel, c.settings.chatModel].map((m) => ({ model: m, known: !!pricingFor(c.db, m) })), pricingFetchedAt: models?.fetchedAt ?? null };
});
/** Relit la liste des modèles et leurs tarifs sur la passerelle, puis recalcule les coûts estimés. */
route("POST", "/api/gateway/refresh", async () => {
  const c = classifier();
  const models = await gatewayModels(c.db, true);
  if (models.error) throw new Error(models.error);
  // Les lignes estimées sont recalculées au nouveau tarif ; les coûts réels de la passerelle restent.
  const rows = c.db.prepare("SELECT DISTINCT model FROM usage WHERE estimated = 1").all() as Array<{ model: string }>;
  let updated = 0;
  for (const r of rows) {
    const p = pricingFor(c.db, r.model);
    if (!p) continue;
    updated += c.db.prepare("UPDATE usage SET cost = input_tokens * ? + output_tokens * ? WHERE estimated = 1 AND model = ?").run(p.input, p.output, r.model).changes;
  }
  return { models: models.models.length, fetchedAt: models.fetchedAt, updated, credits: await gatewayCredits() };
});

// ---------- sources
route("GET", "/api/accounts", () => listAccounts(openDb()));
/**
 * Connexion d'une boîte. Les droits enregistrés sont ceux que Google a accordés : sans Gmail, erreur
 * `gmail.missingMailScope` et rien n'est gardé ; Brouillons ou Agenda décochés, la boîte est connectée quand même,
 * avec `missingScopes` (« drafts », « calendar ») et un avertissement traduit par droit manquant.
 */
route("POST", "/api/accounts/add", async (_m, _req, _url, body) => {
  const { drafts, calendar } = (body ?? {}) as { drafts?: boolean; calendar?: boolean };
  const { email, missing } = await authorizeNewAccount({ drafts, calendar });
  const acc = upsertAccount(openDb(), "gmail", email);
  // Reconnexion : le connecteur en cache tient encore l'ancien jeton, le suivant relira le nouveau.
  connectors.delete(acc.id);
  return { ...acc, missingScopes: missing, warnings: missing.map(missingWarning) };
});
const missingWarning = (m: "drafts" | "calendar" | "drive") => t(m === "drafts" ? "gmail.missingDrafts" : m === "drive" ? "gmail.missingDrive" : "gmail.missingCalendar");
/** Bouton Annuler pendant « En attente de Google… » : ferme le serveur local de la connexion en cours. */
route("POST", "/api/accounts/add/cancel", () => ({ ok: true, cancelled: cancelPendingAuthorization() }));
route("POST", "/api/accounts/:id/labels", async (m) => {
  const c = classifier();
  const ids = await connector(Number(m.groups!.id), c).ensureLabels(allLabels(c));
  return Object.fromEntries(ids);
});

// ---------- WhatsApp (lu depuis WhatsApp Desktop, en local)
interface WaSettings { captions: boolean; historyDays: number; everyMinutes: number }
const WA_DEFAULTS: WaSettings = { captions: false, historyDays: 30, everyMinutes: 15 };
/**
 * `probe` : regarder le dossier de WhatsApp (écran WhatsApp, branchement). Sinon, et tant que WhatsApp n'est pas
 * branché, on s'en tient à la dernière vérification : un simple chargement de page ne doit jamais déclencher la
 * demande d'autorisation de macOS. L'attente est bornée : si macOS attend une réponse, l'état le dit (`probing`).
 */
async function waState(opts: { probe?: boolean } = {}) {
  const db = openDb();
  const enabled = kvGet(db, "wa.enabled", false);
  if (opts.probe || enabled) await Promise.race([wa.probe(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  const settings = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(db, "wa.settings", {}) };
  const listened = (db.prepare("SELECT COUNT(*) n FROM wa_chats WHERE listen = 1").get() as { n: number }).n;
  const st = wa.status();
  const lastError = kvGet<string | null>(db, "wa.schemaError", null);
  if (!enabled && lastError && st.schemaOk == null) { st.schemaOk = false; st.schemaError = lastError; }
  const lastIngest = kvGet<IngestStats | null>(db, "wa.lastIngest", null);
  const accountId = (db.prepare("SELECT id FROM accounts WHERE source = 'whatsapp'").get() as { id: number } | undefined)?.id ?? null;
  const ingestError = kvGet<string | null>(db, "wa.lastError", null);
  return { ...st, enabled, settings, listened, members: householdMembers(loadContext()), lastIngest, ingestError, ingesting: ingesting(), accountId };
}
/** Lit les conversations écoutées et classe les nouvelles fenêtres. */
async function runIngest(): Promise<IngestStats> {
  const c = classifier();
  const settings = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(c.db, "wa.settings", {}) };
  // L'erreur de la dernière lecture automatique est affichée dans Canaux › WhatsApp ; une lecture réussie l'efface.
  try { const r = await ingestWhatsApp(c, { captions: settings.captions, historyDays: settings.historyDays, ownerName: c.ctx.owner.name.split(/\s+/)[0] }); kvSet(c.db, "wa.lastError", null); return r; }
  catch (e) {
    const msg = (e as Error).message;
    if (kvGet<string | null>(c.db, "wa.lastError", null) !== msg) logActivity(c.db, "whatsapp", "error", { error: msg.slice(0, 200), n: 1 });
    kvSet(c.db, "wa.lastError", msg);
    throw e;
  }
}
route("POST", "/api/whatsapp/ingest", async () => {
  if (!kvGet(openDb(), "wa.enabled", false)) fail("err.waNotConnected");
  return runIngest();
});
/** Ce qui vient de WhatsApp dans la file Actions et dans « À caler » : pour le menu. */
route("GET", "/api/whatsapp/counts", () => {
  const c = classifier();
  const accountId = (c.db.prepare("SELECT id FROM accounts WHERE source = 'whatsapp'").get() as { id: number } | undefined)?.id;
  if (!accountId || !kvGet(c.db, "wa.enabled", false)) return { accountId: null, actions: 0, toCal: 0, lastIngestAt: null };
  const { where, params } = mailWhere(c, "queue", String(accountId), "");
  const actions = (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
  const toCal = (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${toCalWhere} AND a.source = 'whatsapp'`).get() as { n: number }).n;
  // `lastIngestAt` : la page s'en sert pour suivre les lectures automatiques sans rechargement.
  return { accountId, actions, toCal, lastIngestAt: kvGet<IngestStats | null>(c.db, "wa.lastIngest", null)?.at ?? null };
});
// Lecture automatique : toutes les N minutes tant que le Mac est allumé et WhatsApp branché.
setInterval(() => {
  try {
    const db = openDb();
    if (!kvGet(db, "wa.enabled", false) || ingesting()) return;
    const every = ({ ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(db, "wa.settings", {}) }).everyMinutes;
    const last = kvGet<IngestStats | null>(db, "wa.lastIngest", null);
    if (last && Date.now() - new Date(last.at).getTime() < every * 60_000) return;
    runIngest().catch(() => { /* notée dans wa.lastError */ });
  } catch { /* la prochaine minute réessaiera */ }
}, 60_000).unref();
route("GET", "/api/whatsapp/status", (_m, _req, url) => waState({ probe: url.searchParams.get("probe") === "1" }));
route("POST", "/api/whatsapp/enable", async () => {
  // Branchement demandé : on attend la vérification (et donc la réponse à macOS), sans bloquer le serveur.
  if (!(await wa.probe()).found) fail("err.waDbNotFound");
  await wa.snapshot(true);
  try { wa.openCopy(); } catch (e) {
    // Format inconnu : on garde le message pour l'écran de branchement et on ne branche pas.
    wa.removeSnapshot();
    kvSet(openDb(), "wa.schemaError", (e as Error).message);
    throw e;
  }
  kvSet(openDb(), "wa.schemaError", null);
  kvSet(openDb(), "wa.enabled", true);
  return waState();
});
route("POST", "/api/whatsapp/disable", () => {
  kvSet(openDb(), "wa.enabled", false);
  wa.removeSnapshot();
  return waState();
});
route("POST", "/api/whatsapp/refresh", async () => { const snap = await wa.snapshot(true); const ingest = kvGet(openDb(), "wa.enabled", false) ? await runIngest() : null; return { ...snap, ingest, status: await waState() }; });
route("PUT", "/api/whatsapp/settings", (_m, _req, _url, body) => {
  const b = (body ?? {}) as Partial<WaSettings>;
  const cur = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(openDb(), "wa.settings", {}) };
  const next: WaSettings = {
    captions: typeof b.captions === "boolean" ? b.captions : cur.captions,
    historyDays: Math.min(365, Math.max(1, Number(b.historyDays ?? cur.historyDays) || cur.historyDays)),
    everyMinutes: Math.min(1440, Math.max(1, Number(b.everyMinutes ?? cur.everyMinutes) || cur.everyMinutes)),
  };
  kvSet(openDb(), "wa.settings", next);
  return next;
});
route("GET", "/api/whatsapp/chats", async (_m, _req, url) => {
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
  const db = openDb();
  if (!kvGet(db, "wa.enabled", false)) fail("err.waNotConnected");
  await wa.snapshot();
  const prefs = new Map((db.prepare("SELECT pk, listen, for_member FROM wa_chats").all() as Array<{ pk: number; listen: number; for_member: string | null }>).map((r) => [r.pk, r]));
  const chats = wa.listChats(days).map((c) => ({ ...c, listen: !!prefs.get(c.pk)?.listen, forMember: prefs.get(c.pk)?.for_member ?? null }));
  return { days, chats, snapshotAt: wa.snapshotAt() };
});
route("PUT", "/api/whatsapp/chats/:pk", (m, _req, _url, body) => {
  const pk = Number(m.groups!.pk);
  const { listen, forMember } = (body ?? {}) as { listen?: boolean; forMember?: string | null };
  // La liste de l'interface va jusqu'à 90 jours (365 par l'API) : on cherche aussi large.
  const chat = wa.listChats(365).find((c) => c.pk === pk);
  if (!chat) fail("err.unknownChat");
  const db = openDb();
  const cur = db.prepare("SELECT listen, for_member FROM wa_chats WHERE pk = ?").get(pk) as { listen: number; for_member: string | null } | undefined;
  const nextListen = typeof listen === "boolean" ? listen : !!cur?.listen;
  const nextFor = forMember === undefined ? cur?.for_member ?? null : forMember || null;
  db.prepare(
    `INSERT INTO wa_chats (pk, jid, name, kind, listen, for_member) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pk) DO UPDATE SET jid = excluded.jid, name = excluded.name, kind = excluded.kind, listen = excluded.listen, for_member = excluded.for_member, updated_at = datetime('now')`,
  ).run(pk, chat.jid, chat.name, chat.kind, nextListen ? 1 : 0, nextFor);
  return { pk, listen: nextListen, forMember: nextFor };
});
/** Aperçu local des derniers textes d'une conversation : ce que l'IA verrait. Aucun appel, rien ne sort du Mac. */
route("GET", "/api/whatsapp/chats/:pk/preview", (m, _req, url) => {
  const db = openDb();
  if (!kvGet(db, "wa.enabled", false)) fail("err.waNotConnected");
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 7) || 7));
  const settings = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(db, "wa.settings", {}) };
  const items = wa.readMessages(Number(m.groups!.pk), 0, { captions: settings.captions, since: new Date(Date.now() - days * 86_400_000), limit: Number(url.searchParams.get("limit") ?? 60) || 60, ownerName: loadContext().owner.name.split(/\s+/)[0] });
  return items.map((i) => ({ id: i.externalId, at: i.date.toISOString(), from: i.fromName, me: i.isOutgoing, text: i.bodyExcerpt, dateHint: wa.hasDateHint(i.bodyExcerpt) }));
});

// ---------- Google Drive : lecture seule, index des noms et des dossiers, périmètre choisi (core/drive-index.ts)
function driveAccount(id: string): AccountRow {
  const a = getAccount(openDb(), id);
  if (!a || a.source !== "gmail") fail("err.unknownAccount");
  return a;
}
const hasDriveScope = (email: string) => scopesForAccount(email).includes(SCOPE_DRIVE_READ);
function driveAccountState(a: AccountRow) {
  const db = openDb();
  const st = driveState(db, a.id), busy = driveBusy.get(a.id);
  const n = (sql: string) => (db.prepare(sql).get(a.id) as { n: number }).n;
  return {
    id: a.id, email: a.email, scope: hasDriveScope(a.email), enabled: driveEnabled(db, a.id),
    rootId: st.rootId, scannedAt: st.scannedAt, syncedAt: st.syncedAt, nextAt: nextDriveSync(db, a.id), error: st.error, errorCode: st.errorCode,
    busy: busy ? { phase: busy.phase, n: busy.n, startedAt: busy.startedAt } : null,
    docs: n("SELECT COUNT(*) n FROM docs WHERE account_id = ? AND in_scope = 1"),
    frozen: n("SELECT COUNT(*) n FROM docs WHERE account_id = ? AND frozen = 1"),
    folders: n("SELECT COUNT(*) n FROM drive_folders WHERE account_id = ? AND path IS NOT NULL"),
    settings: driveSettings(db, a.id), formats: formatCounts(db, a.id), root: rootSummary(db, a.id),
    // La fiche des documents : combien sont classés, ce qui attend, le classement en cours, la lecture des scans possible ou non.
    cards: { ...cardCounts(db, a.id), auto: autoClassifyOn(db, a.id), job: docJobs.get(a.id) ?? null, ocr: !!textBin() },
  };
}
const classifyDeps = (a: AccountRow) => { const c = classifier(); return { db: c.db, ctx: c.ctx, settings: c.settings, accountId: a.id, reader: new DriveReader(a.email) }; };
/** Un classement en arrière-plan ; l'écran suit son avancement par /api/drive/status. */
function startClassify(a: AccountRow, opts: { max?: number | null; auto?: boolean } = {}): void {
  if (classifying(a.id)) return;
  void classifyDocs(classifyDeps(a), { ...opts, email: a.email }).catch((e) => console.error("[drive] fiches", (e as Error).message));
}
/** Une lecture de Drive en arrière-plan : l'erreur est gardée dans l'état du compte et notée au fil. */
function startDriveSync(a: AccountRow, full = false): Promise<SyncResult | null> {
  if (driveBusy.has(a.id)) return Promise.resolve(null);
  return syncDrive(openDb(), a, new DriveReader(a.email), { full }).catch((e) => { console.error("[drive]", (e as Error).message); return null; });
}
/**
 * Le projet Google de Molinova : le numéro au début de l'identifiant du client OAuth (« 123…-abc.apps.googleusercontent.com »).
 * Le lien vers Google Drive API s'ouvre ainsi directement dans ce projet, sans avoir à le choisir.
 */
function googleProject(): { project: string | null; apiUrl: string } {
  const project = /^(\d+)-/.exec(currentGoogleClientId() ?? "")?.[1] ?? null;
  return { project, apiUrl: `https://console.cloud.google.com/apis/library/drive.googleapis.com${project ? `?project=${project}` : ""}` };
}
route("GET", "/api/drive/status", () => ({
  everyMinutes: DRIVE_EVERY_MIN, google: googleProject(),
  accounts: listAccounts(openDb()).filter((a) => a.source === "gmail").map(driveAccountState),
}));
/**
 * Donne à Molinova le droit de lire Drive pour une boîte déjà connectée. Les droits déjà accordés (brouillons, agenda)
 * sont redemandés avec, pour ne rien perdre ; Google propose directement cette boîte, et une autre est refusée.
 */
route("POST", "/api/drive/:id/connect", async (m) => {
  const a = driveAccount(m.groups!.id);
  const cur = scopesForAccount(a.email);
  const { missing } = await authorizeNewAccount({ drafts: cur.includes(SCOPE_DRAFTS), calendar: cur.includes(SCOPE_CALENDAR), drive: true, expectEmail: a.email });
  connectors.delete(a.id);
  if (!missing.includes("drive")) {
    setDriveEnabled(openDb(), a.id, true);
    void startDriveSync(a);
  }
  return { ...driveAccountState(a), warnings: missing.map(missingWarning) };
});
route("POST", "/api/drive/:id/enable", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  const on = !!(body as { on?: unknown } | null)?.on;
  if (on && !hasDriveScope(a.email)) fail("drive.scopeMissing");
  setDriveEnabled(openDb(), a.id, on);
  if (on && !driveState(openDb(), a.id).pageToken) void startDriveSync(a);
  return driveAccountState(a);
});
/** « Relire maintenant » : les changements depuis la dernière lecture, ou tout (`full`). Répond tout de suite ; la page suit l'état. */
route("POST", "/api/drive/:id/sync", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  if (!hasDriveScope(a.email)) fail("drive.scopeMissing");
  if (driveBusy.has(a.id)) fail("drive.busy", undefined, 409);
  void startDriveSync(a, !!(body as { full?: unknown } | null)?.full);
  return driveAccountState(a);
});
/** Oublie l'index local de ce compte et coupe les lectures. Rien n'est touché dans Drive ; les choix de dossiers restent. */
route("DELETE", "/api/drive/:id/index", (m) => {
  const a = driveAccount(m.groups!.id);
  if (driveBusy.has(a.id)) fail("drive.busy", undefined, 409);
  forgetDrive(openDb(), a.id);
  return driveAccountState(a);
});
route("GET", "/api/drive/:id/folders", (m, _req, url) => {
  const a = driveAccount(m.groups!.id);
  const parent = url.searchParams.get("parent") || driveState(openDb(), a.id).rootId;
  return { parent, folders: parent ? folderChildren(openDb(), a.id, parent) : [] };
});
route("PUT", "/api/drive/:id/folders/:fid", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  const mode = (body as { mode?: unknown } | null)?.mode ?? null;
  if (mode !== null && !FOLDER_MODES.includes(mode as FolderMode)) fail("drive.badMode");
  const db = openDb();
  setFolderMode(db, a.id, decodeURIComponent(m.groups!.fid), mode as FolderMode | null);
  refreshScope(db, a.id);
  return driveAccountState(a);
});
route("PUT", "/api/drive/:id/settings", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  const b = (body ?? {}) as { formats?: unknown; maxMb?: unknown };
  const db = openDb();
  saveDriveSettings(db, a.id, {
    ...(Array.isArray(b.formats) ? { formats: b.formats.filter((f): f is Format => (FORMATS as readonly unknown[]).includes(f)) } : {}),
    ...(b.maxMb != null && Number(b.maxMb) > 0 ? { maxMb: Math.min(2000, Number(b.maxMb)) } : {}),
  });
  refreshScope(db, a.id);
  return driveAccountState(a);
});
/**
 * Recherche de documents : l'index local (noms, dossiers, fiches, début du texte). `deep=1` ajoute la recherche de Google
 * dans le contenu et la relecture des meilleurs candidats par Jev (≈ 0,1 ¢), sur demande explicite (Entrée).
 */
route("GET", "/api/drive/search", async (_m, _req, url) => {
  const account = Number(url.searchParams.get("account")) || undefined;
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return [];
  const deep = url.searchParams.get("deep") === "1";
  const c = classifier();
  return findDocs({ db: c.db, ctx: c.ctx, settings: c.settings, accountId: account, limit: deep ? 5 : 30, rerank: deep, google: deep ? driveFullText : undefined }, { request: q });
});
/** La recherche de Google dans le contenu, pour un compte dont Drive est branché. */
async function driveFullText(accountId: number, words: string[]): Promise<string[]> {
  const a = getAccount(openDb(), String(accountId));
  if (!a || !hasDriveScope(a.email) || !driveEnabled(openDb(), a.id)) return [];
  return new DriveReader(a.email).fullTextSearch(words);
}
/** Combien coûterait la fiche des documents en attente (tout, ou un échantillon choisi dans la fenêtre du coût). */
route("POST", "/api/estimate/drive/:id", async (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  const c = classifier();
  // `redo` : refaire aussi les fiches déjà faites par Jev (jamais celles corrigées à la main).
  const redo = !!(body as { redo?: unknown } | null)?.redo;
  const n = pendingDocs(c.db, a.id).length + (redo ? (c.db.prepare("SELECT COUNT(*) n FROM doc_cards c JOIN docs d USING (account_id, file_id) WHERE c.account_id = ? AND c.by = 'jev' AND c.type IS NOT NULL AND d.in_scope = 1 AND c.md5 IS COALESCE(d.md5, d.modified_at, '')").get(a.id) as { n: number }).n : 0);
  const rate = aiRate(c.db, c.settings, "drive");
  return withCredits({ total: n, rate, estimate: estimateFor(rate, n) });
});
/** Lance la fiche des documents : `max` = un échantillon réparti sur les dossiers et les années, sinon tout ce qui attend. */
route("POST", "/api/drive/:id/classify", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  if (!hasDriveScope(a.email)) fail("drive.scopeMissing");
  const { max, redo } = (body ?? {}) as { max?: unknown; redo?: unknown };
  if (classifying(a.id)) fail("drive.classifyBusy", undefined, 409);
  if (redo) markCardsStale(openDb(), a.id);
  startClassify(a, { max: typeof max === "number" && max > 0 ? Math.floor(max) : null });
  return driveAccountState(a);
});
route("POST", "/api/drive/:id/classify/stop", (m) => {
  const a = driveAccount(m.groups!.id);
  stopClassify(a.id);
  return driveAccountState(a);
});
/**
 * Corriger une fiche : Type, Contexte, personnes. La correction devient un exemple pour Jev, et la fiche n'est plus
 * réécrite par lui (by = user). Le titre et les mots de recherche suivent.
 */
route("PUT", "/api/drive/:id/docs/:fid/card", (m, _req, _url, body) => {
  const a = driveAccount(m.groups!.id);
  const fid = decodeURIComponent(m.groups!.fid);
  const db = openDb();
  const cur = db.prepare("SELECT c.*, d.created_at, d.modified_at FROM docs d LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id WHERE d.account_id = ? AND d.file_id = ?").get(a.id, fid) as Record<string, string | number | null> | undefined;
  if (!cur) fail("drive.unknownDoc", undefined, 404);
  const tax = loadDocTaxonomy(), ctx = loadContext(), members = householdMembers(ctx);
  const b = (body ?? {}) as { type?: string; context?: string; people?: string[] };
  if (b.type !== undefined && !tax.types.some((x) => x.key === b.type)) fail("err.badBody", undefined, 400);
  if (b.context !== undefined && !tax.contexts.some((x) => x.key === b.context)) fail("err.badBody", undefined, 400);
  const people = b.people !== undefined ? b.people.filter((k) => members.some((mm) => mm.key === k && mm.kind !== "family")) : String(cur.people ?? "").split(",").filter(Boolean);
  const next = { type: b.type ?? (cur.type as string | null), context: b.context ?? (cur.context as string | null), context2: b.context !== undefined ? null : (cur.context2 as string | null), people, party: cur.party as string | null };
  const log = db.prepare("INSERT INTO doc_corrections (account_id, file_id, facet, before, after) VALUES (?, ?, ?, ?, ?)");
  db.transaction(() => {
    if (b.type !== undefined && b.type !== cur.type) log.run(a.id, fid, "type", cur.type, b.type);
    if (b.context !== undefined && b.context !== cur.context) log.run(a.id, fid, "context", cur.context, b.context);
    if (b.people !== undefined && people.join(",") !== String(cur.people ?? "")) log.run(a.id, fid, "people", cur.people, people.join(","));
    const names = people.map((k) => (k === "me" ? ctx.owner.name.split(/\s+/)[0] : members.find((mm) => mm.key === k)?.name ?? k));
    const title = composeTitle({ date: docDate(cur.created_at as string | null, cur.modified_at as string | null), type: typeName(tax, next.type), party: next.party, people: names, context: contextName(tax, next.context) });
    db.prepare(`INSERT INTO doc_cards (account_id, file_id, type, context, context2, people, title, facets, by, classified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(account_id, file_id) DO UPDATE SET type = excluded.type, context = excluded.context, context2 = excluded.context2, people = excluded.people, title = excluded.title, facets = excluded.facets, by = 'user'`)
      .run(a.id, fid, next.type, next.context, next.context2, people.join(","), title, facetsText(tax, members, next));
  })();
  refreshDocFts(db, a.id, fid);
  return { ok: true };
});
// ---------- la page Documents : parcourir les dossiers lus, filtrer par fiche, voir le détail (lecture seule, rien vers Google)
/** Les comptes dont Drive a des documents dans le périmètre. */
route("GET", "/api/docs/accounts", () => {
  const db = openDb();
  return listAccounts(db).filter((a) => a.source === "gmail" && hasDriveScope(a.email)).map((a) => ({ id: a.id, email: a.email, rootId: driveState(db, a.id).rootId, ...cardCounts(db, a.id) })).filter((a) => a.inScope > 0);
});
/** Les sous-dossiers qui contiennent des documents lus. */
route("GET", "/api/docs/:id/folders", (m, _req, url) => {
  const a = driveAccount(m.groups!.id);
  const parent = url.searchParams.get("parent") || driveState(openDb(), a.id).rootId;
  return { parent, folders: parent ? folderChildren(openDb(), a.id, parent).filter((f) => f.nScope > 0) : [] };
});
const BROWSE_FLAGS: BrowseFlag[] = ["sensitive", "expiring", "expired", "unclassified", "action", "corrected"];
function browseFilter(accountId: number, url: URL): BrowseFilter {
  const g = (k: string) => url.searchParams.get(k) || null;
  const flag = g("flag");
  const sort = g("sort");
  return { accountId, folder: g("folder"), type: g("type"), context: g("context"), person: g("person"), flag: flag && BROWSE_FLAGS.includes(flag as BrowseFlag) ? (flag as BrowseFlag) : null, q: g("q"),
    sort: sort === "name" || sort === "expiry" ? sort : "modified", offset: Number(g("offset")) || 0, limit: Number(g("limit")) || 60 };
}
route("GET", "/api/docs/:id/list", (m, _req, url) => {
  const a = driveAccount(m.groups!.id);
  const c = classifier();
  const f = browseFilter(a.id, url);
  return { ...listDocs({ db: c.db, ctx: c.ctx }, f), facets: facetCounts({ db: c.db, ctx: c.ctx }, f) };
});
route("GET", "/api/docs/:id/doc/:fid", (m) => {
  const a = driveAccount(m.groups!.id);
  const c = classifier();
  const d = docDetail({ db: c.db, ctx: c.ctx }, a.id, decodeURIComponent(m.groups!.fid));
  if (!d) fail("drive.unknownDoc", undefined, 404);
  return d;
});
/** Un document du périmètre, avec ce qu'il faut pour l'aperçu et le téléchargement (jamais un fichier hors des dossiers lus). */
function previewDoc(accountId: number, fileId: string): { doc: PreviewDoc; reader: DriveReader } {
  const a = driveAccount(String(accountId));
  if (!hasDriveScope(a.email)) fail("drive.scopeMissing");
  const r = openDb().prepare("SELECT file_id id, name, mime, format, size, COALESCE(md5, modified_at, '') stamp FROM docs WHERE account_id = ? AND file_id = ? AND in_scope = 1").get(a.id, fileId) as Omit<PreviewDoc, "accountId"> | undefined;
  if (!r) fail("drive.unknownDoc", undefined, 404);
  return { doc: { ...r, accountId: a.id }, reader: new DriveReader(a.email) };
}
/** Ce que l'aperçu peut montrer : des pages (images), du HTML (Word), du texte, ou rien (format, taille). */
route("GET", "/api/docs/:id/doc/:fid/preview", async (m) => {
  const { doc, reader } = previewDoc(Number(m.groups!.id), decodeURIComponent(m.groups!.fid));
  return previewInfo(reader, doc);
});
route("GET", "/api/docs/:id/doc/:fid/page/:n", async (m) => {
  const { doc, reader } = previewDoc(Number(m.groups!.id), decodeURIComponent(m.groups!.fid));
  return { __raw: await previewPage(reader, doc, Math.max(1, Number(m.groups!.n) || 1)), name: `${doc.name}-${m.groups!.n}.jpg`, mime: "image/jpeg", inline: true };
});
/** Un Word en HTML nettoyé (sans script, règle de sécurité en tête), affiché par l'interface dans un cadre sans script. */
route("GET", "/api/docs/:id/doc/:fid/html", async (m) => {
  const { doc, reader } = previewDoc(Number(m.groups!.id), decodeURIComponent(m.groups!.fid));
  return { html: await previewHtml(reader, doc) };
});
/** Télécharger le document (un fichier Google part en PDF). */
route("GET", "/api/docs/:id/doc/:fid/file", async (m) => {
  const { doc, reader } = previewDoc(Number(m.groups!.id), decodeURIComponent(m.groups!.fid));
  const f = await downloadFile(reader, doc);
  return { __raw: f.data, name: f.name, mime: f.mime };
});
/** La taxonomie documents (Types, Contextes) et les membres du foyer : pour l'éditeur de fiche. */
route("GET", "/api/drive/taxonomy", () => ({ ...loadDocTaxonomy(), members: householdMembers(loadContext()).filter((m) => m.kind !== "family") }));
// Les fiches déjà faites reçoivent les mots de recherche de la version courante (sans Jev, sans coût).
try { const n = upgradeFacets(openDb(), loadContext()); if (n) console.log(`[drive] ${n} fiches : mots de recherche mis à jour`); } catch (e) { console.error("[drive] fiches", (e as Error).message); }
// Lecture automatique : toutes les DRIVE_EVERY_MIN minutes, pour chaque boîte dont Drive est branché.
setInterval(() => {
  try {
    const db = openDb();
    for (const a of listAccounts(db).filter((x) => x.source === "gmail")) {
      if (!driveEnabled(db, a.id) || driveBusy.has(a.id) || !hasDriveScope(a.email)) continue;
      const next = nextDriveSync(db, a.id);
      if (next && Date.parse(next) <= Date.now()) void startDriveSync(a);
      // Les nouveautés reçoivent leur fiche d'elles-mêmes, par petits passages ; un gros lot attend l'accord de l'utilisateur (coût).
      else if (autoClassifyOn(db, a.id) && !classifying(a.id)) { const n = pendingDocs(db, a.id).length; if (n > 0 && n <= AUTO_MAX) startClassify(a, { auto: true }); }
    }
  } catch { /* la prochaine minute réessaiera */ }
}, 60_000).unref();

// ---------- Agenda : un couloir par membre du foyer (écran D). Les accès (compte, agendas, rattachement) sont dans core/agenda-access.

route("GET", "/api/agenda/week", async (_m, _req, url) => {
  const c = classifier();
  const members = householdMembers(c.ctx);
  const start = url.searchParams.get("start") ? parseYmd(url.searchParams.get("start")!) : weekStart(new Date());
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)));
  const source = url.searchParams.get("source");
  const toCal = c.db.prepare(`SELECT i.id, i.from_name, i.from_address, i.subject, i.date, a.source, CASE WHEN COALESCE(json_extract(d.flags_json, '$.event'), 0) = 1 THEN 'event' ELSE 'task' END kind FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${toCalWhere}${source ? " AND a.source = ?" : ""} ORDER BY i.date DESC LIMIT 50`).all(...(source ? [source] : [])) as Array<Record<string, unknown>>;
  const acc = agendaAccount(c.db);
  // Le vrai total (« 1 sur 128 »), même si seules les 50 plus récentes sont listées.
  const toCalTotal = (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${toCalWhere}${source ? " AND a.source = ?" : ""}`).get(...(source ? [source] : [])) as { n: number }).n;
  const base = { start: ymd(start), days, members, timezone: c.ctx.owner.timezone, toCal: { count: toCal.length, total: toCalTotal, items: toCal } };
  if (!acc) return { ...base, account: null, lanes: [], byCalendar: [], conflicts: [], warning: t("cal.warnNoAccount") };
  let calendars: CalendarInfo[];
  let warning: string | null = acc.canList ? null : t("cal.warnNoList");
  try { calendars = await agendaCalendars(acc.email, acc.canList); } catch (e) { return { ...base, account: acc.email, lanes: [], byCalendar: [], conflicts: [], warning: (e as Error).message }; }
  const { map, familyCalendar } = agendaMap(c.db, calendars);
  const shown = calendars.filter((k) => map[k.id] && map[k.id] !== "hidden");
  const timeMin = start, timeMax = addDays(start, 7);
  const results = await Promise.allSettled(shown.map((k) => listEvents(acc.email, k.id, timeMin, timeMax)));
  const events: CalEvent[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => { if (r.status === "fulfilled") events.push(...r.value); else failed.push(`${shown[i].name} : ${r.reason?.message ?? r.reason}`); });
  if (failed.length) warning = [warning, ...failed].filter(Boolean).join(" · ");
  const names = Object.fromEntries(calendars.map((k) => [k.id, k.name]));
  const lanes = buildLanes(events, members, map, names);
  const byCalendar = shown.map((k) => ({ id: k.id, name: k.name, member: map[k.id], events: events.filter((e) => e.calendarId === k.id).map((e) => ({ ...e, day: e.start.length === 10 ? e.start : ymd(new Date(e.start)) })) }));
  const writable = Object.fromEntries(shown.map((k) => [k.id, !!k.canWrite]));
  return { ...base, account: acc.email, canList: acc.canList, canCreate: acc.canCreate, familyCalendar, writable, lanes, byCalendar, conflicts: findConflicts(lanes), warning };
});
/** Change qui est concerné / qui accompagne, sur une occurrence ou toute la série. L'événement reste. */
route("POST", "/api/agenda/events/members", async (_m, _req, _url, body) => {
  const { calendarId, eventId, seriesId, scope = "one", forKeys = [], present = [] } = (body ?? {}) as { calendarId: string; eventId: string; seriesId?: string; scope?: "one" | "series"; forKeys?: string[]; present?: string[] };
  if (!calendarId || !eventId) fail("err.unknownEvent");
  const acc = agendaAccount(openDb());
  if (!acc) fail("cal.noAccount");
  await patchEventProps(acc.email, calendarId, scope === "series" && seriesId ? seriesId : eventId, { ea_for: forKeys.join(","), ea_present: present.join(",") });
  return { ok: true };
});
/** Supprime un événement dans n'importe quel agenda lu : une occurrence, ou toute la série (`seriesId`). Sur un clic confirmé. */
route("POST", "/api/agenda/events/delete", async (_m, _req, _url, body) => {
  const { calendarId, eventId, seriesId, scope = "one" } = (body ?? {}) as { calendarId: string; eventId: string; seriesId?: string; scope?: "one" | "series" };
  if (!calendarId || !eventId) fail("err.unknownEvent");
  const acc = agendaAccount(openDb());
  if (!acc) fail("cal.noAccount");
  await deleteCalendarEvent(acc.email, calendarId, scope === "series" && seriesId ? seriesId : eventId);
  return { ok: true };
});

route("GET", "/api/agenda/calendars", async () => {
  const db = openDb();
  const acc = agendaAccount(db);
  if (!acc) return { account: null, calendars: [], map: {}, familyCalendar: null, members: householdMembers(loadContext()) };
  const calendars = await agendaCalendars(acc.email, acc.canList, true);
  const { map, familyCalendar } = agendaMap(db, calendars);
  return { account: acc.email, canList: acc.canList, canCreate: acc.canCreate, calendars, map, familyCalendar, members: householdMembers(loadContext()) };
});
route("PUT", "/api/agenda/calendars", (_m, _req, _url, body) => {
  const db = openDb();
  const { map, familyCalendar } = (body ?? {}) as { map?: AgendaMap; familyCalendar?: string | null };
  if (map) kvSet(db, "agenda.calendarMap", map);
  if (familyCalendar !== undefined) kvSet(db, "agenda.familyCalendar", familyCalendar);
  return { ok: true };
});
/** Trouve ou crée l'agenda « Famille » du compte. */
route("POST", "/api/agenda/family-calendar", async () => ensureFamilyCalendar(openDb(), loadContext().owner.timezone));

/** Une proposition « à caler » : l'événement extrait (une fois, puis gardé), pour qui d'après Jev, la règle du domaine. */
route("GET", "/api/agenda/tocal/:id", async (m) => {
  const c = classifier();
  const item = c.db.prepare(`SELECT i.id, i.account_id, i.external_id, i.from_name, i.from_address, i.subject, i.date, i.body_excerpt, d.answers_json, d.flags_json, a.source FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE i.id = ?`).get(m.groups!.id) as Record<string, unknown> | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const members = householdMembers(c.ctx);
  const acc = agendaAccount(c.db);
  const isWa = item.source === "whatsapp";
  const flags = (item.flags_json ? JSON.parse(item.flags_json as string) : {}) as Record<string, boolean>;
  const answers = item.answers_json ? (JSON.parse(item.answers_json as string) as Record<string, { probabilities?: Record<string, number> }>) : {};
  const probs: Record<string, number> = {};
  for (const [k, p] of Object.entries(answers.child?.probabilities ?? {})) if (k !== "none") probs[`child:${k}`] = p;
  // Clé de la règle « toujours X pour … » : le domaine de l'expéditeur, ou le groupe WhatsApp.
  const domain = isWa ? (item.from_address as string) : domainOf(item.from_address as string);
  const rule = c.db.prepare("SELECT for_member FROM member_rules WHERE domain = ?").get(domain) as { for_member: string } | undefined;
  const chatPref = isWa ? (c.db.prepare("SELECT for_member FROM wa_chats WHERE jid = ?").get(item.from_address as string) as { for_member: string | null } | undefined)?.for_member : null;
  const best = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  const suggested = rule ? [rule.for_member] : best && best[1] >= 0.5 ? [best[0]] : chatPref ? [chatPref] : [];
  const itemOut = { id: item.id, from_name: item.from_name, from_address: item.from_address, subject: item.subject, date: item.date, source: item.source, text: isWa ? item.body_excerpt : undefined };
  const waText: SourceText = { from: item.from_name as string, subject: item.subject as string, date: item.date as string, text: item.body_excerpt as string, channel: "whatsapp" };
  const cached = c.db.prepare("SELECT draft_json FROM event_drafts WHERE item_id = ?").get(item.id) as { draft_json: string } | undefined;
  const cachedObj = cached ? (JSON.parse(cached.draft_json) as { kind?: string; invite?: IcsInvite; title?: string }) : null;
  // Une tâche sans événement : le modèle texte propose un titre et une échéance.
  if (!flags.event && flags.task) {
    const r = await settleProposal(c, item.id as number, flags, async () => (isWa ? waText : await connector(item.account_id as number, c).getFull(item.external_id as string)));
    if (r.past) return { kind: "past", item: itemOut };
    return { kind: "task", item: itemOut, task: r.proposal, probs, rule: rule?.for_member ?? null, domain, suggested, members };
  }
  let draft: Omit<EventProposal, "kind">;
  if (cachedObj && cachedObj.kind === "draft") draft = cachedObj as typeof draft;
  else if (isWa) {
    const r = await settleProposal(c, item.id as number, flags, () => waText);
    if (r.past) return { kind: "past", item: itemOut };
    draft = r.proposal as typeof draft;
  } else {
    const gm = connector(item.account_id as number, c);
    let inv: IcsInvite | null = cachedObj?.invite ?? null;
    let message: Awaited<ReturnType<GmailConnector["getFull"]>> | null = null;
    if (!inv) {
      message = await gm.getFull(item.external_id as string);
      inv = await invitationOf(gm, message);
      if (inv) c.db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET draft_json = excluded.draft_json, extracted_at = datetime('now')").run(item.id, JSON.stringify({ kind: "invitation", invite: inv }));
    }
    // Une vraie invitation (fichier iCalendar) : on répond, on ne recrée rien. Aucun appel au modèle texte.
    if (inv && (inv.method === "REQUEST" || inv.method === "CANCEL")) {
      const accEmail = getAccount(c.db, String(item.account_id))!.email;
      let google: { id: string; link: string; myStatus: string | null } | null = null;
      try { google = await findByIcalUid(accEmail, inv.uid); } catch (e) { google = null; }
      if (isPast({ kind: "invitation", invite: inv })) { markPast(c.db, item.id as number); return { kind: "past", item: itemOut }; }
      const partstat = google?.myStatus ?? ({ ACCEPTED: "accepted", TENTATIVE: "tentative", DECLINED: "declined", "NEEDS-ACTION": "needsAction" } as Record<string, string>)[myPartstat(inv, c.ctx.owner.emails) ?? ""] ?? "needsAction";
      const domain = domainOf(item.from_address as string);
      return { kind: "invitation", item: itemOut, invite: { ...inv, cancelled: inv.method === "CANCEL", myStatus: partstat, link: google?.link ?? null, inGoogle: !!google }, members, domain, canRespond: !!acc, account: accEmail };
    }
    if (!message) message = await gm.getFull(item.external_id as string);
    const p = await extractEventProposal(c, item.id as number, message);
    cacheProposal(c.db, item.id as number, p);
    draft = p;
  }
  if (isPast({ kind: "draft", ...draft })) { markPast(c.db, item.id as number); return { kind: "past", item: itemOut }; }
  return { kind: "draft", item: itemOut, draft, update: withChanges(draft), probs, rule: rule?.for_member ?? null, domain, suggested, members, canCreate: !!acc, templateUrl: calendarTemplateUrl(draft) };
});
/** L'invitation iCalendar portée par un email, en clair ou en pièce jointe. */
async function invitationOf(gm: GmailConnector, message: Awaited<ReturnType<GmailConnector["getFull"]>>): Promise<IcsInvite | null> {
  let text = message.calendar;
  if (!text && message.calendarAttachmentId) { try { text = (await gm.getAttachment(message.id, message.calendarAttachmentId)).toString("utf8"); } catch { text = undefined; } }
  if (!text) return null;
  try { return parseIcs(text, loadContext().owner.timezone); } catch (err) { console.error("[invitation]", (err as Error).message); return null; }
}
/** Accepter, peut-être, refuser : la réponse part à l'organisateur, comme depuis Google Agenda. */
route("POST", "/api/agenda/tocal/:id/respond", async (m, _req, _url, body) => {
  const c = classifier();
  const { status, forKeys = [] } = (body ?? {}) as { status: RsvpStatus; forKeys?: string[] };
  if (!["accepted", "tentative", "declined"].includes(status)) fail("err.unknownRsvp");
  const item = c.db.prepare("SELECT id, account_id, external_id FROM items WHERE id = ?").get(m.groups!.id) as { id: number; account_id: number; external_id: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const acc = getAccount(c.db, String(item.account_id))!;
  if (!scopesForAccount(acc.email).includes(SCOPE_CALENDAR)) fail("err.calendarScope");
  const gm = connector(item.account_id, c);
  const inv = await invitationOf(gm, await gm.getFull(item.external_id));
  if (!inv) fail("err.noInvite");
  const props: Record<string, string> = { ea_source: `gmail:${item.id}` };
  if (forKeys.length) props.ea_for = forKeys.join(",");
  const r = await respondToInvite(acc.email, inv, status, props);
  c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(item.id);
  return { ok: true, status, ...r };
});
route("POST", "/api/agenda/tocal/:id/create", async (m, _req, _url, body) => {
  const c = classifier();
  const { draft, forKeys = [], present = [], always = false } = (body ?? {}) as { draft: EventDraft; forKeys?: string[]; present?: string[]; always?: boolean };
  if (!draft?.title?.trim() || !draft.start) fail("err.titleStartRequired");
  const item = c.db.prepare("SELECT i.id, i.from_address, a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id = ?").get(m.groups!.id) as { id: number; from_address: string; source: string } | undefined;
  if (!item) fail("err.unknownItem", undefined, 404);
  const members = householdMembers(c.ctx);
  const fam = await ensureFamilyCalendar(c.db, c.ctx.owner.timezone);
  const who = forKeys.length ? forKeys : ["family"];
  const names = (keys: string[]) => keys.map((k) => members.find((x) => x.key === k)?.name ?? k).join(", ");
  const description = eventDescription(draft.description, names(who), present.length ? names(present) : "");
  const r = await createCalendarEvent(fam.email, {
    ...draft, calendarId: fam.id, timezone: draft.timezone || c.ctx.owner.timezone, title: titleFor(draft.title, who, members), description,
    props: { ea_for: who.join(","), ea_present: present.join(","), ea_source: `${item.source}:${item.id}` },
  });
  c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(item.id);
  forgetUpcoming();
  if (always && who.length === 1) c.db.prepare("INSERT INTO member_rules (domain, for_member) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET for_member = excluded.for_member").run(item.source === "whatsapp" ? item.from_address : domainOf(item.from_address), who[0]);
  return { ok: true, ...r };
});
/**
 * Le message modifie un événement déjà dans l'agenda : on met cet événement à jour (horaires, lieu, titre),
 * on note la précision en fin de description, et le message sort de la file. Sur clic explicite.
 */
route("POST", "/api/agenda/tocal/:id/update", async (m, _req, _url, body) => {
  const c = classifier();
  const { draft } = (body ?? {}) as { draft: EventDraft };
  if (!draft?.title?.trim() || !draft.start) fail("err.titleStartRequired");
  const r = await applyUpdate(c, Number(m.groups!.id), draft);
  if (!r) fail("err.noEventToUpdate");
  return { ok: true, ...r };
});
/** Rattrapage : règle toutes les propositions encore ouvertes (extraction en cache, les dépassées sortent). */
route("POST", "/api/agenda/settle", async () => settleOpen(classifier()));
/**
 * Les éléments « Agenda » ou « Tâche » encore ouverts : chacun reçoit sa proposition (extraite une fois, gardée en cache)
 * et sort de la file si sa date est passée. `onlyMissing` : seulement ceux jamais extraits (le passage de fond,
 * quelques appels au modèle texte au plus, comme à l'arrivée d'un message) ; `limit` borne le nombre d'extractions.
 */
async function settleOpen(c: Classifier, opts: { onlyMissing?: boolean; limit?: number } = {}): Promise<{ checked: number; past: number; open: number; errors: number }> {
  const missing = opts.onlyMissing ? " AND NOT EXISTS (SELECT 1 FROM event_drafts e WHERE e.item_id = i.id)" : "";
  const rows = c.db.prepare(`SELECT i.id, i.account_id, i.external_id, i.from_name, i.subject, i.date, i.body_excerpt, d.flags_json, a.source FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${toCalWhere}${missing} ORDER BY i.date DESC LIMIT ?`).all(opts.limit ?? 1000) as Array<Record<string, unknown>>;
  let past = 0, open = 0, errors = 0;
  for (const r of rows) {
    const flags = (r.flags_json ? JSON.parse(r.flags_json as string) : {}) as Record<string, boolean>;
    try {
      const cached = cachedProposal(c.db, r.id as number);
      if (cached?.kind === "invitation") { if (isPast(cached)) { markPast(c.db, r.id as number); past++; } else open++; continue; }
      const res = await settleProposal(c, r.id as number, flags, async () => (r.source === "whatsapp" ? { from: r.from_name as string, subject: r.subject as string, date: r.date as string, text: r.body_excerpt as string, channel: "whatsapp" as const } : await connector(r.account_id as number, c).getFull(r.external_id as string)));
      if (res.past) past++; else open++;
    } catch { errors++; }
  }
  return { checked: rows.length, past, open, errors };
}
/** « Nettoyer le bruit » (carte À caler) : combien de propositions Jev relira, et ce que ça coûtera. */
route("POST", "/api/estimate/declutter", (_m, _req, _url, body) => {
  const c = classifier();
  const n = toCalRows(c, (body as { source?: string } | undefined)?.source).length;
  const rate = aiRate(c.db, c.settings, "gmail");
  // Prudent : compté comme un classement complet, alors qu'il n'y a qu'une question par proposition.
  return withCredits({ total: n, rate, estimate: estimateFor(rate, n, { allJev: true }) });
});
/** Jev relit toutes les propositions en attente et ignore les sollicitations ; on dit combien sont parties et lesquelles. */
route("POST", "/api/agenda/declutter", async (_m, _req, _url, body) => {
  const c = classifier();
  const rows = toCalRows(c, (body as { source?: string } | undefined)?.source);
  const r = await declutter(c, rows);
  if (r.ignored.length) logActivity(c.db, "app", "declutter", { n: r.ignored.length, kept: r.kept });
  return r;
});
route("POST", "/api/agenda/tocal/:id/ignore", (m) => {
  openDb().prepare("UPDATE decisions SET action_state = 2 WHERE item_id = ?").run(m.groups!.id);
  return { ok: true };
});
route("POST", "/api/agenda/tocal/:id/task", (m, _req, _url, body) => {
  const db = openDb();
  const { title, due, forMember } = (body ?? {}) as { title: string; due?: string | null; forMember?: string | null };
  if (!title?.trim()) fail("err.titleRequired");
  const src = (db.prepare("SELECT a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id = ?").get(m.groups!.id) as { source: string } | undefined)?.source ?? "gmail";
  const r = db.prepare("INSERT INTO tasks (title, due, for_member, source, source_item_id) VALUES (?, ?, ?, ?, ?)").run(title.trim(), due || null, forMember || null, src, Number(m.groups!.id));
  db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(m.groups!.id);
  return { ok: true, id: Number(r.lastInsertRowid) };
});

// ---------- tâches : dans l'app, nulle part ailleurs
route("GET", "/api/tasks", (_m, _req, url) => {
  const all = url.searchParams.get("all") === "1";
  return openDb().prepare(`SELECT * FROM tasks ${all ? "" : "WHERE done_at IS NULL OR done_at > datetime('now', '-2 days')"} ORDER BY done_at IS NOT NULL, due IS NULL, due, id LIMIT 200`).all();
});
route("POST", "/api/tasks", (_m, _req, _url, body) => {
  const { title, due, forMember } = (body ?? {}) as { title: string; due?: string | null; forMember?: string | null };
  if (!title?.trim()) fail("err.titleRequired");
  const r = openDb().prepare("INSERT INTO tasks (title, due, for_member) VALUES (?, ?, ?)").run(title.trim(), due || null, forMember || null);
  return { ok: true, id: Number(r.lastInsertRowid) };
});
route("POST", "/api/tasks/:id/toggle", (m) => {
  const db = openDb();
  const task = db.prepare("SELECT done_at FROM tasks WHERE id = ?").get(m.groups!.id) as { done_at: string | null } | undefined;
  if (!task) fail("err.unknownTask", undefined, 404);
  db.prepare("UPDATE tasks SET done_at = ? WHERE id = ?").run(task.done_at ? null : new Date().toISOString(), m.groups!.id);
  return { ok: true, done: !task.done_at };
});
route("DELETE", "/api/tasks/:id", (m) => { openDb().prepare("DELETE FROM tasks WHERE id = ?").run(m.groups!.id); return { ok: true }; });

// ---------- Telegram : le coordinateur, en long polling depuis ce Mac
route("GET", "/api/telegram/status", () => tgState());
route("POST", "/api/telegram/token", async (_m, _req, _url, body) => {
  const { token } = (body ?? {}) as { token?: string };
  if (!token?.trim()) fail("err.tokenMissing");
  let name: string;
  try { name = await checkToken(token.trim()); } catch (e) { fail("err.tokenRefused", { error: (e as Error).message }); }
  // Le jeton devient un secret (trousseau dans l'app, .env.local en dev) ; l'ancienne copie en base disparaît.
  setSecret("TELEGRAM_BOT_TOKEN", token.trim());
  openDb().prepare("DELETE FROM kv WHERE key = 'tg.token'").run();
  return { ok: true, botName: name };
});
route("DELETE", "/api/telegram/token", () => {
  stopTelegram();
  const db = openDb();
  setSecret("TELEGRAM_BOT_TOKEN", null);
  db.prepare("DELETE FROM kv WHERE key = 'tg.token'").run();
  kvSet(db, "tg.enabled", false);
  return { ok: true };
});
route("POST", "/api/telegram/enable", async () => {
  const db = openDb();
  if (!tgToken(db).token) fail("err.tokenFirst");
  kvSet(db, "tg.enabled", true);
  await startTelegram({ classifier, mail: telegramMail, drive: telegramDrive });
  const st = tgState();
  if (st.lastError) { kvSet(db, "tg.enabled", false); throw new Error(st.lastError); }
  return st;
});
route("POST", "/api/telegram/disable", () => { stopTelegram(); kvSet(openDb(), "tg.enabled", false); return tgState(); });
route("POST", "/api/telegram/pair", () => newPairing(openDb(), "owner"));
route("POST", "/api/telegram/unpair", () => { kvSet(openDb(), "tg.owner", null); return { ok: true }; });
route("POST", "/api/telegram/invite", (_m, _req, _url, body) => {
  const { key, name } = (body ?? {}) as { key?: string; name?: string };
  if (!name?.trim()) fail("err.firstNameRequired");
  return newPairing(openDb(), "contact", key?.trim() || `contact:${slug(name)}`, name.trim());
});
/**
 * Réglages d'un proche : parle au bot, semaine du dimanche, membre du foyer qu'il est, couloirs et agendas Google qu'il
 * suit, envois activés (matin, rappels, au fil de l'eau). Chaque champ est facultatif ; les valeurs inconnues sont écartées.
 */
route("PUT", "/api/telegram/contacts/:chatId", (m, _req, _url, body) => {
  const db = openDb();
  const b = (body ?? {}) as { weekDigest?: boolean; agent?: boolean; member?: string | null; follows?: unknown; calendars?: unknown; sends?: Record<string, unknown>; drive?: boolean; driveSensitive?: boolean };
  const keys = householdMembers(loadContext()).map((x) => x.key);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : []);
  const list = tgContacts(db).map((c) => {
    if (String(c.chatId) !== m.groups!.chatId) return c;
    const next = { ...c };
    if (b.weekDigest != null) next.weekDigest = !!b.weekDigest;
    if (b.agent != null) next.agent = !!b.agent;
    if (b.drive != null) next.drive = !!b.drive;
    if (b.driveSensitive != null) next.driveSensitive = !!b.driveSensitive;
    if (b.member !== undefined) { if (b.member && keys.includes(b.member) && b.member !== "family") next.member = b.member; else delete next.member; }
    if (b.follows !== undefined) next.follows = strings(b.follows).filter((k) => keys.includes(k));
    if (b.calendars !== undefined) next.calendars = strings(b.calendars);
    if (b.sends) next.sends = { ...c.sends, ...Object.fromEntries(["morning", "reminders", "live"].filter((k) => b.sends![k] != null).map((k) => [k, !!b.sends![k]])) };
    return next;
  });
  kvSet(db, "tg.contacts", list);
  return list;
});
route("DELETE", "/api/telegram/contacts/:chatId", (m) => {
  const db = openDb();
  const list = tgContacts(db).filter((c) => String(c.chatId) !== m.groups!.chatId);
  kvSet(db, "tg.contacts", list);
  return list;
});
route("PUT", "/api/telegram/settings", (_m, _req, _url, body) => {
  const db = openDb();
  const cur = tgSchedule(db), b = (body ?? {}) as Partial<TgSchedule>;
  const hm = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
  const next: TgSchedule = {
    morning: hm(b.morning, cur.morning), weekly: hm(b.weekly, cur.weekly), quietFrom: hm(b.quietFrom, cur.quietFrom), quietTo: hm(b.quietTo, cur.quietTo),
    reminders: b.reminders == null ? cur.reminders : !!b.reminders,
    everyMinutes: Math.min(720, Math.max(5, Number(b.everyMinutes ?? cur.everyMinutes) || TG_DEFAULTS.everyMinutes)),
    replyAfterDays: Math.min(30, Math.max(1, Number(b.replyAfterDays ?? cur.replyAfterDays) || TG_DEFAULTS.replyAfterDays)),
  };
  kvSet(db, "tg.schedule", next);
  return next;
});
route("POST", "/api/telegram/send", async (_m, _req, _url, body) => sendNow(((body ?? {}) as { kind?: "day" | "week" | "reminders" | "help" }).kind ?? "day"));

// ---------- app macOS : réglages, état pour la barre des menus (voir docs/desktop-app.md)
let version: string | undefined;
/** La version de l'app : celle que passe l'app au lancement, sinon package.json. */
function appVersion(): string {
  if (version) return version;
  try { version = process.env.MOLINOVA_VERSION || String((JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"); }
  catch { version = "0.0.0"; }
  return version;
}
/** Les problèmes d'une ZodError en une ligne : « champ : message ». */
const zodIssues = (e: unknown): string => ((e as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues ?? []).map((i) => `${i.path.map(String).join(".") || "·"} : ${i.message}`).join(", ") || (e as Error).message;

route("GET", "/api/app/settings", () => loadAppSettings());
route("PUT", "/api/app/settings", (_m, _req, _url, body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("err.badBody", undefined, 400);
  let next;
  try { next = saveAppSettings(body as Record<string, unknown>); } catch (e) { fail("err.badAppSettings", { error: zodIssues(e) }, 400); }
  postToMain({ type: "molinova:app-settings", settings: next });
  return next;
});
/** Comptes à reconnecter : jeton absent, ou refusé par Google au dernier passage (surveillance en cours comprise). */
function tokenErrorsOf(gmail: AccountRow[]): string[] {
  return gmail.filter((a) => {
    if (!hasToken(a.email)) return true;
    const last = listJobs().find((j) => j.accountId === a.id);
    return !!last && isAuthError(last.status === "error" ? last.error : last.lastError);
  }).map((a) => a.email);
}
/** Lu par l'app toutes les 60 s (menu de la barre, pastille du Dock) : rien que la base et la mémoire, aucun appel réseau. */
route("GET", "/api/app/status", () => {
  const db = openDb();
  const gmail = listAccounts(db).filter((a) => a.source === "gmail");
  let actions = 0, review = 0;
  try { const c = classifier(); actions = mailCount(c, "queue"); review = mailCount(c, "review"); } catch { /* configuration illisible : l'état reste lisible */ }
  const tg = tgState();
  const tokenErrors = tokenErrorsOf(gmail);
  return {
    version: appVersion(), appMode: APP_MODE, setupComplete: computeSetup().complete,
    accounts: gmail.length, watching: gmail.filter((a) => runningFor(a.id)?.kind === "watch").length, actions, review,
    whatsapp: { enabled: kvGet(db, "wa.enabled", false), lastIngestAt: kvGet<IngestStats | null>(db, "wa.lastIngest", null)?.at ?? null, error: kvGet<string | null>(db, "wa.lastError", null) },
    telegram: { enabled: tg.enabled, running: tg.running, error: tg.lastError },
    tokenErrors,
  };
});

// ---------- Accueil : ce qui tourne, ce qui en sort, ce qui s'est passé
/**
 * Tout l'état « en direct » des canaux, lu dans la base et la mémoire : aucun appel réseau, aucune sonde macOS.
 * Interrogé toutes les 30 s par la navigation (voyants des canaux) et par l'Accueil.
 */
route("GET", "/api/home", () => {
  const c = classifier();
  const db = c.db;
  const gmailAccs = listAccounts(db).filter((a) => a.source === "gmail");
  const tokenErrors = tokenErrorsOf(gmailAccs);
  const jobs = listJobs();
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

  const accounts = gmailAccs.map((a) => {
    const watch = jobs.find((j) => j.accountId === a.id && j.kind === "watch" && j.status === "running");
    const busy = jobs.find((j) => j.accountId === a.id && j.kind !== "watch" && j.status === "running");
    const lastJob = jobs.find((j) => j.accountId === a.id);
    const items = n("SELECT COUNT(*) n FROM items WHERE account_id = ?", a.id);
    const pending = n("SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id WHERE i.account_id = ? AND d.applied_at IS NULL", a.id);
    return {
      id: a.id, email: a.email, watching: !!watch, every: watch?.every ?? a.watch_every ?? null,
      lastPassAt: watch?.lastPassAt ?? null, nextPassAt: watch?.nextPassAt ?? null, watchError: watch?.lastError ?? null,
      busy: busy ? { kind: busy.kind, processed: busy.processed, total: busy.total } : null,
      error: lastJob?.status === "error" ? lastJob.error ?? null : null,
      tokenError: tokenErrors.includes(a.email), backfillDone: !!a.backfill_done, messagesTotal: a.messages_total ?? null, items, pending,
      review: mailCount(c, "review", String(a.id)),
    };
  });
  const gmailState = !accounts.length ? "setup" : accounts.some((a) => a.tokenError || (a.error && !a.watching)) ? "error" : accounts.every((a) => a.watching) ? "on" : accounts.some((a) => a.watching) ? "partial" : "off";

  const waOn = kvGet(db, "wa.enabled", false);
  const waSettings = { ...WA_DEFAULTS, ...kvGet<Partial<WaSettings>>(db, "wa.settings", {}) };
  const waLast = kvGet<IngestStats | null>(db, "wa.lastIngest", null);
  const waError = kvGet<string | null>(db, "wa.lastError", null);
  const whatsapp = {
    state: !waOn ? (wa.supported() ? "setup" : "unsupported") : waError ? "error" : "on",
    // WhatsApp Desktop fermé : sa base ne bouge plus, rien de neuf n'arrive (pgrep, quelques ms, seulement une fois branché).
    appRunning: waOn ? wa.appRunning() : null,
    listened: n("SELECT COUNT(*) n FROM wa_chats WHERE listen = 1"), everyMinutes: waSettings.everyMinutes,
    lastIngestAt: waLast?.at ?? null, nextAt: waOn && waLast ? new Date(new Date(waLast.at).getTime() + waSettings.everyMinutes * 60_000).toISOString() : null,
    ingesting: ingesting(), error: waError,
  };

  const tg = tgState();
  const telegram = {
    state: !tg.tokenSet ? "setup" : tg.running && tg.lastError ? "error" : tg.running ? (tg.owner ? "on" : "pair") : "off",
    botName: tg.botName, owner: tg.owner ? tg.owner.name : null, contacts: tg.contacts.map((x) => x.name),
    lastMessageAt: tg.lastMessageAt, lastPollAt: tg.lastPollAt, lastDigest: tg.lastDigest, error: tg.lastError,
    schedule: { morning: tg.schedule.morning, weekly: tg.schedule.weekly, reminders: tg.schedule.reminders, everyMinutes: tg.schedule.everyMinutes },
  };

  // Google Drive : les boîtes qui ont donné le droit de lecture, branchées ou en pause.
  const driveAccs = gmailAccs.filter((a) => hasDriveScope(a.email)).map((a) => {
    const st = driveState(db, a.id), busy = driveBusy.get(a.id);
    return { id: a.id, email: a.email, enabled: driveEnabled(db, a.id), syncedAt: st.syncedAt, nextAt: nextDriveSync(db, a.id), error: st.error, busy: !!busy,
      docs: n("SELECT COUNT(*) n FROM docs WHERE account_id = ? AND in_scope = 1", a.id) };
  });
  const driveOn = driveAccs.filter((a) => a.enabled);
  const drive = {
    state: !driveOn.length ? (driveAccs.length ? "off" : "setup") : driveOn.some((a) => a.error) ? "error" : "on",
    accounts: driveAccs, docs: driveOn.reduce((x, a) => x + a.docs, 0), everyMinutes: DRIVE_EVERY_MIN,
    lastAt: driveOn.reduce<string | null>((x, a) => (a.syncedAt && (!x || a.syncedAt > x) ? a.syncedAt : x), null),
    nextAt: driveOn.reduce<string | null>((x, a) => (a.nextAt && (!x || a.nextAt < x) ? a.nextAt : x), null),
    busy: driveOn.some((a) => a.busy),
  };

  // Ce qui en sort, ouvert maintenant, par canal : la file Actions, « à caler » (date ou chose à faire), les tâches.
  const bySource = (where: string[], params: unknown[]) => Object.fromEntries((db.prepare(`SELECT a.source s, COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${where.join(" AND ")} GROUP BY a.source`).all(...params) as Array<{ s: string; n: number }>).map((r) => [r.s, r.n]));
  const q = mailWhere(c, "queue", null, "");
  const queue = bySource(q.where, q.params);
  const toCal = bySource([toCalWhere], []);
  const tasks = Object.fromEntries((db.prepare("SELECT COALESCE(source, 'app') s, COUNT(*) n FROM tasks WHERE done_at IS NULL GROUP BY COALESCE(source, 'app')").all() as Array<{ s: string; n: number }>).map((r) => [r.s, r.n]));
  const matrix = {
    gmail: { queue: queue.gmail ?? 0, toCal: toCal.gmail ?? 0, tasks: tasks.gmail ?? 0 },
    whatsapp: { queue: queue.whatsapp ?? 0, toCal: toCal.whatsapp ?? 0, tasks: tasks.whatsapp ?? 0 },
    telegram: { queue: null, toCal: null, tasks: tasks.telegram ?? 0 },
    app: { tasks: tasks.app ?? 0 },
  };
  const review = mailCount(c, "review");
  // Ce que Molinova a lu et classé (emails, fenêtres WhatsApp) : aujourd'hui pour le chiffre de l'animation, sur 7 jours pour la taille du réseau.
  const readBy = (since: string) => Object.fromEntries((db.prepare(`SELECT a.source s, COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id JOIN accounts a ON a.id = i.account_id WHERE d.decided_at >= ${since} GROUP BY a.source`).all() as Array<{ s: string; n: number }>).map((r) => [r.s, r.n]));
  const today = readBy("datetime('now', 'localtime', 'start of day', 'utc')"), week = readBy("datetime('now', '-7 days')");
  const read = { today: { gmail: today.gmail ?? 0, whatsapp: today.whatsapp ?? 0 }, week: (week.gmail ?? 0) + (week.whatsapp ?? 0) };

  // Ce que l'utilisateur a à faire pour que tout tourne : seulement quand c'est utile.
  const alerts: Array<Record<string, unknown>> = [];
  for (const a of accounts) {
    if (a.tokenError) alerts.push({ kind: "reconnect", accountId: a.id, email: a.email });
    else if (a.error && !a.watching) alerts.push({ kind: "gmailError", accountId: a.id, email: a.email, error: a.error });
    if (!a.tokenError && !a.backfillDone && !a.busy && a.messagesTotal != null && a.messagesTotal > a.items) alerts.push({ kind: "backfill", accountId: a.id, email: a.email, n: a.messagesTotal - a.items });
    if (!a.watching && !a.tokenError) alerts.push({ kind: "watchOff", accountId: a.id, email: a.email });
    if (a.pending && a.backfillDone) alerts.push({ kind: "pending", accountId: a.id, email: a.email, n: a.pending });
  }
  if (review) alerts.push({ kind: "review", n: review });
  if (whatsapp.state === "error") alerts.push({ kind: "waError", error: whatsapp.error });
  else if (whatsapp.appRunning === false) alerts.push({ kind: "waClosed" });
  if (telegram.state === "error") alerts.push({ kind: "tgError", error: telegram.error });
  if (telegram.state === "off") alerts.push({ kind: "tgOff" });
  for (const a of driveOn) if (a.error) alerts.push({ kind: "driveError", accountId: a.id, email: a.email, error: a.error });

  return {
    now: new Date().toISOString(),
    channels: {
      telegram, gmail: { state: gmailState, accounts }, whatsapp, drive,
      threads: { lastAt: threadsCheckedAt, everyMinutes: THREADS_EVERY_MIN },
    },
    counts: { actions: mailCount(c, "queue"), review, toCal: (toCal.gmail ?? 0) + (toCal.whatsapp ?? 0) },
    matrix, alerts, read,
  };
});
route("GET", "/api/activity", (_m, _req, url) => {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const before = Number(url.searchParams.get("before")) || undefined;
  return listActivity(openDb(), limit, before);
});

// ---------- premier lancement : l'assistant
function computeSetup() {
  const db = openDb();
  const accepted = kvGet<{ version: string; at: string } | null>(db, "terms.accepted", null);
  return setupState({
    appMode: APP_MODE,
    terms: accepted?.version === TERMS_VERSION,
    gateway: !!getSecret("AI_GATEWAY_API_KEY"),
    google: googleClientSource() !== null,
    account: listAccounts(db).some((a) => a.source === "gmail" && hasToken(a.email)),
    context: fs.existsSync(path.join(PATHS.config, "context.json")),
    finished: kvGet(db, "setup.finished", false),
  });
}
/** L'état de l'assistant pour l'interface : avec l'adresse des conditions d'utilisation, pour le lien sous la case. */
const setupForUi = () => ({ ...computeSetup(), termsUrl: MOLINOVA_PAGES.terms });
route("GET", "/api/setup/state", () => setupForUi());

/** Les conditions d'utilisation acceptées au premier écran : la version et le moment, gardés dans la base. */
route("POST", "/api/setup/terms", (_m, _req, _url, body) => {
  if ((body as { accept?: unknown } | null)?.accept !== true) fail("err.badBody", undefined, 400);
  kvSet(openDb(), "terms.accepted", { version: TERMS_VERSION, at: new Date().toISOString() });
  return setupForUi();
});

/**
 * Les pages publiques de Molinova (MOLINOVA_PAGES) répondent-elles ? Tant que le dépôt est privé, non : l'assistant propose
 * alors les pages de ton propre site. HEAD (GET si HEAD est refusé), 4 s au plus ; résultat gardé 10 min s'il est
 * en ligne, 2 min sinon. Ne lève jamais : un réseau absent vaut « hors ligne ».
 */
let pagesCheck: { online: boolean; at: number } | undefined;
async function pagesOnline(): Promise<boolean> {
  if (pagesCheck && Date.now() - pagesCheck.at < (pagesCheck.online ? 10 : 2) * 60_000) return pagesCheck.online;
  const signal = AbortSignal.timeout(4000);
  let online = false;
  try {
    const head = await fetch(MOLINOVA_PAGES.home, { method: "HEAD", redirect: "follow", signal });
    online = head.ok || (!signal.aborted && (await fetch(MOLINOVA_PAGES.home, { redirect: "follow", signal }).then((r) => { void r.body?.cancel(); return r.ok; })));
  } catch { online = false; }
  pagesCheck = { online, at: Date.now() };
  return online;
}
route("GET", "/api/setup/pages-online", async () => ({ online: await pagesOnline(), ...MOLINOVA_PAGES }));

/** Une promesse qui échoue après `ms` : la vérification d'une clé ne doit pas bloquer l'assistant. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms / 1000} s`)), ms); });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
/** La clé est vérifiée par un appel « crédits » fait avec elle, avant d'être enregistrée. */
route("POST", "/api/setup/gateway-key", async (_m, _req, _url, body) => {
  const key = String((body as { key?: unknown } | undefined)?.key ?? "").trim();
  if (!key) fail("setup.keyMissing", undefined, 400);
  try { await withTimeout(createGateway({ apiKey: key }).getCredits(), 15_000); }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403 || GatewayAuthenticationError.isInstance(e) || GatewayForbiddenError.isInstance(e)) fail("setup.keyInvalid", undefined, 400);
    fail("setup.gatewayUnreachable", { error: (e as Error).message.slice(0, 160) }, 502);
  }
  setSecret("AI_GATEWAY_API_KEY", key);
  return { ok: true, keySource: secretSource("AI_GATEWAY_API_KEY"), state: computeSetup() };
});
/**
 * Le client OAuth Google : JSON téléchargé (client « Application de bureau ») ou { clientId, clientSecret }.
 * Un autre client alors que des boîtes sont connectées : 409 tant que `replace: true` n'est pas envoyé
 * (leurs jetons appartiennent à l'ancien client, chaque boîte devra être reconnectée).
 */
route("POST", "/api/setup/google-client", (_m, _req, _url, body) => {
  const { clientId, clientSecret } = parseGoogleClient(body);
  const current = currentGoogleClientId();
  const connected = listAccounts(openDb()).filter((a) => a.source === "gmail" && hasToken(a.email)).length;
  if (connected && current && current !== clientId && (body as { replace?: unknown } | undefined)?.replace !== true) fail("setup.googleReplace", { n: connected }, 409);
  setSecret("GOOGLE_CLIENT_ID", clientId);
  setSecret("GOOGLE_CLIENT_SECRET", clientSecret);
  connectors.clear();
  return { ok: true, secretsSource: googleClientSource(), state: computeSetup() };
});
/** Crée ou complète context.json (les autres champs gardés) ; la langue donnée devient celle de l'app. */
route("POST", "/api/setup/context", async (_m, _req, _url, body) => {
  const b = (body ?? {}) as { name?: unknown; emails?: unknown; timezone?: unknown; language?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) fail("setup.nameRequired", undefined, 400);
  const list = Array.isArray(b.emails) ? b.emails : typeof b.emails === "string" ? b.emails.split(/[,;\s]+/) : [];
  let emails = [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail("setup.badEmail", { email: e }, 400);
  // Sans adresse donnée : celles des boîtes déjà connectées (elles servent à reconnaître mes envois).
  if (!emails.length) emails = listAccounts(openDb()).filter((a) => a.source === "gmail").map((a) => a.email.toLowerCase());
  const timezone = typeof b.timezone === "string" && b.timezone.trim() ? b.timezone.trim() : systemTimeZone();
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { fail("setup.badTimezone", { timezone }, 400); }
  if (b.language != null && !isLanguage(b.language)) fail("err.unknownLanguage", undefined, 400);
  const file = path.join(PATHS.config, "context.json");
  const cur = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) as { owner?: { languages?: string[] } & Record<string, unknown> } & Record<string, unknown>;
  const languages = cur.owner?.languages?.length ? cur.owner.languages : isLanguage(b.language) ? [b.language] : [];
  const next = { ...cur, owner: { ...cur.owner, name, emails, languages, timezone } };
  parseContext(next);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  connectors.clear();
  // Même chemin qu'un changement de langue dans Réglages : taxonomie et libellés par défaut suivent.
  if (isLanguage(b.language) && b.language !== loadSettings().language) await applyLanguage(b.language);
  return { ok: true, context: loadContext(), language: loadSettings().language, state: computeSetup() };
});
/** Fin de l'assistant ; avec `watchEvery` (s), la surveillance démarre sur chaque boîte connectée et survivra aux redémarrages. */
route("POST", "/api/setup/finish", (_m, _req, _url, body) => {
  const { watchEvery } = (body ?? {}) as { watchEvery?: unknown };
  const db = openDb();
  kvSet(db, "setup.finished", true);
  const watching: string[] = [], errors: string[] = [];
  if (typeof watchEvery === "number" && Number.isFinite(watchEvery) && watchEvery > 0) {
    const every = Math.min(86_400, Math.max(60, Math.round(watchEvery)));
    for (const a of listAccounts(db).filter((x) => x.source === "gmail" && hasToken(x.email))) {
      if (runningFor(a.id)?.kind === "watch") { watching.push(a.email); continue; }
      try { startWatch(a.id, every); watching.push(a.email); } catch (e) { errors.push(`${a.email} : ${(e as Error).message}`); }
    }
  }
  return { ok: true, watching, errors, state: computeSetup() };
});

/** Au démarrage : relance les surveillances qui tournaient à l'arrêt du serveur. Un compte en échec n'empêche pas les autres. */
function resumeWatches(): void {
  let list: Array<{ accountId: number; every: number }>;
  try { list = watchesToResume(listAccounts(openDb()), hasToken); }
  catch (err) { console.error(t("srv.watchResumeFailed", { email: "*", error: (err as Error).message })); return; }
  for (const w of list) {
    const email = getAccount(openDb(), String(w.accountId))?.email ?? String(w.accountId);
    try { startWatch(w.accountId, w.every); console.log(t("srv.watchResumed", { email, seconds: w.every })); }
    catch (err) { console.error(t("srv.watchResumeFailed", { email, error: (err as Error).message })); }
  }
}

// ---------- serveur
/** Les dictionnaires d'une langue, concaténés ; « v » = la date de modification la plus récente, pour le cache. */
function langFiles(lang: string): string[] {
  const dir = path.join(UI, "lang", lang);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => path.join(dir, f)) : [];
}
function langBundle(lang: string): string { return langFiles(lang).map((f) => fs.readFileSync(f, "utf8")).join("\n"); }
function langStamp(lang: string): string { return String(Math.floor(Math.max(0, ...langFiles(lang).map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } })))); }
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

/** Page servie sans clé de session : rien de l'interface, seulement comment l'ouvrir. */
function lockedPage(): string {
  let lang: Language = "fr"; try { lang = loadSettings().language; } catch { /* français */ }
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>Molinova</title>
<style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:0 24px;text-align:center;
font-family:-apple-system,"Helvetica Neue",sans-serif;background:#fbfbfc;color:#1b1c1f}b{font-size:40px;font-weight:700;letter-spacing:-.03em}i{color:#ff3b30;font-style:normal}
p{margin:0;color:#6f747c;font-size:14px;max-width:440px}@media (prefers-color-scheme:dark){body{background:#1b1c1f;color:#fbfbfc}}</style>
<b>Molinova<i>.</i></b><p>${esc(t("srv.locked"))}</p></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    // Seule l'interface locale parle à ce serveur : pas un autre site ouvert dans le navigateur, ni un domaine rebindé.
    const info = {
      method: req.method ?? "GET", path: url.pathname, host: req.headers.host, origin: req.headers.origin, contentType: req.headers["content-type"],
      fetchSite: req.headers["sec-fetch-site"] as string | undefined, cookie: req.headers.cookie, keyHeader: req.headers["x-molinova-key"] as string | undefined,
    };
    const guard = checkRequest(info, PORT, SESSION_KEY);
    if (!guard.ok) guard.reason === "session" ? fail("err.session", undefined, 401) : fail("err.forbiddenOrigin", undefined, 403);
    // /?molinova_key=… (l'app au lancement, le lien du terminal en mode dev) : la clé devient un cookie, puis on la retire de l'adresse.
    if (url.searchParams.has(KEY_PARAM) && !url.pathname.startsWith("/api/")) {
      if (sameKey(url.searchParams.get(KEY_PARAM) ?? "", SESSION_KEY)) {
        url.searchParams.delete(KEY_PARAM);
        res.writeHead(302, { "Set-Cookie": sessionCookie(PORT, SESSION_KEY, !APP_MODE), Location: url.pathname + url.search, "Cache-Control": "no-store" });
        res.end();
        return;
      }
    }
    if (url.pathname.startsWith("/api/")) {
      const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
      if (!r) fail("err.unknownRoute", undefined, 404);
      let body: unknown = undefined;
      if (req.method !== "GET") {
        const chunks: Buffer[] = [];
        for await (const ch of req) chunks.push(ch as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        try { body = raw ? JSON.parse(raw) : undefined; } catch { fail("err.badBody", undefined, 400); }
      }
      const out = await r.handler(url.pathname.match(r.pattern)!, req, url, body);
      const raw = out as { __raw?: Buffer; name?: string; mime?: string; inline?: boolean } | null;
      if (raw && raw.__raw) {
        // Un aperçu (inline : une page en image) s'affiche dans l'app ; le reste se télécharge.
        res.writeHead(200, { "Content-Type": raw.mime ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": `${raw.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(raw.name ?? t("srv.downloadName"))}` });
        res.end(raw.__raw);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out ?? null));
      return;
    }
    // /lang/<langue>.js : les fichiers de ui/lang/<langue>/ concaténés, dans l'ordre des noms.
    const langMatch = /^\/lang\/(fr|en|es)\.js$/.exec(url.pathname);
    if (langMatch) {
      res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
      res.end(langBundle(langMatch[1]));
      return;
    }
    // Fichiers statiques de l'interface ; toute autre route renvoie index.html.
    let file = path.join(UI, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(UI) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(UI, "index.html");
    if (path.basename(file) === "index.html" && !hasSession(info, PORT, SESSION_KEY)) {
      // Sans clé, l'interface ne pourrait rien charger : une page qui dit comment ouvrir Molinova.
      res.writeHead(401, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(lockedPage());
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    if (path.basename(file) === "index.html") {
      // Chaque fichier de l'interface est référencé avec sa date de modification : une nouvelle version n'est jamais servie depuis le cache.
      const stamp = (f: string) => { try { return String(Math.floor(fs.statSync(path.join(UI, f)).mtimeMs)); } catch { return "0"; } };
      // La langue est connue avant le premier rendu : <html lang>, window.EA_LANG, et le dictionnaire de la langue active (le français reste chargé en repli).
      let lang: Language = "fr"; try { lang = loadSettings().language; } catch { /* settings illisibles : français */ }
      const html = fs.readFileSync(file, "utf8")
        .replace(/(href|src)="\/(style\.css|i18n\.js|app\.js|home\.js|gmail\.js|setup\.js|mail\.js|actions\.js|map\.js|whatsapp\.js|agenda\.js|telegram\.js|settings\.js|vendor\/qrcode\.js)"/g, (_m, attr, f) => `${attr}="/${f}?v=${stamp(f)}"`)
        .replace(/src="\/lang\/fr\.js"/, `src="/lang/fr.js?v=${langStamp("fr")}"`)
        .replace(/<html lang="[a-z]+">/, `<html lang="${lang}">`)
        .replace(/window\.EA_LANG="[a-z]+"/, `window.EA_LANG="${lang}"`)
        .replace("<!--EA_LANG_SCRIPT-->", lang === "fr" ? "" : `<script src="/lang/${lang}.js?v=${langStamp(lang)}"></script>`);
      res.end(html);
      return;
    }

    fs.createReadStream(file).pipe(res);
  } catch (err) {
    const e = err as Error & { status?: number; code?: unknown };
    // `code` = la clé i18n de l'erreur (fail(), erreurs Google traduites) : l'interface peut réagir sans lire le texte.
    const code = keyOf(e.code);
    res.writeHead(e.status ?? 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(code ? { error: e.message, code } : { error: e.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  // Mode dev : le lien porte la clé (une fois ouverte, le navigateur garde le cookie). Dans l'app, la fenêtre l'a déjà.
  const openUrl = `${url}/?${KEY_PARAM}=${SESSION_KEY}`;
  try { loadSettings(); } catch { /* pas encore de settings.json : messages en français */ }
  console.log(t("srv.listening", { url: APP_MODE ? url : openUrl }));
  // L'app attend ce message pour charger la fenêtre.
  postToMain({ type: "molinova:ready", port: PORT });
  resumeWatches();
  // Ancienne copie du jeton Telegram en base : rejoint les autres secrets avant le démarrage du bot.
  try { migrateTgToken(openDb()); } catch (err) { console.error(`[telegram] ${(err as Error).message}`); }
  void startTelegram({ classifier, mail: telegramMail, drive: telegramDrive }).then(() => { const st = tgState(); if (st.running) console.log(t("srv.telegramListening", { name: st.botName ?? "" })); else if (st.lastError) console.error(t("srv.telegramError", { error: st.lastError })); });
  if (!APP_MODE && !process.argv.includes("--no-open")) void open(openUrl);
});
