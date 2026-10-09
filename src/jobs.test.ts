import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// jobs.ts charge config.ts : dossier de données neuf, jamais le dépôt.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-jobs-"));
let jobsMod: typeof import("./jobs.js");
let watchesToResume: typeof import("./jobs.js").watchesToResume;
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  vi.resetModules();
  jobsMod = await import("./jobs.js");
  ({ watchesToResume } = jobsMod);
});
afterAll(() => { delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

const acc = (id: number, email: string, over: Partial<{ source: string; watch_since: string | null; watch_every: number | null }> = {}) =>
  ({ id, email, source: "gmail", watch_since: "2026-09-28 10:00:00", watch_every: 300, ...over });

describe("surveillances à relancer au démarrage", () => {
  it("garde les boîtes Gmail surveillées dont le jeton existe, avec leur intervalle", () => {
    const tokens = new Set(["a@x.com", "c@x.com"]);
    const out = watchesToResume([
      acc(1, "a@x.com", { watch_every: 120 }),
      acc(2, "b@x.com"), // jeton absent
      acc(3, "c@x.com", { watch_since: null, watch_every: null }), // arrêtée par l'utilisateur
      acc(4, "whatsapp", { source: "whatsapp" }),
    ], (e) => tokens.has(e));
    expect(out).toEqual([{ accountId: 1, every: 120 }]);
  });
  it("ignore une surveillance d'avant la persistance (sans intervalle) et borne un intervalle trop court", () => {
    const out = watchesToResume([acc(1, "a@x.com", { watch_every: null }), acc(2, "b@x.com", { watch_every: 5 })], () => true);
    expect(out).toEqual([{ accountId: 2, every: 30 }]);
  });
});

describe("surveillance : erreurs", () => {
  /** Un classifieur réel sur la base du dossier temporaire, et une boîte Gmail factice. */
  async function setup(email: string) {
    const cfg = await import("./config.js");
    const { openDb, upsertAccount } = await import("./db.js");
    const { makeClassifier } = await import("./core/classify.js");
    const db = openDb();
    dbRef = db;
    const c = makeClassifier({ settings: cfg.loadSettings(), taxonomy: cfg.loadTaxonomy(), rules: cfg.loadRules(), ctx: cfg.loadContext(), db });
    return { c, db, accountId: upsertAccount(db, "gmail", email).id };
  }
  const openDbFor = () => dbRef!;
  let dbRef: import("./db.js").Db | null = null;
  const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };

  it("une erreur réseau au démarrage (Wi-Fi pas encore là) est réessayée au passage suivant", async () => {
    const { c, db, accountId } = await setup("net@x.com");
    let labelsCalls = 0;
    const gm = {
      ensureLabels: async () => { if (++labelsCalls === 1) throw new Error("getaddrinfo ENOTFOUND gmail.googleapis.com"); return new Map(); },
      currentHistoryId: async () => "100",
      newMessagesSince: async () => ({ ids: [], historyId: "101" }),
    } as unknown as import("./connectors/gmail.js").GmailConnector;
    const job = jobsMod.startJob("watch", c, gm, accountId, { every: 0.01 });
    await until(() => (db.prepare("SELECT history_id h FROM accounts WHERE id = ?").get(accountId) as { h: string | null }).h === "101");
    expect(job.status).toBe("running");
    expect(job.errors).toBe(1);
    expect(job.lastError).toMatch(/ENOTFOUND/);
    await jobsMod.stopAndWait(job.id, 2000);
    expect(job.status).toBe("stopped");
  });
  it("un jeton refusé par Google termine la surveillance en erreur", async () => {
    const { c, accountId } = await setup("auth@x.com");
    const gm = {
      ensureLabels: async () => new Map(),
      currentHistoryId: async () => "100",
      newMessagesSince: async () => { throw new Error("invalid_grant"); },
    } as unknown as import("./connectors/gmail.js").GmailConnector;
    const job = jobsMod.startJob("watch", c, gm, accountId, { every: 0.01 });
    await until(() => job.status !== "running");
    expect(job.status).toBe("error");
    expect(jobsMod.isAuthError(job.error)).toBe(true);
    expect(jobsMod.isAuthError(new Error("socket hang up"))).toBe(false);
    const { listActivity } = await import("./db.js");
    expect(listActivity(openDbFor()).find((a) => a.kind === "jobError")?.params).toMatchObject({ kind: "watch", email: "auth@x.com", auth: true });
  });
  it("un passage qui trouve des emails s'inscrit au fil et donne l'heure du prochain", async () => {
    const { c, accountId } = await setup("pass@x.com");
    // Une règle « stop » classe sans appeler Jev.
    c.rules.push({ id: "t", when: { fromDomain: "ecole.example" }, category: c.taxonomy.categories[0].key, origin: "user", stop: true, quiet: false });
    let calls = 0;
    const item = { externalId: "m1", accountId, source: "gmail" as const, fromName: "École", fromAddress: "info@ecole.example", to: [], subject: "Sortie", date: new Date(), bodyExcerpt: "", hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX", "UNREAD"] };
    const gm = {
      ensureLabels: async () => new Map(),
      currentHistoryId: async () => "100",
      newMessagesSince: async () => (++calls === 1 ? { ids: ["m1"], historyId: "101" } : { ids: [], historyId: "101" }),
      fetch: async () => item,
      applyLabels: async () => {},
    } as unknown as import("./connectors/gmail.js").GmailConnector;
    const job = jobsMod.startJob("watch", c, gm, accountId, { every: 60 });
    await until(() => !!job.nextPassAt);
    expect(job.lastPassAt).toBeTypeOf("number");
    expect(job.nextPassAt! - job.lastPassAt!).toBeGreaterThanOrEqual(59_000);
    const { listActivity } = await import("./db.js");
    expect(listActivity(openDbFor()).find((a) => a.kind === "pass")?.params).toMatchObject({ email: "pass@x.com", n: 1 });
    await jobsMod.stopAndWait(job.id, 2000);
    expect(job.nextPassAt).toBeUndefined();
  });
  it("onDone est appelé à la fin d'un aperçu (relance de la surveillance mise en pause)", async () => {
    const { c, accountId } = await setup("ondone@x.com");
    const gm = { listIds: async () => [] } as unknown as import("./connectors/gmail.js").GmailConnector;
    let done = 0;
    const job = jobsMod.startJob("preview", c, gm, accountId, { onDone: () => { done++; } });
    await until(() => job.status !== "running");
    expect(job.status).toBe("done");
    expect(done).toBe(1);
    expect(jobsMod.runningFor(accountId)).toBeUndefined();
  });

  /** Un email classé en base, avec sa décision. */
  async function stored(c: Awaited<ReturnType<typeof setup>>["c"], accountId: number, ext: string, daysAgo: number, dec: { category: string; decidedBy: "user" | "jev"; flags?: Record<string, unknown> }) {
    const { upsertItem, saveDecision } = await import("./db.js");
    const id = upsertItem(c.db, { externalId: ext, accountId, source: "gmail", fromName: "École", fromAddress: `info@ecole.example`, to: [], subject: ext, date: new Date(Date.now() - daysAgo * 86_400_000), bodyExcerpt: "", hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX"] });
    saveDecision(c.db, { itemId: id, decidedBy: dec.decidedBy, category: dec.category, confidence: 1, needsReview: false, flags: { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false, ...(dec.flags ?? {}) } as never });
    return id;
  }
  it("reclasser à la demande : la catégorie choisie par l'utilisateur reste, les drapeaux d'état aussi", async () => {
    const { c, accountId } = await setup("refresh@x.com");
    const cats = c.taxonomy.categories.map((x) => x.key);
    // Une règle « stop » répond sans Jev : la catégorie de la règle remplace celle de Jev, pas celle de l'utilisateur.
    c.rules.push({ id: "r", when: { fromDomain: "ecole.example" }, category: cats[0], origin: "user", stop: true, quiet: false });
    const mine = await stored(c, accountId, "mine", 2, { category: cats[1], decidedBy: "user", flags: { followUp: true } });
    const auto = await stored(c, accountId, "auto", 2, { category: cats[1], decidedBy: "jev" });
    const rows = jobsMod.refreshTargets(c, { ids: [mine, auto] }).get(accountId)!;
    const gm = { ensureLabels: async () => new Map(), applyLabels: async () => { throw new Error("aucun libellé à poser : rien n'était appliqué"); } } as unknown as import("./connectors/gmail.js").GmailConnector;
    const job = jobsMod.startReclassify(c, gm, accountId, rows, { modes: {}, refresh: true });
    await until(() => job.status !== "running");
    expect(job.status).toBe("done");
    expect(job.processed).toBe(2);
    expect(job.errors).toBe(0);
    const dec = (id: number) => c.db.prepare("SELECT category, decided_by, flags_json FROM decisions WHERE item_id = ?").get(id) as { category: string; decided_by: string; flags_json: string };
    expect(dec(mine)).toMatchObject({ category: cats[1], decided_by: "user" });
    expect(JSON.parse(dec(mine).flags_json).followUp).toBe(true);
    expect(dec(auto).category).toBe(cats[0]);
  });
  it("file : un travail qui se termine laisse la suite au crochet, et la veille ne repart qu'à la fin de la file", async () => {
    const { c, accountId } = await setup("queue@x.com");
    const gm = { listIds: async () => [] } as unknown as import("./connectors/gmail.js").GmailConnector;
    let resumed = 0, handed: (() => void) | undefined;
    jobsMod.setJobEndHook((_acc, onDone) => { if (handed) return false; handed = onDone; return true; });
    const first = jobsMod.startJob("preview", c, gm, accountId, { onDone: () => { resumed++; } });
    await until(() => first.status !== "running");
    // Le crochet a pris la main : la veille attend.
    expect(resumed).toBe(0);
    // Fin de la file : le crochet rend la relance, qui part enfin.
    handed!();
    expect(resumed).toBe(1);
    jobsMod.setJobEndHook(undefined);
  });
  it("un rattrapage survit à une coupure réseau : il attend et reprend le même lot", async () => {
    const { c, accountId } = await setup("offline@x.com");
    c.rules.push({ id: "o", when: { fromDomain: "ecole.example" }, category: c.taxonomy.categories[0].key, origin: "user", stop: true, quiet: false });
    jobsMod.netRetry.baseMs = 5;
    let fails = 2;
    const item = (id: string) => ({ externalId: id, accountId, source: "gmail" as const, fromName: "École", fromAddress: "info@ecole.example", to: [], subject: id, date: new Date(), bodyExcerpt: "", hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX"] });
    const gm = {
      listIds: async () => ["n1", "n2"],
      fetch: async (id: string) => { if (fails > 0) { fails--; throw Object.assign(new Error("getaddrinfo ENOTFOUND gmail.googleapis.com"), { code: "ENOTFOUND" }); } return item(id); },
    } as unknown as import("./connectors/gmail.js").GmailConnector;
    const job = jobsMod.startJob("preview", c, gm, accountId, {});
    await until(() => job.status !== "running");
    expect(job.status).toBe("done");
    expect(job.processed).toBe(2);
    expect(job.errors).toBe(0);
    expect(jobsMod.isNetworkError(new Error("fetch failed"))).toBe(true);
    expect(jobsMod.isNetworkError(new Error("invalid_grant"))).toBe(false);
    jobsMod.netRetry.baseMs = 10_000;
  });
  it("choix des emails à relancer : période, catégorie, les plus récents d'abord, plafond", async () => {
    const { c, accountId } = await setup("targets@x.com");
    const [a, b] = c.taxonomy.categories.map((x) => x.key);
    const recent = await stored(c, accountId, "t-recent", 1, { category: a, decidedBy: "jev" });
    const old = await stored(c, accountId, "t-old", 60, { category: a, decidedBy: "jev" });
    const other = await stored(c, accountId, "t-other", 2, { category: b, decidedBy: "jev" });
    const ids = (sel: Parameters<typeof jobsMod.refreshTargets>[1]) => (jobsMod.refreshTargets(c, sel).get(accountId) ?? []).map((r) => r.id);
    expect(ids({ accountId, period: "all" })).toEqual([recent, other, old]);
    expect(ids({ accountId, period: "30d" })).toEqual([recent, other]);
    expect(ids({ accountId, period: "all", category: a })).toEqual([recent, old]);
    expect(ids({ accountId, period: "all", max: 1 })).toEqual([recent]);
  });
});
