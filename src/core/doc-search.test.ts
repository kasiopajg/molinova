import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from "ai/test";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadContext, loadSettings, type Context } from "../config.js";
import { driveSchema } from "../db.js";
import { setLanguage } from "../i18n/index.js";
import { cardCounts, classifyDocs, markCardsStale, pendingDocs } from "./doc-classify.js";
import { docDetail, facetCounts, findDocs, ftsAny, listDocs, scoreRow, searchWords, visibleTo } from "./doc-search.js";
import { loadDocTaxonomy } from "./doc-questions.js";
setLanguage("fr");

const ctx: Context = { ...loadContext(), owner: { ...loadContext().owner, name: "Alex Martin" }, keyPeople: [{ name: "Clara Martin", relation: "épouse", emails: [] }], family: { children: [{ name: "Léo", activities: [] }], schoolDomains: [], activityDomains: [] } };
const settings = { ...loadSettings(), language: "fr" as const, concurrency: 4 };
// loadSettings() remet la langue du fichier de réglages : les questions de ces tests sont en français.
setLanguage("fr");

/**
 * Un faux Jev qui lit l'état : une carte d'identité est une pièce d'identité « Administratif », sensible ; le prénom cité
 * dit qui est concerné ; pour la recherche, « répond » si le type du document est celui de la demande.
 */
function fakeJev() {
  const dist = (keys: string[], top: string, p = 0.9) => Object.fromEntries(keys.map((k) => [k, k === top ? p : (1 - p) / (keys.length - 1)]));
  return new MockEvaluationModel({
    doEvaluate: async ({ state, questions }) => {
      const s = state as { text?: string; file?: { name: string }; request?: string; document?: { type: string } };
      const text = `${s.file?.name ?? ""} ${s.text ?? ""}`.toLowerCase();
      const isId = /identit/.test(text), isBill = /facture/.test(text);
      const answers: Record<string, unknown> = {};
      for (const [k, q] of Object.entries(questions)) {
        const keys = q.type === "choice" ? Object.keys((q as { criteria: Record<string, string> }).criteria) : [];
        if (k === "type") answers[k] = { type: "choice", choice: isId ? "identity" : isBill ? "invoice" : "other", probabilities: dist(keys, isId ? "identity" : isBill ? "invoice" : "other") };
        else if (k === "context") answers[k] = { type: "choice", choice: isId ? "admin" : isBill ? "home_utilities" : "other", probabilities: dist(keys, isId ? "admin" : isBill ? "home_utilities" : "other") };
        else if (k === "expiry") { const top = keys.find((x) => x !== "none") ?? "none"; answers[k] = { type: "choice", choice: top, probabilities: dist(keys, top) }; }
        else if (k === "party") answers[k] = { type: "choice", choice: "none", probabilities: dist(keys, "none") };
        else if (k.startsWith("person_")) { const name = (q as { instructions: string }).instructions.match(/concerne-t-il (\S+)/)?.[1]?.toLowerCase() ?? ""; answers[k] = { type: "boolean", probability: text.includes(name.split(" ")[0]) ? 0.9 : 0.1 }; }
        else if (k === "sensitive") answers[k] = { type: "boolean", probability: isId ? 0.95 : 0.1 };
        else if (k === "match") answers[k] = { type: "boolean", probability: /identit/.test(s.request ?? "") === (s.document?.type === "Pièce d'identité") ? 0.9 : 0.1 };
        else if (q.type === "score") answers[k] = { type: "score", score: 1.2, probabilities: { "0": 0.1, "1": 0.7, "2": 0.1, "3": 0.1 } };
        else answers[k] = { type: "boolean", probability: 0.8 };
      }
      return { answers: answers as never, warnings: [], providerMetadata: { typesafe: { confidence: {} } } };
    },
  });
}

