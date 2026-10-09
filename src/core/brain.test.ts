import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n/index.js";
import { claimsDone, findReminders, normalizeWhen, renderDay, renderWeek, resolvePresent, resolveWho, weeklyRule, type Snapshot } from "./brain.js";
import { t } from "../i18n/index.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");

const now = new Date(2026, 8, 24, 7, 30); // jeudi 24 sept. 2026, 07:30
const members = [
  { key: "me", name: "Alex", short: "A", kind: "adult" as const },
  { key: "spouse", name: "Conjointe", short: "C", kind: "adult" as const },
  { key: "child:leo", name: "Léo", short: "E1", kind: "child" as const },
  { key: "family", name: t("agenda.family"), short: "F", kind: "family" as const },
];
const base = (): Snapshot => ({
  now, members,
  days: {
    "2026-09-24": [{ time: "16:30", title: "Dentiste", who: ["Léo"] }, { time: "", title: "Jour férié", who: [] }],
    "2026-09-25": [{ time: "09:00", title: "Réunion parents", who: ["Alex", "Conjointe"], location: "École" }],
    "2026-09-28": [{ time: "18:00", title: "Foot", who: ["Léo"] }],
  },
  agendaWarning: null,
  tasks: [
    { id: 1, title: "Signer l'autorisation", due: "2026-09-24", for_member: "child:leo", done_at: null },
    { id: 2, title: "Payer la cantine", due: "2026-09-20", for_member: null, done_at: null },
    { id: 3, title: "Renvoyer le formulaire", due: "2026-09-25", for_member: null, done_at: null },
    { id: 4, title: "Sans date", due: null, for_member: null, done_at: null },
  ],
  queue: [
    { id: 10, from_name: "EDF", from_address: "no-reply@edf.fr", subject: "Facture <septembre>", date: "2026-09-23T10:00:00Z", category: "maison", flags: { toPay: true }, needs_review: 0, score: 1, source: "gmail", decided_at: "" },
    { id: 11, from_name: "Marie", from_address: "marie@example.org", subject: "Sortie samedi ?", date: "2026-09-19T10:00:00Z", category: "amis", flags: { reply: true }, needs_review: 0, score: 1, source: "gmail", decided_at: "" },
    { id: 12, from_name: "Banque", from_address: "alerte@banque.fr", subject: "Action requise", date: "2026-09-24T06:00:00Z", category: "finance", flags: { important: true }, needs_review: 0, score: 2.8, source: "gmail", decided_at: "" },
    { id: 13, from_name: "Groupe classe", from_address: "wa", subject: "Fenêtre", date: "2026-09-24T06:00:00Z", category: "ecole", flags: { event: true }, needs_review: 0, score: 1, source: "whatsapp", decided_at: "" },
  ],
  toCal: [
    { id: 13, subject: "Sortie piscine", from: "Groupe classe", source: "whatsapp", proposal: { kind: "draft", found: true, uncertain: [], title: "Piscine", start: "2026-09-25T09:00", end: "2026-09-25T12:00", allDay: false, timezone: "Europe/Madrid" } },
    { id: 14, subject: "Réunion en octobre", from: "École", source: "gmail", proposal: { kind: "draft", found: true, uncertain: [], title: "Réunion", start: "2026-10-15T18:00", end: "2026-10-15T19:00", allDay: false, timezone: "Europe/Madrid" } },
  ],
});

describe("résumé du matin", () => {
  it("montre la journée, demain, les tâches qui pressent et la boîte, en HTML Telegram échappé", () => {
    const t = renderDay(base());
    expect(t).toContain("<b>jeudi 24 sept.</b>");
    expect(t).toContain("<b>16:30</b> Dentiste · Léo");
    expect(t).toContain("• Jour férié"); // journée entière : pas d'heure
    expect(t).toContain("<b>Demain</b>");
    expect(t).toContain("<i>École</i>");
    expect(t).toContain("Signer l'autorisation · Léo <b>aujourd'hui</b>");
    expect(t).toContain("Payer la cantine <b>en retard</b> (20 sept.)");
    expect(t).toContain("Renvoyer le formulaire 25 sept.");
    expect(t).not.toContain("Sans date");
    expect(t).toContain("<b>Boîte</b> · 1 à payer · 1 à répondre · 1 important · 2 à caler");
  });
  it("dit quand l'agenda est vide ou indisponible", () => {
    const s = base(); s.days = {};
    expect(renderDay(s)).toContain("Rien à l'agenda.");
    s.agendaWarning = "aucun compte";
    expect(renderDay(s)).toContain("Agenda indisponible : aucun compte");
  });
});

