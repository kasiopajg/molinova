/**
 * Agenda « par personne » : un couloir par membre du foyer.
 * Logique pure, sans réseau : semaine, membres, rattachement d'un événement à des couloirs, conflits.
 */
import type { Context } from "../config.js";
import { slug } from "./questions.js";
import { t, tn } from "../i18n/index.js";

export interface Member {
  /** me | spouse | child:<slug> | family */
  key: string;
  name: string;
  /** Initiale(s) affichée(s) dans le couloir : D, C, E1… */
  short: string;
  kind: "adult" | "child" | "family";
}

/** Cette relation désigne le conjoint : « Épouse », « Epouse », « Conjoint·e », « Cónyuge », « Wife »… accents ignorés. */
export function isSpouseRelation(relation: string): boolean {
  const r = relation.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /conjoint|epou|espos|conyuge|spouse|wife|husband|femme|\bmari(do)?\b|pareja|compagn/.test(r);
}

/** Les membres du foyer tels que le contexte les connaît. Le conjoint est repéré par sa relation. */
export function householdMembers(ctx: Context): Member[] {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const spouse = ctx.keyPeople.find((p) => isSpouseRelation(p.relation));
  const kids = ctx.family.children.filter((c) => c.name.trim());
  return [
    { key: "me", name: first(ctx.owner.name) || t("agenda.me"), short: (first(ctx.owner.name)[0] || t("agenda.me")[0]).toUpperCase(), kind: "adult" },
    ...(spouse ? [{ key: "spouse", name: first(spouse.name), short: (first(spouse.name)[0] || "C").toUpperCase(), kind: "adult" as const }] : []),
    ...kids.map((c, i) => ({ key: `child:${slug(c.name)}`, name: first(c.name), short: `E${i + 1}`, kind: "child" as const })),
    { key: "family", name: t("agenda.family"), short: "F", kind: "family" },
  ];
}

/** Le lundi de la semaine qui contient `d`, à minuit, en heure locale du Mac. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - dow);
  return x;
}
export const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(t("agenda.dateFormat"));
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Un événement lu dans Google Agenda, déjà aplati. */
export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO complet, ou AAAA-MM-JJ si journée entière. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  link?: string;
  /** Id de la série quand c'est une occurrence d'un événement récurrent. */
  recurringEventId?: string;
  /** Propriétés posées par l'agent : pour qui, qui doit être là, d'où ça vient. */
  props: Record<string, string>;
  /** Vrai si l'événement est marqué « disponible » (transparent) : on l'affiche en léger. */
  free?: boolean;
}

/** Un événement placé dans un couloir. `role` : concerné (trait plein) ou présent (pointillé). */
export interface LaneEvent extends CalEvent {
  role: "for" | "present";
  /** Membres concernés, pour l'étiquette « · Léo » dans le couloir d'un adulte. */
  forKeys: string[];
  /** Origine : gmail | whatsapp | manuelle, d'après ea_source. */
  source: "gmail" | "whatsapp" | "telegram" | null;
  day: string;
  confirm?: boolean;
}

export interface Lane {
  member: Member;
  /** Agendas Google rattachés à ce couloir (noms), pour le sous-titre. */
  calendars: string[];
  events: LaneEvent[];
  count: number;
  presentCount: number;
  connected: boolean;
}

/** Le jour local (AAAA-MM-JJ) d'un début d'événement. */
export function dayOf(start: string): string {
  return start.length === 10 ? start : ymd(new Date(start));
}

