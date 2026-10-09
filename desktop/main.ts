// Processus principal de Molinova.app (Electron) : lance le serveur local, affiche son interface, vit dans la barre des menus.
// Contrat avec le serveur : docs/desktop-app.md.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, powerSaveBlocker, shell, Tray,
  type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions,
} from "electron";
import { ago, currentLang, detectLanguage, tr } from "./i18n.js";
import { RotatingLog } from "./logs.js";
import { isSecretName, SecretStore, type SecretsHealth } from "./secrets.js";
import { PREFERRED_PORT, ServerProcess, sqliteBindingPath, type ServerMessage } from "./server-process.js";
import { isNewerVersion } from "./version.js";

// ---------- dossiers : tout ce que l'app écrit vit dans HOME (profil Chromium compris)
app.setName("Molinova");
const HOME = process.env.MOLINOVA_HOME ? path.resolve(process.env.MOLINOVA_HOME) : path.join(app.getPath("appData"), "Molinova");
fs.mkdirSync(path.join(HOME, "logs"), { recursive: true });
// Avant requestSingleInstanceLock : le verrou vit dans userData, une instance de test (MOLINOVA_HOME) ne gêne pas la vraie.
app.setPath("userData", HOME);
// Cache, cookies, localStorage de Chromium : dans un sous-dossier, à l'écart des données de Molinova.
app.setPath("sessionData", path.join(HOME, "Chromium"));

const APP_ROOT = app.getAppPath();
const mainLog = new RotatingLog(path.join(HOME, "logs", "main.log"));
const serverLog = new RotatingLog(path.join(HOME, "logs", "server.log"));
const secrets = new SecretStore(HOME);
const UPDATE_URL = "https://api.github.com/repos/kasiopajg/molinova/releases/latest";
const STATUS_EVERY_MS = 60_000;
const UPDATE_EVERY_MS = 24 * 3600_000;

// ---------- réglages de l'app (HOME/config/app.json, écrits par le serveur)
interface AppSettings { openAtLogin: boolean; preventSleep: boolean; closeToTray: boolean }
const DEFAULT_SETTINGS: AppSettings = { openAtLogin: true, preventSleep: true, closeToTray: true };
let settings: AppSettings = { ...DEFAULT_SETTINGS };

