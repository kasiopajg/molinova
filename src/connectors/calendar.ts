import { google, type calendar_v3 } from "googleapis";
import type { CalEvent } from "../core/agenda.js";
import { clientForAccount } from "./gmail.js";
import { t } from "../i18n/index.js";

export interface EventDraft {
  title: string;
  start: string; // ISO local, ex. 2026-09-25T09:00
  end: string;
  allDay: boolean;
  timezone: string;
  location?: string;
  description?: string;
  /** Agenda cible ; « primary » par défaut. */
  calendarId?: string;
  /** Propriétés privées de l'agent : ea_for, ea_present, ea_source… Lisibles au retour, invisibles dans Google Agenda. */
  props?: Record<string, string>;
  /** Règles iCalendar (« RRULE:FREQ=WEEKLY;BYDAY=TU,TH ») pour une série. */
  recurrence?: string[];
}

function cal(email: string): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: clientForAccount(email) });
}

/** Message clair pour les deux erreurs les plus fréquentes : API non activée, droit manquant. */
function explain(err: unknown): Error {
  const m = (err as Error).message ?? "";
  const proj = /project (\d+)/.exec(m)?.[1];
  if (/has not been used|is disabled/.test(m)) {
    return new Error(t("cal.apiDisabled", { project: proj ? ` ${proj}` : "", url: `https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview${proj ? `?project=${proj}` : ""}` }));
  }
  if (/insufficient authentication scopes|insufficientPermissions|Insufficient Permission/i.test(m)) return new Error(t("cal.scopeMissing"));
  // « Bad Request » seul ne dit rien : Google met la vraie raison (« Invalid start time », « The specified time range is empty »…) dans la réponse.
  const detail = (err as { response?: { data?: { error?: { message?: string; errors?: Array<{ message?: string }> } } } }).response?.data?.error;
  const why = detail?.errors?.[0]?.message || detail?.message;
  if (why && why !== m) return new Error(`${m} : ${why}`);
  return err as Error;
}

/** Google exige des secondes dans une heure (« 10:00:00 ») : « 2026-09-26T10:00 » lui vaut un Bad Request muet. */
export function rfc3339(local: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
}

/** Le lendemain d'un AAAA-MM-JJ, sans passer par le fuseau du Mac. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
/**
 * Journée entière : dans l'app, la fin est le dernier jour inclus (souvent le même que le début) ;
 * Google attend le lendemain (fin exclusive) et refuse une fin égale au début.
 */
export function allDayRange(start: string, end?: string): { start: string; end: string } {
  const s = start.slice(0, 10);
  const last = (end || start).slice(0, 10);
  return { start: s, end: nextDay(last < s ? s : last) };
}

/** Crée l'événement. Appelé sur clic explicite. */
export async function createCalendarEvent(email: string, e: EventDraft): Promise<{ id: string; link: string }> {
  let res;
  try {
    res = await cal(email).events.insert({
      calendarId: e.calendarId || "primary",
      requestBody: {
        summary: e.title,
        location: e.location || undefined,
        description: e.description || undefined,
        start: e.allDay ? { date: allDayRange(e.start, e.end).start } : { dateTime: rfc3339(e.start), timeZone: e.timezone },
        end: e.allDay ? { date: allDayRange(e.start, e.end).end } : { dateTime: rfc3339(e.end), timeZone: e.timezone },
        extendedProperties: e.props && Object.keys(e.props).length ? { private: e.props } : undefined,
        recurrence: e.recurrence?.length ? e.recurrence : undefined,
      },
    });
  } catch (err) {
    throw explain(err);
  }
  return { id: res.data.id!, link: res.data.htmlLink ?? "" };
}

/**
 * Met à jour un événement existant (ou une seule occurrence d'une série) d'après un message : titre, horaires, lieu.
 * `note` s'ajoute à la fin de la description, qui garde tout ce qu'elle disait. Appelé sur clic explicite.
 */
