import { describe, expect, it } from "vitest";
import { parseTaxonomy, loadContext, loadRules, loadSettings, type Taxonomy } from "../config.js";
import { routeByChild, makeClassifier } from "./classify.js";
import { buildQuestions } from "./questions.js";
import { diff, labelName, ordered, pathName } from "./taxonomy.js";
import Database from "better-sqlite3";
import { setLanguage } from "../i18n/index.js";
import { DEFAULT_SPECIAL_LABELS } from "../i18n/taxonomy-defaults.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");
/** Les réglages du fichier, mais en français : les libellés attendus par ces tests sont « AI/À répondre », « AI/À revoir ». */
const frSettings = () => { const s = { ...loadSettings(), language: "fr" as const, specialLabels: { ...DEFAULT_SPECIAL_LABELS.fr } }; setLanguage("fr"); return s; };

const color = { background: "#fef1d1", text: "#7a2e0b" };
const flat = (): Taxonomy => parseTaxonomy({ prefix: "AI", categories: [
  { key: "maison", name: "Maison", criteria: "La maison.", color },
  { key: "famille_activites", name: "Famille · Activités", criteria: "Clubs et cours.", color },
  { key: "loisirs", name: "Loisirs", criteria: "Bateau.", color },
] });
const nested = (): Taxonomy => parseTaxonomy({ prefix: "AI", categories: [
  { key: "maison", name: "Maison", criteria: "La maison.", color },
  { key: "maison_jardinage", name: "Jardinage", criteria: "Jardinier, piscine.", color, parent: "maison" },
  { key: "famille_activites", name: "Famille · Activités", criteria: "Clubs et cours.", color },
  { key: "famille_activites_leo", name: "Léo", criteria: "Basket.", color, parent: "famille_activites", child: "leo" },
  { key: "loisirs", name: "Loisirs", criteria: "Bateau.", color, parent: "famille_activites" },
] });

describe("taxonomie à deux niveaux", () => {
  it("nomme le chemin et le libellé Gmail imbriqué", () => {
    const t = nested();
    const j = t.categories[1];
    expect(pathName(t, j)).toBe("Maison › Jardinage");
    expect(labelName(t, j)).toBe("AI/Maison/Jardinage");
    expect(labelName(t, t.categories[0])).toBe("AI/Maison");
  });
  it("ordonne chaque parent suivi de ses sous-catégories", () => {
    const t = nested();
    expect(ordered(t).map((c) => c.key)).toEqual(["maison", "maison_jardinage", "famille_activites", "famille_activites_leo", "loisirs"]);
  });
  it("refuse trois niveaux et un parent inconnu", () => {
    expect(() => parseTaxonomy({ categories: [{ key: "a", name: "A", criteria: "x", color }, { key: "b", name: "B", criteria: "x", color, parent: "a" }, { key: "c", name: "C", criteria: "x", color, parent: "b" }] })).toThrow(/deux niveaux/);
    expect(() => parseTaxonomy({ categories: [{ key: "a", name: "A", criteria: "x", color }, { key: "b", name: "B", criteria: "x", color, parent: "zz" }] })).toThrow(/parent inconnu/);
  });
  it("décrit ce qui change pour les emails déjà classés", () => {
    const d = diff(flat(), nested());
    expect(d).toContainEqual({ key: "maison_jardinage", name: "Jardinage", kind: "added" });
    expect(d).toContainEqual({ key: "loisirs", name: "Loisirs", kind: "moved", from: "AI/Loisirs", to: "AI/Famille · Activités/Loisirs" });
    expect(d).toContainEqual({ key: "maison", name: "Maison", kind: "gained", children: ["Jardinage"] });
    expect(d).toContainEqual({ key: "famille_activites", name: "Famille · Activités", kind: "gained", children: ["Léo", "Loisirs"] });
    const back = diff(nested(), flat());
    expect(back).toContainEqual({ key: "maison_jardinage", name: "Jardinage", kind: "removed", from: "AI/Maison/Jardinage" });
    expect(back).toContainEqual({ key: "loisirs", name: "Loisirs", kind: "moved", from: "AI/Famille · Activités/Loisirs", to: "AI/Loisirs" });
  });
  it("envoie à Jev le chemin de la sous-catégorie et le cadre du parent", () => {
    const q = buildQuestions(nested(), loadContext());
    expect(q.category.criteria.maison_jardinage).toMatch(/^Maison › Jardinage\. Jardinier, piscine\. \(Sous-catégorie de « Maison »/);
    expect(q.category.criteria.maison).toMatch(/préfère une de ses sous-catégories .*Jardinage/);
  });
  it("descend vers la sous-catégorie de l'enfant désigné par Jev", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE corrections (id INTEGER PRIMARY KEY, item_id INTEGER, from_category TEXT, to_category TEXT, made_at TEXT); CREATE TABLE items (id INTEGER PRIMARY KEY, from_name TEXT, from_address TEXT, subject TEXT);");
    const c = makeClassifier({ taxonomy: nested(), settings: frSettings(), rules: loadRules(), ctx: loadContext(), db });
    const sure = { child: { type: "choice", choice: "leo", probabilities: { leo: 0.9, none: 0.1 } } };
    expect(routeByChild(c, "famille_activites", sure, 0.7)).toBe("famille_activites_leo");
    expect(routeByChild(c, "maison", sure, 0.7)).toBe("maison");
    expect(routeByChild(c, "famille_activites", { child: { type: "choice", choice: "leo", probabilities: { leo: 0.5, none: 0.5 } } }, 0.7)).toBe("famille_activites");
    expect(routeByChild(c, "famille_activites", { child: { type: "choice", choice: "none", probabilities: { leo: 0.1, none: 0.9 } } }, 0.7)).toBe("famille_activites");
  });
});
