import { google, type drive_v3 } from "googleapis";
import { t } from "../i18n/index.js";
import { clientForAccount } from "./gmail.js";

/**
 * Google Drive, en lecture seule (droit `drive.readonly`) : noms, dossiers, dates, empreintes, et le contenu d'un fichier
 * quand Molinova le lit pour remplir sa fiche ou l'envoyer sur demande. Ce module ne contient
 * aucun appel qui écrit, déplace, partage ou supprime ; un test (drive.test.ts) veille à ce que ça reste vrai.
 */

/** Un élément de Drive tel que Molinova le garde : jamais le contenu, seulement ce qui sert à le retrouver. */
export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  parentId: string | null;
  size: number | null;
  md5: string | null;
  modifiedAt: string | null;
  createdAt: string | null;
  ownedByMe: boolean;
  link: string | null;
}
export const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,parents,size,md5Checksum,modifiedTime,createdTime,ownedByMe,webViewLink,trashed";

const httpCode = (err: unknown): number => { const e = err as { code?: number | string; status?: number }; return Number(e.code ?? e.status); };
const reasonOf = (err: unknown): string => {
  const e = err as { errors?: Array<{ reason?: string }>; response?: { data?: { error?: { errors?: Array<{ reason?: string }>; status?: string } } }; message?: string };
  return e.errors?.[0]?.reason ?? e.response?.data?.error?.errors?.[0]?.reason ?? e.response?.data?.error?.status ?? "";
};
/** Les refus de Google qui ont une solution connue : API non activée dans le projet, droit Drive absent. */
export function driveError(err: unknown): Error {
  const reason = reasonOf(err), msg = (err as Error)?.message ?? "";
  if (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(msg)) return Object.assign(new Error(t("drive.apiDisabled")), { code: "drive.apiDisabled", status: 400 });
  if (reason === "insufficientPermissions" || (reason === "PERMISSION_DENIED" && /scope/i.test(msg)) || /insufficient authentication scopes/i.test(msg)) return Object.assign(new Error(t("drive.scopeMissing")), { code: "drive.scopeMissing", status: 400 });
  return err instanceof Error ? err : new Error(String(err));
}

/** Drive accepte ~12 000 requêtes par minute : on va pas à pas, et on attend quand Google freine (403/429 de débit, 5xx). */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      const code = httpCode(err), reason = reasonOf(err);
      const retry = code === 429 || code >= 500 || (code === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason));
      if (!retry || attempt >= 5) throw driveError(err);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    }
  }
}

function toEntry(f: drive_v3.Schema$File): DriveEntry {
  return {
    id: f.id!, name: f.name ?? "", mimeType: f.mimeType ?? "",
    parentId: f.parents?.[0] ?? null,
    size: f.size != null ? Number(f.size) : null, md5: f.md5Checksum ?? null,
    modifiedAt: f.modifiedTime ?? null, createdAt: f.createdTime ?? null,
    ownedByMe: !!f.ownedByMe, link: f.webViewLink ?? null,
  };
}

export class DriveReader {
  private drive: drive_v3.Drive;
  constructor(email: string) { this.drive = google.drive({ version: "v3", auth: clientForAccount(email) }); }

  /** L'identifiant de « Mon Drive » : le haut de l'arborescence. */
  async rootId(): Promise<string> {
    const r = await call(() => this.drive.files.get({ fileId: "root", fields: "id" }));
    return r.data.id!;
  }

  /** Tout ce qui n'est pas à la corbeille, page par page (1 000 éléments), métadonnées seulement. */
  async listAll(onPage?: (n: number) => void, signal?: AbortSignal): Promise<DriveEntry[]> {
    const out: DriveEntry[] = [];
    let pageToken: string | undefined;
    do {
      if (signal?.aborted) throw new Error(t("gmail.stopped"));
      const r = await call(() => this.drive.files.list({ q: "trashed = false", spaces: "drive", corpora: "user", pageSize: 1000, pageToken, fields: `nextPageToken, files(${FIELDS})` }));
      for (const f of r.data.files ?? []) if (f.id) out.push(toEntry(f));
      onPage?.(out.length);
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  /** Le point de départ des changements : pris avant une lecture complète, rien de ce qui bouge pendant n'est perdu. */
  async startPageToken(): Promise<string> {
    const r = await call(() => this.drive.changes.getStartPageToken({}));
    return r.data.startPageToken!;
  }

  /** Le fichier tel quel (PDF, image, docx…), pour en lire le texte sur le Mac ou l'envoyer sur demande. */
  async download(fileId: string): Promise<Buffer> {
    const r = await call(() => this.drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }));
    return Buffer.from(r.data as unknown as ArrayBuffer);
  }

  /** Un fichier Google (Docs, Sheets, Slides) converti : text/plain, text/csv, ou application/pdf pour l'envoyer. */
  async exportAs(fileId: string, mimeType: string): Promise<Buffer> {
    const r = await call(() => this.drive.files.export({ fileId, mimeType }, { responseType: "arraybuffer" }));
    return Buffer.from(r.data as unknown as ArrayBuffer);
  }

  /**
   * La recherche de Google dans le contenu des fichiers (texte, et ce que Google lit lui-même dans les PDF et les images).
   * Un mot au moins doit y être ; renvoie les identifiants, du plus pertinent au moins pertinent selon Google.
   */
  async fullTextSearch(words: string[], limit = 30): Promise<string[]> {
    const terms = words.map((w) => w.trim()).filter(Boolean).slice(0, 8).map((w) => `fullText contains '${w.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
    if (!terms.length) return [];
    const r = await call(() => this.drive.files.list({ q: `(${terms.join(" or ")}) and trashed = false`, spaces: "drive", corpora: "user", pageSize: Math.min(100, limit), fields: "files(id)" }));
    return (r.data.files ?? []).map((f) => f.id!).filter(Boolean);
  }

  /** Ce qui a changé depuis `token` : éléments modifiés, ou retirés (corbeille, suppression, perte d'accès). */
  async changesSince(token: string): Promise<{ changed: DriveEntry[]; removed: string[]; next: string }> {
    const changed: DriveEntry[] = [], removed: string[] = [];
    let pageToken: string | undefined = token, next = token;
    while (pageToken) {
      const r = await call(() => this.drive.changes.list({ pageToken, spaces: "drive", pageSize: 1000, includeRemoved: true, fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FIELDS}))` }));
      for (const c of r.data.changes ?? []) {
        if (!c.fileId) continue;
        if (c.removed || !c.file || c.file.trashed) removed.push(c.fileId);
        else changed.push(toEntry(c.file));
      }
      if (r.data.newStartPageToken) next = r.data.newStartPageToken;
      pageToken = r.data.nextPageToken ?? undefined;
    }
    return { changed, removed, next };
  }
}
