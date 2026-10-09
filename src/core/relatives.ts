/**
 * Les proches reliés au bot Telegram : ce qui les concerne, et ce que Molinova leur envoie de lui-même.
 *
 * Un proche est rattaché à un membre du foyer (ou à personne : une grand-mère), suit des couloirs (ses événements,
 * ceux d'un enfant, toute la famille) et, en plus, des agendas Google précis. Quatre envois, chacun activable :
 * le résumé du matin, les rappels avant ses événements, ce qui le concerne au fil de l'eau (nouvel événement,
 * proposition venue de WhatsApp ou d'un email, avec l'expéditeur et l'objet, jamais le corps), la semaine le dimanche.
 *
 * Tout ici est pur ou ne lit que la base : les envois eux-mêmes sont dans channels/telegram.ts.
 */
import type { Db } from "../db.js";
import type { Member } from "./agenda.js";
import { addDays, ymd } from "./agenda.js";
import type { Contact, DayEvent, Reminder, Snapshot, TaskRow } from "./brain.js";
import { esc } from "./brain.js";
import { domainOf } from "./text.js";
import { fmtDayShort, t, type Language, currentLanguage } from "../i18n/index.js";

/** Le membre du foyer qu'est ce proche : choisi, sinon sa clé d'invitation quand c'en est une (« spouse »). */
export function contactMember(ct: Contact, members: Member[]): string | null {
  if (ct.member && members.some((m) => m.key === ct.member)) return ct.member;
  return members.some((m) => m.key === ct.key && m.key !== "family") ? ct.key : null;
}
/** Les couloirs qu'il suit : choisis, sinon les siens et ceux de toute la famille. */
export function contactFollows(ct: Contact, members: Member[]): string[] {
  if (ct.follows) return ct.follows.filter((k) => members.some((m) => m.key === k));
  const me = contactMember(ct, members);
  return me ? [me, "family"] : ["family"];
}

/** Un événement concerne ce proche : un agenda qu'il suit, ou un membre qu'il suit concerné ou présent. */
export function eventConcerns(e: DayEvent, ct: Contact, members: Member[]): boolean {
  if (e.calendarId && ct.calendars?.includes(e.calendarId)) return true;
  const follows = contactFollows(ct, members);
  return [...(e.whoKeys ?? []), ...(e.presentKeys ?? [])].some((k) => follows.includes(k));
}
const taskConcerns = (x: TaskRow, ct: Contact, members: Member[]): boolean => contactFollows(ct, members).includes(x.for_member ?? "family");

/** Le même instantané, réduit à ce qui concerne ce proche : ses événements, ses tâches, et rien de la boîte mail. */
export function forContact(s: Snapshot, ct: Contact, members: Member[]): Snapshot {
  const days: Snapshot["days"] = {};
  for (const [d, ev] of Object.entries(s.days)) { const mine = ev.filter((e) => eventConcerns(e, ct, members)); if (mine.length) days[d] = mine; }
  return { ...s, days, tasks: s.tasks.filter((x) => taskConcerns(x, ct, members)), queue: [], toCal: [] };
}

/** Clé d'envoi propre à un proche : un même rappel part une fois pour lui, sans gêner celui du propriétaire. */
export const contactKey = (ct: Contact, key: string): string => `ct:${ct.chatId}:${key}`;

/**
 * Les rappels d'un proche : ses événements qui commencent dans l'heure (s'il doit y être, ou si c'est un couloir
 * qu'il suit), ses tâches pour demain et celles en retard. Pure.
 */
export function contactReminders(s: Snapshot, ct: Contact, members: Member[], sent: Set<string>, opts: { leadMinutes?: number } = {}, lang: Language = currentLanguage()): Reminder[] {
  const out: Reminder[] = [];
  const lead = (opts.leadMinutes ?? 60) * 60_000;
  const now = s.now.getTime();
  const today = ymd(s.now), tomorrow = ymd(addDays(s.now, 1));
  const push = (key: string, text: string) => { const k = contactKey(ct, key); if (!sent.has(k)) out.push({ key: k, text }); };
  for (const e of s.days[today] ?? []) {
    if (!e.time || !e.start || !eventConcerns(e, ct, members)) continue;
    const at = new Date(e.start).getTime();
    if (at > now && at - now <= lead) push(`ev:${e.id ?? e.title}:${e.start}`, t("rel.eventSoon", { time: e.time, title: esc(e.title), location: e.location ? ` · ${esc(e.location)}` : "" }, lang));
  }
  for (const x of s.tasks) {
    if (!x.due || !taskConcerns(x, ct, members)) continue;
    if (x.due === tomorrow) push(`task-tomorrow:${x.id}`, t("rem.tomorrow", { title: esc(x.title) }, lang));
    else if (x.due < today) push(`task-late:${x.id}`, t("rem.late", { date: fmtDayShort(x.due, { lang }), title: esc(x.title) }, lang));
  }
  return out;
}

/** Les événements qu'il n'a pas encore vus (par identifiant), dans l'ordre. `seen` = ce qui lui a déjà été montré. */
export function newEvents(s: Snapshot, ct: Contact, members: Member[], seen: Set<string>): DayEvent[] {
  return Object.keys(s.days).sort().flatMap((d) => s.days[d]).filter((e) => e.id && !seen.has(e.id) && eventConcerns(e, ct, members));
}
/** Une ligne d'événement pour un message à un proche : jour, heure, titre, lieu. */
export function eventText(e: DayEvent, lang: Language = currentLanguage()): string {
  const day = e.start ? fmtDayShort(e.start.slice(0, 10), { lang }) : "";
  return `${day}${e.time ? ` <b>${e.time}</b>` : ""} · ${esc(e.title)}${e.location ? ` · <i>${esc(e.location)}</i>` : ""}`;
}

/**
 * Pour qui est un élément « à caler » (email ou fenêtre WhatsApp) : la règle « toujours X pour ce domaine / ce groupe »,
 * sinon l'enfant repéré par Jev (à plus de 50 %), sinon le membre choisi pour ce groupe WhatsApp. Même logique que la
 * carte À caler de l'Agenda.
 */
export function suggestedFor(db: Db, row: { from_address: string; source: string; answers_json: string | null }): string[] {
  const isWa = row.source === "whatsapp";
  const domain = isWa ? row.from_address : domainOf(row.from_address);
  const rule = db.prepare("SELECT for_member FROM member_rules WHERE domain = ?").get(domain) as { for_member: string } | undefined;
  if (rule) return [rule.for_member];
  let answers: Record<string, { probabilities?: Record<string, number> }> = {};
  try { answers = row.answers_json ? JSON.parse(row.answers_json) : {}; } catch { /* réponse illisible : pas d'enfant repéré */ }
  const best = Object.entries(answers.child?.probabilities ?? {}).filter(([k]) => k !== "none").sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 0.5) return [`child:${best[0]}`];
  if (isWa) { const chat = db.prepare("SELECT for_member FROM wa_chats WHERE jid = ?").get(row.from_address) as { for_member: string | null } | undefined; if (chat?.for_member) return [chat.for_member]; }
  return [];
}
