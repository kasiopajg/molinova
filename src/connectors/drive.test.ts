import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de sécurité : Molinova est open source et tourne sur le Drive de ses utilisateurs. Aucun code ne doit
 * pouvoir supprimer, mettre à la corbeille, vider la corbeille ou changer un partage dans Google Drive. Si un jour
 * une de ces lignes apparaît, ce test casse : c'est voulu, la règle ne se contourne pas par mégarde.
 */
const SRC = path.resolve(import.meta.dirname, "..");
const FORBIDDEN: Array<[string, RegExp]> = [
  ["suppression de fichier", /files\s*\.\s*delete\s*\(/],
  ["vidage de la corbeille", /emptyTrash/],
  ["mise à la corbeille", /trashed\s*:\s*true/],
  ["changement de partage", /permissions\s*\.\s*(create|update|delete|patch)\s*\(/],
  ["suppression de Drive partagé", /drives\s*\.\s*delete\s*\(/],
];
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

describe("Google Drive : ce que Molinova ne fait jamais", () => {
  const files = sources(SRC);
  it("trouve bien le code à surveiller", () => {
    expect(files.some((f) => f.endsWith(path.join("connectors", "drive.ts")))).toBe(true);
  });
  for (const [what, re] of FORBIDDEN) {
    it(`aucune ${what}`, () => {
      const hits = files.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
      expect(hits).toEqual([]);
    });
  }
  it("le connecteur Drive n'écrit rien : ni création, ni modification, ni copie", () => {
    const code = fs.readFileSync(path.join(SRC, "connectors", "drive.ts"), "utf8");
    expect(code).not.toMatch(/files\s*\.\s*(create|update|copy)\s*\(/);
  });
});
