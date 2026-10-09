/**
 * Telegram : le canal du coordinateur. Un bot privé, en long polling depuis ce Mac (aucune URL publique).
 *
 * - Un seul propriétaire, relié par un code affiché dans l'app. Tout autre expéditeur est ignoré.
 * - Des proches peuvent être reliés par un code d'invitation : le propriétaire leur écrit d'un bouton, leurs réponses lui sont relayées.
 * - Les commandes (/jour, /semaine, /actions…) ne coûtent rien : elles lisent la base. Le texte libre passe par le modèle de chat.
 * - Rien d'irréversible sans bouton : un événement ou un message à un proche se confirme d'un tap.
 */
import { randomInt } from "node:crypto";
import type { ModelMessage } from "ai";
import type { Classifier } from "../core/classify.js";
import type { Db } from "../db.js";
import { kvGet, kvSet, logActivity, openDb } from "../db.js";
import { boxHeading, chat, createPendingEvent, esc, findReminders, markSent, renderDay, renderWeek, sentKeys, snapshot, type Contact, type Pending } from "../core/brain.js";
import { householdMembers, ymd } from "../core/agenda.js";
import { clip } from "../core/text.js";
import { contactFollows, contactKey, contactMember, contactReminders, eventText, forContact, newEvents, suggestedFor } from "../core/relatives.js";
import { applyUpdate, cachedProposal } from "../core/proposals.js";
import type { DocQuery, DocResult, Viewer } from "../core/doc-search.js";
import { changedFields } from "../core/event-match.js";
import { EPHEMERAL_MINUTES, freshSigninAlerts } from "../core/ephemeral.js";
import { toCalWhere } from "../core/agenda-access.js";
import { mailWhere } from "../core/mail-query.js";
import { currentLanguage, LANGUAGES, t, type Language } from "../i18n/index.js";
import { getSecret, secretSource, setSecret, type SecretSource } from "../secrets.js";

// ---------- commandes : un identifiant, un nom par langue, tous acceptés quelle que soit la langue choisie
export type CommandId = "day" | "week" | "actions" | "toPay" | "reply" | "tasks" | "reminders" | "help" | "reset";
export const COMMANDS: ReadonlyArray<{ id: CommandId; names: Record<Language, string>; legacy?: string[]; /** Réservée au propriétaire (boîte mail). */ owner: boolean }> = [
  { id: "day", names: { fr: "jour", en: "day", es: "dia" }, legacy: ["today"], owner: false },
  { id: "week", names: { fr: "semaine", en: "week", es: "semana" }, owner: false },
  { id: "actions", names: { fr: "actions", en: "actions", es: "acciones" }, owner: true },
  { id: "toPay", names: { fr: "apayer", en: "topay", es: "pagar" }, owner: true },
  { id: "reply", names: { fr: "repondre", en: "reply", es: "responder" }, owner: true },
  { id: "tasks", names: { fr: "taches", en: "tasks", es: "tareas" }, owner: false },
  { id: "reminders", names: { fr: "rappels", en: "reminders", es: "recordatorios" }, owner: true },
  { id: "help", names: { fr: "aide", en: "help", es: "ayuda" }, legacy: ["start"], owner: false },
  { id: "reset", names: { fr: "oublie", en: "reset", es: "olvida" }, owner: false },
];
/** « jour », « day », « dia », « today » → "day". Inconnu → null. */
export function commandId(cmd: string): CommandId | null {
  const c = cmd.toLowerCase();
  return COMMANDS.find((x) => LANGUAGES.some((l) => x.names[l] === c) || x.legacy?.includes(c))?.id ?? null;
}
/** Le nom d'une commande dans la langue choisie, pour l'aide et le menu du bot. */
export const commandName = (id: CommandId, lang: Language = currentLanguage()): string => COMMANDS.find((x) => x.id === id)!.names[lang];
const HELP_KEY: Record<CommandId, Parameters<typeof t>[0]> = { day: "tg.help.day", week: "tg.help.week", actions: "tg.help.actions", toPay: "tg.help.toPay", reply: "tg.help.reply", tasks: "tg.help.tasks", reminders: "tg.help.reminders", help: "tg.help.help", reset: "tg.help.reset" };

// ---------- réglages persistants
export interface TgSchedule { morning: string; weekly: string; reminders: boolean; everyMinutes: number; quietFrom: string; quietTo: string; replyAfterDays: number }
export const TG_DEFAULTS: TgSchedule = { morning: "07:30", weekly: "20:00", reminders: true, everyMinutes: 30, quietFrom: "22:00", quietTo: "07:00", replyAfterDays: 3 };
export interface Owner { chatId: number; name: string; pairedAt: string }
interface Pairing { code: string; expires: string; kind: "owner" | "contact"; key?: string; name?: string }

/** Le jeton du bot : un secret (trousseau, .env.local, environnement) d'abord, l'ancienne copie en base (kv) ensuite. */
export function tgToken(db: Db): { token: string | null; source: SecretSource | "kv" | null } {
  const secret = getSecret("TELEGRAM_BOT_TOKEN");
  if (secret) return { token: secret, source: secretSource("TELEGRAM_BOT_TOKEN") };
  const t = kvGet<string | null>(db, "tg.token", null);
  return { token: t, source: t ? "kv" : null };
}
/**
 * L'ancienne copie du jeton en base (kv tg.token, en clair) rejoint les autres secrets, puis disparaît de la base.
 * Déjà un secret : la copie est simplement effacée. Persistance impossible : la copie reste (rien n'est perdu).
 */
export function migrateTgToken(db: Db): boolean {
  const old = kvGet<string | null>(db, "tg.token", null);
  if (!old) return false;
  if (!getSecret("TELEGRAM_BOT_TOKEN")) {
    try { if (!setSecret("TELEGRAM_BOT_TOKEN", old)) return false; } catch { return false; }
  }
  db.prepare("DELETE FROM kv WHERE key = 'tg.token'").run();
  return true;
}
export const tgSchedule = (db: Db): TgSchedule => ({ ...TG_DEFAULTS, ...kvGet<Partial<TgSchedule>>(db, "tg.schedule", {}) });
export const tgOwner = (db: Db): Owner | null => kvGet<Owner | null>(db, "tg.owner", null);
export const tgContacts = (db: Db): Contact[] => kvGet<Contact[]>(db, "tg.contacts", []);

