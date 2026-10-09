import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ephemeralByText } from "./ephemeral.js";

describe("messages à durée de vie courte : détection par mots-clés", () => {
  // Objets réels de la file Actions (anonymisés), et formes courantes dans les trois langues.
  const code = [
    "Alex, please verify your new device",
    "Vercel Email Verification",
    "Acme Code de vérification",
    "Please confirm your sign-up",
    "123456 is your Facebook code",
    "Ton code Facebook est 482913",
    "Votre code de connexion",
    "Tu código de verificación de Amazon",
    "Confirmez votre adresse e-mail",
    "Your one-time password",
    "Sign-in link for Notion",
    "Alex, here's your PIN 445882",
    "Vérifiez votre compte",
    "Verifica tu cuenta de Netflix",
    "Alex, here's the link to reset your password",
    "Réinitialisez votre mot de passe",
  ];
  const signin = [
    "Account security alert - Create a new password",
    "Alerte de sécurité",
    "New sign-in to your account",
    "Nouvelle connexion à votre compte",
    "Your password was changed",
    "Suspicious activity on your account",
    "Alerta de seguridad: nuevo inicio de sesión",
    "Alex, your password was successfully reset",
  ];
  const none = [
    "Confirmation de votre commande Google Play du 19 sept. 2026",
    "Action Required: Additional Verification Required - 2026-09-23",
    "Estamos verificando tu cuenta de Amazon Business",
    "Unlock Smarter Outdoor Security",
    "Erreur de connexion",
    "Your code review is ready",
    "Facture électricité octobre",
    "Réunion parents d'élèves jeudi",
    "Se ha confirmado tu suscripción",
    "Confirm your subscription to our newsletter",
    "Votre code postal a été mis à jour",
  ];
  it.each(code)("code : %s", (s) => expect(ephemeralByText(s)).toBe("code"));
  it.each(signin)("alerte : %s", (s) => expect(ephemeralByText(s)).toBe("signin"));
  it.each(none)("rien : %s", (s) => expect(ephemeralByText(s)).toBeNull());
  it("regarde aussi le corps quand l'objet ne dit rien, même loin après l'en-tête", () => {
    expect(ephemeralByText("Facebook", "Hi, 482913 is your Facebook code. Don't share it.")).toBe("code");
    // Un lien de suivi qui contient « otp » ne fait pas d'une invitation un code.
    expect(ephemeralByText("I want to connect", "Hanne wants to connect. Accept: https://www.linkedin.com/comm/invitations?eid=9udsw&otp=1&midToken=AQ")).toBeNull();
    expect(ephemeralByText("Acme", `${"Acme Connect ".repeat(80)}VOUS Y ÊTES PRESQUE. Confirmez votre adresse e-mail pour activer votre compte.`)).toBe("code");
  });
});

// ---------- nettoyage de la file, sur une base neuve
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-eph-"));
let dbm: typeof import("../db.js");
let eph: typeof import("./ephemeral.js");
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  fs.mkdirSync(path.join(home, "data"), { recursive: true });
  vi.resetModules();
  dbm = await import("../db.js");
  eph = await import("./ephemeral.js");
});
afterAll(() => { dbm.closeDb(); delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

describe("nettoyage de la file Actions", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  function add(db: ReturnType<typeof dbm.openDb>, acc: number, id: string, subject: string, date: string, flags: Record<string, unknown> = {}, outgoing = 0): number {
    const itemId = Number(db.prepare("INSERT INTO items (account_id, external_id, subject, date, is_outgoing) VALUES (?, ?, ?, ?, ?)").run(acc, id, subject, date, outgoing).lastInsertRowid);
    db.prepare("INSERT INTO decisions (item_id, decided_by, category, flags_json) VALUES (?, 'jev', 'x', ?)").run(itemId, JSON.stringify({ important: true, ...flags }));
    return itemId;
  }
  const state = (db: ReturnType<typeof dbm.openDb>, id: number) => (db.prepare("SELECT action_state s, flags_json f FROM decisions WHERE item_id = ?").get(id) as { s: number; f: string });

  it("codes et alertes de plus de 30 min passent en « dépassé », les frais restent, le reste ne bouge pas", () => {
    const db = dbm.openDb();
    const acc = dbm.upsertAccount(db, "gmail", "me@example.com").id;
    const wa = dbm.upsertAccount(db, "whatsapp", "whatsapp").id;
    const oldCode = add(db, acc, "a", "Votre code de connexion", ago(45));
    const freshCode = add(db, acc, "b", "Votre code de connexion", ago(10));
    const oldAlert = add(db, acc, "c", "Hello", ago(31), { ephemeral: "signin" }); // Jev l'a dit, l'objet ne le dit pas
    const invoice = add(db, acc, "d", "Facture électricité octobre", ago(600));
    const mine = add(db, acc, "e", "Ton code Facebook est 482913", ago(90), {}, 1); // mon propre envoi : jamais touché
    const chat = add(db, wa, "f", "Votre code de connexion", ago(90)); // WhatsApp : hors du champ
    const r = eph.sweepQueue(db, now);
    expect(r).toEqual({ codes: 1, signins: 1, past: 0 });
    expect(state(db, oldCode)).toMatchObject({ s: 3 });
    expect(JSON.parse(state(db, oldCode).f).ephemeral).toBe("code");
    expect(state(db, oldAlert).s).toBe(3);
    for (const id of [freshCode, invoice, mine, chat]) expect(state(db, id).s).toBe(0);
    // Un deuxième passage ne refait rien.
    expect(eph.sweepQueue(db, now)).toEqual({ codes: 0, signins: 0, past: 0 });
  });

  it("une proposition d'événement dont la date est passée sort aussi", () => {
    const db = dbm.openDb();
    const acc = dbm.upsertAccount(db, "gmail", "me@example.com").id;
    const ev = add(db, acc, "g", "Réunion parents", ago(60 * 24 * 10), { event: true });
    db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?)").run(ev, JSON.stringify({ kind: "draft", title: "Réunion", start: "2026-09-20T18:00:00", end: "2026-09-20T19:00:00", allDay: false, timezone: "Europe/Paris" }));
    expect(eph.sweepQueue(db, now).past).toBe(1);
    expect(state(db, ev).s).toBe(3);
  });

  it("une proposition sans date trouvée vaut le jour du message, puis sort", () => {
    const db = dbm.openDb();
    const acc = dbm.upsertAccount(db, "gmail", "me@example.com").id;
    const draft = JSON.stringify({ kind: "draft", found: false, title: "", start: "", end: "", allDay: false, timezone: "Europe/Madrid" });
    const yesterday = add(db, acc, "j", "Para el partido de mañana, polo azul", ago(60 * 20), { event: true, task: true });
    const sameDay = add(db, acc, "k", "Para el partido de mañana, polo azul", ago(60), { event: true });
    for (const id of [yesterday, sameDay]) db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?)").run(id, draft);
    eph.sweepQueue(db, now);
    expect(state(db, yesterday).s).toBe(3);
    expect(state(db, sameDay).s).toBe(0);
  });

  it("Telegram : seules les alertes de connexion fraîches partent", () => {
    const db = dbm.openDb();
    const acc = dbm.upsertAccount(db, "gmail", "me@example.com").id;
    const fresh = add(db, acc, "h", "New sign-in to your account", ago(5));
    add(db, acc, "i", "123456 is your Facebook code", ago(3)); // un code : jamais sur Telegram
    expect(eph.freshSigninAlerts(db, now).map((a) => a.id)).toEqual([fresh]);
  });
});
