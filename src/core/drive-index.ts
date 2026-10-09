import type { Db } from "../db.js";
import { kvGet, kvSet, logActivity, rebuildDocsFts } from "../db.js";
import { t } from "../i18n/index.js";
import { FOLDER_MIME, type DriveEntry } from "../connectors/drive.js";

/**
 * L'index local de Google Drive : l'arborescence, les noms et les dates des documents, et le périmètre choisi
 * (dossiers inclus, exclus ou figés, formats retenus). Aucun contenu n'est lu ici, et rien n'est écrit dans Drive.
 */

// ---------- formats
export const FORMATS = ["pdf", "google", "office", "text", "image"] as const;
export type Format = (typeof FORMATS)[number];
/** Tous les formats par défaut, images comprises : un papier scanné ou photographié (carte d'identité, attestation) est souvent un JPG. Les dossiers de photos restent exclus d'office (isDefaultOut). */
export const DEFAULT_FORMATS: Format[] = ["pdf", "google", "office", "text", "image"];
export const DEFAULT_MAX_MB = 50;

const GOOGLE_DOCS = new Set(["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation"]);
const OFFICE = /^application\/(msword|rtf|vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.(text|spreadsheet|presentation))/;
const TEXT = new Set(["text/plain", "text/markdown", "text/csv"]);
const IMAGE = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/tiff", "image/webp"]);
/** Le format d'un fichier, ou null s'il n'est pas un document (vidéo, son, archive, code, raccourci…). */
export function formatOf(mime: string): Format | null {
  if (mime === "application/pdf") return "pdf";
  if (GOOGLE_DOCS.has(mime)) return "google";
  if (OFFICE.test(mime)) return "office";
  if (TEXT.has(mime)) return "text";
  if (IMAGE.has(mime)) return "image";
  return null;
}

// ---------- périmètre
export type FolderMode = "in" | "out" | "frozen";
export const FOLDER_MODES: FolderMode[] = ["in", "out", "frozen"];
/** Dossiers exclus d'office (on peut les réinclure) : photos, enregistrements, notebooks, exports. */
const DEFAULT_OUT = [/^(google\s+)?photos?$/i, /^colab notebooks$/i, /^takeout$/i, /^meet recordings$/i, /^enregistrements meet$/i, /^grabaciones de meet$/i];
export const isDefaultOut = (name: string): boolean => DEFAULT_OUT.some((r) => r.test(name.trim()));

export interface ScopeFolder { id: string; name: string; parentId: string | null; mode: FolderMode | null }
export interface ScopeDoc { id: string; parentId: string | null; format: Format | null; size: number | null }
export interface ScopeOptions { rootId: string; formats: Format[]; maxBytes: number }
export interface FolderScope { path: string; effective: FolderMode; nDocs: number; nScope: number; nSub: number }
export interface DocScope { path: string | null; inScope: boolean; frozen: boolean }

/**
 * Calcul pur du périmètre. Un dossier sans choix hérite de son parent ; « Mon Drive » est inclus par défaut ; un
 * dossier de photos est exclu par défaut. Un fichier qu'on ne relie pas à « Mon Drive » (partagé avec moi sans être
 * rangé chez moi) n'est pas dans le périmètre. `nDocs` : documents des formats retenus sous le dossier, à toute
 * profondeur ; `nScope` : ceux qui seront lus.
 */
export function computeScope(folders: ScopeFolder[], docs: ScopeDoc[], o: ScopeOptions): { folders: Map<string, FolderScope>; docs: Map<string, DocScope> } {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, { path: string; effective: FolderMode } | null>();
  // `null` : pas relié à « Mon Drive ».
  const resolve = (id: string, depth = 0): { path: string; effective: FolderMode } | null => {
    if (memo.has(id)) return memo.get(id)!;
    let r: { path: string; effective: FolderMode } | null;
    if (id === o.rootId) r = { path: "", effective: byId.get(id)?.mode ?? "in" };
    else {
      const f = byId.get(id);
      const parent = f?.parentId && depth < 200 ? resolve(f.parentId, depth + 1) : null;
      r = f && parent ? { path: parent.path ? `${parent.path}/${f.name}` : f.name, effective: f.mode ?? (isDefaultOut(f.name) ? "out" : parent.effective) } : null;
    }
    memo.set(id, r);
    return r;
  };
  const out = new Map<string, FolderScope>();
  for (const f of folders) {
    const r = resolve(f.id);
    if (r) out.set(f.id, { ...r, nDocs: 0, nScope: 0, nSub: 0 });
  }
  for (const f of folders) if (f.parentId && out.has(f.id) && out.has(f.parentId)) out.get(f.parentId)!.nSub++;
  const formats = new Set(o.formats);
  const docsOut = new Map<string, DocScope>();
  for (const d of docs) {
    const parent = d.parentId ? resolve(d.parentId) : null;
    if (!parent) { docsOut.set(d.id, { path: null, inScope: false, frozen: false }); continue; }
    const counted = !!d.format && formats.has(d.format) && (d.size == null || d.size <= o.maxBytes);
    const inScope = counted && parent.effective !== "out";
    docsOut.set(d.id, { path: parent.path, inScope, frozen: inScope && parent.effective === "frozen" });
    if (!counted) continue;
    // Les compteurs remontent jusqu'à « Mon Drive ».
    for (let id: string | null = d.parentId, depth = 0; id && depth < 200; depth++) {
      const s = out.get(id);
      if (!s) break;
      s.nDocs++;
      if (inScope) s.nScope++;
      id = id === o.rootId ? null : byId.get(id)?.parentId ?? null;
    }
  }
  return { folders: out, docs: docsOut };
}

