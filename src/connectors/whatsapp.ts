/**
 * WhatsApp, lu depuis l'application WhatsApp Desktop de ce Mac.
 *
 * Aucun appareil lié, aucun réseau : l'agent copie la base locale de WhatsApp Desktop
 * (ChatStorage.sqlite, une base Core Data) dans data/whatsapp/ et la lit en lecture seule.
 * Ton numéro n'est jamais exposé ; si Meta change le format, on le détecte et on le dit.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { t } from "../i18n/index.js";
import { PATHS } from "../config.js";
import { sqliteOptions } from "../db.js";
import type { Item } from "./types.js";

/** Core Data compte les secondes depuis le 1er janvier 2001. */
const APPLE_EPOCH = 978307200;
export const appleToDate = (s: number | null): Date | null => (s == null ? null : new Date((s + APPLE_EPOCH) * 1000));
export const dateToApple = (d: Date): number => d.getTime() / 1000 - APPLE_EPOCH;

export const WA = {
  app: "/Applications/WhatsApp.app",
  container: path.join(os.homedir(), "Library", "Group Containers", "group.net.whatsapp.WhatsApp.shared"),
  get db() { return path.join(this.container, "ChatStorage.sqlite"); },
  copyDir: path.join(PATHS.data, "whatsapp"),
  get copy() { return path.join(this.copyDir, "ChatStorage.sqlite"); },
};

/** Ce qu'on attend du schéma. Si une colonne manque, on refuse de lire plutôt que de se tromper. */
const REQUIRED: Record<string, string[]> = {
  ZWACHATSESSION: ["Z_PK", "ZCONTACTJID", "ZPARTNERNAME", "ZSESSIONTYPE", "ZARCHIVED", "ZREMOVED", "ZLASTMESSAGEDATE"],
  ZWAMESSAGE: ["Z_PK", "ZCHATSESSION", "ZMESSAGEDATE", "ZMESSAGETYPE", "ZISFROMME", "ZTEXT", "ZFROMJID", "ZGROUPMEMBER", "ZSTANZAID", "ZMEDIAITEM"],
  ZWAGROUPMEMBER: ["Z_PK", "ZCHATSESSION", "ZISACTIVE", "ZMEMBERJID", "ZCONTACTNAME"],
  ZWAPROFILEPUSHNAME: ["ZJID", "ZPUSHNAME"],
  ZWAMEDIAITEM: ["Z_PK", "ZTITLE"],
};
/** ZSESSIONTYPE : 0 = conversation à deux, 1 = groupe. Les autres (statuts, diffusion, communautés) ne nous intéressent pas. */
export const CHAT_KIND = { direct: 0, group: 1 } as const;
/** ZMESSAGETYPE : 0 = texte, 1 = image, 2 = vidéo, 3 = vocal, 7 = document. */
export const MSG_TEXT = 0;

export interface WhatsAppStatus {
  /** false hors macOS : rien n'est lu, l'interface affiche « app non installée ». */
  supported: boolean;
  appInstalled: boolean;
  appRunning: boolean;
  /** Selon la dernière vérification (probe) ; false tant qu'on n'a pas regardé. */
  dbFound: boolean;
  dbPath: string;
  /** false : le dossier de WhatsApp n'a pas encore été regardé depuis le démarrage. */
  probed: boolean;
  /** Une vérification attend : au premier accès, c'est presque toujours macOS qui attend ta réponse. */
  probing: boolean;
  /** Dernière écriture de WhatsApp Desktop dans sa base (fichier principal ou journal). */
  dbUpdatedAt: string | null;
  /** null tant qu'aucune copie n'a été faite : le format se vérifie au branchement. */
  schemaOk: boolean | null;
  schemaError: string | null;
  /** Dernière copie faite par l'agent. */
  snapshotAt: string | null;
  lastMessageAt: string | null;
  totalMessages: number | null;
  chats: { groups: number; direct: number } | null;
  /** Une copie est en cours ; à la première fois, macOS attend probablement ta réponse à sa demande d'autorisation. */
  copying: boolean;
}

