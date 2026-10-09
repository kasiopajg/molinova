/**
 * Changer la langue de l'app : ce que ça renomme dans Gmail, calculé avant d'écrire quoi que ce soit.
 * Une catégorie est renommée si son nom est encore celui par défaut de l'ancienne langue ; un nom personnalisé
 * reste tel quel. Même règle pour les libellés spéciaux (« À revoir », « À payer »…), qui sont aussi des libellés Gmail.
 * Logique pure, testée ; l'écriture (settings, taxonomie, renommage Gmail) est dans server.ts (applyLanguage).
 */
import type { Settings, Taxonomy } from "../config.js";
import type { Language } from "../i18n/index.js";
import { DEFAULT_SPECIAL_LABELS, DEFAULT_TAXONOMY } from "../i18n/taxonomy-defaults.js";
import { diff, labelName } from "./taxonomy.js";

export interface LanguagePlan {
  from: Language;
  to: Language;
  /** La taxonomie candidate : noms (et critères restés par défaut) dans la nouvelle langue. */
  taxonomy: Taxonomy;
  /** Les renommages Gmail de catégories, parents d'abord (« AI/Maison » avant « AI/Maison/Jardinage »). */
  categories: Array<{ key: string; from: string; to: string; label: { from: string; to: string } }>;
  specialLabels: Settings["specialLabels"];
  specials: Array<{ id: keyof Settings["specialLabels"]; from: string; to: string; label: { from: string; to: string } }>;
  /** Ce qui n'est pas renommé : nom personnalisé, ou collision avec un nom déjà pris. */
  skipped: Array<{ key: string; name: string; reason: "custom" | "collision" }>;
}

const norm = (s: string): string => s.normalize("NFC").trim();

export function planLanguageChange(from: Language, to: Language, taxonomy: Taxonomy, special: Settings["specialLabels"]): LanguagePlan {
  const was = DEFAULT_TAXONOMY[from], will = DEFAULT_TAXONOMY[to];
  const skipped: LanguagePlan["skipped"] = [];
  const taken = new Set(taxonomy.categories.map((c) => norm(c.name)));
  const categories = taxonomy.categories.map((c) => {
    const d = was[c.key], n = will[c.key];
    if (!d || !n || from === to) return c;
    if (norm(c.name) !== norm(d.name)) { skipped.push({ key: c.key, name: c.name, reason: "custom" }); return c; }
    if (norm(n.name) !== norm(c.name) && taken.has(norm(n.name))) { skipped.push({ key: c.key, name: c.name, reason: "collision" }); return c; }
    // Les critères ne suivent que s'ils sont encore ceux par défaut : les tiens sont à toi.
    return { ...c, name: n.name, criteria: norm(c.criteria) === norm(d.criteria) ? n.criteria : c.criteria };
  });
  const next: Taxonomy = { ...taxonomy, categories };
  const byKey = new Map(next.categories.map((c) => [c.key, c]));
  const renames = diff(taxonomy, next)
    .filter((ch) => ch.kind === "moved" && ch.from && ch.to)
    .sort((a, b) => a.to!.split("/").length - b.to!.split("/").length)
    .map((ch) => ({ key: ch.key, from: taxonomy.categories.find((c) => c.key === ch.key)!.name, to: byKey.get(ch.key)!.name, label: { from: ch.from!, to: ch.to! } }));

  const specialsNext: Settings["specialLabels"] = { ...special };
  const specials: LanguagePlan["specials"] = [];
  for (const id of Object.keys(special) as Array<keyof Settings["specialLabels"]>) {
    const cur = special[id], d = DEFAULT_SPECIAL_LABELS[from][id], n = DEFAULT_SPECIAL_LABELS[to][id];
    if (from === to || norm(cur) !== norm(d) || norm(n) === norm(cur)) continue;
    specialsNext[id] = n;
    specials.push({ id, from: cur, to: n, label: { from: `${taxonomy.prefix}/${cur}`, to: `${taxonomy.prefix}/${n}` } });
  }
  void labelName;
  return { from, to, taxonomy: next, categories: renames, specialLabels: specialsNext, specials, skipped };
}