// ---------- réglages et état (les tables sont créées par openDb, voir driveSchema dans db.ts)
export interface DriveSettings { formats: Format[]; maxMb: number }
/** `triedAt` : dernier essai, réussi ou non (une erreur ne relance pas une lecture chaque minute). */
export interface DriveState { rootId: string | null; pageToken: string | null; scannedAt: string | null; syncedAt: string | null; triedAt: string | null; error: string | null; errorCode: string | null }
const EMPTY_STATE: DriveState = { rootId: null, pageToken: null, scannedAt: null, syncedAt: null, triedAt: null, error: null, errorCode: null };
export const driveSettings = (db: Db, accountId: number): DriveSettings => {
  const s = kvGet<Partial<DriveSettings>>(db, `drive.settings:${accountId}`, {});
  const formats = (s.formats ?? DEFAULT_FORMATS).filter((f): f is Format => (FORMATS as readonly string[]).includes(f));
  const maxMb = Number.isFinite(s.maxMb) && s.maxMb! > 0 ? Math.min(2000, s.maxMb!) : DEFAULT_MAX_MB;
  return { formats, maxMb };
};
export const saveDriveSettings = (db: Db, accountId: number, s: Partial<DriveSettings>): DriveSettings => {
  kvSet(db, `drive.settings:${accountId}`, { ...driveSettings(db, accountId), ...s });
  return driveSettings(db, accountId);
};
export const driveState = (db: Db, accountId: number): DriveState => ({ ...EMPTY_STATE, ...kvGet<Partial<DriveState>>(db, `drive.state:${accountId}`, {}) });
const setState = (db: Db, accountId: number, s: Partial<DriveState>) => kvSet(db, `drive.state:${accountId}`, { ...driveState(db, accountId), ...s });
export const driveEnabled = (db: Db, accountId: number): boolean => kvGet(db, `drive.enabled:${accountId}`, false);
export const setDriveEnabled = (db: Db, accountId: number, on: boolean): void => kvSet(db, `drive.enabled:${accountId}`, on);

function upsertEntries(db: Db, accountId: number, entries: DriveEntry[]): number {
  const folder = db.prepare(`INSERT INTO drive_folders (account_id, folder_id, name, parent_id, owned) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, folder_id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, owned = excluded.owned`);
  const doc = db.prepare(`INSERT INTO docs (account_id, file_id, name, mime, format, size, md5, parent_id, modified_at, created_at, owned, link)
    VALUES (@a, @id, @name, @mime, @format, @size, @md5, @parent, @modified, @created, @owned, @link)
    ON CONFLICT(account_id, file_id) DO UPDATE SET name = excluded.name, mime = excluded.mime, format = excluded.format, size = excluded.size,
      md5 = excluded.md5, parent_id = excluded.parent_id, modified_at = excluded.modified_at, created_at = excluded.created_at,
      owned = excluded.owned, link = excluded.link, indexed_at = datetime('now')`);
  // Un dossier devenu fichier (ou l'inverse) n'existe pas dans Drive ; on retire tout de même l'autre forme, par sûreté.
  const dropDoc = db.prepare("DELETE FROM docs WHERE account_id = ? AND file_id = ?");
  let n = 0;
  for (const e of entries) {
    if (e.mimeType === FOLDER_MIME) { folder.run(accountId, e.id, e.name, e.parentId, e.ownedByMe ? 1 : 0); dropDoc.run(accountId, e.id); n++; continue; }
    if (e.mimeType === "application/vnd.google-apps.shortcut") continue;
    doc.run({ a: accountId, id: e.id, name: e.name, mime: e.mimeType, format: formatOf(e.mimeType), size: e.size, md5: e.md5, parent: e.parentId, modified: e.modifiedAt, created: e.createdAt, owned: e.ownedByMe ? 1 : 0, link: e.link });
    n++;
  }
  return n;
}