const parseKeys = (s: string | undefined): string[] => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** Trouve les membres nommés dans un titre (« Dentiste · Léo », « [Léo] Excursion »). */
export function membersInTitle(title: string, members: Member[]): string[] {
  const out: string[] = [];
  for (const m of members) {
    if (m.kind === "family" || m.key === "me") continue;
    const re = new RegExp(`(^|[^\\p{L}])${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu");
    if (re.test(title)) out.push(m.key);
  }
  return out;
}

/**
 * Range les événements dans les couloirs.
 * `calendarMap` : id d'agenda Google → clé de membre (ou "family" pour l'agenda partagé, "hidden" pour ignorer).
 * Un événement de l'agenda Famille va au membre indiqué par ea_for, sinon à ceux nommés dans le titre, sinon à « Toute la famille ».
 * Les personnes de ea_present le reçoivent aussi, en pointillé.
 */
export function buildLanes(events: CalEvent[], members: Member[], calendarMap: Record<string, string>, calendarNames: Record<string, string>): Lane[] {
  const lanes = new Map<string, Lane>(members.map((m) => [m.key, { member: m, calendars: [], events: [], count: 0, presentCount: 0, connected: false }]));
  for (const [id, key] of Object.entries(calendarMap)) {
    const lane = lanes.get(key);
    if (lane) { lane.calendars.push(calendarNames[id] ?? id); lane.connected = true; }
  }
  const push = (key: string, e: CalEvent, role: "for" | "present", forKeys: string[]) => {
    const lane = lanes.get(key);
    if (!lane) return;
    const source = e.props.ea_source?.startsWith("whatsapp") ? "whatsapp" : e.props.ea_source?.startsWith("gmail") ? "gmail" : e.props.ea_source?.startsWith("telegram") ? "telegram" : null;
    lane.events.push({ ...e, role, forKeys, source, day: dayOf(e.start), confirm: e.props.ea_confirm === "1" });
    if (role === "for") lane.count++; else lane.presentCount++;
  };
  for (const e of events) {
    const target = calendarMap[e.calendarId];
    if (!target || target === "hidden") continue;
    let forKeys = parseKeys(e.props.ea_for);
    if (target === "family") {
      if (!forKeys.length) forKeys = membersInTitle(e.title, members);
      if (!forKeys.length) forKeys = ["family"];
    } else {
      // Agenda personnel : son propriétaire est concerné ; un enfant nommé dans le titre l'est aussi.
      forKeys = forKeys.length ? forKeys : [target, ...membersInTitle(e.title, members).filter((k) => k !== target)];
    }
    for (const k of forKeys) push(k, e, "for", forKeys);
    // L'agenda Famille est la vue du foyer : tout ce qu'il contient apparaît aussi dans le couloir « Toute la famille ».
    if (target === "family" && !forKeys.includes("family")) push("family", e, "for", forKeys);
    for (const k of parseKeys(e.props.ea_present)) if (!forKeys.includes(k)) push(k, e, "present", forKeys);
  }
  for (const lane of lanes.values()) lane.events.sort((a, b) => a.start.localeCompare(b.start));
  return [...lanes.values()];
}

export interface Conflict { day: string; note: string }

/**
 * Conflits du jour : deux enfants (ou plus) pris en même temps, et combien d'adultes sont libres à ce moment-là.
 * L'agent signale, il ne tranche pas.
 */
export function findConflicts(lanes: Lane[]): Conflict[] {
  const kids = lanes.filter((l) => l.member.kind === "child");
  const adults = lanes.filter((l) => l.member.kind === "adult");
  const timed = (l: Lane) => l.events.filter((e) => !e.allDay && e.role === "for");
  const overlap = (a: LaneEvent, b: LaneEvent) => a.start < b.end && b.start < a.end;
  const out: Conflict[] = [];
  const days = new Set(kids.flatMap((l) => timed(l).map((e) => e.day)));
  for (const day of [...days].sort()) {
    const per = kids.map((l) => timed(l).filter((e) => e.day === day));
    // Cherche une paire d'événements d'enfants différents qui se chevauchent.
    let clash: { a: LaneEvent; b: LaneEvent } | undefined;
    for (let i = 0; i < per.length && !clash; i++)
      for (let j = i + 1; j < per.length && !clash; j++)
        for (const a of per[i]) { const b = per[j].find((x) => overlap(a, x)); if (b) { clash = { a, b }; break; } }
    if (!clash) continue;
    const busy = new Set<string>();
    for (const l of kids) for (const e of timed(l)) if (e.day === day && (overlap(e, clash.a) || overlap(e, clash.b))) busy.add(l.member.key);
    const freeAdults = adults.filter((l) => !l.events.some((e) => e.day === day && (e.allDay || overlap(e, clash!.a) || overlap(e, clash!.b)))).length;
    out.push({ day, note: tn("agenda.conflict", freeAdults, { kids: busy.size }) });
  }
  return out;
}

/** La description écrite dans Google Agenda : le texte de l'événement, puis « Pour : … · Présent : … » dans la langue de l'app. */
export function eventDescription(base: string | undefined, forNames: string, presentNames: string): string {
  const line = t("event.for", { names: forNames || t("agenda.family") }) + (presentNames ? t("event.present", { names: presentNames }) : "");
  return [base?.trim(), line].filter(Boolean).join("\n\n");
}

/** Le titre écrit dans Google Agenda : le membre en préfixe, lisible partout, même hors de l'app. */
export function titleFor(title: string, forKeys: string[], members: Member[]): string {
  const names = forKeys.filter((k) => k !== "family").map((k) => members.find((m) => m.key === k)?.name).filter(Boolean);
  const clean = title.trim();
  if (!names.length) return clean;
  const prefix = names.join(" + ");
  return clean.toLowerCase().startsWith(prefix.toLowerCase()) ? clean : `${prefix} · ${clean}`;
}
