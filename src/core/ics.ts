/**
 * Lecture minimale d'un fichier iCalendar (invitation reçue par email).
 * On ne lit que ce qui sert à répondre : méthode, identifiant, titre, dates, lieu, organisateur, participants.
 */
import { t } from "../i18n/index.js";

export interface IcsAttendee { email: string; name?: string; partstat?: string }
export interface IcsInvite {
  method: string; // REQUEST | CANCEL | REPLY | PUBLISH
  uid: string;
  summary: string;
  /** ISO avec décalage (ou AAAA-MM-JJ si journée entière). */
  start: string;
  /** Journée entière : le dernier jour inclus (convention de l'app ; iCalendar et Google donnent le lendemain). */
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  organizer?: IcsAttendee;
  attendees: IcsAttendee[];
  sequence: number;
  /** Fuseau déclaré dans le fichier, s'il y en a un. */
  tzid?: string;
}

/** Déplie les lignes (une ligne qui commence par un espace continue la précédente). */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
}
function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(";");
  const params: Record<string, string> = {};
  for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** Décalage (minutes) d'un fuseau IANA à un instant donné. */
function offsetMinutes(tz: string, at: Date): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - at.getTime()) / 60000);
}
/** « 20261023T200000 » dans un fuseau → ISO avec décalage. Deux passes suffisent autour d'un changement d'heure. */
export function zonedToIso(local: string, tz: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(local);
  if (!m) throw new Error(t("ics.badDate", { value: local }));
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let off = offsetMinutes(tz, new Date(naive));
  off = offsetMinutes(tz, new Date(naive - off * 60000));
  const d = new Date(naive - off * 60000);
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  const iso = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${iso}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
/** Noms de fuseaux Windows (invitations Outlook / Exchange) vers IANA, pour les plus courants. */
const WINDOWS_TZ: Record<string, string> = {
  "romance standard time": "Europe/Paris", "w. europe standard time": "Europe/Berlin", "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw", "gmt standard time": "Europe/London", "greenwich standard time": "Atlantic/Reykjavik",
  "e. europe standard time": "Europe/Chisinau", "fle standard time": "Europe/Kiev", "gtb standard time": "Europe/Bucharest",
  "russian standard time": "Europe/Moscow", "morocco standard time": "Africa/Casablanca", "utc": "UTC", "coordinated universal time": "UTC",
  "eastern standard time": "America/New_York", "central standard time": "America/Chicago", "mountain standard time": "America/Denver",
  "pacific standard time": "America/Los_Angeles", "atlantic standard time": "America/Halifax", "sa pacific standard time": "America/Bogota",
  "argentina standard time": "America/Buenos_Aires", "e. south america standard time": "America/Sao_Paulo", "mexico standard time": "America/Mexico_City",
  "canary islands standard time": "Atlantic/Canary", "arabian standard time": "Asia/Dubai", "india standard time": "Asia/Kolkata",
  "china standard time": "Asia/Shanghai", "tokyo standard time": "Asia/Tokyo", "aus eastern standard time": "Australia/Sydney",
};
/** Un fuseau utilisable par Intl : IANA tel quel, nom Windows traduit, sinon le fuseau de repli. */
export function resolveTz(tzid: string | undefined, fallbackTz: string): string {
  if (!tzid) return fallbackTz;
  const clean = tzid.replace(/^\/+/, "").trim();
  const win = WINDOWS_TZ[clean.toLowerCase()];
  const candidate = win ?? clean;
  try { new Intl.DateTimeFormat("en-US", { timeZone: candidate }); return candidate; } catch { return fallbackTz; }
}
function prevDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
function toIso(value: string, params: Record<string, string>, fallbackTz: string): { iso: string; allDay: boolean; tzid?: string } {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) return { iso: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, allDay: true };
  if (value.endsWith("Z")) return { iso: new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15) || "00"}Z`).toISOString(), allDay: false };
  const tz = resolveTz(params.TZID, fallbackTz);
  return { iso: zonedToIso(value, tz), allDay: false, tzid: params.TZID };
}
function mailto(v: string): string { return v.replace(/^mailto:/i, "").trim().toLowerCase(); }

/** Renvoie la première VEVENT du fichier, ou null si ce n'est pas une invitation lisible. */
export function parseIcs(text: string, fallbackTz = "UTC"): IcsInvite | null {
  const lines = unfold(text);
  let method = "";
  let inEvent = false;
  const ev: Partial<IcsInvite> & { attendees: IcsAttendee[] } = { attendees: [], sequence: 0 };
  for (const raw of lines) {
    const l = parseLine(raw);
    if (!l) continue;
    if (!inEvent) {
      if (l.name === "METHOD") method = l.value.trim().toUpperCase();
      if (l.name === "BEGIN" && l.value.trim().toUpperCase() === "VEVENT") inEvent = true;
      continue;
    }
    if (l.name === "END" && l.value.trim().toUpperCase() === "VEVENT") break;
    switch (l.name) {
      case "UID": ev.uid = l.value.trim(); break;
      case "SUMMARY": ev.summary = unescape(l.value).trim(); break;
      case "LOCATION": ev.location = unescape(l.value).trim(); break;
      case "DESCRIPTION": ev.description = unescape(l.value).trim(); break;
      case "SEQUENCE": ev.sequence = Number(l.value) || 0; break;
      case "DTSTART": { const t = toIso(l.value.trim(), l.params, fallbackTz); ev.start = t.iso; ev.allDay = t.allDay; ev.tzid = t.tzid ?? ev.tzid; break; }
      case "DTEND": { const t = toIso(l.value.trim(), l.params, fallbackTz); ev.end = t.iso; break; }
      case "ORGANIZER": ev.organizer = { email: mailto(l.value), name: l.params.CN }; break;
      case "ATTENDEE": ev.attendees.push({ email: mailto(l.value), name: l.params.CN, partstat: l.params.PARTSTAT?.toUpperCase() }); break;
    }
  }
  if (!inEvent || !ev.uid || !ev.start) return null;
  // Journée entière : DTEND est le lendemain (exclusif) ; l'app garde le dernier jour inclus.
  const end = ev.allDay ? (ev.end && ev.end.length === 10 && ev.end > ev.start ? prevDay(ev.end) : ev.start) : ev.end ?? ev.start;
  return { method: method || "PUBLISH", uid: ev.uid, summary: ev.summary ?? t("event.untitled"), start: ev.start, end, allDay: !!ev.allDay, location: ev.location, description: ev.description, organizer: ev.organizer, attendees: ev.attendees, sequence: ev.sequence ?? 0, tzid: ev.tzid };
}

/** Le statut du destinataire dans l'invitation, d'après ses adresses. */
export function myPartstat(inv: IcsInvite, myEmails: string[]): string | undefined {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()));
  return inv.attendees.find((a) => mine.has(a.email))?.partstat;
}