export async function updateCalendarEvent(email: string, calendarId: string, eventId: string, e: { title: string; start: string; end: string; allDay: boolean; timezone: string; location?: string; note?: string; props?: Record<string, string> }): Promise<{ id: string; link: string }> {
  const c = cal(email);
  try {
    const cur = await c.events.get({ calendarId, eventId });
    const range = e.allDay ? allDayRange(e.start, e.end) : null;
    const res = await c.events.patch({
      calendarId, eventId,
      requestBody: {
        summary: e.title,
        location: e.location?.trim() ? e.location : undefined,
        description: e.note ? [cur.data.description?.trim(), e.note].filter(Boolean).join("\n\n") : undefined,
        // Passer d'une heure à une journée entière (ou l'inverse) : l'autre champ doit être vidé, sinon Google refuse.
        start: range ? { date: range.start, dateTime: null, timeZone: null } : { dateTime: rfc3339(e.start), timeZone: e.timezone, date: null },
        end: range ? { date: range.end, dateTime: null, timeZone: null } : { dateTime: rfc3339(e.end), timeZone: e.timezone, date: null },
        extendedProperties: e.props && Object.keys(e.props).length ? { private: e.props } : undefined,
      },
    });
    return { id: res.data.id!, link: res.data.htmlLink ?? "" };
  } catch (err) {
    throw explain(err);
  }
}

/** Supprime un événement, une occurrence d'une série (id d'occurrence) ou toute la série (id de la série). Déjà parti = pas une erreur. */
export async function deleteCalendarEvent(email: string, calendarId: string, eventId: string): Promise<void> {
  try { await cal(email).events.delete({ calendarId, eventId }); }
  catch (err) { const code = (err as { code?: number }).code; if (code === 404 || code === 410) return; throw explain(err); }
}
/** Change les propriétés privées (ea_for, ea_present…) d'un événement ou d'une série, sans toucher au reste. */
export async function patchEventProps(email: string, calendarId: string, eventId: string, props: Record<string, string>): Promise<void> {
  await cal(email).events.patch({ calendarId, eventId, requestBody: { extendedProperties: { private: props } } });
}

export interface CalendarInfo { id: string; name: string; primary: boolean; canWrite: boolean; color?: string }

/** Les agendas visibles du compte (les siens et ceux partagés avec lui). */
export async function listCalendars(email: string): Promise<CalendarInfo[]> {
  try {
    const r = await cal(email).calendarList.list({ maxResults: 100, minAccessRole: "reader" });
    return (r.data.items ?? []).map((c) => ({ id: c.id!, name: c.summaryOverride || c.summary || c.id!, primary: !!c.primary, canWrite: c.accessRole === "owner" || c.accessRole === "writer", color: c.backgroundColor ?? undefined }));
  } catch (err) {
    throw explain(err);
  }
}

/** Crée un agenda secondaire (ex. « Famille ») dans le compte. */
export async function createCalendar(email: string, name: string, timezone: string): Promise<CalendarInfo> {
  try {
    const r = await cal(email).calendars.insert({ requestBody: { summary: name, timeZone: timezone } });
    return { id: r.data.id!, name: r.data.summary ?? name, primary: false, canWrite: true };
  } catch (err) {
    throw explain(err);
  }
}

/** Les événements d'un agenda sur une fenêtre, occurrences des récurrents comprises. */
export async function listEvents(email: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<CalEvent[]> {
  let r;
  try {
    r = await cal(email).events.list({ calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250 });
  } catch (err) {
    throw explain(err);
  }
  return (r.data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
      const allDay = !!e.start?.date;
      return {
        id: e.id!, calendarId, title: e.summary || "(sans titre)", allDay,
        start: allDay ? e.start!.date! : e.start?.dateTime ?? "", end: allDay ? e.end!.date! : e.end?.dateTime ?? "",
        location: e.location ?? undefined, link: e.htmlLink ?? undefined, recurringEventId: e.recurringEventId ?? undefined,
        props: (e.extendedProperties?.private ?? {}) as Record<string, string>,
        free: e.transparency === "transparent",
      };
    });
}

