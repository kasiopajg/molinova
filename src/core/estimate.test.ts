import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base neuve dans un dossier temporaire : jamais celle du dépôt.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-estimate-"));
let est: typeof import("./estimate.js");
let dbm: typeof import("../db.js");
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  fs.mkdirSync(path.join(home, "data"), { recursive: true });
  vi.resetModules();
  dbm = await import("../db.js");
  est = await import("./estimate.js");
});
afterAll(() => { dbm.closeDb(); delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

const S = { jevModel: "typesafe-ai/jev", writerModel: "openai/gpt-5.4-mini" };
const PRICES = { "typesafe-ai/jev": { input: 0.00000002, output: 0.0000001 }, "openai/gpt-5.4-mini": { input: 0.00000075, output: 0.0000045 } };

describe("estimation du coût avant un lancement en masse", () => {
  it("sans historique : prudente, chaque élément passe par Jev, au tarif du modèle", () => {
    const db = dbm.openDb();
    dbm.kvSet(db, "gateway.models", { fetchedAt: new Date().toISOString(), models: Object.entries(PRICES).map(([id, pricing]) => ({ id, name: id, pricing })) });
    const rate = est.aiRate(db, S, "gmail");
    expect(rate).toMatchObject({ basis: "default", sample: 0, jevShare: 1, extractShare: 0.05 });
    const e = est.estimateFor(rate, 1000);
    // 1 000 × (3 000 tokens Jev + 5 % × 850 tokens d'extraction)
    expect(e.inputTokens).toBe(1000 * 3000 + Math.round(1000 * 0.05 * 850));
    expect(e.cost).toBeCloseTo(1000 * (3000 * 2e-8 + 160 * 1e-7) + 50 * (850 * 7.5e-7 + 130 * 4.5e-6), 6);
    expect(e.maxCost).toBe(e.cost);
  });

  it("avec historique : coût réel moyen, part réelle de Jev, maximum si tout passe par Jev", () => {
    const db = dbm.openDb();
    const acc = dbm.upsertAccount(db, "gmail", "me@example.com");
    const insItem = db.prepare("INSERT INTO items (account_id, external_id, subject, date) VALUES (?, ?, 's', '2026-10-01')");
    const insDec = db.prepare("INSERT INTO decisions (item_id, decided_by, category) VALUES (?, ?, 'x')");
    const insUse = db.prepare("INSERT INTO usage (purpose, model, input_tokens, output_tokens, cost, estimated, item_id) VALUES (?, ?, ?, ?, ?, 0, ?)");
    for (let k = 0; k < 100; k++) {
      const id = Number(insItem.run(acc.id, `m${k}`).lastInsertRowid);
      // 60 passent par Jev, 40 par les règles ou la mémoire ; 2 déclenchent une extraction.
      const jev = k < 60;
      insDec.run(id, jev ? "jev" : "memory");
      if (jev) insUse.run("classify", S.jevModel, 3000, 150, 0.0001, id);
      if (k < 2) insUse.run("extract_event", S.writerModel, 800, 150, 0.002, id);
    }
    const rate = est.aiRate(db, S, "gmail");
    expect(rate).toMatchObject({ basis: "measured", sample: 100, jevShare: 0.6, extractShare: 0.02 });
    expect(rate.jev.cost).toBeCloseTo(0.0001, 8);
    const e = est.estimateFor(rate, 10_000);
    expect(e.cost).toBeCloseTo(10_000 * (0.6 * 0.0001 + 0.02 * 0.002), 6);
    expect(e.maxCost).toBeCloseTo(10_000 * (0.0001 + 0.02 * 0.002), 6);
    // Reclassement : tout passe par Jev, le probable est le maximum.
    expect(est.estimateFor(rate, 10_000, { allJev: true }).cost).toBeCloseTo(e.maxCost!, 8);
    // Une autre source garde ses propres chiffres : WhatsApp sans historique reste prudent.
    expect(est.aiRate(db, S, "whatsapp").basis).toBe("default");
  });

  it("tarif inconnu : les tokens restent, le coût est inconnu plutôt qu'inventé", () => {
    const db = dbm.openDb();
    const rate = est.aiRate(db, { jevModel: "acme/unknown", writerModel: "acme/other" }, "drive");
    const e = est.estimateFor(rate, 10);
    expect(e.inputTokens).toBeGreaterThan(0);
    expect(e.cost).toBeNull();
    // Jev chiffré, extraction sans tarif : le coût de Jev reste, signalé comme partiel.
    const half = est.estimateFor(est.aiRate(db, { jevModel: S.jevModel, writerModel: "acme/other" }, "whatsapp"), 10);
    expect(half.cost).toBeGreaterThan(0);
    expect(half.partial).toBe(true);
    // Drive : le texte se lit sur le Mac, seule la fiche passe par Jev ; aucun modèle rédacteur, donc jamais partiel.
    const drive = est.estimateFor(est.aiRate(db, { jevModel: S.jevModel, writerModel: "acme/other" }, "drive"), 10);
    expect(drive.cost).toBeGreaterThan(0);
    expect(drive.partial).toBe(false);
    expect(drive.cost).toBeCloseTo(drive.maxCost!, 10);
  });
});
