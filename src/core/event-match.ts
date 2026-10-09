/**
 * Un message peut parler d'un événement déjà dans l'agenda : changement d'heure, de lieu, précision.
 * Logique pure, sans réseau : choisir les quelques événements que le modèle texte verra (jamais tout l'agenda),
 * ramener une heure Google à l'heure locale de l'app, dire ce qui change.
 */
import type { CalEvent } from "./agenda.js";

/** L'événement de l'agenda que le message modifie, tel qu'il était à la lecture. */
export interface EventUpdate {
  eventId: string;
  calendarId: string;
  /** Avant la modification : titre, début et fin au format de l'app (heure locale, fin inclusive en journée entière). */
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  link?: string;
  /** ea_for de l'événement : le préfixe « Léo · » du titre est gardé à la mise à jour. */
  forKeys?: string[];
  /** Ce qui change ou se précise, en une phrase, d'après le modèle. */
  change: string;
}

const STOP = new Set(("avec dans pour sans chez votre notre vous nous elle elles ils leur leurs cette cela merci bonjour bonsoir salut " +
  "cordialement bien sont sera serait être avoir fait faire plus tout tous toute toutes comme mais donc alors aussi très demain " +
  "the and for with from this that your have will been are you our please thanks hello regards " +
  "para con por los las una unos unas este esta como pero gracias hola saludos").split(" "));
const strip = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Les mots porteurs d'un texte : au moins quatre lettres, sans accents, sans les mots de liaison. */
export function words(s: string): Set<string> {
  return new Set((strip(s).match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * Les événements qui pourraient être celui dont parle le message, du plus probable au moins probable.
 * Un événement né d'un message du même fil ou du même expéditeur (`linked` : ea_source « gmail:12 ») passe en tête ;
 * les autres doivent partager au moins un mot porteur avec le message. Au plus `max`, pour un prompt court.
 */
export function candidateEvents(events: CalEvent[], message: { subject?: string; text?: string }, linked: Set<string>, max = 10): CalEvent[] {
  const msg = words(`${message.subject ?? ""} ${(message.text ?? "").slice(0, 4000)}`);
  const scored = events.map((e) => {
    let score = 0;
    for (const w of words(`${e.title} ${e.location ?? ""}`)) if (msg.has(w)) score++;
    if (e.props.ea_source && linked.has(e.props.ea_source)) score += 5;
    return { e, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.e.start.localeCompare(b.e.start)).slice(0, max).map((x) => x.e);
}

/** « 2026-10-05T10:00:00+02:00 » → « 2026-10-05T10:00 » dans le fuseau de l'app. Un AAAA-MM-JJ reste tel quel. */
export function localTime(iso: string, timezone: string): string {
  if (!iso || iso.length === 10) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** La veille d'un AAAA-MM-JJ, sans passer par le fuseau du Mac : Google donne la fin d'une journée entière exclusive. */
function prevDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Un événement Google au format de l'app : heures locales, fin inclusive en journée entière. */
export function asDraftTimes(e: CalEvent, timezone: string): { start: string; end: string } {
  if (e.allDay) return { start: e.start, end: e.end && e.end > e.start ? prevDay(e.end) : e.start };
  return { start: localTime(e.start, timezone), end: localTime(e.end, timezone) };
}

/** La ligne qui présente un événement candidat au modèle : référence courte, quand, quoi, où. */
export function candidateLine(ref: string, e: CalEvent, timezone: string): string {
  const { start, end } = asDraftTimes(e, timezone);
  const when = e.allDay ? (end !== start ? `${start} → ${end}` : `${start} (journée entière)`) : `${start} → ${end.slice(0, 10) === start.slice(0, 10) ? end.slice(11) : end}`;
  return `${ref} · ${when} · ${e.title}${e.location ? ` · ${e.location}` : ""}`;
}

export function toUpdate(e: CalEvent, timezone: string, change: string): EventUpdate {
  const forKeys = e.props.ea_for ? e.props.ea_for.split(",").filter(Boolean) : undefined;
  return { eventId: e.id, calendarId: e.calendarId, title: e.title, ...asDraftTimes(e, timezone), allDay: e.allDay, location: e.location, link: e.link, forKeys, change: change.trim() };
}

export type ChangedField = "title" | "start" | "end" | "location";
/** Les champs qui diffèrent entre l'événement d'avant et la proposition. Vide = déjà à jour dans l'agenda. */
export function changedFields(before: Pick<EventUpdate, "title" | "start" | "end" | "allDay" | "location">, after: { title: string; start: string; end?: string; allDay: boolean; location?: string }): ChangedField[] {
  const norm = (s: string | undefined, allDay: boolean) => (allDay ? (s ?? "").slice(0, 10) : (s ?? "").slice(0, 16));
  const out: ChangedField[] = [];
  if (strip(before.title).trim() !== strip(after.title).trim()) out.push("title");
  if (before.allDay !== after.allDay || norm(before.start, after.allDay) !== norm(after.start, after.allDay)) out.push("start");
  if (before.allDay !== after.allDay || norm(before.end, after.allDay) !== norm(after.end || after.start, after.allDay)) out.push("end");
  if ((after.location ?? "").trim() && strip(after.location ?? "").trim() !== strip(before.location ?? "").trim()) out.push("location");
  return out;
}
