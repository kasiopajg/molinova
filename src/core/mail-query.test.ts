import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { HIGH_MAX_DAYS, OBSOLETE_DAYS, OBSOLETE_URGENT_DAYS, URGENT_MAX_DAYS, mailWhere, obsoleteSql, priorityScoreSql } from "./mail-query.js";

const TH = { highScore: 1.5, normalScore: 0.5 };

/** Le score effectif d'un email reçu il y a `days` jours, avec la réponse Jev donnée. */
function effective(days: number, answers: object | null): number {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, date TEXT); CREATE TABLE decisions (item_id INTEGER, answers_json TEXT);");
  const date = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare("INSERT INTO items (id, date) VALUES (1, ?)").run(date);
  db.prepare("INSERT INTO decisions (item_id, answers_json) VALUES (1, ?)").run(answers ? JSON.stringify(answers) : null);
  const r = db.prepare(`SELECT ${priorityScoreSql(TH)} s FROM items i JOIN decisions d ON d.item_id = i.id`).get() as { s: number };
  db.close();
  return r.s;
}
const urgent = { priority: { score: 2.9 } };

describe("priorité plafonnée par l'âge", () => {
  it("un email récent garde le score de Jev", () => {
    expect(effective(0.5, urgent)).toBe(2.9);
    expect(effective(URGENT_MAX_DAYS - 0.5, urgent)).toBe(2.9);
  });
  it("un email de plus de quelques jours n'est plus urgent, au plus haut", () => {
    expect(effective(URGENT_MAX_DAYS + 1, urgent)).toBe(TH.highScore);
  });
  it("un vieil email est au plus normal ; un score bas ne remonte jamais", () => {
    expect(effective(HIGH_MAX_DAYS + 1, urgent)).toBe(TH.normalScore);
    expect(effective(HIGH_MAX_DAYS + 30, { priority: { score: 0.2 } })).toBe(0.2);
  });
  it("sans réponse Jev : normale (1) si récent", () => {
    expect(effective(1, null)).toBe(1);
  });
});

describe("obsolète : portée limitée dans le temps, délai passé", () => {
  const c = {
    settings: { thresholds: { urgentScore: 2.5, highScore: 1.5, normalScore: 0.5 } },
    taxonomy: { categories: [{ key: "promotions", attention: false }, { key: "clients", attention: true }] },
  } as unknown as Parameters<typeof obsoleteSql>[0];
  type Case = { days: number; answers?: object | null; category?: string; flags?: object; outgoing?: boolean };
  function obsolete({ days, answers = null, category = "promotions", flags = {}, outgoing = false }: Case): boolean {
    return value({ days, answers, category, flags, outgoing }) === 1;
  }
  /** La valeur brute : 0 ou 1, jamais NULL (sinon « NOT obsolète » écarterait l'email de la file). */
  function value({ days, answers = null, category = "promotions", flags = {}, outgoing = false }: Case): number | null {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, date TEXT, is_outgoing INTEGER); CREATE TABLE decisions (item_id INTEGER, answers_json TEXT, flags_json TEXT, category TEXT);");
    db.prepare("INSERT INTO items VALUES (1, ?, ?)").run(new Date(Date.now() - days * 86_400_000).toISOString(), outgoing ? 1 : 0);
    db.prepare("INSERT INTO decisions VALUES (1, ?, ?, ?)").run(answers ? JSON.stringify(answers) : null, JSON.stringify(flags), category);
    const r = db.prepare(`SELECT ${obsoleteSql(c)} o FROM items i JOIN decisions d ON d.item_id = i.id`).get() as { o: number };
    db.close();
    return r.o;
  }
  const bound = (score = 1) => ({ time_bound: { type: "boolean", probability: 0.9 }, priority: { score } });
  it("Jev : portée limitée → obsolète après 14 jours, ou 3 jours s'il était urgent", () => {
    expect(obsolete({ days: 10, answers: bound(), category: "clients" })).toBe(false);
    expect(obsolete({ days: OBSOLETE_DAYS + 1, answers: bound(), category: "clients" })).toBe(true);
    expect(obsolete({ days: OBSOLETE_URGENT_DAYS + 1, answers: bound(2.9), category: "clients" })).toBe(true);
    expect(obsolete({ days: 1, answers: bound(2.9) })).toBe(false);
  });
  it("Jev : portée non limitée → jamais obsolète, même vieux et sans attention", () => {
    expect(obsolete({ days: 200, answers: { time_bound: { probability: 0.1 } } })).toBe(false);
  });
  it("sans réponse Jev : vieux et dans une catégorie sans attention seulement", () => {
    expect(obsolete({ days: OBSOLETE_DAYS + 1 })).toBe(true);
    expect(obsolete({ days: OBSOLETE_DAYS + 1, category: "clients" })).toBe(false);
    expect(obsolete({ days: 5 })).toBe(false);
  });
  it("jamais NULL : un vieil email d'une catégorie suivie, sans réponse Jev, vaut 0 et reste dans la file", () => {
    expect(value({ days: 100, category: "clients" })).toBe(0);
    expect(value({ days: 100, category: null as unknown as string })).toBe(0);
    expect(value({ days: 100, answers: { priority: { score: 2 } }, category: "clients" })).toBe(0);
  });
  it("jamais obsolète : à payer, relance en cours, envoyé par moi", () => {
    expect(obsolete({ days: 100, flags: { toPay: true } })).toBe(false);
    expect(obsolete({ days: 100, flags: { followUp: true } })).toBe(false);
    expect(obsolete({ days: 100, outgoing: true })).toBe(false);
  });
});

