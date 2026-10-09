import { describe, expect, it } from "vitest";
import { setLanguage, t } from "../i18n/index.js";
import { groupEvents, type Contact, type Pending, type Snapshot } from "./brain.js";
import { contactFollows, contactMember, contactReminders, eventConcerns, forContact, newEvents } from "./relatives.js";
setLanguage("fr");

const now = new Date(2026, 8, 24, 15, 45); // jeudi 24 sept. 2026, 15:45
const members = [
  { key: "me", name: "Alex", short: "A", kind: "adult" as const },
  { key: "spouse", name: "Kim", short: "K", kind: "adult" as const },
  { key: "child:leo", name: "Léo", short: "E1", kind: "child" as const },
  { key: "child:ines", name: "Inès", short: "E2", kind: "child" as const },
  { key: "family", name: t("agenda.family"), short: "F", kind: "family" as const },
];
const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m).toISOString();
const snap = (): Snapshot => ({
  now, members, agendaWarning: null, queue: [], toCal: [],
  days: {
    "2026-09-24": [
      { id: "e1", time: "16:30", title: "Dentiste", who: ["Léo"], whoKeys: ["child:leo"], presentKeys: ["spouse"], start: at(16, 30), calendarId: "fam" },
      { id: "e2", time: "18:00", title: "Réunion", who: ["Alex"], whoKeys: ["me"], start: at(18), calendarId: "work" },
      { id: "e3", time: "17:00", title: "Danse", who: ["Inès"], whoKeys: ["child:ines"], start: at(17), calendarId: "ecole" },
    ],
    "2026-09-26": [{ id: "e4", time: "", title: "Pique-nique", who: [], whoKeys: ["family"], start: "2026-09-26", calendarId: "fam" }],
  },
  tasks: [
    { id: 1, title: "Signer l'autorisation", due: "2026-09-25", for_member: "child:leo", done_at: null },
    { id: 2, title: "Payer la cantine", due: "2026-09-25", for_member: "me", done_at: null },
  ],
});
const kim: Contact = { key: "spouse", name: "Kim", chatId: 7 };
const granny: Contact = { key: "contact:mamie", name: "Mamie", chatId: 9, follows: ["child:leo"], calendars: ["ecole"] };

describe("proches : qui ils sont, ce qu'ils suivent", () => {
  it("prend le membre choisi, sinon la clé d'invitation quand c'est un membre", () => {
    expect(contactMember(kim, members)).toBe("spouse");
    expect(contactMember(granny, members)).toBeNull();
    expect(contactMember({ ...granny, member: "child:ines" }, members)).toBe("child:ines");
  });
  it("suit par défaut ses couloirs et la famille", () => {
    expect(contactFollows(kim, members)).toEqual(["spouse", "family"]);
    expect(contactFollows(granny, members)).toEqual(["child:leo"]);
  });
  it("un événement concerne le proche s'il y est, s'il suit le couloir ou l'agenda", () => {
    const [dentiste, reunion, danse] = snap().days["2026-09-24"];
    expect(eventConcerns(dentiste, kim, members)).toBe(true); // présente
    expect(eventConcerns(reunion, kim, members)).toBe(false);
    expect(eventConcerns(dentiste, granny, members)).toBe(true); // suit Léo
    expect(eventConcerns(danse, granny, members)).toBe(true); // suit l'agenda de l'école
  });
  it("le résumé d'un proche ne garde que ce qui le concerne, sans la boîte mail", () => {
    const s = forContact({ ...snap(), queue: [{ id: 1 } as never] }, granny, members);
    expect(s.days["2026-09-24"].map((e) => e.title)).toEqual(["Dentiste", "Danse"]);
    expect(s.days["2026-09-26"]).toBeUndefined();
    expect(s.tasks.map((x) => x.id)).toEqual([1]);
    expect(s.queue).toEqual([]);
  });
});

describe("proches : rappels et nouveautés", () => {
  it("rappelle un événement qui commence dans l'heure, une seule fois, et ses tâches de demain", () => {
    const r = contactReminders(snap(), kim, members, new Set());
    expect(r.map((x) => x.key)).toEqual([`ct:7:ev:e1:${at(16, 30)}`]);
    const g = contactReminders(snap(), granny, members, new Set());
    expect(g.map((x) => x.key)).toEqual([`ct:9:ev:e1:${at(16, 30)}`, "ct:9:task-tomorrow:1"]);
    expect(contactReminders(snap(), granny, members, new Set(g.map((x) => x.key)))).toEqual([]);
  });
  it("les nouveaux événements : ceux qui le concernent et qu'il n'a pas vus", () => {
    expect(newEvents(snap(), kim, members, new Set()).map((e) => e.id)).toEqual(["e1", "e4"]);
    expect(newEvents(snap(), kim, members, new Set(["e1"])).map((e) => e.id)).toEqual(["e4"]);
  });
});

describe("plusieurs événements d'un même message", () => {
  const ev = (n: number): Pending => ({ id: `e${n}`, kind: "event", label: `RDV ${n}`, draft: { title: `RDV ${n}`, start: "2026-10-01T10:00", end: "2026-10-01T11:00", allDay: false, timezone: "Europe/Madrid", location: "", description: "" }, forKeys: ["me"], present: ["me"], createdBy: "me" });
  it("deviennent un lot avec un seul bouton ; le reste garde le sien", () => {
    const out = groupEvents([ev(1), { id: "d", kind: "done", label: "x", taskId: 1, title: "x" }, ev(2), ev(3)]);
    expect(out.map((p) => p.kind)).toEqual(["batch", "done"]);
    const b = out[0] as Extract<Pending, { kind: "batch" }>;
    expect(b.events.map((e) => e.label)).toEqual(["RDV 1", "RDV 2", "RDV 3"]);
    expect(b.label).toBe("3 événements");
  });
  it("un seul événement reste tel quel", () => {
    expect(groupEvents([ev(1)]).map((p) => p.kind)).toEqual(["event"]);
  });
});