function mergeSettings(raw: unknown): AppSettings {
  const next = { ...settings };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") next[k] = v;
    }
  }
  return next;
}
function readSettingsFile(): AppSettings {
  try { return mergeSettings(JSON.parse(fs.readFileSync(path.join(HOME, "config", "app.json"), "utf8"))); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

// ---------- état pour la barre des menus (GET /api/app/status)
interface AppStatus {
  version: string; appMode: boolean; setupComplete: boolean; accounts: number; watching: number; actions: number; review: number;
  whatsapp: { enabled: boolean; lastIngestAt: string | null; error: string | null };
  telegram: { enabled: boolean; running: boolean; error: string | null };
  tokenErrors: string[];
}
let status: AppStatus | undefined;
let update: { version: string; url: string } | undefined;
const notifiedTokenErrors = new Set<string>();

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let server: ServerProcess;
let quitting = false;
let sleepBlocker: number | undefined;
let statusTimer: NodeJS.Timeout | undefined;
let updateTimer: NodeJS.Timeout | undefined;
/** Trousseau refusé ou secrets.bin illisible : le serveur le sait (MOLINOVA_SECRETS_OK=0), la barre des menus le montre. */
let secretsHealth: SecretsHealth = "ok";

const origin = () => `http://127.0.0.1:${server.port}`;
/**
 * Clé de session, nouvelle à chaque lancement : le serveur local ne répond qu'à qui la présente (la fenêtre, par un cookie
 * posé au premier chargement ; ce processus, par l'en-tête X-Molinova-Key). Un autre compte du Mac ou une autre app n'y a pas accès.
 */
const SESSION_KEY = randomBytes(32).toString("base64url");
const appUrl = () => `${origin()}/?molinova_key=${SESSION_KEY}`;
const keyHeader = { "X-Molinova-Key": SESSION_KEY };
function isLocalUrl(url: string): boolean {
  try { return !!server?.port && new URL(url).origin === origin(); } catch { return false; }
}
function isAllowedExternal(url: string): boolean {
  try { return ["https:", "http:", "mailto:"].includes(new URL(url).protocol); } catch { return false; }
}
function openExternal(url: string): void {
  if (isAllowedExternal(url)) void shell.openExternal(url).catch(() => undefined);
  else mainLog.line(`lien externe refusé : ${url.slice(0, 80)}`);
}

// ---------- fenêtre
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
/** Page locale (data:) le temps que le serveur démarre, ou pour dire qu'il n'a pas pu. */
function waitingPage(message: string, detail = ""): string {
  const html = `<!doctype html><html lang="${currentLang()}"><meta charset="utf-8"><title>Molinova</title>
<style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
font-family:-apple-system,"Helvetica Neue",sans-serif;background:#fbfbfc;color:#1b1c1f;-webkit-app-region:drag}
b{font-size:40px;font-weight:700;letter-spacing:-.03em}i{color:#ff3b30;font-style:normal}p{margin:0;color:#6f747c;font-size:14px}
small{color:#a6abb2;font-size:12px;font-family:Menlo,monospace;-webkit-user-select:text}
@media (prefers-color-scheme:dark){body{background:#1b1c1f;color:#fbfbfc}}</style>
<b>Molinova<i>.</i></b><p>${escapeHtml(message)}</p>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 600,
    titleBarStyle: "hiddenInset",
    show: false,
    backgroundColor: "#fbfbfc",
    webPreferences: {
      preload: path.join(APP_ROOT, "dist-desktop", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--molinova-version=${app.getVersion()}`],
    },
  });
  w.once("ready-to-show", () => w.show());
  // Tout ce qui n'est pas l'interface locale part dans le navigateur par défaut (http, https, mailto seulement).
  w.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => {
    if (isLocalUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  // will-navigate ne voit que le cadre principal : un lien target=_self ou une iframe distante dans le cadre d'un e-mail
  // chargerait la page dans l'app. Les sous-cadres restent sur l'interface locale, about:blank/srcdoc ou data:.
  w.webContents.on("will-frame-navigate", (e) => {
    if (e.isMainFrame || /^(about:(blank|srcdoc)|data:)/i.test(e.url) || isLocalUrl(e.url)) return;
    e.preventDefault();
    openExternal(e.url);
  });
  w.on("close", (e) => {
    if (!quitting && settings.closeToTray) { e.preventDefault(); w.hide(); }
  });
  w.on("closed", () => { if (win === w) win = undefined; });
  void w.loadURL(server.state === "ready" ? appUrl()
    : server.state === "gave-up" ? waitingPage(tr("startFailed"), tr("seeLogs", { file: serverLog.file }))
    : waitingPage(tr("starting")));
  return w;
}

/**
 * Montre la fenêtre et met l'app au premier plan, en un seul clic (Dock, barre des menus, notification).
 * show() seul ne suffit pas quand l'app n'est pas active : macOS la laisse derrière. Et l'icône du Dock n'est
 * redemandée que si elle est cachée : la redemander alors qu'elle est là peut renvoyer la fenêtre derrière les autres.
 */
function showWindow(): BrowserWindow {
  if (!win || win.isDestroyed()) win = createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); }
  if (process.platform === "darwin") {
    if (app.dock && !app.dock.isVisible()) void app.dock.show();
    app.focus({ steal: true });
  }
  win.focus();
  return win;
}

function openSettings(): void {
  const w = showWindow();
  if (isLocalUrl(w.webContents.getURL())) void w.webContents.executeJavaScript(`location.hash = "settings"`).catch(() => undefined);
}

// ---------- menus natifs
function buildAppMenu(): void {
  const view: MenuItemConstructorOptions[] = [
    { role: "reload" },
    ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as MenuItemConstructorOptions]),
    { type: "separator" },
    { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: tr("settings"), accelerator: "Cmd+,", click: openSettings },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: tr("quit") },
      ],
    },
    { role: "editMenu" },
    { label: tr("view"), submenu: view },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function trayIconPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "trayTemplate.png") : path.join(APP_ROOT, "build", "trayTemplate.png");
}

