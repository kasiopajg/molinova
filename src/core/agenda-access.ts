/**
 * Accès à l'agenda Google : quel compte porte l'agenda, quels agendas existent, comment ils se rattachent aux couloirs.
 * Partagé par l'interface (page Agenda) et par le coordinateur Telegram (résumés du matin, de la semaine).
 */
import type { Db } from "../db.js";
import { kvGet, kvSet, listAccounts } from "../db.js";
import { SCOPE_CALENDAR, SCOPE_CALENDAR_CREATE, SCOPE_CALENDAR_LIST, scopesForAccount } from "../connectors/gmail.js";
import { createCalendar, listCalendars, listEvents, type CalendarInfo } from "../connectors/calendar.js";
import type { CalEvent } from "./agenda.js";
import { t } from "../i18n/index.js";

/** id d'agenda → me | spouse | child:<slug> | family | hidden */
export interface AgendaMap { [calendarId: string]: string }
export const calendarsCache = new Map<string, { at: number; list: CalendarInfo[] }>();

/** Le compte Google qui porte l'agenda : celui choisi, sinon le premier qui a le droit Agenda. */
export function agendaAccount(db: Db): { email: string; canList: boolean; canCreate: boolean } | null {
  const chosen = kvGet<string | null>(db, "agenda.account", null);
  const accs = listAccounts(db).filter((a) => a.source === "gmail");
  const acc = accs.find((a) => a.email === chosen) ?? accs.find((a) => scopesForAccount(a.email).includes(SCOPE_CALENDAR)) ?? null;
  if (!acc) return null;
  const sc = scopesForAccount(acc.email);
  return { email: acc.email, canList: sc.includes(SCOPE_CALENDAR_LIST), canCreate: sc.includes(SCOPE_CALENDAR_CREATE) };
}

