import Database from "better-sqlite3";
import { PATHS } from "./config.js";
import type { Item } from "./connectors/types.js";

export type Db = Database.Database;

/** Dans l'app, better-sqlite3 charge le binaire construit pour l'ABI d'Electron (MOLINOVA_SQLITE_BINDING, posé
 *  par le processus principal) ; en dev, le binaire Node habituel de node_modules. Voir docs/desktop-app.md. */
export function sqliteOptions(options: Database.Options = {}): Database.Options {
  const nativeBinding = process.env.MOLINOVA_SQLITE_BINDING;
  return nativeBinding ? { ...options, nativeBinding } : options;
}

let db: Db | undefined;

export function openDb(): Db {
  if (db) return db;
  db = new Database(PATHS.db, sqliteOptions());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      history_id TEXT,
      backfill_page_token TEXT,
      backfill_done INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      external_id TEXT NOT NULL,
      thread_id TEXT,
      from_name TEXT, from_address TEXT, subject TEXT, date TEXT,
      body_excerpt TEXT,
      has_attachments INTEGER, has_list_unsubscribe INTEGER, is_outgoing INTEGER,
      labels_json TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS items_from ON items(account_id, from_address);
    CREATE TABLE IF NOT EXISTS decisions (
      item_id INTEGER PRIMARY KEY REFERENCES items(id),
      decided_by TEXT NOT NULL,           -- rule | memory | jev | user
      rule_id TEXT,
      category TEXT,                      -- clé de taxonomie, ou NULL si « à revoir »
      confidence REAL,
      answers_json TEXT,                  -- réponses brutes de Jev
      needs_review INTEGER NOT NULL DEFAULT 0,
      flags_json TEXT,                    -- { reply, toPay, spam, urgent }
      applied_at TEXT,                    -- NULL tant que rien n'est posé dans Gmail
      applied_labels_json TEXT,
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      latency_ms INTEGER, input_tokens INTEGER
    );
    CREATE TABLE IF NOT EXISTS sender_memory (
      account_id INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      category TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, from_address, category)
    );
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id),
      from_category TEXT, to_category TEXT NOT NULL,
      made_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,                 -- inventory | preview | backfill | watch
      account_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      jev_calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      note TEXT
    );
  `);
  // Migration douce : sortie de la file Actions (0 = à traiter, 1 = sorti, constaté par l'outil, 2 = « rien à faire »).
  const cols = db.prepare("PRAGMA table_info(decisions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "action_state")) db.exec("ALTER TABLE decisions ADD COLUMN action_state INTEGER NOT NULL DEFAULT 0");
  const acols = db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>;
  if (!acols.some((c) => c.name === "messages_total")) db.exec("ALTER TABLE accounts ADD COLUMN messages_total INTEGER");
  if (!acols.some((c) => c.name === "watch_since")) db.exec("ALTER TABLE accounts ADD COLUMN watch_since TEXT");
  // Intervalle de la surveillance en cours (s) : elle repart à l'identique au démarrage du serveur.
  if (!acols.some((c) => c.name === "watch_every")) db.exec("ALTER TABLE accounts ADD COLUMN watch_every INTEGER");
  const icols = db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
  // Destinataires (envoyés surtout) : pour afficher « → qui » et adresser une relance.
  if (!icols.some((c) => c.name === "to_json")) db.exec("ALTER TABLE items ADD COLUMN to_json TEXT");
  if (!icols.some((c) => c.name === "labels_checked_at")) db.exec("ALTER TABLE items ADD COLUMN labels_checked_at TEXT");
  for (const col of ["thread_last_from_me INTEGER", "thread_last_at TEXT", "thread_checked_at TEXT", "thread_note TEXT"]) {
    if (!cols.some((c) => c.name === col.split(" ")[0])) db.exec(`ALTER TABLE decisions ADD COLUMN ${col}`);
  }
  // WhatsApp : quelles conversations l'agent écoute, et pour qui. Rien n'est lu tant que listen = 0.
  db.exec(`CREATE TABLE IF NOT EXISTS wa_chats (
    pk INTEGER PRIMARY KEY,                -- Z_PK de la conversation dans la base WhatsApp
    jid TEXT NOT NULL,
    name TEXT,
    kind TEXT NOT NULL,                    -- group | direct
    listen INTEGER NOT NULL DEFAULT 0,
    for_member TEXT,                       -- me | spouse | child:<prénom> | family | NULL
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)`);
  // Agenda : tâches (elles vivent ici, nulle part ailleurs), règles « toujours X pour ce domaine », brouillons d'événements extraits.
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    due TEXT,                              -- AAAA-MM-JJ ou NULL
    for_member TEXT,                       -- me | spouse | child:<slug> | family | NULL
    source TEXT,                           -- gmail | whatsapp | NULL (à la main)
    source_item_id INTEGER,
    done_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Qui a créé la tâche quand elle vient d'un canal partagé (Telegram) : clé de membre ou prénom.
  const tcols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!tcols.some((c) => c.name === "created_by")) db.exec("ALTER TABLE tasks ADD COLUMN created_by TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS member_rules (
    domain TEXT PRIMARY KEY,               -- domaine de l'expéditeur (école, club) ou jid d'un groupe WhatsApp
    for_member TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS event_drafts (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    draft_json TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS style_samples (account_id INTEGER NOT NULL, external_id TEXT NOT NULL, text TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (account_id, external_id))`);
  // Tokens et coût : une ligne par appel à un modèle, avec son sujet (purpose) et son coût réel ou estimé.
  db.exec(`CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    purpose TEXT NOT NULL,                 -- classify | reclassify | test | draft | extract_event | extract_task | chat
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL,                             -- USD ; NULL si le tarif du modèle est inconnu
    estimated INTEGER NOT NULL DEFAULT 1,  -- 0 : coût renvoyé par la passerelle ; 1 : calculé au tarif du modèle
    item_id INTEGER,
    account_id INTEGER,
    latency_ms INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS usage_at ON usage(at)");
  db.exec("CREATE INDEX IF NOT EXISTS usage_item ON usage(item_id)");
  // Fil d'activité de l'Accueil : ce que Molinova a fait tout seul, canal par canal. Le texte est composé par l'interface
  // (kind + params), dans la langue du moment ; gardé 30 jours.
  db.exec(`CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    channel TEXT NOT NULL,                 -- gmail | whatsapp | telegram | drive | threads | app
    kind TEXT NOT NULL,
    params_json TEXT,
    item_id INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS activity_at ON activity(at)");
  driveSchema(db);
  purgeActivity(db);
  return db;
}