describe("filtre par date", () => {
  const c = { settings: { thresholds: { urgentScore: 2.5, highScore: 1.5, normalScore: 0.5 } }, taxonomy: { categories: [] } } as unknown as Parameters<typeof mailWhere>[0];
  function ids(filter: string, dates: string[]): number[] {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, date TEXT, account_id INTEGER); CREATE TABLE decisions (item_id INTEGER);");
    dates.forEach((d, k) => { db.prepare("INSERT INTO items VALUES (?, ?, 1)").run(k + 1, d); db.prepare("INSERT INTO decisions VALUES (?)").run(k + 1); });
    const { where, params } = mailWhere(c, filter, null, "");
    const out = (db.prepare(`SELECT i.id FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")} ORDER BY i.id`).all(...params) as Array<{ id: number }>).map((r) => r.id);
    db.close();
    return out;
  }
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  it("24 h, 7 jours, 30 jours", () => {
    const dates = [ago(0.5), ago(3), ago(20), ago(90)];
    expect(ids("date:1d", dates)).toEqual([1]);
    expect(ids("date:7d", dates)).toEqual([1, 2]);
    expect(ids("date:30d", dates)).toEqual([1, 2, 3]);
  });
  it("une période du calendrier, bornes comprises (et dans le désordre)", () => {
    const dates = ["2026-09-01T12:00:00.000Z", "2026-09-15T12:00:00.000Z", "2026-09-30T12:00:00.000Z", "2026-10-02T12:00:00.000Z"];
    expect(ids("date:2026-09-01..2026-09-30", dates)).toEqual([1, 2, 3]);
    expect(ids("date:2026-09-30..2026-09-15", dates)).toEqual([2, 3]);
  });
  it("une valeur inconnue ne filtre rien", () => {
    expect(ids("date:hier", [ago(1), ago(100)])).toEqual([1, 2]);
  });
});

describe("nettoyage : ignorer les emails d'avant une date", () => {
  function queue(ignoreBefore: string | null, extra = ""): number[] {
    const c = {
      settings: { thresholds: { urgentScore: 2.5, highScore: 1.5, normalScore: 0.5 }, ignoreBefore },
      taxonomy: { categories: [{ key: "clients", attention: true }] },
    } as unknown as Parameters<typeof mailWhere>[0];
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, date TEXT, account_id INTEGER, labels_json TEXT, is_outgoing INTEGER);
      CREATE TABLE decisions (item_id INTEGER, flags_json TEXT, answers_json TEXT, needs_review INTEGER, action_state INTEGER, category TEXT);`);
    ["2025-06-01T12:00:00.000Z", "2026-02-01T12:00:00.000Z", new Date().toISOString()].forEach((d, k) => {
      db.prepare("INSERT INTO items VALUES (?, ?, 1, ?, 0)").run(k + 1, d, JSON.stringify(["INBOX", "UNREAD"]));
      db.prepare("INSERT INTO decisions VALUES (?, ?, NULL, 0, 0, 'clients')").run(k + 1, JSON.stringify({ reply: true }));
    });
    const { where, params } = mailWhere(c, "queue" + extra, null, "");
    const out = (db.prepare(`SELECT i.id FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")} ORDER BY i.id`).all(...params) as Array<{ id: number }>).map((r) => r.id);
    db.close();
    return out;
  }
  it("sans date, tout est dans la file ; avec une date, les plus anciens en sortent", () => {
    expect(queue(null)).toEqual([1, 2, 3]);
    expect(queue("2026-01-01")).toEqual([2, 3]);
  });
  it("« nocutoff » montre la file sans le réglage (pour le compte des Réglages)", () => {
    expect(queue("2026-01-01", "+nocutoff")).toEqual([1, 2, 3]);
  });
  it("une valeur invalide n'est jamais écrite dans la requête", () => {
    expect(queue("2026-01-01'; DROP TABLE items; --")).toEqual([1, 2, 3]);
  });
});
