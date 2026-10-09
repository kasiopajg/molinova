import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// declutter.ts charge config.ts et la base : dossier de données neuf, jamais le dépôt.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-declutter-"));
let mod: typeof import("./declutter.js");
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  vi.resetModules();
  mod = await import("./declutter.js");
});
afterAll(() => { delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

describe("nettoyer le bruit de « À caler »", () => {
  it("écarte les sollicitations, garde les vraies démarches, laisse en place ce que Jev n'a pas pu relire", async () => {
    const cfg = await import("../config.js");
    const { openDb, upsertAccount, upsertItem, saveDecision } = await import("../db.js");
    const { makeClassifier } = await import("./classify.js");
    const db = openDb();
    // Jev factice : « Soldes » est une sollicitation, « Panne » fait échouer l'appel, le reste est une vraie démarche.
    const model = new MockEvaluationModel({
      doEvaluate: async (opts: unknown) => {
        const s = JSON.stringify(opts);
        if (s.includes("Panne")) throw new Error("gateway down");
        return { answers: { real_action: { type: "boolean", probability: s.includes("Soldes") ? 0.05 : 0.92 } } as never, warnings: [], providerMetadata: { typesafe: { confidence: {} } } };
      },
    });
    const c = makeClassifier({ settings: cfg.loadSettings(), taxonomy: cfg.loadTaxonomy(), rules: [], ctx: cfg.loadContext(), db, model });
    const accountId = upsertAccount(db, "gmail", "declutter@x.com").id;
    const add = (subject: string, flags: Record<string, boolean>) => {
      const id = upsertItem(db, { externalId: subject, accountId, source: "gmail", fromName: "X", fromAddress: "x@shop.example", to: [], subject, date: new Date(), bodyExcerpt: subject, hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX"] });
      saveDecision(db, { itemId: id, decidedBy: "jev", category: c.taxonomy.categories[0].key, confidence: 1, needsReview: false, flags: { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false, ...flags } as never });
      return id;
    };
    const promo = add("Soldes : -50 % sur tout", { task: true });
    const tax = add("Rappel : paiement des impôts avant le 15", { task: true });
    const broken = add("Panne", { event: true });
    add("Juste une info", {}); // ni tâche ni événement : hors de « À caler »
    const rows = mod.toCalRows(c);
    expect(rows.map((r) => r.id).sort()).toEqual([promo, tax, broken].sort());
    const r = await mod.declutter(c, rows);
    expect(r.ignored.map((x) => x.id)).toEqual([promo]);
    expect(r.kept).toBe(1);
    expect(r.errors).toBe(1);
    const state = (id: number) => (db.prepare("SELECT action_state s FROM decisions WHERE item_id = ?").get(id) as { s: number }).s;
    expect([state(promo), state(tax), state(broken)]).toEqual([2, 0, 0]);
    expect(mod.toCalRows(c).map((x) => x.id).sort()).toEqual([tax, broken].sort());

    // Un email de plus de 30 jours ne propose plus rien… sauf si sa date extraite est encore à venir.
    const old = (subject: string, days: number) => {
      const id = upsertItem(db, { externalId: subject, accountId, source: "gmail", fromName: "Y", fromAddress: "y@air.example", to: [], subject, date: new Date(Date.now() - days * 86_400_000), bodyExcerpt: subject, hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX"] });
      saveDecision(db, { itemId: id, decidedBy: "jev", category: c.taxonomy.categories[0].key, confidence: 1, needsReview: false, flags: { reply: false, toPay: false, spam: false, urgent: false, important: false, event: true } as never });
      return id;
    };
    const pastFlight = old("Vol de 2024", 400);
    const farAppointment = old("Rendez-vous dans deux mois", 45);
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?)").run(farAppointment, JSON.stringify({ kind: "draft", title: "RDV", start: future }));
    // Année devinée (« jeudi 21 » d'un email de 2025 projeté en 2026) : ne compte pas, sauf si l'année est écrite dans l'email.
    const guessed = old("Contact sur notre site, rendez-vous jeudi 21", 400);
    db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?)").run(guessed, JSON.stringify({ kind: "draft", title: "RDV", start: future, uncertain: ["année"] }));
    const written = old(`Invitation - lun. 19 avr. ${future.slice(0, 4)}`, 400);
    db.prepare("INSERT INTO event_drafts (item_id, draft_json) VALUES (?, ?)").run(written, JSON.stringify({ kind: "draft", title: "ITV", start: future, uncertain: ["heure", "lieu"] }));
    const ids = mod.toCalRows(c).map((x) => x.id);
    expect(ids).toContain(farAppointment);
    expect(ids).toContain(written);
    expect(ids).not.toContain(pastFlight);
    expect(ids).not.toContain(guessed);
  });
});
