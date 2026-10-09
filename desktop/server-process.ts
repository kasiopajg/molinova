// Le serveur Molinova (dist/server.js) dans un utilityProcess : port, environnement, journaux, redémarrages.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { RotatingLog } from "./logs.js";

export const PREFERRED_PORT = 4310;
const STOP_GRACE_MS = 5000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** Au-delà de 5 pannes en 5 minutes, on arrête de relancer (jusqu'au « Redémarrer le serveur » du menu). */
const CRASH_WINDOW_MS = 5 * 60_000;
const CRASH_LIMIT = 5;
/** Un serveur resté debout une minute remet l'attente de relance à 1 s. */
const STABLE_MS = 60_000;

export type ServerState = "starting" | "ready" | "stopped" | "gave-up";

/** L'assistant natif molinova-text est posé à côté du binaire SQLite (Resources/native dans l'app, build/native en dev). */
export function textBinPath(sqliteBinding: string): string {
  return path.join(path.dirname(sqliteBinding), "molinova-text");
}
export interface ServerMessage { type: string; [key: string]: unknown }

export interface ServerOptions {
  entry: string;
  home: string;
  /** Port essayé en premier (4310, ou MOLINOVA_PORT pour les tests) ; sinon un port libre quelconque. */
  preferredPort: number;
  version: string;
  /** Clé de session de l'interface (MOLINOVA_SESSION_KEY) : sans elle, le serveur ne répond pas sur /api/. */
  sessionKey: string;
  sqliteBinding: string;
  serverLog: RotatingLog;
  mainLog: RotatingLog;
  /** Relu à chaque lancement : les secrets déchiffrés et MOLINOVA_SECRETS_OK (un secret posé entre deux redémarrages est bien transmis). */
  secrets(): Record<string, string>;
  onReady(port: number): void;
  onMessage(message: ServerMessage): void;
  onGiveUp(): void;
  onStateChange(state: ServerState): void;
}

/** Libre sur 127.0.0.1 ? */
function tryPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(null));
    srv.listen(port, "127.0.0.1", () => {
      const got = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(got));
    });
  });
}

/** 4310 si libre (ou le port déjà utilisé, pour garder la même adresse au redémarrage), sinon un port libre quelconque. */
export async function pickPort(preferred: number[]): Promise<number> {
  for (const p of preferred) {
    const ok = await tryPort(p);
    if (ok) return ok;
  }
  const any = await tryPort(0);
  if (!any) throw new Error("aucun port libre sur 127.0.0.1");
  return any;
}

export class ServerProcess {
  state: ServerState = "stopped";
  port = 0;
  private child: UtilityProcess | undefined;
  private stopping: Promise<void> | undefined;
  private crashes: number[] = [];
  private backoff = BACKOFF_MIN_MS;
  private retryTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;
  /** Incrémenté par stop() et par chaque start() : un lancement en cours (await du port) dépassé ne forke plus. */
  private generation = 0;

  constructor(private readonly o: ServerOptions) {}

  get running(): boolean { return !!this.child; }

  private setState(state: ServerState): void {
    this.state = state;
    this.o.onStateChange(state);
  }

