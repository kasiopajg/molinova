/**
 * Une proposition (événement ou tâche repérés par Jev) se « règle » une fois pour toutes :
 * le modèle texte en extrait la date, et si elle est déjà passée au moment de la lecture,
 * l'élément sort de la file de lui-même, rangé en « dépassé ». Personne n'a d'action à faire pour rien.
 */
import type { EventDraft } from "../connectors/calendar.js";
import type { Db } from "../db.js";
import type { Classifier } from "./classify.js";
import { extractEvent, extractTask, type SourceText } from "./writer.js";
import { agendaAccount, forgetUpcoming, upcomingEvents } from "./agenda-access.js";
import { householdMembers, titleFor } from "./agenda.js";
import { updateCalendarEvent } from "../connectors/calendar.js";
import { t } from "../i18n/index.js";
import { candidateEvents, candidateLine, toUpdate, type EventUpdate } from "./event-match.js";

/** action_state : 0 à traiter · 1 sorti (constaté) · 2 rien à faire · 3 dépassé (date déjà passée à la lecture). */
export const STATE_PAST = 3;

/** `update` : le message modifie un événement déjà dans l'agenda ; draft = l'événement après modification. */
export type EventProposal = { kind: "draft" } & EventDraft & { found: boolean; uncertain: string[]; update?: EventUpdate };
export type TaskProposal = { kind: "task"; found: boolean; title: string; due: string; notes: string; uncertain: string[] };
export type Proposal = EventProposal | TaskProposal | { kind: "invitation"; invite: { start: string; end: string; allDay: boolean } };

const ymdLocal = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Vrai si la proposition est déjà derrière nous. Un événement d'une journée entière reste valable jusqu'à minuit ; une tâche jusqu'à la fin du jour d'échéance. */
export function isPast(p: Proposal, now = new Date()): boolean {
  const today = ymdLocal(now);
  if (p.kind === "task") return !!p.due && p.due.slice(0, 10) < today;
  const ev = p.kind === "invitation" ? p.invite : p;
  const end = ev.end || ev.start;
  if (!end) return false;
  if (ev.allDay || end.length === 10) return end.slice(0, 10) < today; // fin exclusive pour Google, inclusive pour nous : on reste large
  const t = new Date(end).getTime();
  return !Number.isNaN(t) && t < now.getTime();
}

export function cachedProposal(db: Db, itemId: number): Proposal | null {
  const row = db.prepare("SELECT draft_json FROM event_drafts WHERE item_id = ?").get(itemId) as { draft_json: string } | undefined;
  if (!row) return null;
  try { const o = JSON.parse(row.draft_json) as Proposal & { kind?: string }; return o.kind ? (o as Proposal) : null; } catch { return null; }
}
export function cacheProposal(db: Db, itemId: number, p: Proposal): void {
  db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET draft_json = excluded.draft_json, extracted_at = datetime('now')").run(itemId, JSON.stringify(p));
}
export function markPast(db: Db, itemId: number): void {
  db.prepare("UPDATE decisions SET action_state = ? WHERE item_id = ? AND action_state = 0").run(STATE_PAST, itemId);
}

/**
 * Les ea_source (« gmail:12 », « whatsapp:40 ») des messages du même fil ou du même expéditeur (groupe WhatsApp compris) :
 * un événement né de l'un d'eux est le premier candidat quand un nouveau message en parle.
 */
export function linkedSources(db: Db, itemId: number): Set<string> {
  const me = db.prepare("SELECT thread_id, from_address FROM items WHERE id = ?").get(itemId) as { thread_id: string | null; from_address: string } | undefined;
  if (!me) return new Set();
  const rows = db.prepare("SELECT i.id, a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id != ? AND ((? IS NOT NULL AND i.thread_id = ?) OR i.from_address = ?) ORDER BY i.id DESC LIMIT 500").all(itemId, me.thread_id, me.thread_id, me.from_address) as Array<{ id: number; source: string }>;
  return new Set(rows.map((r) => `${r.source}:${r.id}`));
}