// ---------- petits calculs purs (testés)
/** « /jour@monbot  arg » → { cmd: "jour", arg: "arg" } ; texte libre → null. */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}
/** Telegram refuse au-delà de 4 096 caractères : on coupe sur une ligne. */
export function splitMessage(text: string, max = 4000): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  out.push(rest);
  return out;
}
/** Heures creuses : « 22:00 » → « 07:00 » passe minuit. */
export function inQuietHours(hm: string, from: string, to: string): boolean {
  if (from === to) return false;
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}
/** Un envoi programmé est dû s'il est prévu à `at` et qu'on est dans l'heure qui suit. */
export function isDue(nowHM: string, at: string): boolean {
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const d = mins(nowHM) - mins(at);
  return d >= 0 && d < 60;
}
export const hm = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** Heure, jour et jour de semaine (0 = dimanche) dans le fuseau du foyer, pas celui du Mac (voyage, machine réglée ailleurs). */
export function zonedNow(d: Date, timeZone: string): { hm: string; ymd: string; dow: number } {
  let p: Record<string, string>;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  } catch { return { hm: hm(d), ymd: ymd(d), dow: d.getDay() }; }
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { hm: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`, ymd: `${p.year}-${p.month}-${p.day}`, dow };
}
/** Code d'appairage : aléatoire cryptographique, 6 chiffres. */
const newCode = (): string => String(randomInt(100000, 1000000));
/** Au-delà de ce nombre de mauvais codes, le code en cours est annulé : il faut en demander un nouveau dans l'app. */
const MAX_PAIRING_FAILS = 5;
/**
 * L'historique gardé pour le modèle : les `max` derniers messages, mais toujours à partir d'un message de l'utilisateur.
 * Couper au milieu d'un échange outil (appel sans résultat, résultat sans appel) fait refuser toute la conversation.
 */
export function trimConversation<M extends { role: string }>(messages: M[], max: number): M[] {
  if (messages.length <= max) return messages;
  const cut = messages.slice(-max);
  const first = cut.findIndex((m) => m.role === "user");
  return first === -1 ? [] : cut.slice(first);
}

// ---------- Bot API
interface TgUser { id: number; first_name?: string; username?: string }
interface TgPhoto { file_id: string; width: number; height: number; file_size?: number }
interface TgDocument { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; caption?: string; photo?: TgPhoto[]; document?: TgDocument; media_group_id?: string }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage } }
type Button = { text: string; callback_data: string };

class BotApi {
  constructor(private token: string) {}
  async call<T>(method: string, body?: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: ac.signal });
      const data = (await res.json()) as { ok: boolean; result: T; description?: string; error_code?: number };
      if (!data.ok) throw Object.assign(new Error(data.description ?? `Telegram ${res.status}`), { code: data.error_code });
      return data.result;
    } finally { clearTimeout(t); }
  }
  /** Télécharge un fichier reçu (photo, document) : getFile, puis l'adresse de téléchargement du bot. */
  async download(fileId: string): Promise<Uint8Array> {
    const f = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (!f.file_path) throw new Error("Telegram : fichier indisponible");
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${f.file_path}`);
    if (!res.ok) throw new Error(`Telegram ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  /** Envoie un fichier (un document du Drive, sur confirmation) : multipart, 50 Mo au plus côté Telegram. */
  async sendDocument(chatId: number, data: Uint8Array, filename: string, mime: string, caption?: string): Promise<TgMessage> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([new Uint8Array(data)], { type: mime || "application/octet-stream" }), filename);
    if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: "POST", body: form, signal: ac.signal });
      const out = (await res.json()) as { ok: boolean; result: TgMessage; description?: string };
      if (!out.ok) throw new Error(out.description ?? `Telegram ${res.status}`);
      return out.result;
    } finally { clearTimeout(timer); }
  }
  async send(chatId: number, html: string, buttons?: Button[][]): Promise<TgMessage | null> {
    let last: TgMessage | null = null;
    const parts = splitMessage(html);
    for (let i = 0; i < parts.length; i++) {
      last = await this.call<TgMessage>("sendMessage", { chat_id: chatId, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true, ...(buttons && i === parts.length - 1 ? { reply_markup: { inline_keyboard: buttons } } : {}) });
    }
    return last;
  }
}

// ---------- pièces jointes : photos, PDF, textes envoyés au bot
/** Ce que le modèle de chat sait lire : images, PDF, et les fichiers texte (lus comme du texte). */
export interface Attachment { kind: "image" | "pdf" | "text"; mediaType: string; name: string; data: Uint8Array }
/** Au-delà, on refuse poliment : la Bot API ne sert de toute façon pas plus de 20 Mo. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|ics)$)/;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
/** Le genre d'un fichier d'après son type (ou son extension quand Telegram ne le donne pas). null = illisible pour le modèle. */
export function attachmentKind(mediaType: string | undefined, name = ""): { kind: Attachment["kind"]; mediaType: string } | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", txt: "text/plain", csv: "text/csv", ics: "text/calendar", md: "text/markdown" };
  const mt = (mediaType && mediaType !== "application/octet-stream" ? mediaType : byExt[ext]) ?? "";
  if (mt === "application/pdf") return { kind: "pdf", mediaType: mt };
  if (IMAGE_TYPES.test(mt)) return { kind: "image", mediaType: mt };
  if (TEXT_TYPES.test(mt)) return { kind: "text", mediaType: mt };
  return null;
}
/** La photo à lire : la plus grande qui reste sous 1600 px de large (assez pour lire un texte, sans gaspiller). */
export function pickPhoto(sizes: TgPhoto[]): TgPhoto {
  const sorted = [...sizes].sort((a, b) => a.width - b.width);
  return [...sorted].reverse().find((p) => p.width <= 1600) ?? sorted[0];
}
/** Le message pour le modèle : le texte (ou la légende), puis chaque pièce jointe sous la forme qu'il lit. */
export function attachmentContent(text: string, files: Attachment[], noCaption: string): Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] {
  const parts: Array<{ type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string; filename: string }> = [{ type: "text", text: text.trim() || noCaption }];
  for (const f of files) {
    if (f.kind === "image") parts.push({ type: "file", data: f.data, mediaType: f.mediaType, filename: f.name });
    else if (f.kind === "pdf") parts.push({ type: "file", data: f.data, mediaType: f.mediaType, filename: f.name });
    else parts.push({ type: "text", text: `[${f.name}]\n${clip(new TextDecoder().decode(f.data), 20_000)}` });
  }
  return parts;
}

// ---------- état du canal
interface Conversation { at: number; messages: ModelMessage[] }
const conversations = new Map<number, Conversation>();
const pendings = new Map<string, { at: number; chatId: number; p: Pending }>();
let api: BotApi | null = null;
let running = false;
/** Chaque démarrage (et chaque arrêt) change de génération : une ancienne boucle de lecture s'arrête d'elle-même. */
let generation = 0;
let offset = 0;
let botName: string | null = null;
let lastError: string | null = null;
let lastPollAt: string | null = null;
/** Dernier message reçu d'une personne reliée (ou d'un inconnu) : pour l'Accueil. */
let lastMessageAt: string | null = null;
let lastReminderCheck = 0;
/** Ce que le serveur prête au bot pour agir sur le courrier : brouillon de relance, envoi, ignorer. */
export interface MailDeps {
  followUpDraft(c: Classifier, itemId: number): Promise<{ to: string; subject: string; text: string }>;
  send(c: Classifier, itemId: number, m: { to: string; subject: string; text: string }): Promise<void>;
  ignore(c: Classifier, itemId: number): Promise<void>;
}
/** Ce que le serveur prête au bot pour les documents du Drive : la recherche (filtrée pour un proche) et le fichier lui-même. */
export interface DriveDeps {
  search(c: Classifier, q: DocQuery, viewer?: Viewer): Promise<DocResult[]>;
  get(c: Classifier, accountId: number, fileId: string, viewer?: Viewer): Promise<DocResult | null>;
  file(accountId: number, fileId: string): Promise<{ data: Uint8Array; name: string; mime: string }>;
}
let deps: { classifier: () => Classifier; mail?: MailDeps; drive?: DriveDeps } | null = null;
const stats = { received: 0, sent: 0, chatCalls: 0, inputTokens: 0, outputTokens: 0 };

export function tgState() {
  const db = openDb();
  const { token, source } = tgToken(db);
  const pairing = kvGet<Pairing | null>(db, "tg.pairing", null);
  const livePairing = pairing && new Date(pairing.expires) > new Date() ? pairing : null;
  return { enabled: kvGet(db, "tg.enabled", false), tokenSet: !!token, tokenSource: source, botName, running, lastError, lastPollAt, lastMessageAt, owner: tgOwner(db), contacts: tgContacts(db), pairing: livePairing, schedule: tgSchedule(db), stats: { ...stats }, lastDigest: kvGet<string | null>(db, "tg.lastDigest", null) };
}

// ---------- appairage
export function newPairing(db: Db, kind: "owner" | "contact", key?: string, name?: string): Pairing {
  const p: Pairing = { code: newCode(), expires: new Date(Date.now() + 15 * 60_000).toISOString(), kind, key, name };
  kvSet(db, "tg.pairing", p);
  kvSet(db, "tg.pairingFails", 0);
  kvSet(db, "tg.codeTold", []);
  return p;
}
function consumePairing(db: Db, code: string): Pairing | null {
  const p = kvGet<Pairing | null>(db, "tg.pairing", null);
  if (!p || new Date(p.expires) < new Date()) return null;
  if (p.code !== code) {
    // Chaque mauvais code compte ; au bout de quelques-uns, le code est annulé (on ne devine pas un code par essais).
    const fails = kvGet<number>(db, "tg.pairingFails", 0) + 1;
    kvSet(db, "tg.pairingFails", fails);
    if (fails >= MAX_PAIRING_FAILS) { kvSet(db, "tg.pairing", null); kvSet(db, "tg.pairingFails", 0); }
    return null;
  }
  kvSet(db, "tg.pairingFails", 0);
  kvSet(db, "tg.pairing", null);
  return p;
}

// ---------- ce que le bot dit
/** L'aide, avec les prénoms du contexte pour que les exemples parlent. */
function help(c: Classifier): string {
  const members = householdMembers(c.ctx);
  const kid = members.find((m) => m.kind === "child")?.name ?? t("tg.help.aKid");
  const spouse = tgContacts(c.db)[0]?.name ?? members.find((m) => m.key === "spouse")?.name;
  const line = (id: CommandId) => `/${commandName(id)} · ${t(HELP_KEY[id])}`;
  return [
    `<b>${t("tg.help.title")}</b>`,
    ...(["day", "week", "actions", "toPay", "reply", "tasks", "reminders", "reset"] as CommandId[]).map(line),
    "",
    t("tg.help.examples", { kid: esc(kid), spouse: spouse ? t("tg.help.exampleSpouse", { spouse: esc(spouse) }) : "" }),
  ].join("\n");
}

function listRowsImpl(c: Classifier, filter: string, title: string, limit = 10): string {
  const { where, params } = mailWhere(c, filter, null, "");
  const rows = c.db.prepare(`SELECT i.id, i.from_name, i.from_address, i.subject, i.date, a.source FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${where.join(" AND ")} ORDER BY i.date DESC LIMIT ?`).all(...params, limit) as Array<{ id: number; from_name: string | null; from_address: string; subject: string | null; date: string; source: string }>;
  if (!rows.length) return `<b>${title}</b>\n${t("tg.nothing")}`;
  return [`<b>${title}</b>`, ...rows.map((r) => `• ${esc(r.from_name || r.from_address)} — ${esc(r.subject || t("rem.noSubject"))}${r.source === "whatsapp" ? " <i>WhatsApp</i>" : ""}`)].join("\n");
}

async function sendReminders(c: Classifier, owner: Owner, force = false): Promise<number> {
  const s = await snapshot(c, new Date(), 3);
  const sched = tgSchedule(c.db);
  const due = findReminders(s, force ? new Set() : sentKeys(c.db), { replyAfterDays: sched.replyAfterDays, urgentScore: c.settings.thresholds.urgentScore });
  if (!due.length) return 0;
  const plain = due.filter((r) => !r.followUp).slice(0, 15);
  const followUps = due.filter((r) => r.followUp).slice(0, 5);
  // Chaque rappel est marqué dès que son message est parti : un échec plus loin ne le renvoie pas en double, et ce qui n'est pas parti repartira.
  if (plain.length) {
    await api!.send(owner.chatId, [`<b>${t("tg.reminders")}</b>`, ...plain.map((r) => `• ${r.text}`)].join("\n"));
    stats.sent++;
    markSent(c.db, plain.map((r) => r.key));
  }
  // Chaque relance a son message et ses boutons : « Relancer » prépare un brouillon, « Ignorer » sort le sujet de la file.
  for (const r of followUps) {
    const p: Pending = { id: newPendingId(), kind: "followup", label: r.followUp!.label, itemId: r.followUp!.itemId };
    pendings.set(p.id, { at: Date.now(), chatId: owner.chatId, p });
    await api!.send(owner.chatId, `<b>${t("tg.toFollowUp")}</b>\n${r.text}`, [[{ text: t("tg.btn.followUp"), callback_data: `fu:${p.id}` }, { text: t("tg.btn.ignore"), callback_data: `ig:${p.id}` }]]);
    stats.sent++;
    markSent(c.db, [r.key]);
  }
  return plain.length + followUps.length;
}
let pendingSeq = 0;
const newPendingId = () => `${Date.now().toString(36)}${(++pendingSeq).toString(36)}`;

/** Qui parle : le propriétaire, ou un proche relié. */
type Speaker = { chatId: number; name: string; owner: true } | { chatId: number; name: string; owner: false; contact: Contact };

/** Texte libre : le modèle de chat, avec l'historique récent de cette personne. */
async function freeText(c: Classifier, sp: Speaker, owner: Owner | null, text: string, files: Attachment[] = []): Promise<void> {
  const send = async (html: string, buttons?: Button[][]) => { await api!.send(sp.chatId, html, buttons); stats.sent++; };
  let conv = conversations.get(sp.chatId);
  if (!conv || Date.now() - conv.at > 2 * 3600_000) conv = { at: Date.now(), messages: [] };
  const asked: ModelMessage = { role: "user", content: files.length ? attachmentContent(text, files, t("tg.fileNoCaption")) : text };
  conv.messages.push(asked);
  await api!.call("sendChatAction", { chat_id: sp.chatId, action: "typing" }).catch(() => {});
  // Le propriétaire peut écrire aux proches ; un proche peut écrire au propriétaire et aux autres proches.
  const all = tgContacts(c.db);
  const ownerAsContact: Contact | null = owner ? { key: "me", name: c.ctx.owner.name.split(/\s+/)[0], chatId: owner.chatId } : null;
  const reachable = sp.owner ? all : [...(ownerAsContact ? [ownerAsContact] : []), ...all.filter((x) => x.chatId !== sp.chatId)];
  try {
    const speakerKey = sp.owner ? null : contactMember(sp.contact, householdMembers(c.ctx)) ?? sp.contact.key;
    // Documents : le propriétaire, et un proche seulement si on le lui a permis ; pour lui, sensibles et personnes non suivies sont filtrés.
    const dd = deps?.drive;
    const viewer = sp.owner ? undefined : { sensitive: sp.contact.driveSensitive === true, follows: contactFollows(sp.contact, householdMembers(c.ctx)) };
    const drive = dd && (sp.owner || sp.contact.drive === true) ? { search: (q: DocQuery) => dd.search(c, q, viewer), get: (a: number, f: string) => dd.get(c, a, f, viewer) } : undefined;
    const r = await chat(c, { contacts: reachable, speaker: sp.owner ? undefined : { key: speakerKey!, name: sp.name }, mail: sp.owner, drive }, conv.messages);
    stats.chatCalls++; stats.inputTokens += r.usage.input; stats.outputTokens += r.usage.output;
    // Une image ou un PDF n'est lu qu'une fois : dans l'historique, il devient une mention (sa lecture est dans la réponse).
    // Sinon chaque message suivant renverrait le fichier au modèle, et le paierait à nouveau.
    if (files.length) asked.content = `${text.trim() || t("tg.fileNoCaption")}\n[${files.map((f) => t("tg.fileRead", { name: f.name })).join(", ")}]`;
    conv.messages.push(...r.messages);
    conv.messages = trimConversation(conv.messages, 14);
    conv.at = Date.now();
    conversations.set(sp.chatId, conv);
    const buttons: Button[][] = [];
    // Ce qui partira ou changera s'affiche en clair au-dessus des boutons, quoi qu'ait écrit le modèle.
    const details: string[] = [];
    for (const p of r.pending) {
      pendings.set(p.id, { at: Date.now(), chatId: sp.chatId, p });
      if (p.kind === "batch") {
        // Un lot : la liste complète au-dessus, un seul bouton pour tout créer.
        buttons.push([{ text: t("tg.btn.createAll", { n: p.events.length }), callback_data: `ok:${p.id}` }, { text: t("tg.btn.cancel"), callback_data: `no:${p.id}` }]);
        details.push(p.events.map((e) => `• ${esc(e.label)}`).join("\n"));
        continue;
      }
      const verb = p.kind === "event" ? t("tg.btn.create") : p.kind === "done" ? t("tg.btn.markDone") : t("tg.btn.send");
      buttons.push([{ text: `${verb} · ${clip(p.label, 40)}`, callback_data: `ok:${p.id}` }, { text: t("tg.btn.cancel"), callback_data: `no:${p.id}` }]);
      if (p.kind === "message") details.push(t("tg.pendingMessage", { name: esc(p.contact.name), text: esc(p.text) }));
      else if (p.kind === "done") details.push(esc(p.label));
      else if (p.kind === "file") details.push(t("tg.pendingFile", { name: esc(p.name) }));
    }
    await send([esc(r.text), ...details.map((d) => `<i>${d}</i>`)].join("\n\n"), buttons.length ? buttons : undefined);
    for (const e of r.effects) logActivity(c.db, "telegram", "effect", { who: sp.name, text: e });
    // Un proche a changé quelque chose dans l'app : le propriétaire le sait, sans modèle.
    if (!sp.owner && owner && r.effects.length) { await api!.send(owner.chatId, [t("tg.viaBot", { name: esc(sp.name) }), ...r.effects.map((e) => `• ${esc(e)}`)].join("\n")); stats.sent++; }
  } catch (e) {
    // L'historique a peut-être été refusé tel quel : on repart d'une conversation neuve plutôt que d'échouer à chaque message.
    conversations.delete(sp.chatId);
    await send(t("tg.couldNotAnswer", { error: esc((e as Error).message) }));
  }
}

async function handleOwnerText(c: Classifier, owner: Owner, text: string): Promise<void> {
  const cmd = parseCommand(text);
  const send = async (html: string) => { await api!.send(owner.chatId, html); stats.sent++; };
  if (!cmd) return freeText(c, { chatId: owner.chatId, name: owner.name, owner: true }, owner, text);
  switch (commandId(cmd.cmd)) {
    case "help": return send(help(c));
    case "day": return send(renderDay(await snapshot(c, new Date(), 2)));
    case "week": return send(renderWeek(await snapshot(c, new Date(), 9)));
    case "actions": { const s = await snapshot(c, new Date(), 1); const day = renderDay(s).split("\n").find((l) => l.startsWith(boxHeading())) ?? t("tg.boxNothing", { box: t("day.box") }); return send([day, "", listRowsImpl(c, "important", t("tg.important"), 6), "", listRowsImpl(c, "reply", t("tg.toReply"), 6), "", listRowsImpl(c, "toPay", t("tg.toPay"), 6)].join("\n")); }
    case "toPay": return send(listRowsImpl(c, "toPay", t("tg.toPay")));
    case "reply": return send(listRowsImpl(c, "reply", t("tg.toReply")));
    case "tasks": return send(tasksText(await snapshot(c, new Date(), 1)));
    case "reminders": { const n = await sendReminders(c, owner); return n ? undefined : send(t("tg.nothingToRemind")); }
    case "reset": conversations.delete(owner.chatId); return send(t("tg.forgotten"));
    default: return send(`${t("tg.unknownCommand")}\n\n${help(c)}`);
  }
}

const tasksText = (s: Awaited<ReturnType<typeof snapshot>>): string => (s.tasks.length ? [`<b>${t("tg.tasks")}</b>`, ...s.tasks.map((x) => `• ${esc(x.title)}${x.due ? ` <i>${x.due}</i>` : ""}`)].join("\n") : t("tool.noTasks"));

/** L'aide d'un proche : agenda, tâches, événements, message au propriétaire. Pas la boîte mail. */
function helpContact(c: Classifier, ct: Contact): string {
  const first = esc(c.ctx.owner.name.split(/\s+/)[0]);
  return [
    `<b>${t("tg.helpContact.title", { name: esc(ct.name) })}</b>`,
    `/${commandName("day")} · ${t("tg.helpContact.day")}`,
    `/${commandName("week")} · ${t("tg.help.week")}`,
    `/${commandName("tasks")} · ${t("tg.help.tasks")}`,
    `/${commandName("reset")} · ${t("tg.help.reset")}`,
    "",
    t("tg.helpContact.examples", { owner: first }),
    t("tg.helpContact.noMail", { owner: first }),
  ].join("\n");
}

/** Un proche qui parle au bot : commandes limitées, puis le cerveau sans la boîte mail. Si le proche n'a pas ce droit, relais brut. */
async function handleContactText(c: Classifier, ct: Contact, owner: Owner | null, text: string): Promise<void> {
  const send = async (html: string) => { await api!.send(ct.chatId, html); stats.sent++; };
  if (ct.agent === false) {
    if (owner) { await api!.send(owner.chatId, `<b>${esc(ct.name)}</b> : ${esc(text)}`); stats.sent++; }
    return;
  }
  const cmd = parseCommand(text);
  if (!cmd) return freeText(c, { chatId: ct.chatId, name: ct.name, owner: false, contact: ct }, owner, text);
  switch (commandId(cmd.cmd)) {
    case "help": return send(helpContact(c, ct));
    case "day": return send(renderDay(await snapshot(c, new Date(), 2)).split("\n").filter((l) => !l.startsWith(boxHeading())).join("\n"));
    case "week": return send(renderWeek(await snapshot(c, new Date(), 9), undefined, { mail: false }));
    case "tasks": return send(tasksText(await snapshot(c, new Date(), 1)));
    case "reset": conversations.delete(ct.chatId); return send(t("tg.forgotten"));
    default: return send(`${t("tg.unknownCommand")}\n\n${helpContact(c, ct)}`);
  }
}

async function handleCallback(c: Classifier, owner: Owner | null, q: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const [verb, id] = (q.data ?? "").split(":");
  const entry = pendings.get(id);
  const ack = (text: string) => api!.call("answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => {});
  const edit = async (suffix: string) => {
    if (!q.message) return;
    const text = (q.message.text ?? "") + "\n\n" + suffix;
    await api!.call("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: esc(text.replace(/\n\n$/, "")), parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }).catch(() => {});
  };
  if (!entry || entry.chatId !== q.from.id) { await ack(t("tg.expired")); await edit(t("tg.expiredSuffix")); return; }
  pendings.delete(id);
  // Relance : « Ignorer » sort le sujet de la file ; « Relancer » rédige un brouillon dans le ton des échanges, à confirmer.
  if (entry.p.kind === "proposal") {
    const p = entry.p;
    const name = tgContacts(c.db).find((x) => x.chatId === q.from.id)?.name ?? (owner && q.from.id === owner.chatId ? c.ctx.owner.name.split(/\s+/)[0] : q.from.first_name ?? "");
    const relay = async (text: string) => { if (owner && q.from.id !== owner.chatId) { await api!.send(owner.chatId, `${t("tg.viaBot", { name: esc(name) })}\n• ${esc(text)}`); stats.sent++; } };
    try {
      if (verb === "ig") {
        c.db.prepare("UPDATE decisions SET action_state = 2 WHERE item_id = ?").run(p.itemId);
        await ack(t("rel.ignored")); await edit(t("rel.ignoredSuffix"));
        await relay(t("rel.relayIgnored", { label: p.label }));
      } else if (p.task) {
        const member = contactMember(tgContacts(c.db).find((x) => x.chatId === q.from.id) ?? { key: "", name, chatId: q.from.id }, householdMembers(c.ctx)) ?? "me";
        c.db.prepare("INSERT INTO tasks (title, due, for_member, source, source_item_id, created_by) VALUES (?, ?, ?, 'telegram', ?, ?)").run(p.task.title, p.task.due, p.forKeys[0] ?? "family", p.itemId, member);
        c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(p.itemId);
        await ack(t("rel.taskAdded")); await edit(t("rel.taskAddedSuffix"));
        logActivity(c.db, "telegram", "effect", { who: name, text: t("tool.taskAdded", { title: p.task.title, who: p.forKeys.join(", ") }) });
        await relay(t("rel.relayTask", { label: p.label }));
      } else if (p.event && p.update) {
        if (!(await applyUpdate(c, p.itemId, p.event))) throw new Error(t("err.noEventToUpdate"));
        await ack(t("tg.eventUpdated")); await edit(t("tg.eventUpdatedLabel", { label: p.label }));
        logActivity(c.db, "telegram", "effect", { who: name, text: t("tg.eventUpdatedRelay", { label: p.label }) });
        await relay(t("tg.eventUpdatedRelay", { label: p.label }));
      } else if (p.event) {
        const members = householdMembers(c.ctx);
        const ct = tgContacts(c.db).find((x) => x.chatId === q.from.id);
        const me = ct ? contactMember(ct, members) : "me";
        // Qui sera là : la personne qui ajoute, si c'est un adulte du foyer ; sinon à préciser dans l'agenda.
        const present = me && members.find((m) => m.key === me)?.kind === "adult" ? [me] : [];
        await createPendingEvent(c, { id: p.id, kind: "event", label: p.label, draft: p.event, forKeys: p.forKeys.length ? p.forKeys : ["family"], present, createdBy: me ?? ct?.key ?? "me" });
        c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(p.itemId);
        const calendar = t("cal.familyName");
        await ack(t("tg.eventCreated", { calendar })); await edit(t("tg.eventCreatedLabel", { label: p.label, calendar }));
        logActivity(c.db, "telegram", "eventCreated", { who: name, label: p.label });
        await relay(t("tg.eventCreatedRelay", { label: p.label }));
      }
    } catch (e) { await ack(t("tg.failed")); await edit(t("tg.failedLabel", { label: p.label, error: (e as Error).message })); }
    return;
  }
  if (entry.p.kind === "followup") {
    const isOwner = !!owner && q.from.id === owner.chatId;
    if (!isOwner || !deps?.mail) { await ack(t("tg.ownerOnly")); return; }
    if (verb === "ig") {
      try { await deps.mail.ignore(c, entry.p.itemId); await ack(t("tg.ignored")); await edit(t("tg.ignoredSuffix")); }
      catch (e) { await ack(t("tg.failed")); await edit(`✗ ${(e as Error).message}`); }
      return;
    }
    if (verb !== "fu") { await ack(t("tg.abandoned")); await edit(t("tg.abandonedSuffix")); return; }
    await ack(t("tg.drafting"));
    await edit(t("tg.draftingSuffix"));
    try {
      const d = await deps.mail.followUpDraft(c, entry.p.itemId);
      const next: Pending = { id: newPendingId(), kind: "mail", label: entry.p.label, itemId: entry.p.itemId, to: d.to, subject: d.subject, text: d.text };
      pendings.set(next.id, { at: Date.now(), chatId: q.from.id, p: next });
      await api!.send(q.from.id, t("tg.followUpDraft", { to: esc(d.to), subject: esc(d.subject), text: esc(d.text) }), [[{ text: t("tg.btn.send"), callback_data: `ok:${next.id}` }, { text: t("tg.btn.cancel"), callback_data: `no:${next.id}` }]]);
      stats.sent++;
    } catch (e) { await api!.send(q.from.id, t("tg.couldNotDraft", { error: esc((e as Error).message) })); stats.sent++; }
    return;
  }
  if (verb !== "ok") { await ack(t("tg.abandoned")); await edit(t("tg.abandonedLabel", { label: entry.p.label })); return; }
  const speakerName = owner && q.from.id === owner.chatId ? c.ctx.owner.name.split(/\s+/)[0] : (tgContacts(c.db).find((x) => x.chatId === q.from.id)?.name ?? q.from.first_name ?? "");
  try {
    if (entry.p.kind === "mail") {
      if (!owner || q.from.id !== owner.chatId || !deps?.mail) { await ack(t("tg.ownerOnly")); return; }
      await deps.mail.send(c, entry.p.itemId, { to: entry.p.to, subject: entry.p.subject, text: entry.p.text });
      logActivity(c.db, "telegram", "followUpSent", { to: entry.p.to }, entry.p.itemId);
      await ack(t("tg.sentTo", { to: entry.p.to }));
      await edit(t("tg.followUpSent", { to: entry.p.to }));
    } else if (entry.p.kind === "event") {
      const r = await createPendingEvent(c, entry.p);
      logActivity(c.db, "telegram", "eventCreated", { who: speakerName, label: entry.p.label });
      const calendar = t("cal.familyName");
      await ack(t("tg.eventCreated", { calendar }));
      await edit(t("tg.eventCreatedLabel", { label: entry.p.label, calendar }));
      await api!.send(q.from.id, `<a href="${esc(r.link)}">${t("tg.openCalendar")}</a>`);
      if (owner && q.from.id !== owner.chatId) { await api!.send(owner.chatId, `${t("tg.viaBot", { name: esc(speakerName) })}\n${t("tg.eventCreatedRelay", { label: esc(entry.p.label) })}`); stats.sent++; }
    } else if (entry.p.kind === "batch") {
      // Chaque événement est créé ; un échec n'empêche pas les suivants, et la réponse dit lesquels manquent.
      const calendar = t("cal.familyName");
      const ok: string[] = [], failed: string[] = [];
      await ack(t("tg.creating"));
      for (const ev of entry.p.events) {
        try { await createPendingEvent(c, ev); ok.push(ev.label); logActivity(c.db, "telegram", "eventCreated", { who: speakerName, label: ev.label }); }
        catch (e) { console.log(`[telegram] échec création « ${ev.label} » (début ${ev.draft.start}, fin ${ev.draft.end}, journée ${ev.draft.allDay}) : ${(e as Error).message}`); failed.push(`${ev.label} (${(e as Error).message.slice(0, 120)})`); }
      }
      const n = entry.p.events.length;
      await edit(failed.length ? t("tg.batchPartial", { ok: ok.length, n, calendar, failed: failed.join(" ; ") }) : t("tg.batchCreated", { n, calendar }));
      if (ok.length && owner && q.from.id !== owner.chatId) { await api!.send(owner.chatId, `${t("tg.viaBot", { name: esc(speakerName) })}\n${esc(t("tg.batchRelay", { n: ok.length, labels: ok.join(" ; ") }))}`); stats.sent++; }
    } else if (entry.p.kind === "done") {
      const r = c.db.prepare("UPDATE tasks SET done_at = ? WHERE id = ? AND done_at IS NULL").run(new Date().toISOString(), entry.p.taskId);
      if (!r.changes) { await ack(t("tool.taskUnknown")); await edit(t("tool.taskUnknown")); return; }
      logActivity(c.db, "telegram", "taskDone", { who: speakerName, title: entry.p.title });
      await ack(t("tg.taskMarkedDone", { title: entry.p.title }));
      await edit(t("tg.taskMarkedDone", { title: entry.p.title }));
      if (owner && q.from.id !== owner.chatId) { await api!.send(owner.chatId, `${t("tg.viaBot", { name: esc(speakerName) })}\n• ${esc(t("tool.taskDone", { title: entry.p.title }))}`); stats.sent++; }
    } else if (entry.p.kind === "file") {
      // Le droit est relu au moment d'envoyer : un proche à qui on l'a retiré entre-temps ne reçoit rien.
      const p = entry.p;
      const ct = tgContacts(c.db).find((x) => x.chatId === q.from.id);
      const isOwner = !!owner && q.from.id === owner.chatId;
      if (!deps?.drive || (!isOwner && ct?.drive !== true)) { await ack(t("tg.noDriveRight")); await edit(t("tg.noDriveRight")); return; }
      const viewer = isOwner ? undefined : { sensitive: ct?.driveSensitive === true, follows: ct ? contactFollows(ct, householdMembers(c.ctx)) : [] };
      if (!(await deps.drive.get(c, p.accountId, p.fileId, viewer))) { await ack(t("tg.noDriveRight")); await edit(t("tg.noDriveRight")); return; }
      await ack(t("tg.sendingFile"));
      const f = await deps.drive.file(p.accountId, p.fileId);
      await api!.sendDocument(q.from.id, f.data, f.name, f.mime);
      stats.sent++;
      logActivity(c.db, "telegram", "documentSent", { who: speakerName, name: f.name });
      await edit(t("tg.fileSent", { name: f.name }));
      if (owner && !isOwner) { await api!.send(owner.chatId, `${t("tg.viaBot", { name: esc(speakerName) })}\n• ${esc(t("tg.fileSentRelay", { name: f.name }))}`); stats.sent++; }
    } else {
      await api!.send(entry.p.contact.chatId, `<b>${esc(speakerName)}</b> : ${esc(entry.p.text)}`);
      stats.sent++;
      logActivity(c.db, "telegram", "messageSent", { who: speakerName, to: entry.p.contact.name });
      await ack(t("tg.sentTo", { to: entry.p.contact.name }));
      await edit(t("tg.sentToSuffix", { name: entry.p.contact.name }));
    }
  } catch (e) {
    await ack(t("tg.failed"));
    await edit(t("tg.failedLabel", { label: entry.p.label, error: (e as Error).message }));
  }
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  const c = deps!.classifier();
  const db = c.db;
  const owner = tgOwner(db);
  const contacts = tgContacts(db);
  if (u.callback_query) {
    stats.received++;
    const known = (owner && u.callback_query.from.id === owner.chatId) || contacts.some((x) => x.chatId === u.callback_query!.from.id);
    if (known) await handleCallback(c, owner, u.callback_query);
    else await api!.call("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => {});
    return;
  }
  const m = u.message;
  if (!m || m.chat.type !== "private") return;
  if (!m.text && (m.photo?.length || m.document)) { await handleFile(c, owner, contacts, m); return; }
  if (!m.text) return;
  stats.received++;
  lastMessageAt = new Date().toISOString();
  const from = m.from!;
  const cmd = parseCommand(m.text);
  // Appairage : « /start 123456 » avec le code affiché dans l'app.
  if (cmd?.cmd === "start" && cmd.arg) {
    const p = consumePairing(db, cmd.arg);
    if (!p) {
      // Une seule réponse par conversation : un inconnu qui essaie des codes n'obtient plus rien ensuite.
      const told = kvGet<number[]>(db, "tg.codeTold", []);
      if (!told.includes(m.chat.id)) { kvSet(db, "tg.codeTold", [...told, m.chat.id].slice(-50)); await api!.send(m.chat.id, t("tg.codeUnknown")); }
      return;
    }
    if (p.kind === "owner") {
      kvSet(db, "tg.owner", { chatId: m.chat.id, name: from.first_name ?? "", pairedAt: new Date().toISOString() } satisfies Owner);
      logActivity(db, "telegram", "paired", { name: from.first_name ?? "" });
      await api!.send(m.chat.id, `${t("tg.paired")}\n\n${help(c)}`);
    } else {
      const others = contacts.filter((x) => x.chatId !== m.chat.id && x.key !== p.key);
      const isMember = !!p.key && householdMembers(c.ctx).some((x) => x.key === p.key && x.key !== "family");
      const ct: Contact = { key: p.key ?? `contact:${m.chat.id}`, name: p.name || from.first_name || t("tg.contactDefault"), chatId: m.chat.id, weekDigest: false, agent: true, ...(isMember ? { member: p.key } : {}) };
      kvSet(db, "tg.contacts", [...others, ct]);
      logActivity(db, "telegram", "contactPaired", { name: ct.name });
      await api!.send(m.chat.id, `${t("tg.hello", { name: esc(ct.name) })} ${helpContact(c, ct)}`);
      if (owner) await api!.send(owner.chatId, t("tg.contactPaired", { name: esc(ct.name) }));
    }
    return;
  }
  if (owner && m.chat.id === owner.chatId) { await handleOwnerText(c, owner, m.text); return; }
  const ct = contacts.find((x) => x.chatId === m.chat.id);
  if (ct) { await handleContactText(c, ct, owner, m.text); return; }
  // Inconnu : une seule réponse, puis silence.
  const warned = kvGet<number[]>(db, "tg.warned", []);
  if (!warned.includes(m.chat.id)) { kvSet(db, "tg.warned", [...warned, m.chat.id].slice(-50)); await api!.send(m.chat.id, t("tg.private")); }
}

/** Albums : Telegram envoie chaque photo à part (même media_group_id) ; on les lit ensemble, en un seul échange. */
const albums = new Map<string, { messages: TgMessage[]; timer: NodeJS.Timeout }>();
async function handleFile(c: Classifier, owner: Owner | null, contacts: Contact[], m: TgMessage): Promise<void> {
  stats.received++;
  lastMessageAt = new Date().toISOString();
  const isOwner = !!owner && m.chat.id === owner.chatId;
  const ct = contacts.find((x) => x.chatId === m.chat.id);
  if (!isOwner && !ct) return; // inconnu : rien, pas même une réponse
  // Un proche sans le droit de parler au bot : son fichier est relayé tel quel au propriétaire.
  if (ct && ct.agent === false) {
    if (owner) { await api!.send(owner.chatId, `<b>${esc(ct.name)}</b> :`); await api!.call("copyMessage", { chat_id: owner.chatId, from_chat_id: m.chat.id, message_id: m.message_id }).catch(() => {}); stats.sent++; }
    return;
  }
  if (m.media_group_id) {
    const g = albums.get(m.media_group_id);
    if (g) { g.messages.push(m); return; }
    const entry = { messages: [m], timer: setTimeout(() => { albums.delete(m.media_group_id!); void readFiles(deps!.classifier(), owner, ct ?? null, entry.messages); }, 1500) };
    albums.set(m.media_group_id, entry);
    return;
  }
  await readFiles(c, owner, ct ?? null, [m]);
}
async function readFiles(c: Classifier, owner: Owner | null, ct: Contact | null, messages: TgMessage[]): Promise<void> {
  const chatId = messages[0].chat.id;
  const files: Attachment[] = [];
  const refused: string[] = [];
  for (const m of messages) {
    const photo = m.photo?.length ? pickPhoto(m.photo) : null;
    const doc = m.document;
    const name = doc?.file_name || (photo ? `photo-${m.message_id}.jpg` : `fichier-${m.message_id}`);
    const kind = photo ? { kind: "image" as const, mediaType: "image/jpeg" } : attachmentKind(doc?.mime_type, name);
    const size = photo?.file_size ?? doc?.file_size ?? 0;
    if (!kind) { refused.push(t("tg.fileUnsupported", { name: esc(name) })); continue; }
    if (size > MAX_FILE_BYTES) { refused.push(t("tg.fileTooBig", { name: esc(name), mb: Math.round(MAX_FILE_BYTES / 1024 / 1024) })); continue; }
    try { files.push({ ...kind, name, data: await api!.download((photo ?? doc)!.file_id) }); }
    catch (e) { refused.push(t("tg.fileFailed", { name: esc(name), error: esc((e as Error).message) })); }
  }
  if (refused.length) { await api!.send(chatId, refused.join("\n")); stats.sent++; }
  if (!files.length) return;
  const caption = messages.map((m) => m.caption ?? "").filter(Boolean).join("\n");
  if (ct) await freeText(c, { chatId, name: ct.name, owner: false, contact: ct }, owner, caption, files);
  else await freeText(c, { chatId, name: owner!.name, owner: true }, owner, caption, files);
}

// ---------- boucle de lecture et envois programmés
async function pollLoop(gen: number, bot: BotApi): Promise<void> {
  const db = openDb();
  offset = kvGet<number>(db, "tg.offset", offset);
  const alive = () => running && gen === generation;
  while (alive()) {
    try {
      const updates = await bot.call<TgUpdate[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] }, 65_000);
      // Arrêté ou redémarré pendant l'attente : ce lot appartient à la nouvelle boucle, qui le relira.
      if (!alive()) return;
      lastPollAt = new Date().toISOString();
      lastError = null;
      for (const u of updates) {
        offset = u.update_id + 1;
        // Enregistré avant le traitement : après un plantage, Telegram ne rejoue pas ce message (pas de double réponse ni de double coût).
        kvSet(db, "tg.offset", offset);
        try { await handleUpdate(u); } catch (e) { lastError = (e as Error).message; console.error("[telegram]", lastError); }
      }
    } catch (e) {
      const err = e as Error & { code?: number; name?: string };
      if (err.name === "AbortError") continue;
      lastError = err.code === 409 ? t("tg.conflict409") : err.message;
      await new Promise((r) => setTimeout(r, err.code === 409 ? 15_000 : 5_000));
    }
  }
}

async function tick(): Promise<void> {
  if (!running || !api || !deps) return;
  const c = deps.classifier();
  const owner = tgOwner(c.db);
  if (!owner) return;
  const now = new Date();
  const { ymd: today, hm: nowHM, dow } = zonedNow(now, c.ctx.owner.timezone);
  const sched = tgSchedule(c.db);
  const sent = sentKeys(c.db);
  try {
    // Marqué seulement une fois parti : une coupure à l'heure dite laisse une nouvelle chance dans l'heure.
    if (isDue(nowHM, sched.morning) && !sent.has(`morning:${today}`)) {
      await api.send(owner.chatId, renderDay(await snapshot(c, now, 2)));
      markSent(c.db, [`morning:${today}`]);
      stats.sent++; kvSet(c.db, "tg.lastDigest", now.toISOString());
      logActivity(c.db, "telegram", "morning");
    }
    if (dow === 0 && isDue(nowHM, sched.weekly) && !sent.has(`weekly:${today}`)) {
      const s = await snapshot(c, now, 9);
      await api.send(owner.chatId, renderWeek(s));
      markSent(c.db, [`weekly:${today}`]);
      stats.sent++;
      kvSet(c.db, "tg.lastDigest", now.toISOString());
      logActivity(c.db, "telegram", "weekly", { contacts: [] });
    }
    if (sched.reminders && !inQuietHours(nowHM, sched.quietFrom, sched.quietTo) && Date.now() - lastReminderCheck >= sched.everyMinutes * 60_000) {
      lastReminderCheck = Date.now();
      const n = await sendReminders(c, owner);
      if (n) logActivity(c.db, "telegram", "reminders", { n });
    }
    // Alerte de connexion (nouvelle connexion, mot de passe modifié) : utile sur le moment seulement. Envoyée dès que
    // Molinova la voit, tant qu'elle a moins de 30 min, jamais après ; au propriétaire seul, expéditeur et objet seulement.
    // Les codes à usage unique ne passent jamais par Telegram.
    if (sched.reminders && !inQuietHours(nowHM, sched.quietFrom, sched.quietTo)) {
      for (const a of freshSigninAlerts(c.db, now).filter((x) => !sent.has(`signin:${x.id}`)).slice(0, 5)) {
        const ago = Math.max(1, Math.round((now.getTime() - Date.parse(a.date)) / 60_000));
        await api.send(owner.chatId, t("tg.signinAlert", { from: esc(a.from), subject: esc(a.subject || t("rem.noSubject")), n: ago, minutes: EPHEMERAL_MINUTES }));
        markSent(c.db, [`signin:${a.id}`]);
        stats.sent++;
      }
    }
  } catch (e) { lastError = (e as Error).message; console.error("[telegram]", lastError); }
  try { await contactsPass(c, now, sched, { today, nowHM, dow }); } catch (e) { lastError = (e as Error).message; console.error("[telegram] proches :", lastError); }
  // Les confirmations en attente expirent au bout d'un jour.
  for (const [id, e] of pendings) if (Date.now() - e.at > 86_400_000) pendings.delete(id);
}

// ---------- envois aux proches : chacun le sien, selon ce qu'il suit et ce qu'il a activé
let lastContactsCheck = 0;
interface Seen { events: string[]; items: number[] }
async function contactsPass(c: Classifier, now: Date, sched: TgSchedule, at: { today: string; nowHM: string; dow: number }): Promise<void> {
  const contacts = tgContacts(c.db).filter((x) => x.sends?.morning || x.sends?.reminders || x.sends?.live || x.weekDigest);
  if (!contacts.length || !api) return;
  const members = householdMembers(c.ctx);
  const sent = sentKeys(c.db);
  const wantMorning = isDue(at.nowHM, sched.morning) ? contacts.filter((x) => x.sends?.morning && !sent.has(contactKey(x, `morning:${at.today}`))) : [];
  const wantWeek = at.dow === 0 && isDue(at.nowHM, sched.weekly) ? contacts.filter((x) => x.weekDigest && !sent.has(contactKey(x, `weekly:${at.today}`))) : [];
  // Rappels et nouveautés : toutes les quelques minutes, jamais pendant les heures calmes.
  const periodic = !inQuietHours(at.nowHM, sched.quietFrom, sched.quietTo) && Date.now() - lastContactsCheck >= Math.min(15, sched.everyMinutes) * 60_000;
  if (!wantMorning.length && !wantWeek.length && !periodic) return;
  if (periodic) lastContactsCheck = Date.now();
  // Un seul instantané pour tous les proches : l'agenda n'est lu qu'une fois.
  const s = await snapshot(c, now, 15);
  const send = async (ct: Contact, html: string, buttons?: Button[][]) => { await api!.send(ct.chatId, html, buttons); stats.sent++; };
  for (const ct of wantMorning) { await send(ct, renderDay(forContact(s, ct, members))); markSent(c.db, [contactKey(ct, `morning:${at.today}`)]); }
  for (const ct of wantWeek) { await send(ct, renderWeek(forContact(s, ct, members), undefined, { mail: false })); markSent(c.db, [contactKey(ct, `weekly:${at.today}`)]); }
  if (wantWeek.length) logActivity(c.db, "telegram", "weekly", { contacts: wantWeek.map((x) => x.name) });
  if (!periodic) return;
  let notified = 0;
  for (const ct of contacts) {
    if (ct.sends?.reminders) {
      const due = contactReminders(s, ct, members, sent);
      if (due.length) { await send(ct, [`<b>${t("tg.reminders")}</b>`, ...due.map((r) => `• ${r.text}`)].join("\n")); markSent(c.db, due.map((r) => r.key)); notified += due.length; }
    }
    if (ct.sends?.live) notified += await liveFor(c, ct, s, send);
  }
  if (notified) logActivity(c.db, "telegram", "relatives", { n: notified });
}
/**
 * Au fil de l'eau : les nouveaux événements qui le concernent, et les propositions « à caler » pour ceux qu'il suit,
 * avec les boutons pour les ajouter. La première fois, tout ce qui existe est noté comme vu, sans rien envoyer.
 */
async function liveFor(c: Classifier, ct: Contact, s: Awaited<ReturnType<typeof snapshot>>, send: (ct: Contact, html: string, buttons?: Button[][]) => Promise<void>): Promise<number> {
  const members = householdMembers(c.ctx);
  const follows = contactFollows(ct, members);
  const key = `tg.ct.seen:${ct.chatId}`;
  const seen = kvGet<Seen | null>(c.db, key, null);
  const events = newEvents(s, ct, members, new Set(seen?.events ?? []));
  const rows = c.db.prepare(`SELECT i.id, i.from_name, i.from_address, i.subject, a.source, d.answers_json FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id WHERE ${toCalWhere} ORDER BY i.date DESC LIMIT 50`).all() as Array<{ id: number; from_name: string | null; from_address: string; subject: string | null; source: string; answers_json: string | null }>;
  const mine = rows.map((r) => ({ r, who: suggestedFor(c.db, r) })).filter((x) => x.who.some((k) => follows.includes(k)));
  const allIds = Object.values(s.days).flat().map((e) => e.id).filter((x): x is string => !!x);
  if (!seen) { kvSet(c.db, key, { events: allIds, items: mine.map((x) => x.r.id) } satisfies Seen); return 0; }
  let n = 0;
  if (events.length) { await send(ct, [`<b>${t("rel.newEvents")}</b>`, ...events.map((e) => `• ${eventText(e)}`)].join("\n")); n += events.length; }
  const items = new Set(seen.items);
  for (const { r, who } of mine) {
    if (items.has(r.id)) continue;
    items.add(r.id);
    const p = cachedProposal(c.db, r.id);
    if (!p || p.kind === "invitation" || !p.found) continue;
    const forNames = who.map((k) => members.find((m) => m.key === k)?.name ?? k).join(", ");
    const from = r.source === "whatsapp" ? t("rel.fromWhatsApp", { chat: esc(r.from_name || r.from_address) }) : t("rel.fromEmail", { who: esc(r.from_name || r.from_address), subject: esc(r.subject || "") });
    // Le message reprend un événement déjà dans l'agenda sans rien y changer : rien à proposer.
    const upd = p.kind === "draft" && p.update ? p.update : null;
    if (upd && !changedFields(upd, p as Extract<typeof p, { kind: "draft" }>).length) continue;
    const pending: Pending = p.kind === "task"
      ? { id: newPendingId(), kind: "proposal", label: p.title, itemId: r.id, forKeys: who, task: { title: p.title, due: p.due || null } }
      : { id: newPendingId(), kind: "proposal", label: p.title, itemId: r.id, forKeys: who, event: { title: p.title, start: p.start, end: p.end, allDay: p.allDay, timezone: p.timezone || c.ctx.owner.timezone, location: p.location, description: p.description }, ...(upd ? { update: true } : {}) };
    pendings.set(pending.id, { at: Date.now(), chatId: ct.chatId, p: pending });
    const what = p.kind === "task"
      ? t("rel.proposalTask", { who: esc(forNames), title: esc(p.title), due: p.due ? ` · ${p.due}` : "" })
      : upd
        ? t("rel.proposalUpdate", { title: esc(upd.title), event: eventText({ time: p.allDay ? "" : p.start.slice(11, 16), title: p.title, who: [], start: p.start, location: p.location }), change: upd.change ? `\n${esc(upd.change)}` : "" })
        : t("rel.proposalEvent", { who: esc(forNames), event: eventText({ time: p.allDay ? "" : p.start.slice(11, 16), title: p.title, who: [], start: p.start, location: p.location }) });
    await send(ct, `${what}\n<i>${from}</i>`, [[{ text: p.kind === "task" ? t("rel.btn.addTask") : upd ? t("rel.btn.update") : t("rel.btn.add"), callback_data: `ok:${pending.id}` }, { text: upd ? t("rel.btn.ignoreChange") : t("rel.btn.notForUs"), callback_data: `ig:${pending.id}` }]]);
    n++;
  }
  kvSet(c.db, key, { events: [...new Set([...(seen.events ?? []), ...allIds])].slice(-500), items: [...items].slice(-500) } satisfies Seen);
  return n;
}

let tickTimer: NodeJS.Timeout | null = null;
export async function startTelegram(d: { classifier: () => Classifier; mail?: MailDeps; drive?: DriveDeps }): Promise<void> {
  deps = d;
  const db = openDb();
  const { token } = tgToken(db);
  if (!token || !kvGet(db, "tg.enabled", false) || running) return;
  api = new BotApi(token);
  try { botName = (await api.call<TgUser>("getMe")).username ?? null; lastError = null; }
  catch (e) { lastError = t("tg.tokenRefused", { error: (e as Error).message }); api = null; return; }
  running = true;
  const gen = ++generation;
  await refreshCommands().catch(() => {});
  void pollLoop(gen, api);
  tickTimer = setInterval(() => void tick(), 60_000);
}
/** Le menu de commandes du bot (Telegram le montre sous le champ de saisie), dans la langue de l'app. Sans effet si le bot ne tourne pas. */
export async function refreshCommands(lang: Language = currentLanguage()): Promise<void> {
  if (!api) return;
  const commands = COMMANDS.map((x) => ({ command: x.names[lang], description: t(HELP_KEY[x.id], undefined, lang).slice(0, 256) }));
  await api.call("setMyCommands", { commands });
}
export function stopTelegram(): void {
  running = false;
  generation++;
  api = null;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
/** Vérifie un jeton sans rien démarrer : le nom du bot, ou une erreur claire. */
export async function checkToken(token: string): Promise<string> {
  const u = await new BotApi(token).call<TgUser>("getMe");
  return u.username ?? String(u.id);
}
/** Depuis l'app : envoyer maintenant un résumé ou les rappels, pour voir. */
export async function sendNow(kind: "day" | "week" | "reminders" | "help"): Promise<{ sent: number }> {
  if (!api || !deps) throw new Error(t("tg.notStarted"));
  const c = deps.classifier();
  const owner = tgOwner(c.db);
  if (!owner) throw new Error(t("tg.noOwner"));
  if (kind === "reminders") return { sent: await sendReminders(c, owner, true) };
  const html = kind === "day" ? renderDay(await snapshot(c, new Date(), 2)) : kind === "week" ? renderWeek(await snapshot(c, new Date(), 9)) : help(c);
  await api.send(owner.chatId, html); stats.sent++;
  return { sent: 1 };
}
