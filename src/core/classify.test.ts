import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from "ai/test";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadContext, loadSettings, loadTaxonomy } from "../config.js";
import type { Item } from "../connectors/types.js";
import { rememberSender } from "../db.js";
import { classify, labelsFor, makeClassifier } from "./classify.js";
import { setLanguage } from "../i18n/index.js";
import { DEFAULT_SPECIAL_LABELS } from "../i18n/taxonomy-defaults.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");
/** Les réglages du fichier, mais en français : les libellés attendus par ces tests sont « AI/À répondre », « AI/À revoir ». */
const frSettings = () => { const s = { ...loadSettings(), language: "fr" as const, specialLabels: { ...DEFAULT_SPECIAL_LABELS.fr } }; setLanguage("fr"); return s; };

function mockJev(answers: Record<string, unknown>, confidence: Record<string, number>) {
  return new MockEvaluationModel({
    doEvaluate: async () => ({ answers: answers as never, warnings: [], providerMetadata: { typesafe: { confidence } } }),
  });
}

const item = (over: Partial<Item> = {}): Item => ({
  externalId: "m1",
  accountId: 1,
  source: "gmail",
  fromName: "Clara",
  fromAddress: "clara@example.org",
  to: ["alex.martin@example.com"],
  subject: "Re: retours plugin",
  date: new Date("2026-09-23"),
  bodyExcerpt: "Peux-tu me dire d'ici vendredi si…",
  hasAttachments: false,
  hasListUnsubscribe: false,
  isOutgoing: false,
  labels: [],
  ...over,
});

