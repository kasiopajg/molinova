import { describe, expect, it } from "vitest";
import type { CalEvent } from "./agenda.js";
import { asDraftTimes, candidateEvents, candidateLine, changedFields, localTime, toUpdate } from "./event-match.js";

const TZ = "Europe/Madrid";
const ev = (id: string, title: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id, calendarId: "fam", title, start, end, allDay: start.length === 10, props: {}, ...extra });

describe("événements candidats", () => {
  const events = [
    ev("a", "Léo · Dentiste", "2026-10-05T10:00:00+02:00", "2026-10-05T11:00:00+02:00", { location: "Cabinet Ruiz" }),
    ev("b", "Réunion de parents", "2026-10-08T18:00:00+02:00", "2026-10-08T19:00:00+02:00"),
    ev("c", "Anniversaire Inès", "2026-10-12", "2026-10-13"),
    ev("d", "Sortie scolaire", "2026-10-20", "2026-10-21", { props: { ea_source: "gmail:12" } }),
  ];
  it("garde ceux qui partagent un mot porteur avec le message, sans les mots de liaison", () => {
    const r = candidateEvents(events, { subject: "Changement d'horaire", text: "Bonjour, le rendez-vous chez le dentiste de Léo est avancé à 9h." }, new Set());
    expect(r.map((e) => e.id)).toEqual(["a"]);
  });
  it("met en tête l'événement né d'un message du même fil, même sans mot commun", () => {
    const r = candidateEvents(events, { subject: "Re: infos", text: "Prévoir un pique-nique et dentiste ?" }, new Set(["gmail:12"]));
    expect(r.map((e) => e.id)).toEqual(["d", "a"]);
  });
  it("ne garde rien quand le message ne parle d'aucun événement connu", () => {
    expect(candidateEvents(events, { subject: "Facture", text: "Votre facture du mois." }, new Set())).toEqual([]);
  });
  it("borne la liste", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(String(i), `Piscine ${i}`, `2026-11-${String(i % 28 + 1).padStart(2, "0")}T17:00:00+01:00`, `2026-11-${String(i % 28 + 1).padStart(2, "0")}T18:00:00+01:00`));
    expect(candidateEvents(many, { text: "piscine annulée" }, new Set(), 10)).toHaveLength(10);
  });
});

describe("heures au format de l'app", () => {
  it("ramène une heure Google au fuseau de l'app", () => {
    expect(localTime("2026-10-05T08:00:00Z", TZ)).toBe("2026-10-05T10:00");
    expect(localTime("2026-10-05T10:00:00+02:00", TZ)).toBe("2026-10-05T10:00");
    expect(localTime("2026-10-05", TZ)).toBe("2026-10-05");
  });
  it("une journée entière Google (fin exclusive) devient une fin inclusive", () => {
    expect(asDraftTimes(ev("x", "Stage", "2026-10-12", "2026-10-13"), TZ)).toEqual({ start: "2026-10-12", end: "2026-10-12" });
    expect(asDraftTimes(ev("x", "Stage", "2026-10-12", "2026-10-15"), TZ)).toEqual({ start: "2026-10-12", end: "2026-10-14" });
    expect(asDraftTimes(ev("x", "Stage", "2026-12-31", "2027-01-01"), TZ)).toEqual({ start: "2026-12-31", end: "2026-12-31" });
  });
  it("la ligne vue par le modèle est courte et lisible", () => {
    expect(candidateLine("E1", ev("a", "Léo · Dentiste", "2026-10-05T10:00:00+02:00", "2026-10-05T11:00:00+02:00", { location: "Cabinet Ruiz" }), TZ)).toBe("E1 · 2026-10-05T10:00 → 11:00 · Léo · Dentiste · Cabinet Ruiz");
    expect(candidateLine("E2", ev("c", "Anniversaire", "2026-10-12", "2026-10-13"), TZ)).toBe("E2 · 2026-10-12 (journée entière) · Anniversaire");
  });
});

describe("ce qui change", () => {
  const before = toUpdate(ev("a", "Léo · Dentiste", "2026-10-05T10:00:00+02:00", "2026-10-05T11:00:00+02:00", { location: "Cabinet Ruiz", props: { ea_for: "child:leo" } }), TZ, "L'heure passe à 15:00");
  it("garde l'événement visé et pour qui il est", () => {
    expect(before).toMatchObject({ eventId: "a", calendarId: "fam", start: "2026-10-05T10:00", end: "2026-10-05T11:00", forKeys: ["child:leo"], change: "L'heure passe à 15:00" });
  });
  it("l'heure, le lieu, le titre", () => {
    expect(changedFields(before, { title: "Léo · Dentiste", start: "2026-10-05T15:00", end: "2026-10-05T16:00", allDay: false, location: "Cabinet Ruiz" })).toEqual(["start", "end"]);
    expect(changedFields(before, { title: "Léo · Dentiste", start: "2026-10-05T10:00", end: "2026-10-05T11:00", allDay: false, location: "Clinique Sol" })).toEqual(["location"]);
    expect(changedFields(before, { title: "Léo · Orthodontiste", start: "2026-10-05T10:00", end: "2026-10-05T11:00", allDay: false })).toEqual(["title"]);
  });
  it("un simple rappel ne change rien ; un lieu absent du message n'efface pas celui de l'agenda", () => {
    expect(changedFields(before, { title: "Léo · dentiste", start: "2026-10-05T10:00", end: "2026-10-05T11:00", allDay: false, location: "" })).toEqual([]);
  });
  it("passer en journée entière change les horaires", () => {
    expect(changedFields(before, { title: "Léo · Dentiste", start: "2026-10-05", end: "2026-10-05", allDay: true })).toEqual(["start", "end"]);
  });
});