  async start(): Promise<void> {
    if (this.child) return;
    clearTimeout(this.retryTimer);
    const gen = ++this.generation;
    this.setState("starting");
    try {
      this.port = await pickPort(this.port ? [this.port, this.o.preferredPort] : [this.o.preferredPort]);
      if (gen !== this.generation) return; // stop() (ou un autre start()) est passé pendant le choix du port
      if (!fs.existsSync(this.o.entry)) throw new Error(`serveur introuvable : ${this.o.entry}`);
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      // Les secrets viennent de secrets.bin, jamais d'un environnement hérité.
      for (const k of ["AI_GATEWAY_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN", "ELECTRON_RUN_AS_NODE"]) delete env[k];
      Object.assign(env, {
        MOLINOVA_APP: "1",
        MOLINOVA_HOME: this.o.home,
        MOLINOVA_PORT: String(this.port),
        MOLINOVA_VERSION: this.o.version,
        MOLINOVA_SESSION_KEY: this.o.sessionKey,
        MOLINOVA_SQLITE_BINDING: this.o.sqliteBinding,
        MOLINOVA_TEXT_BIN: textBinPath(this.o.sqliteBinding),
      }, this.o.secrets());
      const child = utilityProcess.fork(this.o.entry, ["--no-open"], {
        env,
        cwd: this.o.home,
        stdio: "pipe",
        serviceName: "Molinova Server",
      });
      this.child = child;
      this.o.mainLog.line(`serveur : lancement sur le port ${this.port}`);
      child.stdout?.on("data", (chunk: Buffer) => this.o.serverLog.write(chunk));
      child.stderr?.on("data", (chunk: Buffer) => this.o.serverLog.write(chunk));
      child.on("spawn", () => this.o.mainLog.line(`serveur : pid ${child.pid}`));
      child.on("message", (msg: unknown) => this.handleMessage(msg));
      child.on("exit", (code: number) => this.handleExit(child, code));
    } catch (err) {
      this.o.mainLog.line(`serveur : échec du lancement : ${err instanceof Error ? err.message : String(err)}`);
      this.child = undefined;
      this.crashed();
    }
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object" || typeof (msg as ServerMessage).type !== "string") return;
    const m = msg as ServerMessage;
    if (m.type === "molinova:ready") {
      this.setState("ready");
      this.o.mainLog.line(`serveur : prêt sur http://127.0.0.1:${this.port}`);
      clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => { this.backoff = BACKOFF_MIN_MS; }, STABLE_MS);
      this.o.onReady(this.port);
      return;
    }
    this.o.onMessage(m);
  }

  private handleExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return;
    this.child = undefined;
    clearTimeout(this.stableTimer);
    this.o.mainLog.line(`serveur : sorti (code ${code})`);
    if (this.stopping) return; // arrêt voulu : stop() s'en charge
    this.crashed();
  }

  /** Sortie imprévue : relance avec une attente croissante, ou abandon après trop de pannes rapprochées. */
  private crashed(): void {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= CRASH_LIMIT) {
      this.o.mainLog.line(`serveur : ${this.crashes.length} pannes en 5 minutes, relance suspendue`);
      this.setState("gave-up");
      this.o.onGiveUp();
      return;
    }
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    this.setState("starting");
    this.o.mainLog.line(`serveur : relance dans ${wait / 1000} s`);
    this.retryTimer = setTimeout(() => void this.start(), wait);
  }

  /**
   * SIGTERM, puis SIGKILL après 5 s. Annule aussi une relance programmée ou un lancement en cours :
   * sans serveur, la promesse est déjà résolue (appel sans risque à la fermeture).
   */
  stop(): Promise<void> {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.stableTimer);
    this.generation++;
    const child = this.child;
    if (!child) { this.setState("stopped"); return Promise.resolve(); }
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(kill);
        if (this.child === child) this.child = undefined;
        this.stopping = undefined;
        this.setState("stopped");
        resolve();
      };
      const kill = setTimeout(() => {
        // pid lu maintenant : juste après fork, il n'existe pas encore.
        const pid = child.pid;
        this.o.mainLog.line(`serveur : pas sorti après 5 s, SIGKILL${pid ? "" : " impossible (jamais lancé)"}`);
        if (!pid) { done(); return; }
        try { process.kill(pid, "SIGKILL"); } catch { done(); }
      }, STOP_GRACE_MS);
      child.once("exit", done);
      // Avant l'événement « spawn », kill() ne fait rien (pas encore de pid) : on attend le lancement.
      if (child.pid === undefined) child.once("spawn", () => child.kill());
      else child.kill();
    });
    return this.stopping;
  }

  /** Arrêt propre puis relance ; efface l'historique des pannes (demande de l'utilisateur ou du serveur). */
  async restart(): Promise<void> {
    await this.stop();
    this.crashes = [];
    this.backoff = BACKOFF_MIN_MS;
    await this.start();
  }
}

/** Le binaire better-sqlite3 pour l'ABI d'Electron : Resources/native dans l'app, build/native en dev. */
export function sqliteBindingPath(appRoot: string, packaged: boolean, resourcesPath: string): string {
  return packaged
    ? path.join(resourcesPath, "native", "better_sqlite3.node")
    : path.join(appRoot, "build", "native", `darwin-${process.arch}`, "better_sqlite3.node");
}
