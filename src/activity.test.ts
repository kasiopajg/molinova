import { describe, expect, it } from "vitest";
import { listActivity, logActivity, openDb, purgeActivity, saveDecision, upsertAccount, upsertItem, type Decision } from "./db.js";
import { loadContext, loadRules, loadSettings, loadTaxonomy } from "./config.js";
import { makeClassifier } from "./core/classify.js";
import { mailCount } from "./core/mail-query.js";

describe("fil d'activité", () => {
  it("rend les événements du plus récent au plus ancien, page par page", () => {
    const db = openDb();
    db.exec("DELETE FROM activity");
    for (let i = 1; i <= 5; i++) logActivity(db, "gmail", "pass", { n: i });
    const first = listActivity(db, 3);
    expect(first.map((a) => a.params.n)).toEqual([5, 4, 3]);
    const next = listActivity(db, 3, first[2].id);
    expect(next.map((a) => a.params.n)).toEqual([2, 1]);
    expect(next[0]).toMatchObject({ channel: "gmail", kind: "pass", itemId: null });
  });
  it("oublie ce qui a plus de trente jours", () => {
    const db = openDb();
    db.exec("DELETE FROM activity");
    logActivity(db, "telegram", "morning");
    db.prepare("INSERT INTO activity (at, channel, kind) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'), 'telegram', 'weekly')").run();
    expect(purgeActivity(db)).toBe(1);
    expect(listActivity(db).map((a) => a.kind)).toEqual(["morning"]);
  });
  it("n'échoue jamais, même sur une base sans la table", async () => {
    const Database = (await import("better-sqlite3")).default;
    expect(() => logActivity(new Database(":memory:"), "gmail", "pass")).not.toThrow();
  });
});

describe("file Actions et « À classer »", () => {
  const noFlags: Decision["flags"] = { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false };
  it("un email au libellé incertain n'entre dans Actions que s'il a un signal", () => {
    const db = openDb();
    const c = makeClassifier({ settings: loadSettings(), taxonomy: loadTaxonomy(), rules: loadRules(), ctx: loadContext(), db });
    const accountId = upsertAccount(db, "gmail", "queue@x.com").id;
    const attentive = c.taxonomy.categories.find((x) => x.attention)!.key;
    const add = (id: string, d: Partial<Decision>) => {
      const itemId = upsertItem(db, { externalId: id, accountId, source: "gmail", fromName: "", fromAddress: "a@b.com", to: [], subject: id, date: new Date(), bodyExcerpt: "", hasAttachments: false, hasListUnsubscribe: false, isOutgoing: false, labels: ["INBOX", "UNREAD"] });
      saveDecision(db, { itemId, decidedBy: "jev", category: attentive, confidence: 0.4, needsReview: false, flags: noFlags, ...d });
    };
    add("doute", { needsReview: true });
    add("doute-a-repondre", { needsReview: true, flags: { ...noFlags, reply: true } });
    add("sur-non-lu", {});
    const acc = String(accountId);
    expect(mailCount(c, "review", acc)).toBe(2);
    expect(mailCount(c, "queue", acc)).toBe(2); // « doute-a-repondre » et « sur-non-lu »
    expect(mailCount(c, "queue+review", acc)).toBe(1);
  });
});
