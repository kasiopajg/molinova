import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n/index.js";
import { isPast } from "./proposals.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");

const now = new Date(2026, 8, 24, 15, 0); // jeudi 24 sept. 2026, 15:00
const ev = (start: string, end: string, allDay = false) => ({ kind: "draft" as const, found: true, uncertain: [], title: "x", start, end, allDay, timezone: "Europe/Madrid" });

describe("proposition dépassée", () => {
  it("un événement terminé avant la lecture est dépassé, un événement à venir non", () => {
    expect(isPast(ev("2026-09-24T09:00", "2026-09-24T10:00"), now)).toBe(true);
    expect(isPast(ev("2026-09-24T14:00", "2026-09-24T16:00"), now)).toBe(false);
    expect(isPast(ev("2026-10-01T08:45", "2026-10-01T16:00"), now)).toBe(false);
    expect(isPast(ev("2026-09-22T20:00:00+02:00", "2026-09-22T23:00:00+02:00"), now)).toBe(true);
  });
  it("une journée entière vaut jusqu'à minuit, une tâche jusqu'à la fin de son échéance", () => {
    expect(isPast(ev("2026-09-24", "2026-09-24", true), now)).toBe(false);
    expect(isPast(ev("2026-09-23", "2026-09-23", true), now)).toBe(true);
    expect(isPast({ kind: "task", found: true, title: "Signer", due: "2026-09-24", notes: "", uncertain: [] }, now)).toBe(false);
    expect(isPast({ kind: "task", found: true, title: "Signer", due: "2026-09-20", notes: "", uncertain: [] }, now)).toBe(true);
    expect(isPast({ kind: "task", found: true, title: "Sans date", due: "", notes: "", uncertain: [] }, now)).toBe(false);
  });
  it("une invitation passée aussi", () => {
    expect(isPast({ kind: "invitation", invite: { start: "2026-09-20T20:00:00+02:00", end: "2026-09-20T23:00:00+02:00", allDay: false } }, now)).toBe(true);
  });
});