/** Recalcule chemins, choix hérités, compteurs et l'index de recherche d'un compte, après une lecture ou un choix. */
export function refreshScope(db: Db, accountId: number): { inScope: number; folders: number } {
  const rootId = driveState(db, accountId).rootId;
  if (!rootId) return { inScope: 0, folders: 0 };
  const s = driveSettings(db, accountId);
  const folders = (db.prepare("SELECT folder_id id, name, parent_id parentId, mode FROM drive_folders WHERE account_id = ?").all(accountId) as ScopeFolder[]);
  // « Mon Drive » lui-même n'est pas une ligne de la liste : il porte quand même un choix possible (tout exclure).
  if (!folders.some((f) => f.id === rootId)) folders.push({ id: rootId, name: "", parentId: null, mode: null });
  const docs = db.prepare("SELECT file_id id, parent_id parentId, format, size FROM docs WHERE account_id = ?").all(accountId) as ScopeDoc[];
  const r = computeScope(folders, docs, { rootId, formats: s.formats, maxBytes: s.maxMb * 1024 * 1024 });
  const uf = db.prepare("UPDATE drive_folders SET path = ?, effective = ?, n_docs = ?, n_scope = ?, n_sub = ? WHERE account_id = ? AND folder_id = ?");
  const ud = db.prepare("UPDATE docs SET path = ?, in_scope = ?, frozen = ? WHERE account_id = ? AND file_id = ?");
  let inScope = 0;
  db.transaction(() => {
    db.prepare("UPDATE drive_folders SET path = NULL, effective = NULL, n_docs = 0, n_scope = 0, n_sub = 0 WHERE account_id = ?").run(accountId);
    for (const [id, f] of r.folders) uf.run(f.path, f.effective, f.nDocs, f.nScope, f.nSub, accountId, id);
    for (const [id, d] of r.docs) { ud.run(d.path, d.inScope ? 1 : 0, d.frozen ? 1 : 0, accountId, id); if (d.inScope) inScope++; }
    // Les fiches des fichiers disparus de Drive (supprimés, plus partagés) partent avec eux.
    db.prepare("DELETE FROM doc_cards WHERE account_id = ? AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.account_id = doc_cards.account_id AND d.file_id = doc_cards.file_id)").run(accountId);
    rebuildDocsFts(db, accountId);
  })();
  return { inScope, folders: r.folders.size };
}

/** Le choix d'un dossier (null : il hérite de nouveau). « Mon Drive » se règle par son identifiant. */
export function setFolderMode(db: Db, accountId: number, folderId: string, mode: FolderMode | null): void {
  const rootId = driveState(db, accountId).rootId;
  if (folderId === rootId) db.prepare("INSERT INTO drive_folders (account_id, folder_id, name, parent_id, mode) VALUES (?, ?, '', NULL, ?) ON CONFLICT(account_id, folder_id) DO UPDATE SET mode = excluded.mode").run(accountId, folderId, mode);
  else db.prepare("UPDATE drive_folders SET mode = ? WHERE account_id = ? AND folder_id = ?").run(mode, accountId, folderId);
}

// ---------- lecture de Drive
/** Ce dont la synchronisation a besoin de Drive : le lecteur réel (DriveReader) ou un faux dans les tests. */
export interface DriveSource {
  rootId(): Promise<string>;
  listAll(onPage?: (n: number) => void, signal?: AbortSignal): Promise<DriveEntry[]>;
  startPageToken(): Promise<string>;
  changesSince(token: string): Promise<{ changed: DriveEntry[]; removed: string[]; next: string }>;
}
/** La lecture en cours, par compte : l'interface en affiche l'avancement. */
export const driveBusy = new Map<number, { phase: "list" | "changes"; n: number; startedAt: number }>();
export const DRIVE_EVERY_MIN = 15;

export interface SyncResult { full: boolean; changed: number; inScope: number; folders: number }
/**
 * Une lecture : complète la première fois (ou sur demande), puis seulement les changements depuis la précédente.
 * Le point de départ des changements est pris avant la lecture complète : ce qui bouge pendant n'est pas perdu.
 */
