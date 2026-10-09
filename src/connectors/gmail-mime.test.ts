import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// gmail.ts charge config.ts : dossier de données neuf, jamais le dépôt.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-mime-"));
let buildMime: typeof import("./gmail.js").buildMime;
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  vi.resetModules();
  ({ buildMime } = await import("./gmail.js"));
});
afterAll(() => { delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

describe("message avec pièces jointes", () => {
  const pdf = Buffer.from(Array.from({ length: 5000 }, (_, k) => k % 256));
  const mime = () => buildMime({ to: "a@b.example", subject: "Reçu", body: "Hola", attachments: [{ name: "reçu banque \"mars\".pdf", mimeType: "application/pdf", data: pdf }] });
  it("encode le nom accentué pour tous les clients, sans guillemet parasite", () => {
    const m = mime();
    expect(m).toMatch(/filename\*=UTF-8''re%C3%A7u%20banque%20_mars_\.pdf/);
    expect(m).toMatch(/name="=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?="/);
    expect(m).toMatch(/Content-Type: application\/pdf;/);
  });
  it("coupe le base64 en lignes de 76 caractères et garde le fichier intact", () => {
    const m = mime();
    const part = m.split(/--ea_\w+/)[2];
    const b64 = part.split("\r\n\r\n")[1].trim();
    expect(Math.max(...b64.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(76);
    expect(Buffer.from(b64.replace(/\r\n/g, ""), "base64").equals(pdf)).toBe(true);
  });
  it("un type inconnu ou douteux devient application/octet-stream", () => {
    const m = buildMime({ to: "a@b.example", subject: "x", body: "y", attachments: [{ name: "a.bin", mimeType: "text/html\r\nX-Evil: 1", data: Buffer.from("z") }] });
    expect(m).toMatch(/Content-Type: application\/octet-stream; name="a\.bin"/);
    expect(m).not.toMatch(/X-Evil/);
  });
});
