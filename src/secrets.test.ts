import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MOLINOVA_HOME pointe toujours sur un dossier neuf : setSecret n'écrit jamais le .env.local du dépôt.
const homes: string[] = [];
let home = "";
async function load(appMode = false) {
  process.env.MOLINOVA_HOME = home;
  if (appMode) process.env.MOLINOVA_APP = "1"; else delete process.env.MOLINOVA_APP;
  vi.resetModules();
  return import("./secrets.js");
}
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-secrets-"));
  homes.push(home);
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;
});
afterEach(() => { delete process.env.MOLINOVA_APP; delete process.env.MOLINOVA_SECRETS_OK; delete (process as unknown as { parentPort?: unknown }).parentPort; });
afterAll(() => { delete process.env.MOLINOVA_HOME; for (const d of homes) fs.rmSync(d, { recursive: true, force: true }); });

describe("upsertEnvFile", () => {
  it("ajoute, remplace et retire une ligne sans toucher au reste", async () => {
    const { upsertEnvFile } = await load();
    const file = path.join(home, ".env.local");
    fs.writeFileSync(file, "# mes clés\nAI_GATEWAY_API_KEY=abc\n\nOTHER=1 # garde\nTELEGRAM_BOT_TOKEN=old\nexport TELEGRAM_BOT_TOKEN=dup\n");
    upsertEnvFile(file, "TELEGRAM_BOT_TOKEN", "123:new");
    expect(fs.readFileSync(file, "utf8")).toBe("# mes clés\nAI_GATEWAY_API_KEY=abc\n\nOTHER=1 # garde\nTELEGRAM_BOT_TOKEN=123:new\n");
    upsertEnvFile(file, "GOOGLE_CLIENT_ID", "x.apps.googleusercontent.com");
    expect(fs.readFileSync(file, "utf8").endsWith("TELEGRAM_BOT_TOKEN=123:new\nGOOGLE_CLIENT_ID=x.apps.googleusercontent.com\n")).toBe(true);
    upsertEnvFile(file, "AI_GATEWAY_API_KEY", null);
    expect(fs.readFileSync(file, "utf8")).toBe("# mes clés\n\nOTHER=1 # garde\nTELEGRAM_BOT_TOKEN=123:new\nGOOGLE_CLIENT_ID=x.apps.googleusercontent.com\n");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("crée le fichier en 0600 et met entre guillemets une valeur avec # ou espace", async () => {
    const { upsertEnvFile } = await load();
    const dotenv = (await import("dotenv")).default;
    const file = path.join(home, ".env.local");
    upsertEnvFile(file, "GOOGLE_CLIENT_SECRET", "a#b c");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(dotenv.parse(fs.readFileSync(file, "utf8")).GOOGLE_CLIENT_SECRET).toBe("a#b c");
    expect(() => upsertEnvFile(file, "GOOGLE_CLIENT_SECRET", "a\nb")).toThrow();
  });
});

describe("setSecret / secretSource", () => {
  it("mode dev : process.env aussitôt, puis HOME/.env.local", async () => {
    const { setSecret, getSecret, secretSource } = await load();
    expect(secretSource("TELEGRAM_BOT_TOKEN")).toBeNull();
    setSecret("TELEGRAM_BOT_TOKEN", " 123:abc ");
    expect(getSecret("TELEGRAM_BOT_TOKEN")).toBe("123:abc");
    expect(fs.readFileSync(path.join(home, ".env.local"), "utf8")).toBe("TELEGRAM_BOT_TOKEN=123:abc\n");
    expect(secretSource("TELEGRAM_BOT_TOKEN")).toBe(".env.local");
    // Une autre valeur posée par le shell : c'est l'environnement qui parle.
    process.env.TELEGRAM_BOT_TOKEN = "999:shell";
    expect(secretSource("TELEGRAM_BOT_TOKEN")).toBe("env");
    setSecret("TELEGRAM_BOT_TOKEN", null);
    expect(getSecret("TELEGRAM_BOT_TOKEN")).toBeUndefined();
    expect(fs.readFileSync(path.join(home, ".env.local"), "utf8")).toBe("");
  });
  it("mode dev : une valeur refusée par .env.local ne change rien, même en mémoire", async () => {
    const { setSecret, getSecret } = await load();
    expect(() => setSecret("TELEGRAM_BOT_TOKEN", "a\nb")).toThrow();
    expect(getSecret("TELEGRAM_BOT_TOKEN")).toBeUndefined();
    expect(fs.existsSync(path.join(home, ".env.local"))).toBe(false);
  });
  it("mode app : message au processus principal, aucun fichier en clair", async () => {
    const sent: unknown[] = [];
    (process as unknown as { parentPort: { postMessage(m: unknown): void } }).parentPort = { postMessage: (m) => sent.push(m) };
    const { setSecret, secretSource } = await load(true);
    setSecret("GOOGLE_CLIENT_ID", "x.apps.googleusercontent.com");
    expect(sent).toEqual([{ type: "molinova:secret", name: "GOOGLE_CLIENT_ID", value: "x.apps.googleusercontent.com" }]);
    expect(fs.existsSync(path.join(home, ".env.local"))).toBe(false);
    expect(secretSource("GOOGLE_CLIENT_ID")).toBe("keychain");
    setSecret("GOOGLE_CLIENT_ID", "");
    expect(sent[1]).toEqual({ type: "molinova:secret", name: "GOOGLE_CLIENT_ID", value: null });
    expect(process.env.GOOGLE_CLIENT_ID).toBeUndefined();
  });
  it("mode app, trousseau inutilisable (MOLINOVA_SECRETS_OK=0) : exception, rien d'envoyé ni de changé", async () => {
    const sent: unknown[] = [];
    (process as unknown as { parentPort: { postMessage(m: unknown): void } }).parentPort = { postMessage: (m) => sent.push(m) };
    process.env.MOLINOVA_SECRETS_OK = "0";
    const { setSecret, getSecret, secretsWritable } = await load(true);
    expect(secretsWritable()).toBe(false);
    expect(() => setSecret("TELEGRAM_BOT_TOKEN", "123:abc")).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(sent).toEqual([]);
    expect(getSecret("TELEGRAM_BOT_TOKEN")).toBeUndefined();
    expect(fs.existsSync(path.join(home, ".env.local"))).toBe(false);
  });
  it("mode dev : MOLINOVA_SECRETS_OK ne concerne que l'app", async () => {
    process.env.MOLINOVA_SECRETS_OK = "0";
    const { setSecret, secretsWritable } = await load();
    expect(secretsWritable()).toBe(true);
    expect(setSecret("TELEGRAM_BOT_TOKEN", "123:abc")).toBe(true);
  });
});