/** Google Drive : l'arborescence, les documents (métadonnées seulement) et leur index de recherche. Voir core/drive-index.ts. */
export function driveSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS drive_folders (
    account_id INTEGER NOT NULL,
    folder_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    owned INTEGER NOT NULL DEFAULT 1,
    mode TEXT,                             -- in | out | frozen | NULL (hérite du parent) : le choix de l'utilisateur
    path TEXT,                             -- calculé : « A/B/C » depuis Mon Drive, NULL si non relié
    effective TEXT,                        -- calculé : in | out | frozen
    n_docs INTEGER NOT NULL DEFAULT 0,
    n_scope INTEGER NOT NULL DEFAULT 0,
    n_sub INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, folder_id)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS drive_folders_parent ON drive_folders(account_id, parent_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS docs (
    account_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    format TEXT,                           -- pdf | google | office | text | image | NULL (pas un document)
    size INTEGER,
    md5 TEXT,
    parent_id TEXT,
    path TEXT,
    modified_at TEXT,
    created_at TEXT,
    owned INTEGER NOT NULL DEFAULT 1,
    link TEXT,
    in_scope INTEGER NOT NULL DEFAULT 0,
    frozen INTEGER NOT NULL DEFAULT 0,     -- classé et cherché, jamais réorganisé
    indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, file_id)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS docs_scope ON docs(account_id, in_scope)");
  // La fiche d'un document (core/doc-classify.ts) : ce qu'il est, de quel domaine, pour qui, jusqu'à quand. Jamais le fichier.
  db.exec(`CREATE TABLE IF NOT EXISTS doc_cards (
    account_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    type TEXT,                             -- clé de la taxonomie documents (Types, liste plate)
    type_p REAL,
    context TEXT,                          -- clé de la taxonomie documents (Contextes, sur deux niveaux)
    context2 TEXT,                         -- second contexte, si Jev lui donne plus de 0,3
    context_p REAL,
    people TEXT,                           -- clés des membres du foyer concernés, séparées par des virgules
    valid INTEGER,                         -- encore en vigueur : 1, 0, ou NULL (inconnu)
    sensitive INTEGER NOT NULL DEFAULT 0,  -- identité, banque, santé : ni extrait gardé, ni envoi à un proche sans réglage
    action INTEGER NOT NULL DEFAULT 0,     -- demande une action (payer, signer, renvoyer)
    importance REAL,
    expiry TEXT,                           -- AAAA-MM-JJ, choisie par Jev parmi les dates du texte
    party TEXT,                            -- le tiers (organisme, entreprise, personne), choisi parmi les candidats du texte
    title TEXT,                            -- composé par le code : « 2024-03-12 Pièce d'identité · Alex – Administratif »
    facets TEXT,                           -- libellés de la fiche, pour la recherche
    excerpt TEXT,                          -- début du texte lu (NULL si sensible)
    text_hash TEXT,
    method TEXT,                           -- export | pdf | ocr | textutil | plain | NULL (nom seulement)
    md5 TEXT,                              -- empreinte (ou date de modification) du fichier au moment de la fiche
    classified_at TEXT NOT NULL DEFAULT (datetime('now')),
    by TEXT NOT NULL DEFAULT 'jev',        -- jev | user (une fiche corrigée n'est plus réécrite par Jev)
    error TEXT,
    PRIMARY KEY (account_id, file_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS doc_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    facet TEXT NOT NULL,                   -- type | context | people
    before TEXT,
    after TEXT,
    made_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // L'index de recherche : nom et chemin, puis la fiche et le début du texte. Table dérivée : refaite si ses colonnes changent.
  const cols = (db.prepare("SELECT name FROM pragma_table_info('docs_fts')").all() as Array<{ name: string }>).map((c) => c.name);
  if (cols.length && !cols.includes("body")) db.exec("DROP TABLE docs_fts");
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(account_id UNINDEXED, file_id UNINDEXED, name, path, title, facets, body, tokenize = 'unicode61 remove_diacritics 2')");
  if (cols.length && !cols.includes("body")) for (const a of db.prepare("SELECT DISTINCT account_id id FROM docs").all() as Array<{ id: number }>) rebuildDocsFts(db, a.id);
}

const FTS_SELECT = `SELECT d.account_id, d.file_id, d.name, COALESCE(d.path, ''), COALESCE(c.title, ''), COALESCE(c.facets, ''), COALESCE(c.excerpt, '')
  FROM docs d LEFT JOIN doc_cards c ON c.account_id = d.account_id AND c.file_id = d.file_id WHERE d.account_id = ? AND d.in_scope = 1`;
/** Refait l'index de recherche d'un compte : les documents du périmètre, avec leur fiche quand elle existe. */
export function rebuildDocsFts(db: Db, accountId: number): void {
  db.prepare("DELETE FROM docs_fts WHERE account_id = ?").run(accountId);
  db.prepare(`INSERT INTO docs_fts (account_id, file_id, name, path, title, facets, body) ${FTS_SELECT}`).run(accountId);
}
/** Remet à jour la ligne d'un seul document (après sa fiche, ou une correction). */
export function refreshDocFts(db: Db, accountId: number, fileId: string): void {
  db.prepare("DELETE FROM docs_fts WHERE account_id = ? AND file_id = ?").run(accountId, fileId);
  db.prepare(`INSERT INTO docs_fts (account_id, file_id, name, path, title, facets, body) ${FTS_SELECT} AND d.file_id = ?`).run(accountId, fileId);
}

/** Ferme la base (avant de la remplacer, lors d'un import) ; le prochain openDb() la rouvre. */
export function closeDb(): void {
  db?.close();
  db = undefined;
}

export interface AccountRow {
  id: number;
  source: string;
  email: string;
  history_id: string | null;
  backfill_page_token: string | null;
  backfill_done: number;
  messages_total: number | null;
  watch_since: string | null;
  watch_every: number | null;
}

export function upsertAccount(d: Db, source: string, email: string): AccountRow {
  d.prepare("INSERT INTO accounts (source, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING").run(source, email);
  return d.prepare("SELECT * FROM accounts WHERE email = ?").get(email) as AccountRow;
}
export function listAccounts(d: Db): AccountRow[] {
  return d.prepare("SELECT * FROM accounts ORDER BY id").all() as AccountRow[];
}
export function getAccount(d: Db, emailOrId: string): AccountRow | undefined {
  return d.prepare("SELECT * FROM accounts WHERE email = ? OR id = ?").get(emailOrId, Number(emailOrId) || -1) as AccountRow | undefined;
}

export function upsertItem(d: Db, it: Item): number {
  d.prepare(
    `INSERT INTO items (account_id, external_id, thread_id, from_name, from_address, subject, date, body_excerpt,
       has_attachments, has_list_unsubscribe, is_outgoing, labels_json, to_json)
     VALUES (@account_id, @external_id, @thread_id, @from_name, @from_address, @subject, @date, @body_excerpt,
       @has_attachments, @has_list_unsubscribe, @is_outgoing, @labels_json, @to_json)
     ON CONFLICT(account_id, external_id) DO UPDATE SET labels_json = excluded.labels_json, to_json = COALESCE(excluded.to_json, items.to_json)`,
  ).run({
    account_id: it.accountId,
    external_id: it.externalId,
    thread_id: it.threadId ?? null,
    from_name: it.fromName,
    from_address: it.fromAddress,
    subject: it.subject,
    date: it.date.toISOString(),
    body_excerpt: it.bodyExcerpt,
    has_attachments: it.hasAttachments ? 1 : 0,
    has_list_unsubscribe: it.hasListUnsubscribe ? 1 : 0,
    is_outgoing: it.isOutgoing ? 1 : 0,
    labels_json: JSON.stringify(it.labels),
    to_json: it.to.length ? JSON.stringify(it.to) : null,
  });
  return (d.prepare("SELECT id FROM items WHERE account_id = ? AND external_id = ?").get(it.accountId, it.externalId) as { id: number }).id;
}

export interface Decision {
  itemId: number;
  decidedBy: "rule" | "memory" | "jev" | "user";
  ruleId?: string;
  category: string | null;
  confidence: number | null;
  answers?: unknown;
  needsReview: boolean;
  /** `awaitReply` : envoi de ma part qui attend un retour (suivi des fils, puis « Relancer »). */
  flags: { reply: boolean; toPay: boolean; spam: boolean; urgent: boolean; important: boolean; event: boolean; task?: boolean; quiet?: boolean; awaitReply?: boolean; /** Code ou alerte de connexion : Actions 30 min seulement (core/ephemeral.ts). */ ephemeral?: "code" | "signin" };
  latencyMs?: number;
  inputTokens?: number;
}

export function saveDecision(d: Db, dec: Decision): void {
  d.prepare(
    `INSERT INTO decisions (item_id, decided_by, rule_id, category, confidence, answers_json, needs_review, flags_json, latency_ms, input_tokens)
     VALUES (@item_id, @decided_by, @rule_id, @category, @confidence, @answers_json, @needs_review, @flags_json, @latency_ms, @input_tokens)
     ON CONFLICT(item_id) DO UPDATE SET decided_by = excluded.decided_by, rule_id = excluded.rule_id, category = excluded.category,
       confidence = excluded.confidence, answers_json = excluded.answers_json, needs_review = excluded.needs_review,
       flags_json = excluded.flags_json, latency_ms = excluded.latency_ms, input_tokens = excluded.input_tokens,
       decided_at = datetime('now')`,
  ).run({
    item_id: dec.itemId,
    decided_by: dec.decidedBy,
    rule_id: dec.ruleId ?? null,
    category: dec.category,
    confidence: dec.confidence,
    answers_json: dec.answers === undefined ? null : JSON.stringify(dec.answers),
    needs_review: dec.needsReview ? 1 : 0,
    flags_json: JSON.stringify(dec.flags),
    latency_ms: dec.latencyMs ?? null,
    input_tokens: dec.inputTokens ?? null,
  });
}

export function markApplied(d: Db, itemId: number, labels: string[]): void {
  d.prepare("UPDATE decisions SET applied_at = datetime('now'), applied_labels_json = ? WHERE item_id = ?").run(JSON.stringify(labels), itemId);
}

/** Mémoire expéditeur : la catégorie dominante pour cette adresse, si elle est assez établie. */
export function rememberSender(d: Db, accountId: number, from: string, category: string): void {
  d.prepare(
    `INSERT INTO sender_memory (account_id, from_address, category) VALUES (?, ?, ?)
     ON CONFLICT(account_id, from_address, category) DO UPDATE SET count = count + 1, last_at = datetime('now')`,
  ).run(accountId, from, category);
}
export function recallSender(d: Db, accountId: number, from: string, minCount: number): string | undefined {
  const rows = d
    .prepare("SELECT category, count FROM sender_memory WHERE account_id = ? AND from_address = ? ORDER BY count DESC")
    .all(accountId, from) as Array<{ category: string; count: number }>;
  if (rows.length === 0) return undefined;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = rows[0];
  // Il faut assez d'exemples, et une nette majorité, pour se passer de Jev.
  if (top.count >= minCount && top.count / total >= 0.8) return top.category;
  return undefined;
}

export function startRun(d: Db, kind: string, accountId?: number): number {
  return Number(d.prepare("INSERT INTO runs (kind, account_id) VALUES (?, ?)").run(kind, accountId ?? null).lastInsertRowid);
}
export function finishRun(d: Db, runId: number, stats: { processed: number; jevCalls: number; inputTokens: number; note?: string }): void {
  d.prepare("UPDATE runs SET finished_at = datetime('now'), processed = ?, jev_calls = ?, input_tokens = ?, note = ? WHERE id = ?").run(
    stats.processed,
    stats.jevCalls,
    stats.inputTokens,
    stats.note ?? null,
    runId,
  );
}

export interface ActivityRow { id: number; at: string; channel: string; kind: string; params: Record<string, unknown>; itemId: number | null }
/** Note un événement du fil d'activité. Ne lève jamais : le fil ne doit pas faire échouer ce qu'il raconte. */
export function logActivity(d: Db, channel: string, kind: string, params: Record<string, unknown> = {}, itemId?: number | null): void {
  try { d.prepare("INSERT INTO activity (channel, kind, params_json, item_id) VALUES (?, ?, ?, ?)").run(channel, kind, JSON.stringify(params), itemId ?? null); }
  catch (e) { console.error("[activité]", (e as Error).message); }
}
/** Oublie les événements de plus de `days` jours (au démarrage). */
export function purgeActivity(d: Db, days = 30): number {
  return d.prepare("DELETE FROM activity WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)").run(`-${days} days`).changes;
}
/** Les derniers événements, du plus récent au plus ancien. `before` : id pour la page suivante. */
export function listActivity(d: Db, limit = 30, before?: number): ActivityRow[] {
  const rows = d.prepare(`SELECT id, at, channel, kind, params_json, item_id FROM activity ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`)
    .all(...(before ? [before, limit] : [limit])) as Array<{ id: number; at: string; channel: string; kind: string; params_json: string | null; item_id: number | null }>;
  return rows.map((r) => {
    let params: Record<string, unknown> = {};
    try { params = r.params_json ? JSON.parse(r.params_json) : {}; } catch { /* ligne abîmée : sans paramètres */ }
    return { id: r.id, at: r.at, channel: r.channel, kind: r.kind, params, itemId: r.item_id };
  });
}

/** Petits réglages persistants (clé → JSON). */
export function kvGet<T>(d: Db, key: string, fallback: T): T {
  const row = d.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
export function kvSet(d: Db, key: string, value: unknown): void {
  d.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
