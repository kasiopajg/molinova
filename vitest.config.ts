import { defineConfig } from "vitest/config";
// better-sqlite3 est un module natif : on isole les tests en processus, pas en threads.
// src/test-home.ts : chaque fichier de test travaille dans un dossier de données neuf.
export default defineConfig({ test: { pool: "forks", include: ["src/**/*.test.ts"], setupFiles: ["src/test-home.ts"] } });