describe("semaine à venir", () => {
  it("le dimanche soir, c'est lundi à dimanche ; en semaine, à partir de demain", () => {
    const s = base(); s.now = new Date(2026, 8, 27, 20, 0); // dimanche 27 sept.
    const t = renderWeek(s);
    expect(t).toContain("<b>La semaine du 28 sept.</b>");
    expect(t).toContain("<b>Lundi 28</b>");
    expect(t).toContain("Foot · Léo");
    expect(t).not.toContain("Dentiste");
    const w = renderWeek(base());
    expect(w).toContain("La semaine du 25 sept.");
    expect(w).toContain("Réunion parents");
    expect(w).toContain("2 propositions encore à caler");
  });
});

describe("rappels", () => {
  const opts = { replyAfterDays: 3, urgentScore: 2.5 };
  it("trouve chaque chose une fois : tâche demain ou en retard, facture, sans réponse, urgent, à caler sous 48 h", () => {
    const r = findReminders(base(), new Set(), opts);
    const keys = r.map((x) => x.key);
    expect(keys).toEqual(["task-late:2", "task-tomorrow:3", "pay:10", "reply-late:11", "urgent:12", "tocal:13"]);
    expect(r.find((x) => x.key === "pay:10")!.text).toBe("<b>À payer</b> · EDF : Facture &lt;septembre&gt;");
    expect(r.find((x) => x.key === "reply-late:11")!.text).toContain("Sans réponse depuis 4 j");
    expect(r.find((x) => x.key === "tocal:13")!.text).toContain("avant le 25 sept.");
  });
  it("un code ou une alerte de connexion ne donne jamais de rappel après coup", () => {
    const s = base();
    s.queue.forEach((q) => { if (q.id === 12) (q.flags as Record<string, unknown>).ephemeral = "signin"; });
    expect(findReminders(s, new Set(), opts).map((x) => x.key)).not.toContain("urgent:12");
  });
  it("ne redit pas ce qui a déjà été envoyé, ni une tâche due aujourd'hui (le matin s'en charge)", () => {
    const r = findReminders(base(), new Set(["pay:10", "urgent:12"]), opts);
    expect(r.map((x) => x.key)).toEqual(["task-late:2", "task-tomorrow:3", "reply-late:11", "tocal:13"]);
  });
  it("une relance a son propre message : qui n'a pas répondu, jamais « toi », et le sujet à traiter", () => {
    const s = base();
    s.queue.push(
      { id: 20, from_name: "Alex Martin", from_address: "alex.martin@example.com", subject: "Re: Licencia", date: "2026-09-18T10:00:00Z", category: "ecole", flags: { followUp: true, awaitReply: true }, needs_review: 0, score: 1, source: "gmail", decided_at: "", is_outgoing: 1, to_json: JSON.stringify(["club@example.org"]), thread_last_at: "2026-09-18T10:00:00Z" },
      { id: 21, from_name: "Paul", from_address: "paul@example.org", subject: "Devis", date: "2026-09-10T10:00:00Z", category: "maison", flags: { followUp: true }, needs_review: 0, score: 1, source: "gmail", decided_at: "", is_outgoing: 0, thread_last_at: "2026-09-17T10:00:00Z" },
    );
    const r = findReminders(s, new Set(), opts);
    const sent = r.find((x) => x.key === "followup:20")!, recv = r.find((x) => x.key === "followup:21")!;
    expect(sent.text).toBe("<b>Re: Licencia</b>\nEnvoyé à club@example.org le 18 sept. · sans réponse depuis 5 j");
    expect(sent.text).not.toContain("Alex");
    expect(sent.followUp).toEqual({ itemId: 20, label: "Re: Licencia" });
    expect(recv.text).toBe("<b>Devis</b>\nPaul n'a pas répondu depuis 6 j");
    expect(r.filter((x) => !x.followUp).every((x) => !x.text.includes("relancer"))).toBe(true);
  });
  it("un important pas urgent ne dérange pas", () => {
    const s = base(); s.queue[2].score = 1.8;
    expect(findReminders(s, new Set(), opts).map((x) => x.key)).not.toContain("urgent:12");
  });
});