function statusLines(): MenuItemConstructorOptions[] {
  const lines: MenuItemConstructorOptions[] = [];
  const info = (label: string): MenuItemConstructorOptions => ({ label, enabled: false });
  if (server.state === "gave-up") lines.push(info(tr("serverStopped")));
  else if (server.state !== "ready") lines.push(info(tr("serverStarting")));
  if (status && server.state === "ready") {
    if (!status.setupComplete) lines.push(info(tr("setupPending")));
    lines.push(info(status.watching > 0 ? tr("watching", { n: status.watching }) : tr("notWatching")));
    lines.push(info(tr("actions", { n: status.actions })));
    if (status.whatsapp.enabled) {
      lines.push(info(status.whatsapp.error ? tr("waError", { error: status.whatsapp.error.slice(0, 60) })
        : status.whatsapp.lastIngestAt ? tr("waLast", { when: ago(status.whatsapp.lastIngestAt) }) : tr("waNever")));
    }
    if (status.telegram.enabled) lines.push(info(status.telegram.running ? tr("tgRunning") : tr("tgStopped")));
    for (const email of status.tokenErrors) lines.push({ label: `⚠︎ ${tr("reconnect", { email })}`, click: openSettings });
  }
  if (secretsHealth !== "ok") {
    lines.push({ label: `⚠︎ ${tr(secretsHealth === "unreadable" ? "secretsUnreadable" : "secretsUnavailable")}`, click: () => void recoverSecrets() });
  }
  // En tête du menu : c'est la ligne qu'on doit voir en premier.
  if (update) lines.unshift({ label: `⬆︎ ${tr("updateAvailable", { version: update.version })}`, click: () => openExternal(update!.url) });
  return lines;
}

