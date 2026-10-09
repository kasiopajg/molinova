import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_READ_BYTES, extractText, readableBy, textBin, tidy, type TextSource } from "./doc-extract.js";

const fake = (files: Record<string, Buffer>, exports: Record<string, Buffer> = {}): TextSource & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async download(id) { calls.push(`dl:${id}`); return files[id]; },
    async exportAs(id, mime) { calls.push(`ex:${id}:${mime}`); return exports[id]; },
  };
};
const doc = (id: string, mime: string, format: string | null, size: number | null = 1000) => ({ id, name: `${id}.bin`, mime, format, size });

describe("ce qui se lit, et comment", () => {
  it("Google s'exporte, le reste se télécharge ; trop gros, Excel ou sans assistant : rien", () => {
    expect(readableBy(doc("a", "application/vnd.google-apps.document", "google"), null)).toBe("export");
    expect(readableBy(doc("b", "application/pdf", "pdf"), "/bin/x")).toBe("pdf");
    expect(readableBy(doc("b", "application/pdf", "pdf"), null)).toBeNull();
    expect(readableBy(doc("c", "image/jpeg", "image"), "/bin/x")).toBe("ocr");
    expect(readableBy(doc("d", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "office"), null)).toBe("textutil");
    expect(readableBy(doc("e", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "office"), null)).toBeNull();
    expect(readableBy(doc("f", "text/plain", "text"), null)).toBe("plain");
    expect(readableBy(doc("g", "application/pdf", "pdf", MAX_READ_BYTES + 1), "/bin/x")).toBeNull();
  });
  it("le texte est nettoyé et coupé", () => {
    expect(tidy("a\r\n\n\n\nb   c\t\td")).toBe("a\n\nb c d");
    expect(tidy("x".repeat(9000))).toHaveLength(6000);
    // Formulaire : pointillés, tirets bas et sauts de page disparaissent, les rubriques restent.
    expect(tidy("Anmeldung\f.............................\nName / Vorname\n______________\nOrt Datum")).toBe("Anmeldung\nName / Vorname\nOrt Datum");
  });
});

describe("lecture", () => {
  it("export Google et texte simple, sans fichier temporaire", async () => {
    const src = fake({ t: Buffer.from("Bonjour  le   monde") }, { g: Buffer.from("Contrat de location\n\n\n\nLoyer") });
    expect(await extractText(src, doc("g", "application/vnd.google-apps.document", "google"), null)).toEqual({ text: "Contrat de location\n\nLoyer", method: "export" });
    expect(await extractText(src, doc("t", "text/plain", "text"), null)).toEqual({ text: "Bonjour le monde", method: "plain" });
    expect(src.calls).toEqual(["ex:g:text/plain", "dl:t"]);
  });
  it.skipIf(process.platform !== "darwin")("Word/RTF par textutil", async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi Attestation d'assurance habitation}");
    const r = await extractText(fake({ r: rtf }), doc("r", "application/rtf", "office"), null);
    expect(r).toEqual({ text: "Attestation d'assurance habitation", method: "textutil" });
  });
  it.skipIf(process.platform !== "darwin" || !textBin())("PDF texte, PDF scanné et image par molinova-text", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-test-"));
    try {
      fs.writeFileSync(path.join(dir, "cni.txt"), "CARTE NATIONALE D'IDENTITE\nNom : MARTIN\nValable jusqu'au : 15.09.2032\n");
      fs.writeFileSync(path.join(dir, "text.pdf"), execFileSync("/usr/sbin/cupsfilter", ["-m", "application/pdf", path.join(dir, "cni.txt")], { stdio: ["ignore", "pipe", "ignore"] }));
      execFileSync("sips", ["-s", "format", "png", path.join(dir, "text.pdf"), "--out", path.join(dir, "scan.png")], { stdio: "ignore" });
      execFileSync("sips", ["-s", "format", "pdf", path.join(dir, "scan.png"), "--out", path.join(dir, "scan.pdf")], { stdio: "ignore" });
      const read = (f: string) => fs.readFileSync(path.join(dir, f));
      const src = fake({ a: read("text.pdf"), b: read("scan.pdf"), c: read("scan.png") });
      const a = await extractText(src, doc("a", "application/pdf", "pdf"));
      expect(a?.method).toBe("pdf");
      expect(a?.text).toMatch(/15\.09\.2032/);
      const b = await extractText(src, doc("b", "application/pdf", "pdf"));
      expect(b?.method).toBe("ocr");
      expect(b?.text).toMatch(/MARTIN/);
      const c = await extractText(src, doc("c", "image/png", "image"));
      expect(c?.method).toBe("ocr");
      expect(c?.text).toMatch(/IDENTIT/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
