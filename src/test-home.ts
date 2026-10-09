/**
 * Avant chaque fichier de test : MOLINOVA_HOME sur un dossier neuf, jamais le dépôt (config privée, .env.local).
 * Un MOLINOVA_HOME déjà posé est respecté : `MOLINOVA_HOME=$PWD pnpm test` vérifie aussi sa propre configuration.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

if (!process.env.MOLINOVA_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-test-"));
  process.env.MOLINOVA_HOME = home;
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
}
