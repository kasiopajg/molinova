// HOME/secrets.bin : un JSON { NOM: valeur } chiffré par safeStorage (clé dans le trousseau macOS).
// Seuls les quatre noms connus passent (docs/desktop-app.md, « Secrets »).
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

export const SECRET_NAMES = ["AI_GATEWAY_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export type Secrets = Partial<Record<SecretName, string>>;

export function isSecretName(name: unknown): name is SecretName {
  return typeof name === "string" && (SECRET_NAMES as readonly string[]).includes(name);
}

/** État du stockage chiffré, vérifié au démarrage et à chaque lancement du serveur (MOLINOVA_SECRETS_OK). */
export type SecretsHealth = "ok" | "unavailable" | "unreadable";

export class SecretStore {
  readonly file: string;
  constructor(home: string) { this.file = path.join(home, "secrets.bin"); }

  /** Les secrets déchiffrés ; {} si le fichier manque. Un fichier illisible lève (on ne l'écrase pas en silence). */
  read(): Secrets {
    if (!fs.existsSync(this.file)) return {};
    const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file))) as Record<string, unknown>;
    const out: Secrets = {};
    for (const name of SECRET_NAMES) if (typeof raw[name] === "string" && raw[name]) out[name] = raw[name] as string;
    return out;
  }

  /**
   * Peut-on écrire ? « unavailable » : safeStorage refusé (clic sur « Refuser » à la demande du trousseau, clé absente) ;
   * « unreadable » : secrets.bin ne se déchiffre plus (clé « Molinova Safe Storage » réinitialisée) — toute écriture échouerait.
   */
  health(): SecretsHealth {
    try { if (!safeStorage.isEncryptionAvailable()) return "unavailable"; } catch { return "unavailable"; }
    try { this.read(); return "ok"; } catch { return "unreadable"; }
  }

  /** Récupération : secrets.bin illisible mis de côté (secrets.bin.bad, horodaté si besoin) ; le suivant repart de zéro. */
  quarantine(): string | null {
    if (!fs.existsSync(this.file)) return null;
    let dest = `${this.file}.bad`;
    if (fs.existsSync(dest)) dest = `${this.file}.bad-${Date.now()}`;
    fs.renameSync(this.file, dest);
    return dest;
  }

  /** Pose (ou retire avec null) un secret, rechiffre, écriture atomique en 0600. */
  set(name: SecretName, value: string | null): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage indisponible");
    const next = this.read();
    if (value === null || value === "") delete next[name];
    else next[name] = value;
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }
}