export interface ChatRow {
  pk: number;
  jid: string;
  name: string;
  kind: "group" | "direct";
  archived: boolean;
  members: number;
  lastMessageAt: string | null;
  /** Sur la fenêtre demandée (30 jours par défaut). */
  messages: number;
  texts: number;
  /** Textes qui contiennent un jour, une heure ou une date : un simple filtre de mots, l'IA fera mieux. */
  dateHints: number;
}

/** WhatsApp Desktop n'est lu que sur macOS ; ailleurs la source se présente comme « app non installée ». */
export const supported = (): boolean => process.platform === "darwin";
export function appInstalled(): boolean {
  return supported() && fs.existsSync(WA.app);
}
export function appRunning(): boolean {
  if (!supported()) return false;
  try {
    return execFileSync("pgrep", ["-x", "WhatsApp"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
  } catch {
    return false;
  }
}
function mtime(file: string): number {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}
/**
 * Ce qu'on sait de la base de WhatsApp Desktop, sans jamais bloquer le serveur. Son dossier est protégé par macOS
 * (« … souhaite accéder aux données d'autres apps ») : le premier accès attend la réponse de l'utilisateur, et un
 * appel synchrone gèlerait tout le serveur jusque-là. On ne le regarde donc que sur demande (écran WhatsApp,
 * branchement) ou une fois WhatsApp branché, et toujours en asynchrone.
 */
export interface Probe { found: boolean; updatedMs: number }
let lastProbe: Probe | null = null;
let probing: Promise<Probe> | undefined;
export function probe(): Promise<Probe> {
  if (!supported()) return Promise.resolve((lastProbe = { found: false, updatedMs: 0 }));
  if (probing) return probing;
  probing = (async () => {
    const at = async (f: string) => { try { return (await fs.promises.stat(f)).mtimeMs; } catch { return 0; } };
    // La base est en mode WAL : le journal peut être plus récent que le fichier principal.
    const [main, wal] = await Promise.all([at(WA.db), at(WA.db + "-wal")]);
    return (lastProbe = { found: main > 0, updatedMs: Math.max(main, wal) });
  })().finally(() => { probing = undefined; });
  return probing;
}

/**
 * Copie la base (et son journal) dans data/whatsapp/, seulement si WhatsApp a écrit depuis la dernière copie.
 * Asynchrone exprès : à la première lecture, macOS demande l'autorisation d'accéder aux données d'une autre app
 * (« … souhaite accéder aux données d'autres apps ») et bloque la lecture jusqu'à la réponse. Le serveur, lui, continue.
 */
let copying: Promise<{ copied: boolean; at: string }> | undefined;
export function snapshot(force = false): Promise<{ copied: boolean; at: string }> {
  if (copying) return copying;
  copying = (async () => {
    const src = await probe();
    if (!src.found) throw new Error(t("wa.dbNotFound"));
    fs.mkdirSync(WA.copyDir, { recursive: true });
    const done = mtime(WA.copy + ".stamp");
    if (!force && fs.existsSync(WA.copy) && done >= src.updatedMs) return { copied: false, at: new Date(done).toISOString() };
    closeCopy();
    // On copie d'abord sous un nom temporaire : une copie interrompue ne remplace jamais une copie saine.
    // Aucun accès synchrone au dossier de WhatsApp (voir probe()) : un fichier absent se constate à la copie.
    for (const suffix of ["", "-wal", "-shm"]) {
      const from = WA.db + suffix, to = WA.copy + suffix + ".tmp";
      try { await fs.promises.copyFile(from, to); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT" || suffix === "") throw e; await fs.promises.rm(to, { force: true }); }
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      const tmp = WA.copy + suffix + ".tmp";
      if (fs.existsSync(tmp)) fs.renameSync(tmp, WA.copy + suffix);
      else fs.rmSync(WA.copy + suffix, { force: true });
    }
    fs.writeFileSync(WA.copy + ".stamp", new Date().toISOString());
    cache.clear();
    return { copied: true, at: new Date().toISOString() };
  })().finally(() => { copying = undefined; });
  return copying;
}
/** Vrai pendant qu'une copie est en cours (souvent : macOS attend ta réponse). */
export function copying_(): boolean { return !!copying; }
export function snapshotAt(): string | null {
  const t = mtime(WA.copy + ".stamp");
  return t ? new Date(t).toISOString() : null;
}
/** Efface la copie locale (au débranchement). Ne touche jamais à WhatsApp lui-même. */
export function removeSnapshot(): void {
  closeCopy();
  for (const suffix of ["", "-wal", "-shm", ".stamp", ".tmp", "-wal.tmp", "-shm.tmp"]) { try { fs.unlinkSync(WA.copy + suffix); } catch {} }
}

let copyDb: Database.Database | undefined;
function closeCopy(): void {
  try { copyDb?.close(); } catch {}
  copyDb = undefined;
}
/** Ouvre la copie en lecture seule. Jamais l'original. */
export function openCopy(): Database.Database {
  if (copyDb) return copyDb;
  if (!fs.existsSync(WA.copy)) throw new Error(t("wa.noCopy"));
  copyDb = new Database(WA.copy, sqliteOptions({ readonly: true, fileMustExist: true }));
  const err = checkSchema(copyDb);
  if (err) { closeCopy(); throw new Error(err); }
  return copyDb;
}

/** Vérifie que les tables et colonnes attendues existent. Renvoie un message d'erreur, ou null si tout va bien. */
export function checkSchema(db: Database.Database): string | null {
  for (const [table, cols] of Object.entries(REQUIRED)) {
    let have: string[];
    try {
      have = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    } catch (e) {
      return t("wa.badFormat", { error: (e as Error).message });
    }
    if (!have.length) return t("wa.tableMissing", { table });
    const missing = cols.filter((c) => !have.includes(c));
    if (missing.length) return t("wa.columnsMissing", { table, columns: missing.join(", ") });
  }
  return null;
}

/**
 * État de la source. On ne touche jamais l'original de WhatsApp Desktop, même pour vérifier le format :
 * tant qu'aucune copie n'existe, `schemaOk` reste null (inconnu) et le format est vérifié au branchement.
 */
export function status(): WhatsAppStatus {
  // Rien que la dernière vérification connue : status() ne touche jamais au dossier de WhatsApp (voir probe()).
  const found = !!lastProbe?.found;
  const base: WhatsAppStatus = {
    supported: supported(), appInstalled: appInstalled(), appRunning: appRunning(), dbFound: found, dbPath: WA.db,
    probed: lastProbe !== null, probing: !!probing,
    dbUpdatedAt: found && lastProbe!.updatedMs ? new Date(lastProbe!.updatedMs).toISOString() : null,
    schemaOk: null, schemaError: null, snapshotAt: snapshotAt(), lastMessageAt: null, totalMessages: null, chats: null, copying: copying_(),
  };
  if (!found || !fs.existsSync(WA.copy)) return base;
  try {
    const db = openCopy();
    base.schemaOk = true;
    const t = db.prepare("SELECT COUNT(*) n, MAX(ZMESSAGEDATE) last FROM ZWAMESSAGE").get() as { n: number; last: number | null };
    base.totalMessages = t.n;
    base.lastMessageAt = appleToDate(t.last)?.toISOString() ?? null;
    const k = db.prepare("SELECT ZSESSIONTYPE kind, COUNT(*) n FROM ZWACHATSESSION WHERE ZREMOVED = 0 GROUP BY 1").all() as Array<{ kind: number; n: number }>;
    base.chats = { groups: k.find((x) => x.kind === CHAT_KIND.group)?.n ?? 0, direct: k.find((x) => x.kind === CHAT_KIND.direct)?.n ?? 0 };
  } catch (e) {
    base.schemaOk = false;
    base.schemaError = (e as Error).message;
  }
  return base;
}

/** Mots qui trahissent une date ou une heure, en français, espagnol, catalan et anglais. */
const DATE_WORDS = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apr[èe]s-demain|ce soir|ce matin|cet apr[èe]s-midi|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|ma[ñn]ana|pasado ma[ñn]ana|esta tarde|esta noche|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|dem[àa]|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december)\b/i;
const DATE_DIGITS = /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{1,2}\s?[:h]\s?\d{2}\b|\b\d{1,2}\s?h\b|\b(?:a las|à|at)\s+\d{1,2}\b/i;
export function hasDateHint(text: string | null | undefined): boolean {
  if (!text) return false;
  return DATE_WORDS.test(text) || DATE_DIGITS.test(text);
}

const cache = new Map<string, unknown>();

/** Toutes les conversations à deux et tous les groupes, avec leur volume sur `days` jours. */
export function listChats(days = 30): ChatRow[] {
  const key = `chats:${days}`;
  const hit = cache.get(key) as ChatRow[] | undefined;
  if (hit) return hit;
  const db = openCopy();
  const since = dateToApple(new Date(Date.now() - days * 86_400_000));
  const rows = db
    .prepare(
      `SELECT s.Z_PK pk, s.ZCONTACTJID jid, s.ZPARTNERNAME name, s.ZSESSIONTYPE kind, s.ZARCHIVED archived, s.ZLASTMESSAGEDATE lastAt,
         (SELECT COUNT(*) FROM ZWAGROUPMEMBER g WHERE g.ZCHATSESSION = s.Z_PK AND g.ZISACTIVE = 1) members,
         (SELECT COUNT(*) FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK AND m.ZMESSAGEDATE > ?) messages,
         (SELECT COUNT(*) FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK AND m.ZMESSAGEDATE > ? AND m.ZMESSAGETYPE = ?) texts
       FROM ZWACHATSESSION s WHERE s.ZREMOVED = 0 AND s.ZSESSIONTYPE IN (?, ?)`,
    )
    .all(since, since, MSG_TEXT, CHAT_KIND.direct, CHAT_KIND.group) as Array<{ pk: number; jid: string; name: string | null; kind: number; archived: number; lastAt: number | null; members: number; messages: number; texts: number }>;
  // Indices de date : on compte en JS sur les textes de la fenêtre (quelques milliers de lignes, instantané).
  const hints = new Map<number, number>();
  const texts = db.prepare("SELECT ZCHATSESSION pk, ZTEXT t FROM ZWAMESSAGE WHERE ZMESSAGETYPE = ? AND ZMESSAGEDATE > ?").all(MSG_TEXT, since) as Array<{ pk: number; t: string | null }>;
  for (const m of texts) if (hasDateHint(m.t)) hints.set(m.pk, (hints.get(m.pk) ?? 0) + 1);
  const out = rows.map<ChatRow>((r) => ({
    pk: r.pk, jid: r.jid, name: r.name?.trim() || r.jid.split("@")[0], kind: r.kind === CHAT_KIND.group ? "group" : "direct",
    archived: !!r.archived, members: r.members, lastMessageAt: appleToDate(r.lastAt)?.toISOString() ?? null,
    messages: r.messages, texts: r.texts, dateHints: hints.get(r.pk) ?? 0,
  }));
  out.sort((a, b) => b.messages - a.messages || (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  cache.set(key, out);
  return out;
}

export interface ReadOptions {
  /** Inclure la légende des photos et le nom des documents (texte seulement). */
  captions?: boolean;
  since?: Date;
  /** Horodatage Apple brut (secondes, exclusif) : prime sur `since`. C'est le curseur de l'ingestion, sans perte de précision. */
  after?: number;
  limit?: number;
  ownerName?: string;
  /** « asc » : les plus anciens d'abord (l'ingestion avance son curseur sans rien sauter). Par défaut, les plus récents. */
  order?: "asc" | "desc";
}

/**
 * Les messages d'une conversation, du plus récent au plus ancien, sous la forme commune `Item`.
 * `accountId` est celui du compte « whatsapp » dans la base de l'agent (0 pour un simple aperçu).
 */
export function readMessages(chatPk: number, accountId: number, opts: ReadOptions = {}): Array<Item & { at: number }> {
  return readMessagesPage(chatPk, accountId, opts).items;
}
/** Les messages et `truncated` : la limite a coupé la lecture, il en reste d'autres après. */
export function readMessagesPage(chatPk: number, accountId: number, opts: ReadOptions = {}): { items: Array<Item & { at: number }>; truncated: boolean } {
  const db = openCopy();
  const chat = db.prepare("SELECT ZCONTACTJID jid, ZPARTNERNAME name, ZSESSIONTYPE kind FROM ZWACHATSESSION WHERE Z_PK = ?").get(chatPk) as { jid: string; name: string | null; kind: number } | undefined;
  if (!chat) throw new Error(t("err.unknownChat"));
  const since = opts.after ?? (opts.since ? dateToApple(opts.since) : 0);
  const types = opts.captions ? [0, 1, 2, 7] : [0];
  const rows = db
    .prepare(
      `SELECT m.Z_PK pk, m.ZSTANZAID sid, m.ZMESSAGEDATE at, m.ZMESSAGETYPE type, m.ZISFROMME fromMe, m.ZTEXT text, m.ZFROMJID fromJid,
              m.ZMEDIAITEM media, (SELECT ZTITLE FROM ZWAMEDIAITEM x WHERE x.Z_PK = m.ZMEDIAITEM) caption,
              g.ZCONTACTNAME memberName, g.ZMEMBERJID memberJid,
              (SELECT p.ZPUSHNAME FROM ZWAPROFILEPUSHNAME p WHERE p.ZJID = g.ZMEMBERJID LIMIT 1) pushName
       FROM ZWAMESSAGE m LEFT JOIN ZWAGROUPMEMBER g ON g.Z_PK = m.ZGROUPMEMBER
       WHERE m.ZCHATSESSION = ? AND m.ZMESSAGEDATE > ? AND m.ZMESSAGETYPE IN (${types.map(() => "?").join(",")})
       ORDER BY m.ZMESSAGEDATE ${opts.order === "asc" ? "ASC" : "DESC"} LIMIT ?`,
    )
    .all(chatPk, since, ...types, opts.limit ?? 200) as Array<{ pk: number; sid: string | null; at: number; type: number; fromMe: number; text: string | null; fromJid: string | null; pushName: string | null; media: number | null; caption: string | null; memberName: string | null; memberJid: string | null }>;
  const chatName = chat.name?.trim() || chat.jid.split("@")[0];
  const items: Array<Item & { at: number }> = [];
  for (const r of rows) {
    const text = (r.type === MSG_TEXT ? r.text : r.caption || r.text || "")?.trim() ?? "";
    if (!text) continue;
    const kindLabel = r.type === 1 ? t("wa.photo") : r.type === 2 ? t("wa.video") : r.type === 7 ? t("wa.document") : "";
    // Le nom que la personne s'est donné dans WhatsApp, sinon le contact, sinon un membre anonyme : jamais le numéro entier.
    const digits = (r.memberJid ?? r.fromJid ?? "").split("@")[0].replace(/\D/g, "");
    const fromName = r.fromMe ? (opts.ownerName ?? t("wa.me")) : r.pushName?.trim() || r.memberName?.trim() || (chat.kind === CHAT_KIND.direct ? chatName : `${t("wa.member")} ·${digits.slice(-4) || "?"}`);
    items.push({
      externalId: r.sid || `pk:${r.pk}`, threadId: chat.jid, accountId, source: "whatsapp",
      fromName, fromAddress: r.fromMe ? "me" : (r.memberJid ?? r.fromJid ?? chat.jid), to: [chatName], subject: chatName,
      date: appleToDate(r.at)!, bodyExcerpt: kindLabel + text, hasAttachments: r.media != null, hasListUnsubscribe: false,
      isOutgoing: !!r.fromMe, labels: [], at: r.at,
    });
  }
  return { items, truncated: rows.length >= (opts.limit ?? 200) };
}
