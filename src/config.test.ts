import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Chaque test pointe MOLINOVA_HOME sur un dossier neuf, puis recharge config.ts : jamais le dépôt comme dossier de données.
const homes: string[] = [];
function freshHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-config-"));
  homes.push(dir);
  return dir;
}
async function loadConfig(home: string, env: Record<string, string | undefined> = {}) {
  process.env.MOLINOVA_HOME = home;
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
  return import("./config.js");
}
afterEach(() => { delete process.env.MOLINOVA_APP; });
afterAll(() => { delete process.env.MOLINOVA_HOME; for (const d of homes) fs.rmSync(d, { recursive: true, force: true }); });

describe("chemins (MOLINOVA_HOME)", () => {
  it("place les données dans HOME et crée les dossiers, jetons en 0700", async () => {
    const home = freshHome();
    const { HOME, ROOT, PATHS, APP_MODE } = await loadConfig(home);
    expect(HOME).toBe(path.resolve(home));
    expect(APP_MODE).toBe(false);
    expect(PATHS.config).toBe(path.join(home, "config"));
    expect(PATHS.examples).toBe(path.join(ROOT, "config"));
    expect(PATHS.data).toBe(path.join(home, "data"));
    expect(PATHS.logs).toBe(path.join(home, "logs"));
    expect(PATHS.db).toBe(path.join(home, "data", "molinova.sqlite"));
    for (const d of [PATHS.config, PATHS.data, PATHS.logs, PATHS.tokens, PATHS.credentials]) expect(fs.statSync(d).isDirectory()).toBe(true);
    expect(fs.statSync(PATHS.tokens).mode & 0o777).toBe(0o700);
    expect(fs.statSync(PATHS.credentials).mode & 0o777).toBe(0o700);
  });
  it("mode app avec MOLINOVA_APP=1", async () => {
    expect((await loadConfig(freshHome(), { MOLINOVA_APP: "1" })).APP_MODE).toBe(true);
  });
  it("sans context.json : l'exemple de ROOT/config, au fuseau du système", async () => {
    const { loadContext, systemTimeZone } = await loadConfig(freshHome());
    const ctx = loadContext();
    expect(ctx.owner.name).toBeTruthy();
    expect(ctx.owner.timezone).toBe(systemTimeZone());
  });
});

describe("réglages de l'app (app.json)", () => {
  it("défauts sans fichier", async () => {
    const { loadAppSettings } = await loadConfig(freshHome());
    expect(loadAppSettings()).toEqual({ openAtLogin: true, preventSleep: true, closeToTray: true });
  });
  it("changement partiel fusionné et écrit", async () => {
    const home = freshHome();
    const { saveAppSettings, loadAppSettings } = await loadConfig(home);
    expect(saveAppSettings({ preventSleep: false })).toEqual({ openAtLogin: true, preventSleep: false, closeToTray: true });
    expect(loadAppSettings().preventSleep).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(home, "config", "app.json"), "utf8")).preventSleep).toBe(false);
    saveAppSettings({ closeToTray: false });
    expect(loadAppSettings()).toEqual({ openAtLogin: true, preventSleep: false, closeToTray: false });
  });
  it("refuse un type faux sans rien écrire", async () => {
    const home = freshHome();
    const { saveAppSettings, parseAppSettings } = await loadConfig(home);
    expect(() => saveAppSettings({ openAtLogin: "yes" })).toThrow();
    expect(fs.existsSync(path.join(home, "config", "app.json"))).toBe(false);
    expect(() => parseAppSettings({ preventSleep: 1 })).toThrow();
  });
  it("un app.json illisible retombe sur les défauts", async () => {
    const home = freshHome();
    const { loadAppSettings } = await loadConfig(home);
    fs.writeFileSync(path.join(home, "config", "app.json"), "{oups");
    expect(loadAppSettings().openAtLogin).toBe(true);
  });
});

describe("état de l'assistant", () => {
  const none = { appMode: false, gateway: false, google: false, account: false, context: false, finished: false };
  it("installation neuve : rien de fait", async () => {
    const { setupState } = await loadConfig(freshHome());
    expect(setupState(none)).toEqual({ complete: false, appMode: false, steps: { gateway: false, google: false, account: false, context: false, finished: false } });
    expect(setupState({ ...none, appMode: true }).appMode).toBe(true);
  });
  it("installation existante complète sans « terminer »", async () => {
    const { setupState } = await loadConfig(freshHome());
    expect(setupState({ ...none, gateway: true, google: true, account: true, context: true }).complete).toBe(true);
    expect(setupState({ ...none, gateway: true, google: true }).complete).toBe(false);
    // Installation neuve juste après la connexion de Gmail : l'assistant continue (profil et « toujours prêt »).
    expect(setupState({ ...none, gateway: true, google: true, account: true }).complete).toBe(false);
  });
  it("« terminer » suffit", async () => {
    const { setupState } = await loadConfig(freshHome());
    expect(setupState({ ...none, finished: true }).complete).toBe(true);
  });
});
