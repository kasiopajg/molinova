import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n/index.js";
import type { Context } from "../config.js";
import { buildLanes, findConflicts, householdMembers, isSpouseRelation, membersInTitle, titleFor, weekStart, ymd, type CalEvent } from "./agenda.js";
import { allDayRange, rfc3339 } from "../connectors/calendar.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");

const ctx: Context = {
  owner: { name: "Alex Martin", emails: ["alex.martin@example.com"], languages: ["fr"], timezone: "Europe/Madrid" },
  family: { children: [{ name: "Léo", activities: [] }, { name: "Inès", activities: [] }, { name: "Noé", activities: [] }], schoolDomains: [], activityDomains: [] },
  keyPeople: [{ name: "Sam Martin", relation: "Conjoint·e", emails: [] }, { name: "Marc", relation: "Jardinier", emails: [] }],
  projects: [],
  instructions: "",
};
const members = householdMembers(ctx);
const ev = (p: Partial<CalEvent> & { id: string; calendarId: string; start: string; end: string }): CalEvent => ({ title: "x", allDay: false, props: {}, ...p });

describe("membres du foyer", () => {
  it("repère le conjoint par sa relation et numérote les enfants", () => {
    expect(members.map((m) => m.key)).toEqual(["me", "spouse", "child:leo", "child:ines", "child:noe", "family"]);
    expect(members.find((m) => m.key === "spouse")?.name).toBe("Sam");
    expect(members.find((m) => m.key === "child:noe")?.short).toBe("E3");
  });
  it("reconnaît le conjoint avec ou sans accent, dans les trois langues", () => {
    for (const r of ["Epouse", "épouse", "Époux", "Conjoint·e", "Mari", "Cónyuge", "Conyuge", "Esposa", "Marido", "Pareja", "Wife", "Spouse"]) expect(isSpouseRelation(r), r).toBe(true);
    for (const r of ["Jardinier", "Comptable", "Associé·e", "Maire", "Marie", ""]) expect(isSpouseRelation(r), r).toBe(false);
  });
});

describe("semaine", () => {
  it("commence le lundi", () => {
    expect(ymd(weekStart(new Date(2026, 8, 24)))).toBe("2026-09-21"); // jeudi 24 sept. → lundi 21
    expect(ymd(weekStart(new Date(2026, 8, 27)))).toBe("2026-09-21"); // dimanche 27 → lundi 21
    expect(ymd(weekStart(new Date(2026, 8, 21)))).toBe("2026-09-21");
  });
});