/**
 * Extrait l'événement d'un message, en regardant d'abord si l'agenda en contient déjà un dont il parle
 * (même fil, même expéditeur, mots en commun). Si oui, la proposition est une mise à jour de cet événement.
 * L'agenda illisible n'empêche rien : on propose alors un nouvel événement, comme avant.
 */
export async function extractEventProposal(c: Classifier, itemId: number, src: SourceText, now = new Date()): Promise<EventProposal> {
  const tz = c.ctx.owner.timezone;
  let known: ReturnType<typeof candidateEvents> = [];
  try { known = candidateEvents(await upcomingEvents(c.db, now), src, linkedSources(c.db, itemId)); } catch { known = []; }
  const refs = known.map((e, i) => ({ ref: `E${i + 1}`, event: e }));
  const { updates, change, ...draft } = await extractEvent(src, c.ctx, c.settings, now, itemId, refs.map((r) => ({ ref: r.ref, line: candidateLine(r.ref, r.event, tz) })));
  const hit = updates ? refs.find((r) => r.ref === updates) : undefined;
  return { kind: "draft", ...draft, ...(hit ? { update: toUpdate(hit.event, tz, change ?? "") } : {}) };
}

/**
 * Extrait (une seule fois, puis en cache) l'événement ou la tâche d'un élément signalé, et le range en « dépassé » si sa date est passée.
 * Renvoie la proposition, et si elle est encore d'actualité.
 */
export async function settleProposal(c: Classifier, itemId: number, flags: { event?: boolean; task?: boolean }, source: () => Promise<SourceText> | SourceText, now = new Date()): Promise<{ proposal: Proposal | null; past: boolean }> {
  if (!flags.event && !flags.task) return { proposal: null, past: false };
  let p = cachedProposal(c.db, itemId);
  if (!p) {
    const src = await source();
    p = flags.event ? await extractEventProposal(c, itemId, src, now) : { kind: "task", ...(await extractTask(src, c.ctx, c.settings, now, itemId)) };
    cacheProposal(c.db, itemId, p);
  }
  const past = isPast(p, now);
  if (past) markPast(c.db, itemId);
  return { proposal: p, past };
}

/**
 * Applique une mise à jour proposée : l'événement visé vient de la proposition en cache (jamais de l'appelant),
 * `draft` porte les valeurs relues ou corrigées. Le préfixe « Léo · » du titre est gardé, la précision s'ajoute à la description.
 * Le message sort ensuite de la file. `null` s'il n'y a pas d'événement à mettre à jour pour ce message.
 */
export async function applyUpdate(c: Classifier, itemId: number, draft: EventDraft): Promise<{ id: string; link: string } | null> {
  const p = cachedProposal(c.db, itemId);
  const upd = p?.kind === "draft" ? p.update : undefined;
  if (!upd) return null;
  const acc = agendaAccount(c.db);
  if (!acc) throw new Error(t("cal.noAccount"));
  const item = c.db.prepare("SELECT i.from_name, i.from_address, a.source FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.id = ?").get(itemId) as { from_name: string | null; from_address: string; source: string } | undefined;
  const note = upd.change ? t("event.updatedNote", { from: item?.from_name || item?.from_address || "", change: upd.change }) : undefined;
  const title = upd.forKeys?.length ? titleFor(draft.title, upd.forKeys, householdMembers(c.ctx)) : draft.title.trim();
  const r = await updateCalendarEvent(acc.email, upd.calendarId, upd.eventId, { ...draft, timezone: draft.timezone || c.ctx.owner.timezone, title, note, props: { ea_updated: `${item?.source ?? "gmail"}:${itemId}` } });
  c.db.prepare("UPDATE decisions SET action_state = 1 WHERE item_id = ?").run(itemId);
  forgetUpcoming();
  return r;
}