function setup() {
  const db = new Database(":memory:");
  driveSchema(db);
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, from_name TEXT); CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE activity (id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now')), channel TEXT, kind TEXT, params_json TEXT, item_id INTEGER)");
  const files: Record<string, string> = {
    a: "RÉPUBLIQUE FRANÇAISE — CARTE NATIONALE D'IDENTITÉ. Nom : MARTIN. Prénom : Alex. Valable jusqu'au : 15.09.2032",
    b: "CARTE NATIONALE D'IDENTITÉ. Nom : MARTIN. Prénom : Clara. Valable jusqu'au : 20.11.2030",
    c: "Endesa — Facture d'électricité du 01/09/2026, montant 82,40 €",
  };
  const ins = db.prepare("INSERT INTO docs (account_id, file_id, name, mime, format, size, path, modified_at, created_at, in_scope, link) VALUES (1, ?, ?, 'text/plain', 'text', 100, ?, ?, ?, 1, ?)");
  ins.run("a", "IMG_4521.txt", "Scans", "2024-03-12T10:00:00Z", "2024-03-12T10:00:00Z", "https://drive/a");
  ins.run("b", "IMG_4522.txt", "Scans", "2023-06-01T10:00:00Z", "2023-06-01T10:00:00Z", "https://drive/b");
  ins.run("c", "Endesa septembre.txt", "Maison/Énergie", "2026-09-02T10:00:00Z", "2026-09-02T10:00:00Z", "https://drive/c");
  const reader = { async download(id: string) { return Buffer.from(files[id]); }, async exportAs(): Promise<Buffer> { throw new Error("no"); } };
  return { db, reader };
}

