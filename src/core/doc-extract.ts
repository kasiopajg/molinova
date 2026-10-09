/**
 * Le texte d'un document de Drive, lu sur le Mac : export Google pour Docs, Sheets et Slides, couche texte ou OCR de macOS
 * pour les PDF et les images (assistant natif molinova-text), textutil de macOS pour Word, RTF et OpenDocument.
 * Seuls les ~6 000 premiers caractères servent : assez pour savoir ce qu'est un document, pas plus.
 * Le fichier téléchargé vit le temps de la lecture, dans le dossier temporaire du système, puis il est effacé.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../config.js";

export const TEXT_CHARS = 6000;
/** Au-delà, on ne télécharge pas pour lire : le document garde son nom, et la recherche passe par celle de Google. */
export const MAX_READ_BYTES = 20 * 1024 * 1024;

export type ReadMethod = "export" | "pdf" | "ocr" | "textutil" | "plain";
export interface ReadDoc { id: string; name: string; mime: string; format: string | null; size: number | null }
/** Ce dont la lecture a besoin de Drive (DriveReader, ou un faux dans les tests). */
export interface TextSource { download(fileId: string): Promise<Buffer>; exportAs(fileId: string, mime: string): Promise<Buffer> }

const GOOGLE_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
/** Ce que textutil sait lire, avec l'extension qu'il attend. Excel et PowerPoint : le nom seulement. */
const TEXTUTIL: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "application/vnd.oasis.opendocument.text": "odt",
};
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tiff", "image/webp": "webp" };

/** L'assistant natif : posé par l'app (MOLINOVA_TEXT_BIN), ou compilé en dev par pnpm native:text. Null s'il manque. */
export function textBin(): string | null {
  const p = process.env.MOLINOVA_TEXT_BIN || path.join(ROOT, "build", "native", `darwin-${process.arch}`, "molinova-text");
  return fs.existsSync(p) ? p : null;
}
/** Ce que le document peut donner : lisible (et comment), ou pas (format, taille, assistant absent). */
export function readableBy(doc: ReadDoc, bin = textBin()): ReadMethod | null {
  if (GOOGLE_EXPORT[doc.mime]) return "export";
  if (doc.size != null && doc.size > MAX_READ_BYTES) return null;
  if (doc.format === "pdf") return bin ? "pdf" : null;
  if (doc.format === "image") return bin ? "ocr" : null;
  if (TEXTUTIL[doc.mime]) return "textutil";
  if (doc.format === "text") return "plain";
  return null;
}

/** Espaces et lignes vides en trop retirés, coupé à TEXT_CHARS. */
export function tidy(s: string): string {
  return s
    .replace(/\r/g, "").replace(/\f/g, "\n")
    // Rubriques de formulaire : lignes de pointillés, de tirets bas ou de points de suspension.
    .replace(/(?:[.\u2026_]\s?){4,}/g, " ")
    .replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, TEXT_CHARS);
}

function run(cmd: string, args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // molinova-text dit pourquoi il échoue en JSON sur stdout (« pdf protégé par un mot de passe ») : c'est ce message qu'on garde.
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
      if (!err) return resolve(stdout);
      let why = ""; try { why = (JSON.parse(stdout.trim()) as { error?: string }).error ?? ""; } catch { /* pas du JSON */ }
      reject(new Error(why || err.message));
    });
  });
}
async function withTemp<T>(data: Buffer, ext: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-doc-"));
  const file = path.join(dir, `doc.${ext}`);
  try { fs.writeFileSync(file, data, { mode: 0o600 }); return await fn(file); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Le texte d'un document, ou null s'il n'est pas lisible ici. Une erreur de Drive ou de lecture remonte à l'appelant. */
export async function extractText(src: TextSource, doc: ReadDoc, bin = textBin()): Promise<{ text: string; method: ReadMethod } | null> {
  const method = readableBy(doc, bin);
  if (!method) return null;
  if (method === "export") return { text: tidy((await src.exportAs(doc.id, GOOGLE_EXPORT[doc.mime])).toString("utf8")), method };
  const data = await src.download(doc.id);
  if (method === "plain") return { text: tidy(data.toString("utf8")), method };
  if (method === "textutil") return { text: tidy(await withTemp(data, TEXTUTIL[doc.mime], (f) => run("/usr/bin/textutil", ["-convert", "txt", "-stdout", f]))), method };
  const ext = method === "pdf" ? "pdf" : IMAGE_EXT[doc.mime] ?? (path.extname(doc.name).slice(1) || "jpg");
  const out = await withTemp(data, ext, (f) => run(bin!, [f, "--max-chars", String(TEXT_CHARS), "--ocr-pages", "2"]));
  const r = JSON.parse(out.trim().split("\n").pop() || "{}") as { text?: string; ocr?: boolean; error?: string };
  if (r.error) throw new Error(r.error);
  return { text: tidy(r.text ?? ""), method: r.ocr ? "ocr" : "pdf" };
}
