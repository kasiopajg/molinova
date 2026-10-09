import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// gmail.ts charge config.ts : dossier de données neuf, jamais le dépôt.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-gclient-"));
let parseGoogleClient: typeof import("./gmail.js").parseGoogleClient;
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  vi.resetModules();
  ({ parseGoogleClient } = await import("./gmail.js"));
  (await import("../i18n/index.js")).setLanguage("en");
});
afterAll(() => { delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

const id = "123-abc.apps.googleusercontent.com";
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code?: string }).code; } return undefined; };

describe("client OAuth collé dans l'assistant", () => {
  it("accepte le JSON téléchargé (Application de bureau), en objet, en texte ou sous `json`", () => {
    const file = { installed: { client_id: id, client_secret: "GOCSPX-s", redirect_uris: ["http://localhost"] } };
    expect(parseGoogleClient(file)).toEqual({ clientId: id, clientSecret: "GOCSPX-s" });
    expect(parseGoogleClient({ json: file })).toEqual({ clientId: id, clientSecret: "GOCSPX-s" });
    expect(parseGoogleClient({ json: JSON.stringify(file) })).toEqual({ clientId: id, clientSecret: "GOCSPX-s" });
  });
  it("accepte la paire saisie à la main, espaces retirés", () => {
    expect(parseGoogleClient({ clientId: ` ${id} `, clientSecret: " s " })).toEqual({ clientId: id, clientSecret: "s" });
  });
  it("refuse un client « Application Web » avec un message dédié", () => {
    expect(code(() => parseGoogleClient({ web: { client_id: id, client_secret: "s" } }))).toBe("setup.googleWeb");
    expect(() => parseGoogleClient({ web: { client_id: id, client_secret: "s" } })).toThrow(/Desktop app/);
  });
  it("refuse un contenu illisible ou incomplet, et un ID client étranger", () => {
    expect(code(() => parseGoogleClient(undefined))).toBe("setup.googleFormat");
    expect(code(() => parseGoogleClient({ json: "{oups" }))).toBe("setup.googleFormat");
    expect(code(() => parseGoogleClient({ installed: { client_id: id } }))).toBe("setup.googleFormat");
    expect(code(() => parseGoogleClient({ clientId: id, clientSecret: "" }))).toBe("setup.googleFormat");
    expect(code(() => parseGoogleClient({ clientId: id, clientSecret: "a\nb" }))).toBe("setup.googleFormat");
    expect(code(() => parseGoogleClient({ clientId: "abc", clientSecret: "s" }))).toBe("setup.googleClientId");
  });
});
