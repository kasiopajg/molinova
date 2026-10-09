import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { attachmentContent, attachmentKind, commandId, commandName, COMMANDS, inQuietHours, isDue, migrateTgToken, parseCommand, pickPhoto, splitMessage, tgToken, trimConversation, zonedNow } from "./telegram.js";
import { HOME } from "../config.js";
import { kvGet, kvSet, openDb } from "../db.js";
import { setLanguage } from "../i18n/index.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");

describe("commandes", () => {
  it("lit /jour, /start 123456, /aide@monbot, et laisse passer le texte libre", () => {
    expect(parseCommand("/jour")).toEqual({ cmd: "jour", arg: "" });
    expect(parseCommand("  /start 123456 ")).toEqual({ cmd: "start", arg: "123456" });
    expect(parseCommand("/Aide@coordbot")).toEqual({ cmd: "aide", arg: "" });
    expect(parseCommand("ajoute une tâche : signer")).toBeNull();
    expect(parseCommand("va /jour")).toBeNull();
  });
  it("accepte chaque commande dans les trois langues, quelle que soit la langue choisie", () => {
    for (const c of ["jour", "day", "dia", "today", "JOUR"]) expect(commandId(c)).toBe("day");
    expect(commandId("apayer")).toBe("toPay");
    expect(commandId("pagar")).toBe("toPay");
    expect(commandId("topay")).toBe("toPay");
    expect(commandId("start")).toBe("help");
    expect(commandId("ayuda")).toBe("help");
    expect(commandId("olvida")).toBe("reset");
    expect(commandId("foo")).toBeNull();
    expect(commandName("toPay", "es")).toBe("pagar");
    expect(commandName("reminders", "en")).toBe("reminders");
    expect(commandName("day")).toBe("jour");
  });
  it("les noms de commandes respectent Telegram : minuscules a-z, sans accent, uniques", () => {
    const all = COMMANDS.flatMap((c) => [c.names.fr, c.names.en, c.names.es]);
    for (const n of all) expect(n).toMatch(/^[a-z0-9_]{1,32}$/);
    for (const l of ["fr", "en", "es"] as const) expect(new Set(COMMANDS.map((c) => c.names[l])).size).toBe(COMMANDS.length);
  });
});

describe("découpage", () => {
  it("coupe sur une ligne avant 4 000 caractères", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `ligne ${i} ${"x".repeat(20)}`);
    const parts = splitMessage(lines.join("\n"));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    expect(parts.join("\n")).toBe(lines.join("\n"));
  });
  it("laisse un texte court intact", () => { expect(splitMessage("bonjour")).toEqual(["bonjour"]); });
});

describe("horaires", () => {
  it("les heures creuses passent minuit", () => {
    expect(inQuietHours("23:10", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("03:00", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("07:00", "22:00", "07:00")).toBe(false);
    expect(inQuietHours("12:00", "22:00", "07:00")).toBe(false);
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("13:00", "09:00", "09:00")).toBe(false);
  });
  it("un envoi programmé est dû dans l'heure qui suit, pas avant, pas après", () => {
    expect(isDue("07:30", "07:30")).toBe(true);
    expect(isDue("08:10", "07:30")).toBe(true);
    expect(isDue("07:29", "07:30")).toBe(false);
    expect(isDue("08:30", "07:30")).toBe(false);
  });
});

describe("trimConversation", () => {
  it("ne commence jamais par un résultat d'outil orphelin", () => {
    const msgs = [
      { role: "user" }, { role: "assistant" }, { role: "tool" }, { role: "assistant" },
      { role: "user" }, { role: "assistant" }, { role: "tool" }, { role: "assistant" },
    ];
    const out = trimConversation(msgs, 5);
    expect(out[0].role).toBe("user");
    expect(out).toHaveLength(4);
  });
  it("laisse une conversation courte telle quelle", () => {
    const msgs = [{ role: "user" }, { role: "assistant" }];
    expect(trimConversation(msgs, 14)).toBe(msgs);
  });
});

describe("zonedNow", () => {
  it("donne l'heure et le jour dans le fuseau du foyer", () => {
    const d = new Date("2026-09-27T22:30:00Z"); // dimanche 22:30 UTC = lundi 00:30 à Madrid
    expect(zonedNow(d, "Europe/Madrid")).toEqual({ hm: "00:30", ymd: "2026-09-28", dow: 1 });
    expect(zonedNow(d, "America/New_York")).toEqual({ hm: "18:30", ymd: "2026-09-27", dow: 0 });
  });
});

describe("jeton du bot", () => {
  // MOLINOVA_HOME : dossier neuf (src/test-home.ts), jamais le .env.local du dépôt.
  it("l'ancienne copie en base rejoint les secrets, puis disparaît de la base", () => {
    expect(HOME).not.toBe(process.cwd());
    delete process.env.TELEGRAM_BOT_TOKEN;
    const db = openDb();
    kvSet(db, "tg.token", "123:old");
    expect(tgToken(db)).toEqual({ token: "123:old", source: "kv" });
    expect(migrateTgToken(db)).toBe(true);
    expect(kvGet(db, "tg.token", null)).toBeNull();
    expect(tgToken(db)).toEqual({ token: "123:old", source: ".env.local" });
    expect(fs.readFileSync(path.join(HOME, ".env.local"), "utf8")).toContain("TELEGRAM_BOT_TOKEN=123:old");
    // Déjà un secret : la copie en base est seulement effacée.
    kvSet(db, "tg.token", "456:stale");
    expect(migrateTgToken(db)).toBe(true);
    expect(tgToken(db).token).toBe("123:old");
    expect(migrateTgToken(db)).toBe(false);
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
});

describe("pièces jointes", () => {
  it("reconnaît images, PDF et textes, par type ou par extension", () => {
    expect(attachmentKind("application/pdf", "x.pdf")).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    expect(attachmentKind(undefined, "Planning.PDF")).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    expect(attachmentKind("image/png")?.kind).toBe("image");
    expect(attachmentKind("application/octet-stream", "agenda.ics")).toEqual({ kind: "text", mediaType: "text/calendar" });
    expect(attachmentKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx")).toBeNull();
  });
  it("prend la plus grande photo sous 1600 px", () => {
    const sizes = [{ file_id: "a", width: 90, height: 60 }, { file_id: "b", width: 1280, height: 800 }, { file_id: "c", width: 2560, height: 1600 }];
    expect(pickPhoto(sizes).file_id).toBe("b");
    expect(pickPhoto([{ file_id: "z", width: 4000, height: 3000 }]).file_id).toBe("z");
  });
  it("met la légende en tête, l'image et le PDF tels quels, le texte en clair", () => {
    const data = new TextEncoder().encode("BEGIN:VCALENDAR");
    const parts = attachmentContent("", [{ kind: "image", mediaType: "image/jpeg", name: "p.jpg", data }, { kind: "text", mediaType: "text/calendar", name: "a.ics", data }], "(sans texte)") as Array<{ type: string; text?: string }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "file", "text"]);
    expect(parts[0].text).toBe("(sans texte)");
    expect(parts[2].text).toBe("[a.ics]\nBEGIN:VCALENDAR");
  });
});