export async function syncDrive(db: Db, account: { id: number; email: string }, src: DriveSource, opts: { full?: boolean } = {}): Promise<SyncResult> {
  if (driveBusy.has(account.id)) throw Object.assign(new Error(t("drive.busy")), { code: "drive.busy", status: 409 });
  const busy = { phase: "list" as "list" | "changes", n: 0, startedAt: Date.now() };
  driveBusy.set(account.id, busy);
  setState(db, account.id, { triedAt: new Date().toISOString() });
  try {
    const st = driveState(db, account.id);
    let result: SyncResult;
    let changes: Awaited<ReturnType<DriveSource["changesSince"]>> | null = null;
    if (!opts.full && st.pageToken && st.rootId) {
      busy.phase = "changes";
      // Point de départ trop ancien ou invalide : Google le refuse, on relit tout.
      try { changes = await src.changesSince(st.pageToken); } catch (e) { const c = Number((e as { code?: unknown }).code ?? (e as { status?: unknown }).status); if (c !== 400 && c !== 404 && c !== 410) throw e; }
    }
    if (changes) {
      db.transaction(() => {
        const dropDoc = db.prepare("DELETE FROM docs WHERE account_id = ? AND file_id = ?");
        const dropFolder = db.prepare("DELETE FROM drive_folders WHERE account_id = ? AND folder_id = ?");
        for (const id of changes!.removed) { dropDoc.run(account.id, id); dropFolder.run(account.id, id); }
        upsertEntries(db, account.id, changes!.changed);
      })();
      const n = changes.changed.length + changes.removed.length;
      const scope = n ? refreshScope(db, account.id) : { inScope: (db.prepare("SELECT COUNT(*) n FROM docs WHERE account_id = ? AND in_scope = 1").get(account.id) as { n: number }).n, folders: (db.prepare("SELECT COUNT(*) n FROM drive_folders WHERE account_id = ? AND path IS NOT NULL").get(account.id) as { n: number }).n };
      setState(db, account.id, { pageToken: changes.next, syncedAt: new Date().toISOString(), error: null, errorCode: null });
      if (n) logActivity(db, "drive", "pass", { email: account.email, changed: n, docs: scope.inScope });
      result = { full: false, changed: n, ...scope };
    } else {
      busy.phase = "list";
      const [rootId, token] = await Promise.all([src.rootId(), src.startPageToken()]);
      const entries = await src.listAll((n) => { busy.n = n; });
      db.transaction(() => {
        // Les choix de dossiers restent ; ce qui n'existe plus dans Drive disparaît de l'index.
        db.prepare("DELETE FROM docs WHERE account_id = ?").run(account.id);
        const seen = new Set(entries.filter((e) => e.mimeType === FOLDER_MIME).map((e) => e.id));
        seen.add(rootId);
        for (const r of db.prepare("SELECT folder_id FROM drive_folders WHERE account_id = ?").all(account.id) as Array<{ folder_id: string }>) {
          if (!seen.has(r.folder_id)) db.prepare("DELETE FROM drive_folders WHERE account_id = ? AND folder_id = ?").run(account.id, r.folder_id);
        }
        upsertEntries(db, account.id, entries);
        // « Mon Drive » a sa ligne : elle porte ses compteurs et, si l'utilisateur en fait un, son choix.
        db.prepare("INSERT INTO drive_folders (account_id, folder_id, name, parent_id) VALUES (?, ?, '', NULL) ON CONFLICT(account_id, folder_id) DO NOTHING").run(account.id, rootId);
      })();
      const now = new Date().toISOString();
      setState(db, account.id, { rootId, pageToken: token, scannedAt: now, syncedAt: now, error: null, errorCode: null });
      const scope = refreshScope(db, account.id);
      logActivity(db, "drive", "scan", { email: account.email, docs: scope.inScope, folders: scope.folders });
      result = { full: true, changed: entries.length, ...scope };
    }
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    // Une même erreur n'est notée qu'une fois au fil, pas à chaque passage.
    if (driveState(db, account.id).error !== msg) logActivity(db, "drive", "error", { email: account.email, error: msg.slice(0, 200) });
    // Le code (« drive.apiDisabled »…) permet à l'écran d'afficher la bonne aide, pas seulement le message.
    const code = (e as { code?: unknown }).code;
    setState(db, account.id, { error: msg, errorCode: typeof code === "string" ? code : null });
    throw e;
  } finally {
    driveBusy.delete(account.id);
  }
}

