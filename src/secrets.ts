/**
 * Secrets de l'app (voir docs/desktop-app.md › Secrets). Une seule lecture : process.env.
 * Écriture : la persistance du mode courant, puis process.env —
 * app → le processus principal chiffre dans secrets.bin (trousseau macOS) ;
 * dev → la ligne NOM=valeur de HOME/.env.local (0600), le reste du fichier intact.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { APP_MODE, HOME, postToMain } from "./config.js";
import { t } from "./i18n/index.js";

export const SECRET_NAMES = ["AI_GATEWAY_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export type SecretSource = "keychain" | ".env.local" | "env";

export const isSecretName = (x: unknown): x is SecretName => typeof x === "string" && (SECRET_NAMES as readonly string[]).includes(x);
/** Le fichier .env.local du dossier de données. */
export const envFile = (): string => path.join(HOME, ".env.local");

export function getSecret(name: SecretName): string | undefined {
  return process.env[name] || undefined;
}

function readEnvFile(file: string): Record<string, string> {
  try { return dotenv.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

/** D'où vient la valeur en cours : le trousseau (app), .env.local (dev), ou l'environnement du shell. */
export function secretSource(name: SecretName): SecretSource | null {
  const v = getSecret(name);
  if (!v) return null;
  if (APP_MODE) return "keychain";
  return readEnvFile(envFile())[name] === v ? ".env.local" : "env";
}

/** Une valeur écrite telle quelle si elle est simple, sinon entre guillemets (dotenv coupe au « # » sinon). */
function envLine(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(t("secret.badValue", { name }));
  if (/^[\w.\-:/+=@~]*$/.test(value)) return `${name}=${value}`;
  if (!value.includes("'")) return `${name}='${value}'`;
  if (!value.includes('"')) return `${name}="${value}"`;
  throw new Error(t("secret.badValue", { name }));
}

/**
 * Ajoute, remplace ou retire (value null) la ligne NOM=… d'un fichier .env ; commentaires et autres lignes gardés.
 * Écriture atomique (fichier temporaire puis rename), mode 0600.
 */
export function upsertEnvFile(file: string, name: string, value: string | null): void {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[^\w]/g, "")}\\s*=`);
  const out: string[] = [];
  let placed = false;
  for (const line of lines) {
    if (!re.test(line)) { out.push(line); continue; }
    // Première occurrence remplacée, les doublons retirés.
    if (value !== null && !placed) { out.push(envLine(name, value)); placed = true; }
  }
  if (value !== null && !placed) out.push(envLine(name, value));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out.length ? out.join("\n") + "\n" : "", { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/** App : le processus principal a vérifié au lancement que secrets.bin peut être écrit (MOLINOVA_SECRETS_OK=0 sinon). */
export const secretsWritable = (): boolean => !APP_MODE || process.env.MOLINOVA_SECRETS_OK !== "0";

/**
 * Pose (ou efface, value null ou vide) un secret : persistance selon le mode, puis effet immédiat.
 * Une valeur refusée par .env.local, ou un trousseau inutilisable (app, MOLINOVA_SECRETS_OK=0), lève une exception
 * et ne change rien, même en mémoire. false : gardé en mémoire seulement (pas de processus principal).
 */
export function setSecret(name: SecretName, value: string | null): boolean {
  const v = value?.trim() || null;
  let persisted = true;
  if (!secretsWritable()) throw Object.assign(new Error(t("secret.unavailable", { name })), { code: "secret.unavailable", status: 503 });
  if (APP_MODE) {
    persisted = postToMain({ type: "molinova:secret", name, value: v });
    if (!persisted) console.error(`[secrets] ${name} : pas de processus principal, valeur gardée en mémoire seulement`);
  } else upsertEnvFile(envFile(), name, v);
  if (v) process.env[name] = v;
  else delete process.env[name];
  return persisted;
}