describe("pour qui, d'après les mots cités", () => {
  it("moi = qui parle, un prénom = ce membre, nous = la famille, mon mari = l'autre adulte", () => {
    expect(resolveWho("pour moi", "spouse", members)).toEqual(["spouse"]);
    expect(resolveWho("mon rendez-vous", "me", members)).toEqual(["me"]);
    expect(resolveWho("Léo", "spouse", members)).toEqual(["child:leo"]);
    expect(resolveWho("le foot de Leo", "me", members)).toEqual(["child:leo"]);
    expect(resolveWho("pour Alex", "spouse", members)).toEqual(["me"]);
    expect(resolveWho("mon mari", "spouse", members)).toEqual(["me"]);
    expect(resolveWho("ma femme", "me", members)).toEqual(["spouse"]);
    expect(resolveWho("nous", "me", members)).toEqual(["family"]);
    expect(resolveWho("les enfants", "me", members)).toEqual(["family"]);
  });
  it("refuse ce qui ne désigne personne", () => {
    expect(resolveWho("", "me", members)).toBeNull();
    expect(resolveWho("il faut acheter un cadeau", "spouse", members)).toBeNull();
    expect(resolveWho("avant vendredi", "spouse", members)).toBeNull();
  });
});

describe("qui doit être là", () => {
  it("personne / seule = personne ; sinon comme pour qui ; vide = pas dit", () => {
    expect(resolvePresent("personne", "me", members)).toEqual([]);
    expect(resolvePresent("elle y va seule", "me", members)).toEqual([]);
    expect(resolvePresent("j'y vais", "spouse", members)).toEqual(["spouse"]);
    expect(resolvePresent("Alex l'emmène", "spouse", members)).toEqual(["me"]);
    expect(resolvePresent("on y va tous", "me", members)).toEqual(["family"]);
    expect(resolvePresent("", "me", members)).toBeNull();
    expect(resolvePresent("à 18h", "me", members)).toBeNull();
  });
  it("« Léo et la famille », « Léo et moi » : l'enfant est nommé, le reste dit qui l'accompagne", () => {
    expect(resolvePresent("Léo et Famille", "spouse", members)).toEqual(["family"]);
    expect(resolvePresent("Leo et moi", "spouse", members)).toEqual(["spouse"]);
    expect(resolvePresent("Léo", "spouse", members)).toEqual(["child:leo"]);
  });
});

describe("en anglais et en espagnol", () => {
  it("le résumé du matin suit la langue demandée, dates comprises", () => {
    const en = renderDay(base(), "en");
    expect(en).toContain("<b>Thursday 24 Sept</b>");
    expect(en).toContain("<b>Tomorrow</b>");
    expect(en).toContain("Payer la cantine <b>overdue</b> (20 Sept)");
    expect(en).toContain("<b>Inbox</b> · 1 to pay · 1 to reply · 1 important · 2 to schedule");
    const es = renderDay(base(), "es");
    expect(es).toContain("<b>jueves, 24 sept</b>");
    expect(es).toContain("<b>Bandeja</b> · 1 por pagar · 1 por responder · 1 importante · 2 por agendar");
  });
  it("la semaine et les rappels aussi", () => {
    const s = base(); s.now = new Date(2026, 8, 27, 20, 0);
    expect(renderWeek(s, "en")).toContain("<b>The week of 28 Sept</b>");
    expect(renderWeek(s, "en")).toContain("<b>Monday 28</b>");
    expect(renderWeek(base(), "es")).toContain("2 propuestas pendientes de agendar en la app.");
    const r = findReminders(base(), new Set(), { replyAfterDays: 3, urgentScore: 2.5 }, "en");
    expect(r.find((x) => x.key === "pay:10")!.text).toBe("<b>To pay</b> · EDF: Facture &lt;septembre&gt;");
    expect(r.find((x) => x.key === "tocal:13")!.text).toContain("before 25 Sept");
  });
  it("« pour qui » lit les mots de la langue choisie, et ceux des autres langues seulement s'ils sont sans ambiguïté", () => {
    expect(resolveWho("for me", "me", members, "en")).toEqual(["me"]);
    expect(resolveWho("my wife", "me", members, "en")).toEqual(["spouse"]);
    expect(resolveWho("the kids", "me", members, "en")).toEqual(["family"]);
    expect(resolveWho("Leo's football", "me", members, "en")).toEqual(["child:leo"]);
    expect(resolveWho("on Monday", "me", members, "en")).toBeNull(); // « on » n'est pas le « on » français
    expect(resolveWho("nous", "me", members, "en")).toEqual(["family"]); // français dans une app en anglais
    expect(resolveWho("je", "me", members, "en")).toBeNull(); // trop court hors de la langue de l'app
    expect(resolvePresent("nobody", "me", members, "en")).toEqual([]);
    expect(resolvePresent("she goes alone", "me", members, "en")).toEqual([]);
    expect(resolveWho("para mí", "spouse", members, "es")).toEqual(["spouse"]);
    expect(resolveWho("mi marido", "spouse", members, "es")).toEqual(["me"]);
    expect(resolveWho("los niños", "me", members, "es")).toEqual(["family"]);
    expect(resolvePresent("nadie", "me", members, "es")).toEqual([]);
  });
  it("repère un « it's done » ou un « ya está hecho », et garde le filet français", () => {
    expect(claimsDone("It's done, I've added the trainings.", "en")).toBe(true);
    expect(claimsDone("The event is ready to confirm.", "en")).toBe(true);
    expect(claimsDone("Who is this training for?", "en")).toBe(false);
    expect(claimsDone("C'est fait.", "en")).toBe(true);
    expect(claimsDone("Ya está hecho, lo he añadido.", "es")).toBe(true);
    expect(claimsDone("¿Para quién es?", "es")).toBe(false);
  });
});

