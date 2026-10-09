import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textBin, type TextSource } from "./doc-extract.js";
import { downloadFile, previewHtml, previewInfo, previewKind, previewPage, safeHtml, sweepPreviews } from "./doc-preview.js";

const doc = (id: string, mime: string, format: string | null, size: number | null = 1000) => ({ accountId: 1, id, name: `${id}.bin`, mime, format, size, stamp: `s-${id}-${Date.now()}` });

describe("ce que l'aperçu sait montrer", () => {
  it("pages pour PDF, images et fichiers Google ; HTML pour Word ; rien pour Excel ou trop gros", () => {
    expect(previewKind(doc("a", "application/pdf", "pdf"), "/bin/x")).toBe("pages");
    expect(previewKind(doc("b", "image/heic", "image"), "/bin/x")).toBe("pages");
    expect(previewKind(doc("c", "application/vnd.google-apps.document", "google"), "/bin/x")).toBe("pages");
    expect(previewKind(doc("a", "application/pdf", "pdf"), null)).toBe("none");
    expect(previewKind(doc("d", "application/msword", "office"), null)).toBe("html");
    expect(previewKind(doc("e", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "office"), "/bin/x")).toBe("none");
    expect(previewKind(doc("f", "application/pdf", "pdf", 60 * 1024 * 1024), "/bin/x")).toBe("none");
  });
  it("un fichier Google se télécharge en PDF, le reste tel quel", async () => {
    const src: TextSource = { download: async () => Buffer.from("raw"), exportAs: async (_id, mime) => Buffer.from(mime) };
    expect(await downloadFile(src, doc("g", "application/vnd.google-apps.document", "google"))).toMatchObject({ name: "g.bin.pdf", mime: "application/pdf" });
    expect((await downloadFile(src, doc("h", "image/png", "image"))).data.toString()).toBe("raw");
  });
});

describe("HTML d'aperçu sûr", () => {
  it("ni script, ni attribut d'événement, ni caractère nul ; la règle de sécurité en tête", () => {
    const out = safeHtml('<html><head><title>a\u0000</title></head><body onload="x()"><script>alert(1)</script><img src="http://pisteur" onerror=\'y()\'>Texte</body></html>');
    expect(out).not.toMatch(/script|onload|onerror|\u0000/);
    expect(out).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
    expect(out).toMatch(/Texte/);
  });
});

describe.skipIf(process.platform !== "darwin")("aperçu réel", () => {
  it("Word en HTML par textutil, texte échappé", async () => {
    const src: TextSource = { download: async (id) => Buffer.from(id === "r" ? "{\\rtf1\\ansi Anmeldung zur Fischerpr\\u252?fung}" : "a <b> & c"), exportAs: async () => Buffer.alloc(0) };
    expect(await previewHtml(src, doc("r", "application/rtf", "office"))).toMatch(/Anmeldung/);
    expect(await previewHtml(src, doc("t", "text/plain", "text"))).toMatch(/a &lt;b&gt; &amp; c/);
  });
  it.skipIf(!textBin())("PDF : nombre de pages, puis chaque page en PNG, servie ensuite depuis le cache", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-test-"));
    try {
      fs.writeFileSync(path.join(dir, "a.txt"), "Page un\f".repeat(1) + "Page deux\n");
      const pdf = execFileSync("/usr/sbin/cupsfilter", ["-m", "application/pdf", path.join(dir, "a.txt")], { stdio: ["ignore", "pipe", "ignore"] });
      let downloads = 0;
      const src: TextSource = { download: async () => { downloads++; return pdf; }, exportAs: async () => Buffer.alloc(0) };
      const d = doc("p", "application/pdf", "pdf");
      const info = await previewInfo(src, d);
      expect(info.kind).toBe("pages");
      const png = await previewPage(src, d, 1);
      expect([png[0], png[1]]).toEqual([0xff, 0xd8]);
      await previewPage(src, d, 1);
      expect(downloads).toBe(1);
      sweepPreviews(Date.now() + 7 * 3600_000);
      await previewPage(src, d, 1);
      expect(downloads).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