export async function agendaCalendars(email: string, canList: boolean, force = false): Promise<CalendarInfo[]> {
  const hit = calendarsCache.get(email);
  if (!force && hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
  const list = canList ? await listCalendars(email) : [{ id: "primary", name: t("cal.primary"), primary: true, canWrite: true }];
  calendarsCache.set(email, { at: Date.now(), list });
  return list;
}

/** Rattachement agendas → couloirs : ce que l'utilisateur a choisi, complété par des défauts raisonnables. */
export function agendaMap(db: Db, calendars: CalendarInfo[]): { map: AgendaMap; familyCalendar: string | null } {
  const saved = kvGet<AgendaMap>(db, "agenda.calendarMap", {});
  let familyCalendar = kvGet<string | null>(db, "agenda.familyCalendar", null);
  if (familyCalendar && !calendars.some((c) => c.id === familyCalendar)) familyCalendar = null;
  if (!familyCalendar) familyCalendar = calendars.find((c) => /^famil/i.test(c.name))?.id ?? null;
  const map: AgendaMap = {};
  for (const c of calendars) map[c.id] = saved[c.id] ?? (c.id === familyCalendar ? "family" : c.primary ? "me" : "hidden");
  if (familyCalendar) map[familyCalendar] = "family";
  return { map, familyCalendar };
}

/** Au-delà de cet âge, un email ne propose plus rien à caler, sauf si sa date (déjà extraite, sans rien de deviné) est encore à venir. */
export const TOCAL_MAX_DAYS = 30;
// Un rattrapage lit des années d'historique : un vol de 2024 ou un rendez-vous passé ne sont plus « à caler ». Au-delà de
// 30 jours, il faut une date extraite encore à venir, dont l'année n'a pas été devinée : rien d'incertain, ou l'année écrite
// dans l'email (« lun. 19 avr. 2027 »). Une année supposée projetterait un vieil email dans le futur.
const draftDate = "COALESCE(json_extract(e.draft_json, '$.start'), json_extract(e.draft_json, '$.due'), '')";
/** Les éléments encore « à caler » : un signal événement ou tâche, pas de règle quiet, encore dans la boîte de réception. */
export const toCalWhere = "d.action_state = 0 AND (COALESCE(json_extract(d.flags_json, '$.event'), 0) = 1 OR COALESCE(json_extract(d.flags_json, '$.task'), 0) = 1) AND COALESCE(json_extract(d.flags_json, '$.quiet'), 0) = 0 AND i.labels_json LIKE '%INBOX%'"
  + ` AND (julianday(i.date) >= julianday('now', '-${TOCAL_MAX_DAYS} days') OR EXISTS (SELECT 1 FROM event_drafts e WHERE e.item_id = i.id`
  + ` AND substr(${draftDate}, 1, 10) >= date('now', 'localtime')`
  + ` AND (COALESCE(json_array_length(json_extract(e.draft_json, '$.uncertain')), 0) = 0 OR instr(COALESCE(i.subject, '') || ' ' || COALESCE(i.body_excerpt, ''), substr(${draftDate}, 1, 4)) > 0)))`;

export async function ensureFamilyCalendar(db: Db, timezone: string): Promise<{ email: string; id: string }> {
  const acc = agendaAccount(db);
  if (!acc) throw new Error(t("cal.noAccount"));
  const calendars = await agendaCalendars(acc.email, acc.canList, true);
  let { familyCalendar } = agendaMap(db, calendars);
  if (!familyCalendar) {
    // L'agenda créé porte le nom de la langue de l'app (Famille, Family, Familia) ; la détection /^famil/i les reconnaît tous.
    if (!acc.canCreate) throw new Error(t("cal.cannotCreate", { name: t("cal.familyName") }));
    const created = await createCalendar(acc.email, t("cal.familyName"), timezone);
    calendarsCache.delete(acc.email);
    familyCalendar = created.id;
  }
  kvSet(db, "agenda.familyCalendar", familyCalendar);
  const map = kvGet<AgendaMap>(db, "agenda.calendarMap", {});
  kvSet(db, "agenda.calendarMap", { ...map, [familyCalendar]: "family" });
  return { email: acc.email, id: familyCalendar };
}

const upcomingCache = new Map<string, { at: number; events: CalEvent[] }>();
/**
 * Les événements à venir (six mois) des agendas affichés où l'on peut écrire : ceux qu'un nouveau message pourrait modifier.
 * Gardés cinq minutes : un passage de fond qui lit vingt messages ne relit pas l'agenda vingt fois. Sans agenda : liste vide.
 */
export async function upcomingEvents(db: Db, now = new Date()): Promise<CalEvent[]> {
  const acc = agendaAccount(db);
  if (!acc) return [];
  const hit = upcomingCache.get(acc.email);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.events;
  const calendars = await agendaCalendars(acc.email, acc.canList);
  const { map } = agendaMap(db, calendars);
  const shown = calendars.filter((k) => map[k.id] && map[k.id] !== "hidden" && k.canWrite);
  const from = new Date(now.getTime() - 86_400_000), to = new Date(now.getTime() + 183 * 86_400_000);
  const results = await Promise.allSettled(shown.map((k) => listEvents(acc.email, k.id, from, to)));
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  upcomingCache.set(acc.email, { at: Date.now(), events });
  return events;
}
/** Après une création ou une mise à jour : le prochain message doit voir l'agenda tel qu'il est. */
export function forgetUpcoming(): void { upcomingCache.clear(); }

/** Tous les événements des agendas affichés sur une période, avec le rattachement et les noms d'agendas. */
export async function readEvents(db: Db, timeMin: Date, timeMax: Date): Promise<{ account: string | null; events: CalEvent[]; map: AgendaMap; names: Record<string, string>; familyCalendar: string | null; canList: boolean; canCreate: boolean; failed: string[] }> {
  const acc = agendaAccount(db);
  if (!acc) return { account: null, events: [], map: {}, names: {}, familyCalendar: null, canList: false, canCreate: false, failed: [] };
  const calendars = await agendaCalendars(acc.email, acc.canList);
  const { map, familyCalendar } = agendaMap(db, calendars);
  const shown = calendars.filter((k) => map[k.id] && map[k.id] !== "hidden");
  const results = await Promise.allSettled(shown.map((k) => listEvents(acc.email, k.id, timeMin, timeMax)));
  const events: CalEvent[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => { if (r.status === "fulfilled") events.push(...r.value); else failed.push(`${shown[i].name} : ${(r.reason as Error)?.message ?? r.reason}`); });
  const names = Object.fromEntries(calendars.map((k) => [k.id, k.name]));
  return { account: acc.email, events, map, names, familyCalendar, canList: acc.canList, canCreate: acc.canCreate, failed };
}