describe("séries et affirmations", () => {
  it("construit une règle hebdomadaire iCalendar", () => {
    expect(weeklyRule([2, 4])).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    expect(weeklyRule([4, 2, 2], "2026-12-20")).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261220T235959Z");
    expect(weeklyRule([7])).toBe("RRULE:FREQ=WEEKLY;BYDAY=SU");
  });
  it("repère un « c'est fait » sans rien derrière", () => {
    expect(claimsDone("C'est fait, j'ai ajouté les entraînements.")).toBe(true);
    expect(claimsDone("L'événement est prêt à confirmer.")).toBe(true);
    expect(claimsDone("Pour qui est cet entraînement ?")).toBe(false);
    expect(claimsDone("Demain il y a le dentiste à 16h.")).toBe(false);
  });
});

describe("pour qui, quelle que soit la langue de l'app", () => {
  it("comprend « pour moi » ou « on y va » dans une app réglée en anglais", () => {
    expect(resolveWho("pour moi", "me", members, "en")).toEqual(["me"]);
    expect(resolveWho("on y va tous ensemble", "me", members, "en")).toEqual(["family"]);
    expect(resolveWho("for me", "spouse", members, "fr")).toEqual(["spouse"]);
    expect(resolvePresent("personne", "me", members, "en")).toEqual([]);
    expect(resolveWho("Léo", "me", members, "en")).toEqual(["child:leo"]);
  });
});

describe("début et fin d'un événement préparé", () => {
  it("met les heures au format que Google accepte", () => {
    expect(normalizeWhen("2026-10-11 10:00", undefined, false)).toEqual({ start: "2026-10-11T10:00", end: "2026-10-11T11:00", allDay: false });
    expect(normalizeWhen("2026-10-11T9:30:00", "2026-10-11T11:00:00", false)).toEqual({ start: "2026-10-11T09:30", end: "2026-10-11T11:00", allDay: false });
  });
  it("un jour sans heure devient une journée entière", () => {
    expect(normalizeWhen("2026-10-11", undefined, false)).toEqual({ start: "2026-10-11", end: "2026-10-11", allDay: true });
    expect(normalizeWhen("2026-10-11T10:00", "2026-10-12T10:00", true)).toEqual({ start: "2026-10-11", end: "2026-10-12", allDay: true });
  });
  it("une fin avant le début, ou illisible, devient début + 1 h ; un début illisible est refusé", () => {
    expect(normalizeWhen("2026-10-11T23:30", "2026-10-11T10:00", false)).toEqual({ start: "2026-10-11T23:30", end: "2026-10-12T00:30", allDay: false });
    expect(normalizeWhen("2026-10-11T10:00", "plus tard", false)).toEqual({ start: "2026-10-11T10:00", end: "2026-10-11T11:00", allDay: false });
    expect(normalizeWhen("samedi 10h", undefined, false)).toHaveProperty("error");
    expect(normalizeWhen("2026-10-11T25:00", undefined, false)).toHaveProperty("error");
  });
});