/** Oublie l'index d'un compte (les choix de dossiers restent) et arrête les lectures. Rien n'est touché dans Drive. */
export function forgetDrive(db: Db, accountId: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM docs WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM docs_fts WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM doc_cards WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM doc_corrections WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM drive_folders WHERE account_id = ? AND mode IS NULL").run(accountId);
    db.prepare("UPDATE drive_folders SET path = NULL, effective = NULL, n_docs = 0, n_scope = 0, n_sub = 0 WHERE account_id = ?").run(accountId);
    kvSet(db, `drive.state:${accountId}`, EMPTY_STATE);
    setDriveEnabled(db, accountId, false);
  })();
}

/** Le prochain passage d'un compte, ou null s'il n'est pas branché. */
export function nextDriveSync(db: Db, accountId: number): string | null {
  if (!driveEnabled(db, accountId)) return null;
  const st = driveState(db, accountId);
  const last = Math.max(st.syncedAt ? Date.parse(st.syncedAt) : 0, st.triedAt ? Date.parse(st.triedAt) : 0);
  return new Date(last ? last + DRIVE_EVERY_MIN * 60_000 : Date.now()).toISOString();
}

// ---------- consultation
export interface FolderRow { id: string; name: string; path: string | null; mode: FolderMode | null; effective: FolderMode | null; nDocs: number; nScope: number; nSub: number; defaultOut: boolean }
export function folderChildren(db: Db, accountId: number, parentId: string): FolderRow[] {
  const rows = db.prepare("SELECT folder_id id, name, path, mode, effective, n_docs nDocs, n_scope nScope, n_sub nSub FROM drive_folders WHERE account_id = ? AND parent_id = ? AND path IS NOT NULL ORDER BY n_docs = 0, name COLLATE NOCASE").all(accountId, parentId) as Array<Omit<FolderRow, "defaultOut">>;
  return rows.map((r) => ({ ...r, defaultOut: isDefaultOut(r.name) }));
}
export function rootSummary(db: Db, accountId: number): FolderRow | null {
  const rootId = driveState(db, accountId).rootId;
  if (!rootId) return null;
  const r = db.prepare("SELECT folder_id id, name, path, mode, effective, n_docs nDocs, n_scope nScope, n_sub nSub FROM drive_folders WHERE account_id = ? AND folder_id = ?").get(accountId, rootId) as Omit<FolderRow, "defaultOut"> | undefined;
  return r ? { ...r, defaultOut: false } : null;
}
/** Combien de documents par format, dans le périmètre des dossiers (avant le filtre des formats). */
export function formatCounts(db: Db, accountId: number): Record<string, number> {
  const rows = db.prepare(`SELECT d.format f, COUNT(*) n FROM docs d WHERE d.account_id = ? AND d.format IS NOT NULL AND d.path IS NOT NULL
    AND COALESCE((SELECT effective FROM drive_folders f WHERE f.account_id = d.account_id AND f.folder_id = d.parent_id), 'in') != 'out' GROUP BY d.format`).all(accountId) as Array<{ f: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.f, r.n]));
}

export interface DocHit { accountId: number; id: string; name: string; path: string; format: string | null; size: number | null; modifiedAt: string | null; link: string | null; frozen: boolean }
/** Les mots d'une recherche, en préfixes : « attest voit » trouve « Attestation assurance voiture ». */
export function ftsQuery(q: string): string | null {
  const words = q.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.slice(0, 12).map((w) => `"${w.replace(/"/g, "")}"*`).join(" ") : null;
}
export function searchDocs(db: Db, q: string, opts: { accountId?: number; limit?: number } = {}): DocHit[] {
  const fq = ftsQuery(q);
  if (!fq) return [];
  const rows = db.prepare(`SELECT d.account_id accountId, d.file_id id, d.name, COALESCE(d.path, '') path, d.format, d.size, d.modified_at modifiedAt, d.link, d.frozen
    FROM docs_fts f JOIN docs d ON d.account_id = f.account_id AND d.file_id = f.file_id
    WHERE docs_fts MATCH ? ${opts.accountId ? "AND f.account_id = ?" : ""} ORDER BY bm25(docs_fts, 0, 0, 4, 1, 3, 3, 1), d.modified_at DESC LIMIT ?`)
    .all(...[fq, ...(opts.accountId ? [opts.accountId] : []), Math.min(100, opts.limit ?? 30)]) as Array<Omit<DocHit, "frozen"> & { frozen: number }>;
  return rows.map((r) => ({ ...r, frozen: !!r.frozen }));
}