/** Lien « nouvel événement » prérempli dans Google Agenda : aucun droit supplémentaire. */
export function calendarTemplateUrl(e: EventDraft): string {
  const fmt = (s: string) => (e.allDay ? s.slice(0, 10).replace(/-/g, "") : s.replace(/[-:]/g, "").slice(0, 15));
  const range = e.allDay ? allDayRange(e.start, e.end) : { start: e.start, end: e.end };
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${fmt(range.start)}/${fmt(range.end)}`, ctz: e.timezone });
  if (e.location) p.set("location", e.location);
  if (e.description) p.set("details", e.description);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

export type RsvpStatus = "accepted" | "tentative" | "declined";

/** L'événement de l'agenda principal qui porte cet identifiant iCalendar (les invitations reçues y arrivent seules). */
export async function findByIcalUid(email: string, uid: string): Promise<{ id: string; link: string; myStatus: string | null; title: string } | null> {
  let r;
  try { r = await cal(email).events.list({ calendarId: "primary", iCalUID: uid, maxResults: 5, showDeleted: false }); } catch (err) { throw explain(err); }
  const e = (r.data.items ?? []).find((x) => x.status !== "cancelled");
  if (!e) return null;
  const me = e.attendees?.find((a) => a.self);
  return { id: e.id!, link: e.htmlLink ?? "", myStatus: me?.responseStatus ?? null, title: e.summary ?? "" };
}

/**
 * Répond à une invitation : change le statut du participant « moi » et prévient l'organisateur, comme le bouton de Google Agenda.
 * Si l'invitation n'est pas encore dans l'agenda (fichier .ics d'un autre outil), on l'importe d'abord.
 */
export async function respondToInvite(email: string, inv: { uid: string; summary: string; start: string; end: string; allDay: boolean; location?: string; description?: string; organizer?: { email: string; name?: string }; attendees: Array<{ email: string; name?: string }> }, status: RsvpStatus, extraProps?: Record<string, string>): Promise<{ id: string; link: string }> {
  const c = cal(email);
  try {
    let found = await findByIcalUid(email, inv.uid);
    if (!found) {
      const imported = await c.events.import({
        calendarId: "primary",
        requestBody: {
          iCalUID: inv.uid, summary: inv.summary, location: inv.location || undefined, description: inv.description || undefined,
          start: inv.allDay ? { date: allDayRange(inv.start, inv.end).start } : { dateTime: inv.start }, end: inv.allDay ? { date: allDayRange(inv.start, inv.end).end } : { dateTime: inv.end },
          organizer: inv.organizer ? { email: inv.organizer.email, displayName: inv.organizer.name } : undefined,
          attendees: inv.attendees.map((a) => ({ email: a.email, displayName: a.name, responseStatus: a.email.toLowerCase() === email.toLowerCase() ? status : undefined })),
        },
      });
      found = { id: imported.data.id!, link: imported.data.htmlLink ?? "", myStatus: null, title: inv.summary };
    }
    const cur = await c.events.get({ calendarId: "primary", eventId: found.id });
    const attendees = (cur.data.attendees ?? []).map((a) => (a.self || (a.email ?? "").toLowerCase() === email.toLowerCase() ? { ...a, responseStatus: status } : a));
    if (!attendees.some((a) => a.responseStatus === status)) attendees.push({ email, self: true, responseStatus: status });
    const r = await c.events.patch({
      calendarId: "primary", eventId: found.id, sendUpdates: "all",
      requestBody: { attendees, extendedProperties: extraProps && Object.keys(extraProps).length ? { private: extraProps } : undefined },
    });
    return { id: r.data.id!, link: r.data.htmlLink ?? found.link };
  } catch (err) {
    throw explain(err);
  }
}