describe("couloirs", () => {
  const map = { prim: "me", fam: "family", sam: "spouse" };
  const names = { prim: "perso", fam: "Famille", sam: "Sam" };
  it("met un événement Famille étiqueté dans le couloir de l'enfant, et en pointillé chez qui accompagne", () => {
    const lanes = buildLanes([ev({ id: "1", calendarId: "fam", title: "Léo · Dentiste", start: "2026-09-22T16:30:00+02:00", end: "2026-09-22T17:30:00+02:00", props: { ea_for: "child:leo", ea_present: "me", ea_source: "gmail:12" } })], members, map, names);
    const leo = lanes.find((l) => l.member.key === "child:leo")!, me = lanes.find((l) => l.member.key === "me")!;
    expect(leo.events).toHaveLength(1); expect(leo.events[0].role).toBe("for"); expect(leo.events[0].source).toBe("gmail"); expect(leo.count).toBe(1);
    expect(me.events).toHaveLength(1); expect(me.events[0].role).toBe("present"); expect(me.presentCount).toBe(1);
    expect(me.calendars).toEqual(["perso"]); expect(me.connected).toBe(true);
  });
  it("lit le membre dans le titre quand rien n'est étiqueté ; le couloir Famille montre tout l'agenda Famille", () => {
    const lanes = buildLanes([
      ev({ id: "a", calendarId: "fam", title: "Foot Noé", start: "2026-09-23T17:00:00+02:00", end: "2026-09-23T18:00:00+02:00" }),
      ev({ id: "b", calendarId: "fam", title: "Plombier villa", start: "2026-09-24", end: "2026-09-25", allDay: true }),
    ], members, map, names);
    expect(lanes.find((l) => l.member.key === "child:noe")!.events.map((e) => e.id)).toEqual(["a"]);
    expect(lanes.find((l) => l.member.key === "family")!.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(lanes.find((l) => l.member.key === "family")!.events.map((e) => e.id).filter((x, i, a) => a.indexOf(x) !== i)).toEqual([]); // jamais deux fois
    expect(membersInTitle("Léonard & co", members)).toEqual([]); // « Léo » n'est pas « Léonard »
  });
  it("ignore les agendas masqués et donne un agenda perso à son propriétaire", () => {
    const lanes = buildLanes([ev({ id: "p", calendarId: "prim", title: "Point équipe", start: "2026-09-21T09:00:00+02:00", end: "2026-09-21T10:00:00+02:00" }), ev({ id: "h", calendarId: "zzz", start: "2026-09-21T09:00:00+02:00", end: "2026-09-21T10:00:00+02:00" })], members, { ...map, zzz: "hidden" }, names);
    expect(lanes.find((l) => l.member.key === "me")!.events.map((e) => e.id)).toEqual(["p"]);
    expect(lanes.flatMap((l) => l.events).some((e) => e.id === "h")).toBe(false);
  });
});

describe("conflits", () => {
  it("signale deux enfants pris en même temps et compte les adultes libres", () => {
    const lanes = buildLanes([
      ev({ id: "1", calendarId: "fam", title: "Tournoi", start: "2026-09-26T10:00:00+02:00", end: "2026-09-26T12:00:00+02:00", props: { ea_for: "child:noe" } }),
      ev({ id: "2", calendarId: "fam", title: "Match", start: "2026-09-26T10:30:00+02:00", end: "2026-09-26T11:30:00+02:00", props: { ea_for: "child:ines" } }),
      ev({ id: "3", calendarId: "sam", title: "Déplacement", start: "2026-09-26", end: "2026-09-27", allDay: true }),
    ], members, { prim: "me", fam: "family", sam: "spouse" }, {});
    expect(findConflicts(lanes)).toEqual([{ day: "2026-09-26", note: "2 enfants pris en même temps, 1 adulte libre" }]);
  });
  it("ne dit rien quand les horaires ne se chevauchent pas", () => {
    const lanes = buildLanes([
      ev({ id: "1", calendarId: "fam", start: "2026-09-26T10:00:00+02:00", end: "2026-09-26T11:00:00+02:00", props: { ea_for: "child:noe" } }),
      ev({ id: "2", calendarId: "fam", start: "2026-09-26T11:00:00+02:00", end: "2026-09-26T12:00:00+02:00", props: { ea_for: "child:ines" } }),
    ], members, { fam: "family" }, {});
    expect(findConflicts(lanes)).toEqual([]);
  });
});

describe("titre écrit dans Google Agenda", () => {
  it("préfixe par le membre, sans doubler", () => {
    expect(titleFor("Sortie scolaire", ["child:leo"], members)).toBe("Léo · Sortie scolaire");
    expect(titleFor("Léo · Sortie scolaire", ["child:leo"], members)).toBe("Léo · Sortie scolaire");
    expect(titleFor("Vol CDG → MAD", ["family"], members)).toBe("Vol CDG → MAD");
    expect(titleFor("Anniversaire", ["child:leo", "child:noe"], members)).toBe("Léo + Noé · Anniversaire");
  });
});

describe("heures envoyées à Google", () => {
  it("ajoute les secondes qui manquent, laisse le reste tel quel", () => {
    expect(rfc3339("2026-09-26T10:00")).toBe("2026-09-26T10:00:00");
    expect(rfc3339("2026-09-26T10:00:00")).toBe("2026-09-26T10:00:00");
    expect(rfc3339("2026-09-26T10:00:00+02:00")).toBe("2026-09-26T10:00:00+02:00");
    expect(rfc3339("2026-09-26")).toBe("2026-09-26");
  });
});

describe("allDayRange (fin exclusive pour Google)", () => {
  it("un seul jour : fin = lendemain", () => expect(allDayRange("2026-10-12", "2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-13" }));
  it("fin absente ou avant le début : un seul jour", () => {
    expect(allDayRange("2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-13" });
    expect(allDayRange("2026-10-12", "2026-10-10")).toEqual({ start: "2026-10-12", end: "2026-10-13" });
  });
  it("plusieurs jours, passage de mois et d'année", () => {
    expect(allDayRange("2026-10-30", "2026-10-31")).toEqual({ start: "2026-10-30", end: "2026-11-01" });
    expect(allDayRange("2026-12-30T00:00", "2026-12-31")).toEqual({ start: "2026-12-30", end: "2027-01-01" });
  });
});
