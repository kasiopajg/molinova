import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSettings, parseTaxonomy, PATHS, type Taxonomy } from "../config.js";
import { DEFAULT_SPECIAL_LABELS, DEFAULT_TAXONOMY, defaultTaxonomy } from "../i18n/taxonomy-defaults.js";
import { planLanguageChange } from "./language.js";

const color = { background: "#fef1d1", text: "#7a2e0b" };
const cat = (key: string, name: string, extra: Record<string, unknown> = {}) => ({ key, name, criteria: DEFAULT_TAXONOMY.fr[key]?.criteria ?? "x", color, ...extra });
const tax = (): Taxonomy => parseTaxonomy({ prefix: "AI", categories: [
  cat("maison", "Maison"),
  { key: "maison_jardinage", name: "Jardinage", criteria: "Jardinier, piscine.", color, parent: "maison" },
  cat("voyages", "Voyages", { criteria: "Mes voyages à moi." }),
  cat("clients", "Mes clients"),
  cat("finance", "Finance"),
] });
const special = { ...DEFAULT_SPECIAL_LABELS.fr };

describe("changement de langue", () => {
  it("renomme les noms encore par défaut, les critères restés par défaut, et laisse les personnalisés", () => {
    const p = planLanguageChange("fr", "en", tax(), special);
    const by = Object.fromEntries(p.taxonomy.categories.map((c) => [c.key, c]));
    expect(by.maison.name).toBe("Home");
    expect(by.maison.criteria).toBe(DEFAULT_TAXONOMY.en.maison.criteria);
    expect(by.voyages.name).toBe("Travel");
    expect(by.voyages.criteria).toBe("Mes voyages à moi."); // critère personnalisé : intact
    expect(by.clients.name).toBe("Mes clients"); // nom personnalisé : intact
    expect(by.maison_jardinage.name).toBe("Jardinage"); // pas dans les défauts : intact
    expect(p.skipped).toEqual([{ key: "clients", name: "Mes clients", reason: "custom" }]);
  });
  it("liste les renommages Gmail parents d'abord, les sous-catégories suivent leur parent", () => {
    const p = planLanguageChange("fr", "en", tax(), special);
    expect(p.categories.map((c) => c.label.from + " → " + c.label.to)).toEqual([
      "AI/Maison → AI/Home",
      "AI/Voyages → AI/Travel",
      "AI/Maison/Jardinage → AI/Home/Jardinage",
    ]);
  });
  it("renomme les libellés spéciaux encore par défaut, et « Important » ne bouge pas entre fr et en", () => {
    const p = planLanguageChange("fr", "en", tax(), { ...special, toPay: "Factures" });
    expect(p.specialLabels).toEqual({ review: "To review", reply: "To reply", toPay: "Factures", suspect: "Suspicious", important: "Important" });
    expect(p.specials.map((s) => s.id).sort()).toEqual(["reply", "review", "suspect"]);
    expect(p.specials.find((s) => s.id === "review")!.label).toEqual({ from: "AI/À revoir", to: "AI/To review" });
  });
  it("revient à l'identique en repassant en français", () => {
    const there = planLanguageChange("fr", "es", tax(), special);
    const back = planLanguageChange("es", "fr", there.taxonomy, there.specialLabels);
    expect(back.taxonomy).toEqual(tax());
    expect(back.specialLabels).toEqual(special);
  });
  it("ne renomme pas vers un nom déjà pris", () => {
    const t = parseTaxonomy({ prefix: "AI", categories: [cat("maison", "Maison"), cat("loisirs", "Home")] });
    const p = planLanguageChange("fr", "en", t, special);
    expect(p.taxonomy.categories[0].name).toBe("Maison");
    expect(p.skipped).toContainEqual({ key: "maison", name: "Maison", reason: "collision" });
  });
  it("même langue : rien ne change", () => {
    const p = planLanguageChange("fr", "fr", tax(), special);
    expect(p.categories).toEqual([]);
    expect(p.specials).toEqual([]);
    expect(p.skipped).toEqual([]);
  });
});

describe("nouvelle installation", () => {
  it("sans settings.json : anglais, seuils standard, libellés spéciaux anglais", () => {
    const s = parseSettings(undefined);
    expect(s.language).toBe("en");
    expect(s.specialLabels).toEqual(DEFAULT_SPECIAL_LABELS.en);
    expect(s.thresholds.categoryConfidence).toBe(0.7);
    expect(s.dateFormat).toBe("eu");
  });
  it("un settings.json qui dit fr garde ses libellés français", () => {
    const s = parseSettings({ language: "fr", specialLabels: DEFAULT_SPECIAL_LABELS.fr });
    expect(s.language).toBe("fr");
    expect(s.specialLabels.review).toBe("À revoir");
  });
});

describe("défauts par langue", () => {
  // Configuration réelle (privée, absente d'un clone neuf) : vérifiée seulement si elle existe, par ex. `MOLINOVA_HOME=$PWD pnpm test`.
  const hasConfig = ["taxonomy.json", "settings.json"].every((f) => fs.existsSync(path.join(PATHS.config, f)));
  it.skipIf(!hasConfig)("config/taxonomy.json : chaque nom par défaut est celui de la langue courante, jamais celui d'une autre langue", () => {
    const real = parseTaxonomy(JSON.parse(fs.readFileSync(path.join(PATHS.config, "taxonomy.json"), "utf8")));
    const lang = parseSettings(JSON.parse(fs.readFileSync(path.join(PATHS.config, "settings.json"), "utf8"))).language;
    for (const c of real.categories) {
      if (!DEFAULT_TAXONOMY.fr[c.key]) continue;
      // Un nom identique dans deux langues (« Clients », « Finance ») n'est pas périmé.
      const stale = c.name !== DEFAULT_TAXONOMY[lang][c.key].name && (["fr", "en", "es"] as const).some((l) => DEFAULT_TAXONOMY[l][c.key].name === c.name);
      expect(stale, `${c.key} : « ${c.name} » est un nom par défaut d'une autre langue que ${lang}`).toBe(false);
    }
  });
  it("chaque langue a les mêmes clés, et la taxonomie par défaut se valide", () => {
    const keys = Object.keys(DEFAULT_TAXONOMY.fr).sort();
    expect(Object.keys(DEFAULT_TAXONOMY.en).sort()).toEqual(keys);
    expect(Object.keys(DEFAULT_TAXONOMY.es).sort()).toEqual(keys);
    for (const l of ["fr", "en", "es"] as const) expect(parseTaxonomy(defaultTaxonomy(l)).categories.length).toBe(keys.length);
  });
});
