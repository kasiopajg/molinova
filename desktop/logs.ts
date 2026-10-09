// Journaux de l'app : HOME/logs/server.log (sorties du serveur) et HOME/logs/main.log (processus principal).
// Rotation à 5 Mo, 3 fichiers en tout : x.log, x.log.1, x.log.2.
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

export class RotatingLog {
  private size = 0;
  private fd: number | undefined;

  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { this.size = fs.statSync(file).size; } catch { this.size = 0; }
  }

  write(chunk: string | Buffer): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    try {
      if (this.size + buf.length > MAX_BYTES && this.size > 0) this.rotate();
      if (this.fd === undefined) this.fd = fs.openSync(this.file, "a", 0o600);
      fs.writeSync(this.fd, buf);
      this.size += buf.length;
    } catch { /* disque plein, dossier retiré : le journal ne doit jamais arrêter l'app */ }
  }

  /** Une ligne horodatée. */
  line(message: string): void {
    this.write(`${new Date().toISOString()} ${message}\n`);
  }

  close(): void {
    if (this.fd !== undefined) try { fs.closeSync(this.fd); } catch { /* déjà fermé */ }
    this.fd = undefined;
  }

  private rotate(): void {
    this.close();
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
      try { fs.renameSync(from, `${this.file}.${i}`); } catch { /* fichier absent */ }
    }
    this.size = 0;
  }
}