describe("fiche puis recherche", () => {
  it("classe tout, garde la fiche, ne garde pas le texte d'un document sensible", async () => {
    const { db, reader } = setup();
    expect(pendingDocs(db, 1)).toHaveLength(3);
    const job = await classifyDocs({ db, ctx, settings, accountId: 1, reader, model: fakeJev() });
    expect(job.lastError).toBeNull();
    expect(job).toMatchObject({ total: 3, done: 3, errors: 0 });
    const a = db.prepare("SELECT * FROM doc_cards WHERE file_id = 'a'").get() as Record<string, unknown>;
    expect(a).toMatchObject({ type: "identity", context: "admin", people: "me", sensitive: 1, expiry: "2032-09-15", excerpt: null, by: "jev" });
    expect(a.title).toBe("2024-03-12 Pièce d'identité · Alex – Administratif");
    const c = db.prepare("SELECT * FROM doc_cards WHERE file_id = 'c'").get() as Record<string, unknown>;
    expect(c).toMatchObject({ type: "invoice", sensitive: 0 });
    expect(c.excerpt).toMatch(/Endesa/);
    expect(cardCounts(db, 1)).toEqual({ inScope: 3, classified: 3, pending: 0 });
    // Le fichier change : il redevient à classer. Une fiche corrigée, jamais.
    db.prepare("UPDATE docs SET md5 = 'neuf' WHERE file_id = 'c'").run();
    db.prepare("UPDATE doc_cards SET by = 'user' WHERE file_id = 'b'").run();
    db.prepare("UPDATE docs SET md5 = 'neuf' WHERE file_id = 'b'").run();
    expect(pendingDocs(db, 1).map((x) => x.id)).toEqual(["c"]);
    // « Refaire les fiches » : celles de Jev redeviennent à classer, jamais celle corrigée à la main.
    expect(markCardsStale(db, 1)).toBe(2);
    expect(pendingDocs(db, 1).map((x) => x.id).sort()).toEqual(["a", "c"]);
  });

  it("« ma carte d'identité » : la sienne, nommée IMG_4521, avant celle de l'épouse ; la facture n'en est pas", async () => {
    const { db, reader } = setup();
    await classifyDocs({ db, ctx, settings, accountId: 1, reader, model: fakeJev() });
    const local = await findDocs({ db, ctx, settings }, { request: "ma carte d'identité", words: ["carte d'identité", "CNI", "DNI", "passeport"], type: "identity", people: ["me"] });
    expect(local.map((r) => r.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(local[0]).toMatchObject({ typeName: "Pièce d'identité", peopleNames: ["Alex"], expiry: "2032-09-15", link: "https://drive/a" });
    const judged = await findDocs({ db, ctx, settings, rerank: true, model: fakeJev() }, { request: "ma carte d'identité", words: ["identité"], people: ["me"] });
    expect(judged.map((r) => r.id)).toEqual(["a", "b"]);
    expect(judged.every((r) => (r.match ?? 0) >= 0.5)).toBe(true);
  });

  it("un proche ne voit ni les documents sensibles (sans réglage) ni ceux d'une personne qu'il ne suit pas", async () => {
    const { db, reader } = setup();
    await classifyDocs({ db, ctx, settings, accountId: 1, reader, model: fakeJev() });
    const q = { request: "carte d'identité", type: "identity" };
    expect(await findDocs({ db, ctx, settings, viewer: { sensitive: false, follows: ["me", "spouse"] } }, q)).toEqual([]);
    expect((await findDocs({ db, ctx, settings, viewer: { sensitive: true, follows: ["spouse", "family"] } }, q)).map((r) => r.id)).toEqual(["b"]);
  });

  it("la recherche de Google rattrape un document sans fiche, s'il est dans le périmètre", async () => {
    const { db } = setup();
    const r = await findDocs({ db, ctx, settings, google: async () => ["c", "inconnu"] }, { request: "électricité" });
    expect(r.map((x) => x.id)).toEqual(["c"]);
    expect(r[0].classified).toBe(false);
  });
});

describe("parcourir : dossiers, filtres, détail", () => {
  it("un dossier et ses sous-dossiers ; filtres par type, personne, signal ; comptes selon les autres filtres", async () => {
    const { db, reader } = setup();
    await classifyDocs({ db, ctx, settings, accountId: 1, reader, model: fakeJev() });
    const d = { db, ctx };
    expect(listDocs(d, { accountId: 1 }).total).toBe(3);
    expect(listDocs(d, { accountId: 1, folder: "Maison" }).rows.map((r) => r.id)).toEqual(["c"]);
    expect(listDocs(d, { accountId: 1, folder: "Mai" }).total).toBe(0);
    expect(listDocs(d, { accountId: 1, type: "identity", person: "spouse" }).rows.map((r) => r.id)).toEqual(["b"]);
    expect(listDocs(d, { accountId: 1, flag: "sensitive" }).total).toBe(2);
    expect(listDocs(d, { accountId: 1, q: "électricité" }).rows.map((r) => r.id)).toEqual(["c"]);
    const f = facetCounts(d, { accountId: 1, type: "identity" });
    // Le type choisi ne réduit pas ses propres comptes ; les autres groupes, si.
    expect(f.types).toEqual([{ key: "identity", name: "Pièce d'identité", n: 2 }, { key: "invoice", name: "Facture", n: 1 }]);
    expect(f.people.map((x) => [x.key, x.n])).toEqual([["me", 1], ["spouse", 1]]);
    expect(f.contexts.find((x) => x.key === "home")?.n).toBeUndefined();
    expect(facetCounts(d, { accountId: 1 }).contexts.find((x) => x.key === "home")?.n).toBe(1);
    expect(f.flags.sensitive).toBe(2);
    const det = docDetail(d, 1, "c")!;
    expect(det).toMatchObject({ typeName: "Facture", method: "plain" });
    expect(det.excerpt).toMatch(/Endesa/);
    expect(docDetail(d, 1, "a")!.excerpt).toBeNull();
  });
});

describe("langue de la recherche", () => {
  it("app en anglais, recherche en français : « impôts » trouve la fiche « Taxes », « carte d'identité » la fiche « ID document »", async () => {
    const { db, reader } = setup();
    setLanguage("en");
    await classifyDocs({ db, ctx, settings: { ...settings, language: "en" }, accountId: 1, reader, model: fakeJev() });
    const title = (db.prepare("SELECT title FROM doc_cards WHERE file_id = 'a'").get() as { title: string }).title;
    expect(title).toMatch(/ID document/);
    const r = await findDocs({ db, ctx, settings }, { request: "pièce d'identité" });
    expect(r.map((x) => x.id)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(r.map((x) => x.id)).not.toContain("c");
    setLanguage("fr");
  });
});

describe("mots et score", () => {
  it("mots utiles, sans mots de liaison ni lettres seules ; index en OU", () => {
    expect(searchWords({ request: "cherche ma carte d'identité", words: ["CNI", "DNI"] })).toEqual(["cni", "dni", "carte", "identite"]);
    expect(ftsAny(["cni", "carte"])).toBe('"cni"* OR "carte"*');
  });
  it("une fiche qui concerne quelqu'un d'autre recule ; celle de la bonne personne avance", () => {
    const tax = loadDocTaxonomy();
    const mine = scoreRow({ type: "identity", context: "admin", context2: null, people: "me", valid: 1 }, { request: "x", type: "identity", people: ["me"] }, tax, 1);
    const hers = scoreRow({ type: "identity", context: "admin", context2: null, people: "spouse", valid: 1 }, { request: "x", type: "identity", people: ["me"] }, tax, 1);
    expect(mine).toBeGreaterThan(hers);
    expect(scoreRow({ type: null, context: "car_insurance", context2: null, people: null, valid: null }, { request: "x", context: "car" }, tax, 0)).toBeCloseTo(0.8);
  });
  it("visibilité", () => {
    expect(visibleTo({ sensitive: 1, people: null }, undefined)).toBe(true);
    expect(visibleTo({ sensitive: 0, people: "" }, { sensitive: false, follows: [] })).toBe(true);
    expect(visibleTo({ sensitive: 0, people: "child:leo" }, { sensitive: false, follows: ["family"] })).toBe(false);
  });
});