function rebuildTray(): void {
  if (!tray) return;
  const lines = statusLines();
  const menu = Menu.buildFromTemplate([
    ...lines,
    ...(lines.length ? [{ type: "separator" } as MenuItemConstructorOptions] : []),
    { label: tr("open"), click: () => showWindow() },
    { label: tr("keepAwake"), type: "checkbox", checked: settings.preventSleep, click: (item) => void putAppSettings({ preventSleep: item.checked }) },
    { type: "separator" },
    { label: tr("restartServer"), click: () => void server.restart() },
    { label: tr("quit"), accelerator: "Cmd+Q", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------- état du serveur (barre des menus, pastille du Dock, notifications)
async function refreshStatus(): Promise<void> {
  if (server.state !== "ready") { rebuildTray(); return; }
  try {
    const res = await fetch(`${origin()}/api/app/status`, { headers: keyHeader, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status = (await res.json()) as AppStatus;
  } catch (err) {
    mainLog.line(`état : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (status) {
    app.dock?.setBadge(status.actions > 0 ? String(status.actions) : "");
    for (const email of status.tokenErrors) {
      if (notifiedTokenErrors.has(email)) continue;
      notifiedTokenErrors.add(email);
      notify(tr("tokenTitle"), tr("tokenBody", { email }), openSettings);
    }
    for (const email of [...notifiedTokenErrors]) if (!status.tokenErrors.includes(email)) notifiedTokenErrors.delete(email);
    applyLoginItem();
  }
  rebuildTray();
}

async function putAppSettings(patch: Partial<AppSettings>): Promise<void> {
  try {
    const res = await fetch(`${origin()}/api/app/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...keyHeader }, body: JSON.stringify(patch), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applySettings(await res.json());
  } catch (err) {
    mainLog.line(`réglages : ${err instanceof Error ? err.message : String(err)}`);
    rebuildTray();
  }
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on("click", onClick);
  n.show();
}

// ---------- veille, ouverture à la connexion
function applyPower(): void {
  const want = settings.preventSleep && !powerMonitor.isOnBatteryPower();
  if (want && sleepBlocker === undefined) sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
  else if (!want && sleepBlocker !== undefined) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = undefined; }
}

/** Seulement pour l'app installée, une fois l'installation terminée ; jamais pendant les tests (MOLINOVA_NO_LOGIN_ITEM=1). */
function applyLoginItem(): void {
  if (!app.isPackaged || process.env.MOLINOVA_NO_LOGIN_ITEM === "1" || !status?.setupComplete) return;
  if (app.getLoginItemSettings().openAtLogin !== settings.openAtLogin) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
}

function applySettings(raw: unknown): void {
  settings = mergeSettings(raw);
  applyPower();
  applyLoginItem();
  rebuildTray();
}

// ---------- mise à jour : la dernière Release GitHub (pas d'auto-update, l'app n'est pas notarisée)
async function checkUpdate(): Promise<void> {
  if (process.env.MOLINOVA_NO_UPDATE_CHECK === "1") return;
  try {
    const res = await fetch(UPDATE_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Molinova/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return; // 404 tant que le dépôt est privé : silence
    const rel = (await res.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
    const tag = typeof rel.tag_name === "string" ? rel.tag_name.replace(/^v/, "") : "";
    const url = typeof rel.html_url === "string" && rel.html_url.startsWith("https://github.com/") ? rel.html_url : "";
    update = tag && url && !rel.draft && isNewerVersion(tag, app.getVersion()) ? { version: tag, url } : undefined;
    if (update) mainLog.line(`mise à jour disponible : v${update.version}`);
    announceUpdate();
    rebuildTray();
  } catch { /* hors ligne : silence */ }
}

/**
 * Une nouvelle version se voit : une notification macOS, une seule fois par version (HOME/config/update-notified),
 * et un bandeau dans la fenêtre (window.molinova.onUpdate), en plus de la ligne en tête du menu de la barre.
 */
function announceUpdate(): void {
  if (win && !win.isDestroyed()) win.webContents.send("molinova:update", update ?? null);
  if (!update) return;
  const file = path.join(HOME, "config", "update-notified");
  let last = "";
  try { last = fs.readFileSync(file, "utf8").trim(); } catch { /* jamais prévenu */ }
  if (last === update.version) return;
  const u = update;
  notify(tr("updateTitle", { version: u.version }), tr("updateBody"), () => openExternal(u.url));
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, u.version); } catch { /* prévenu quand même */ }
}

// ---------- secrets : état vérifié à chaque lancement du serveur, récupération depuis la barre des menus
/** Pour le serveur : les secrets déchiffrés, et MOLINOVA_SECRETS_OK=0 quand rien ne peut être enregistré. */
function secretsEnv(): Record<string, string> {
  const before = secretsHealth;
  secretsHealth = secrets.health();
  let values: Record<string, string> = {};
  if (secretsHealth === "ok") {
    try { values = secrets.read(); }
    catch (err) { secretsHealth = "unreadable"; mainLog.line(`secrets.bin illisible : ${err instanceof Error ? err.message : String(err)}`); }
  }
  if (secretsHealth !== "ok") {
    mainLog.line(`secrets : ${secretsHealth === "unreadable" ? "secrets.bin illisible" : "safeStorage indisponible"}, rien ne sera enregistré`);
    if (before !== secretsHealth) notify(tr("secretsTitle"), tr(secretsHealth === "unreadable" ? "secretsUnreadable" : "secretsUnavailable"), () => void recoverSecrets());
  }
  return { ...values, MOLINOVA_SECRETS_OK: secretsHealth === "ok" ? "1" : "0" };
}

/** Trousseau refusé : nouvel essai (serveur relancé). secrets.bin illisible : mis de côté (secrets.bin.bad) après confirmation. */
async function recoverSecrets(): Promise<void> {
  const unreadable = secretsHealth === "unreadable";
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: tr(unreadable ? "secretsUnreadable" : "secretsUnavailable"),
    detail: tr(unreadable ? "secretsResetDetail" : "secretsRetryDetail", { file: secrets.file }),
    buttons: [tr(unreadable ? "secretsReset" : "retry"), tr("cancel")],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  if (unreadable) {
    try { mainLog.line(`secrets.bin mis de côté : ${secrets.quarantine() ?? "absent"}`); }
    catch (err) { mainLog.line(`secrets.bin : ${err instanceof Error ? err.message : String(err)}`); return; }
  }
  await server.restart();
}

// ---------- messages du serveur
function onServerMessage(m: ServerMessage): void {
  if (m.type === "molinova:secret") {
    const { name, value } = m;
    if (!isSecretName(name) || !(typeof value === "string" || value === null)) { mainLog.line("molinova:secret refusé (nom ou valeur invalide)"); return; }
    try { secrets.set(name, value); mainLog.line(`secret ${name} ${value === null ? "retiré" : "enregistré"}`); }
    catch (err) {
      // Échec après un démarrage sain (trousseau refusé entre-temps, disque) : la requête a déjà répondu, on prévient ici ;
      // le prochain lancement du serveur reçoit MOLINOVA_SECRETS_OK=0 si le problème persiste.
      mainLog.line(`secret ${name} : ${err instanceof Error ? err.message : String(err)}`);
      secretsHealth = secrets.health();
      notify(tr("secretsTitle"), tr("secretsNotSaved", { name }), secretsHealth === "ok" ? undefined : () => void recoverSecrets());
      rebuildTray();
    }
  } else if (m.type === "molinova:app-settings") {
    applySettings(m.settings);
    void refreshStatus();
  } else if (m.type === "molinova:restart") {
    mainLog.line("redémarrage demandé par le serveur");
    void server.restart();
  }
}

function onServerReady(): void {
  if (win && !win.isDestroyed()) void win.loadURL(appUrl());
  void refreshStatus();
}

// ---------- IPC du preload : seulement depuis l'interface locale, arguments vérifiés
function fromUi(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = e.senderFrame?.url;
  return !!url && isLocalUrl(url);
}

function registerIpc(): void {
  ipcMain.handle("molinova:getUpdate", (e) => {
    if (!fromUi(e)) throw new Error("forbidden");
    return update ?? null;
  });
  ipcMain.handle("molinova:openExternal", async (e, url: unknown) => {
    if (!fromUi(e)) throw new Error("forbidden");
    if (typeof url !== "string" || url.length > 4096 || !isAllowedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

// ---------- démarrage
async function start(): Promise<void> {
  detectLanguage(HOME, app.getPreferredSystemLanguages());
  mainLog.line(`Molinova ${app.getVersion()} (Electron ${process.versions.electron}, ${app.isPackaged ? "app" : "dev"}) HOME=${HOME}`);
  settings = readSettingsFile();

  const binding = sqliteBindingPath(APP_ROOT, app.isPackaged, process.resourcesPath);
  if (!fs.existsSync(binding)) {
    mainLog.line(`binaire SQLite absent : ${binding}`);
    dialog.showErrorBox("Molinova", tr("missingBinding"));
    app.exit(1);
    return;
  }

  server = new ServerProcess({
    entry: path.join(APP_ROOT, "dist", "server.js"),
    home: HOME,
    preferredPort: Number(process.env.MOLINOVA_PORT) || PREFERRED_PORT,
    version: app.getVersion(),
    sessionKey: SESSION_KEY,
    sqliteBinding: binding,
    serverLog,
    mainLog,
    secrets: secretsEnv,
    onReady: onServerReady,
    onMessage: onServerMessage,
    onGiveUp: () => {
      notify(tr("crashTitle"), tr("crashBody"));
      if (win && !win.isDestroyed()) void win.loadURL(waitingPage(tr("startFailed"), tr("seeLogs", { file: serverLog.file })));
      rebuildTray();
    },
    onStateChange: () => rebuildTray(),
  });

  registerIpc();
  buildAppMenu();
  const icon = nativeImage.createFromPath(trayIconPath());
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Molinova");
  rebuildTray();

  powerMonitor.on("on-ac", applyPower);
  powerMonitor.on("on-battery", applyPower);
  applyPower();

  win = createWindow();
  await server.start();

  statusTimer = setInterval(() => void refreshStatus(), STATUS_EVERY_MS);
  void checkUpdate();
  updateTimer = setInterval(() => void checkUpdate(), UPDATE_EVERY_MS);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { showWindow(); });
  app.on("activate", () => { showWindow(); });
  app.on("window-all-closed", () => { /* l'app reste dans la barre des menus */ });
  app.on("before-quit", (e) => {
    quitting = true;
    clearInterval(statusTimer);
    clearInterval(updateTimer);
    if (!server) return;
    // Toujours : annule aussi une relance programmée ou un lancement en cours. On n'attend que s'il y a un serveur.
    const stopped = server.stop();
    if (server.running) {
      e.preventDefault();
      void stopped.finally(() => app.quit());
    }
  });
  app.on("will-quit", () => {
    if (sleepBlocker !== undefined) powerSaveBlocker.stop(sleepBlocker);
    mainLog.line("fin");
    mainLog.close();
    serverLog.close();
  });
  // kill / Ctrl+C : même chemin que Cmd+Q, le serveur est arrêté proprement.
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => app.quit());
  app.whenReady().then(start).catch((err: unknown) => {
    mainLog.line(`démarrage : ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    dialog.showErrorBox("Molinova", `${tr("startFailed")}\n${err instanceof Error ? err.message : String(err)}`);
    app.exit(1);
  });
}