/** Le SDK vérifie que chaque distribution est complète : on la construit sur toutes les options. */
function dist(keys: string[], top: string, p: number): Record<string, number> {
  const rest = (1 - p) / (keys.length - 1);
  return Object.fromEntries(keys.map((k) => [k, k === top ? p : rest]));
}
const catKeys = loadTaxonomy().categories.map((c) => c.key);
const childKeys = [...loadContext().family.children.map((c) => c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")), "none"];
const jevSure = {
  category: { type: "choice", choice: "clients", probabilities: dist(catKeys, "clients", 0.91) },
  reply_expected: { type: "boolean", probability: 0.96 },
  awaits_reply: { type: "boolean", probability: 0.05 },
  priority: { type: "score", score: 2.1, probabilities: { "0": 0.05, "1": 0.15, "2": 0.45, "3": 0.35 } },
  spam: { type: "boolean", probability: 0.02 },
  attention: { type: "boolean", probability: 0.1 },
  event: { type: "boolean", probability: 0.05 },
  task: { type: "boolean", probability: 0.05 },
  to_pay: { type: "boolean", probability: 0.03 },
  time_bound: { type: "boolean", probability: 0.1 },
  ephemeral: { type: "choice", choice: "none", probabilities: { code: 0.02, signin: 0.02, none: 0.96 } },
  child: { type: "choice", choice: "none", probabilities: dist(childKeys, "none", 0.97) },
};

function classifier(model: ReturnType<typeof mockJev>) {
  // Base en mémoire pour ne pas toucher data/ ; seule la mémoire expéditeur sert ici. Aucune règle : chaque test pose les siennes.
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE sender_memory (account_id INTEGER, from_address TEXT, category TEXT, count INTEGER DEFAULT 1,
       last_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (account_id, from_address, category));
     CREATE TABLE corrections (id INTEGER PRIMARY KEY, item_id INTEGER, from_category TEXT, to_category TEXT, made_at TEXT DEFAULT (datetime('now')));
     CREATE TABLE items (id INTEGER PRIMARY KEY, from_name TEXT, from_address TEXT, subject TEXT);`,
  );
  return makeClassifier({ taxonomy: loadTaxonomy(), settings: frSettings(), rules: [], ctx: loadContext(), db, model });
}

describe("cascade de classement", () => {
  it("une règle fixe la catégorie mais Jev fournit encore les signaux", async () => {
    const c = classifier(mockJev({ ...jevSure, category: { ...jevSure.category, choice: "promotions", probabilities: dist(catKeys, "promotions", 0.9) } }, { category: 0.9 }));
    c.rules = [{ id: "client", when: { fromDomain: "client.example.com" }, category: "clients", origin: "user", stop: false, quiet: false }];
    const o = await classify(c, item({ fromAddress: "clara@client.example.com" }));
    expect(o.decidedBy).toBe("rule");
    expect(o.category).toBe("clients");
    expect(o.flags.reply).toBe(true);
    expect(labelsFor(c, o)).toEqual(["AI/Clients", "AI/À répondre"]);
  });

  it("une règle « stop » n'appelle pas Jev", async () => {
    const c = classifier(mockJev(jevSure, { category: 0.9 }));
    c.rules = [{ id: "x", when: { fromDomain: "example.org" }, category: "promotions", origin: "user", stop: true, quiet: false }];
    const o = await classify(c, item());
    expect(o.jev).toBeUndefined();
    expect(labelsFor(c, o)).toEqual(["AI/Promotions"]);
  });

  it("un email signalant un problème reçoit AI/Important, même en Notifications", async () => {
    const c = classifier(mockJev({ ...jevSure, category: { ...jevSure.category, choice: "notifications", probabilities: dist(catKeys, "notifications", 0.9) }, reply_expected: { type: "boolean", probability: 0.1 }, attention: { type: "boolean", probability: 0.93 } }, { category: 0.9 }));
    const o = await classify(c, item({ fromAddress: "noreply@bank.example" }));
    expect(o.flags.important).toBe(true);
    expect(labelsFor(c, o)).toEqual(["AI/Notifications", "AI/Important"]);
  });

  it("un code à usage unique est éphémère : ni réponse ni tâche, le nettoyage le sortira après 30 min", async () => {
    const c = classifier(mockJev({ ...jevSure, task: { type: "boolean", probability: 0.9 }, ephemeral: { type: "choice", choice: "code", probabilities: { code: 0.92, signin: 0.04, none: 0.04 } } }, { category: 0.9 }));
    const o = await classify(c, item({ subject: "Votre code de connexion" }));
    expect(o.flags).toMatchObject({ ephemeral: "code", reply: false, task: false });
  });
  it("un doute de Jev ne rend pas un email éphémère", async () => {
    const c = classifier(mockJev({ ...jevSure, ephemeral: { type: "choice", choice: "signin", probabilities: { code: 0.2, signin: 0.5, none: 0.3 } } }, { category: 0.9 }));
    const o = await classify(c, item());
    expect((o.flags as { ephemeral?: string }).ephemeral).toBeUndefined();
  });

  it("la mémoire expéditeur gagne après assez d'exemples concordants", async () => {
    const c = classifier(mockJev(jevSure, { category: 0.9 }));
    for (let i = 0; i < 3; i++) rememberSender(c.db, 1, "clara@example.org", "clients");
    const o = await classify(c, item());
    expect(o.decidedBy).toBe("memory");
  });

  it("une catégorie mémorisée qui n'existe plus est ignorée : la réponse de Jev compte", async () => {
    const c = classifier(mockJev(jevSure, { category: 0.91 }));
    for (let i = 0; i < 3; i++) rememberSender(c.db, 1, "clara@example.org", "categorie_disparue");
    const o = await classify(c, item());
    expect(o.category).toBe("clients");
    expect(o.needsReview).toBe(false);
  });
  it("Jev sûr : catégorie posée, drapeau réponse attendue", async () => {
    const c = classifier(mockJev(jevSure, { category: 0.9 }));
    const o = await classify(c, item());
    expect(o.decidedBy).toBe("jev");
    expect(o.needsReview).toBe(false);
    expect(o.flags.reply).toBe(true);
    expect(labelsFor(c, o)).toEqual(["AI/Clients", "AI/À répondre"]);
  });

  it("Jev hésitant : l'email part en « À revoir »", async () => {
    const c = classifier(mockJev({ ...jevSure, category: { type: "choice", choice: "clients", probabilities: dist(catKeys, "clients", 0.5) } }, { category: 0.3 }));
    const o = await classify(c, item());
    expect(o.needsReview).toBe(true);
    expect(labelsFor(c, o)).toContain("AI/À revoir");
  });

  it("une catégorie hors taxonomie est rejetée avant d'être posée", async () => {
    const c = classifier(mockJev({ ...jevSure, category: { type: "choice", choice: "inventee", probabilities: dist([...catKeys, "inventee"], "inventee", 0.95) } }, { category: 0.95 }));
    await expect(classify(c, item())).rejects.toThrow(/unknown option/);
  });

  it("un email envoyé par le propriétaire n'attend pas de réponse de lui", async () => {
    const c = classifier(mockJev(jevSure, { category: 0.9 }));
    const o = await classify(c, item({ isOutgoing: true, fromAddress: "alex.martin@example.com" }));
    expect(o.flags.reply).toBe(false);
  });
});

describe("envoyés qui attendent une réponse", () => {
  const sent = () => item({ isOutgoing: true, fromAddress: "alex.martin@example.com", to: ["clara@example.org"] });
  it("un envoi avec une question est suivi (awaitReply), sans jamais être « à répondre »", async () => {
    const c = classifier(mockJev({ ...jevSure, reply_expected: { type: "boolean", probability: 0.1 }, awaits_reply: { type: "boolean", probability: 0.92 } }, { category: 0.9 }));
    const o = await classify(c, sent());
    expect(o.flags.awaitReply).toBe(true);
    expect(o.flags.reply).toBe(false);
    expect(o.needsReview).toBe(false);
  });
  it("un simple merci envoyé n'est pas suivi", async () => {
    const c = classifier(mockJev({ ...jevSure, awaits_reply: { type: "boolean", probability: 0.2 } }, { category: 0.9 }));
    const o = await classify(c, sent());
    expect(o.flags.awaitReply).toBe(false);
  });
  it("un email reçu n'est jamais « en attente de réponse », même si Jev le dit", async () => {
    const c = classifier(mockJev({ ...jevSure, awaits_reply: { type: "boolean", probability: 0.95 } }, { category: 0.9 }));
    const o = await classify(c, item());
    expect(o.flags.awaitReply).toBe(false);
    expect(o.flags.reply).toBe(true);
  });
});
