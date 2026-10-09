/**
 * Voir et télécharger un document de Drive depuis la page Documents, sans quitter Molinova.
 * Aperçu : PDF, images (HEIC compris) et fichiers Google rendus en JPEG page par page par l'assistant natif ;
 * Word, RTF et OpenDocument convertis en HTML par textutil (affiché dans un cadre sans script) ; texte tel quel.
 * Les fichiers et les pages rendues vivent quelques heures dans le dossier temporaire du système, puis sont effacés.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textBin, type TextSource } from "./doc-extract.js";

export interface PreviewDoc { accountId: number; id: string; name: string; mime: string; format: string | null; size: number | null; stamp: string }
export type PreviewInfo = { kind: "pages"; pages: number } | { kind: "html" } | { kind: "text" } | { kind: "none"; reason: "format" | "size" | "helper" };

/** Au-delà, pas d'aperçu : on télécharge le fichier, ou on l'ouvre dans Drive. */
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const CACHE_HOURS = 6;
const GOOGLE_PDF = new Set(["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation"]);
const TEXTUTIL = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "application/rtf", "text/rtf", "application/vnd.oasis.opendocument.text"]);
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tiff", "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/msword": "doc", "application/rtf": "rtf", "text/rtf": "rtf", "application/vnd.oasis.opendocument.text": "odt" };

/** Ce que l'aperçu peut montrer de ce document. */
export function previewKind(doc: Pick<PreviewDoc, "mime" | "format" | "size">, bin = textBin()): PreviewInfo["kind"] | "none" {
  if (doc.size != null && doc.size > MAX_PREVIEW_BYTES) return "none";
  if (GOOGLE_PDF.has(doc.mime) || doc.format === "pdf" || doc.format === "image") return bin ? "pages" : "none";
  if (TEXTUTIL.has(doc.mime)) return "html";
  if (doc.format === "text") return "text";
  return "none";
}

const root = () => path.join(os.tmpdir(), "molinova-preview");
/** Le dossier de cache d'un document dans sa version du moment (une modification dans Drive = un nouveau dossier). */
function cacheDir(doc: PreviewDoc): string {
  const key = crypto.createHash("sha1").update(`${doc.accountId}:${doc.id}:${doc.stamp}`).digest("hex").slice(0, 20);
  return path.join(root(), key);
}
/** Efface les aperçus de plus de CACHE_HOURS heures. */
export function sweepPreviews(now = Date.now()): void {
  try {
    for (const d of fs.readdirSync(root())) {
      const p = path.join(root(), d);
      try { if (now - fs.statSync(p).mtimeMs > CACHE_HOURS * 3600_000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* déjà parti */ }
    }
  } catch { /* pas encore de cache */ }
}

/** Le fichier source, téléchargé une fois (un fichier Google est exporté en PDF). */
async function source(src: TextSource, doc: PreviewDoc): Promise<string> {
  const dir = cacheDir(doc);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const google = GOOGLE_PDF.has(doc.mime);
  const file = path.join(dir, `source.${google ? "pdf" : EXT[doc.mime] ?? (path.extname(doc.name).slice(1).toLowerCase() || "bin")}`);
  if (!fs.existsSync(file)) {
    const data = google ? await src.exportAs(doc.id, "application/pdf") : await src.download(doc.id);
    fs.writeFileSync(file, data, { mode: 0o600 });
  }
  return file;
}
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (err, out) => {
    if (!err) return resolve(out);
    let why = ""; try { why = (JSON.parse(out.trim()) as { error?: string }).error ?? ""; } catch { /* pas du JSON */ }
    reject(new Error(why || err.message));
  }));
}

/** Combien de pages l'aperçu aura (la première est rendue au passage). */
export async function previewInfo(src: TextSource, doc: PreviewDoc, bin = textBin()): Promise<PreviewInfo> {
  sweepPreviews();
  if (doc.size != null && doc.size > MAX_PREVIEW_BYTES) return { kind: "none", reason: "size" };
  const kind = previewKind(doc, bin);
  if (kind === "none") return { kind: "none", reason: GOOGLE_PDF.has(doc.mime) || doc.format === "pdf" || doc.format === "image" ? "helper" : "format" };
  if (kind !== "pages") return { kind };
  const meta = path.join(cacheDir(doc), "pages.json");
  if (fs.existsSync(meta)) return { kind: "pages", pages: (JSON.parse(fs.readFileSync(meta, "utf8")) as { pages: number }).pages };
  await previewPage(src, doc, 1, bin);
  return { kind: "pages", pages: (JSON.parse(fs.readFileSync(meta, "utf8")) as { pages: number }).pages };
}

/** Une page en JPEG (rendue une fois, puis servie depuis le cache). */
export async function previewPage(src: TextSource, doc: PreviewDoc, page: number, bin = textBin()): Promise<Buffer> {
  if (!bin) throw new Error("molinova-text");
  const dir = cacheDir(doc);
  const png = path.join(dir, `p${page}.jpg`);
  if (!fs.existsSync(png)) {
    const file = await source(src, doc);
    const r = JSON.parse((await run(bin, [file, "--render", png, "--page", String(page), "--width", "1400"])).trim().split("\n").pop() || "{}") as { pages?: number };
    fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify({ pages: r.pages ?? 1 }));
  }
  return fs.readFileSync(png);
}

/** La règle de sécurité posée dans chaque aperçu HTML : rien ne se charge d'ailleurs, rien ne s'exécute. */
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
/**
 * Un HTML d'aperçu sûr : sans script, sans attribut d'événement, sans caractère nul (textutil en laisse dans les
 * métadonnées des vieux .doc), avec la règle de sécurité en tête. L'interface l'affiche en plus dans un cadre sans script.
 */
export function safeHtml(html: string): string {
  const clean = html.replace(/\u0000/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, (m) => m + PREVIEW_CSP) : PREVIEW_CSP + clean;
}
/** Word, RTF, OpenDocument en HTML (textutil, sur le Mac) ; un texte, échappé dans un <pre>. */
export async function previewHtml(src: TextSource, doc: PreviewDoc): Promise<string> {
  const file = await source(src, doc);
  if (TEXTUTIL.has(doc.mime)) return safeHtml(await run("/usr/bin/textutil", ["-convert", "html", "-stdout", file]));
  const text = fs.readFileSync(file, "utf8").slice(0, 200_000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return safeHtml(`<!doctype html><html><head><meta charset="utf-8"></head><body><pre style="white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace;margin:16px">${text}</pre></body></html>`);
}

/** Le fichier à télécharger : tel quel, ou en PDF pour un fichier Google. */
export async function downloadFile(src: TextSource, doc: PreviewDoc): Promise<{ data: Buffer; name: string; mime: string }> {
  if (GOOGLE_PDF.has(doc.mime)) return { data: await src.exportAs(doc.id, "application/pdf"), name: `${doc.name}.pdf`, mime: "application/pdf" };
  return { data: await src.download(doc.id), name: doc.name, mime: doc.mime };
}
