/**
 * La taxonomie à deux niveaux : catégories et sous-catégories.
 * Ici tout ce qui dérive de la structure : chemin lisible, nom du libellé Gmail, ordre d'affichage.
 */
import type { Category, Taxonomy } from "../config.js";

export function parentOf(t: Taxonomy, c: Category): Category | undefined {
  return c.parent ? t.categories.find((x) => x.key === c.parent) : undefined;
}
export function childrenOf(t: Taxonomy, key: string): Category[] {
  return t.categories.filter((x) => x.parent === key);
}
export function findCategory(t: Taxonomy, key: string | null | undefined): Category | undefined {
  return key ? t.categories.find((x) => x.key === key) : undefined;
}
/** « Maison › Jardinage » : ce que voient Jev et l'interface. */
export function pathName(t: Taxonomy, c: Category): string {
  const p = parentOf(t, c);
  return p ? `${p.name} › ${c.name}` : c.name;
}
/** « AI/Maison/Jardinage » : le libellé posé dans Gmail. Gmail imbrique sur le « / ». */
export function labelName(t: Taxonomy, c: Category): string {
  const p = parentOf(t, c);
  return p ? `${t.prefix}/${p.name}/${c.name}` : `${t.prefix}/${c.name}`;
}
export function labelNameFor(t: Taxonomy, key: string | null | undefined): string | undefined {
  const c = findCategory(t, key);
  return c ? labelName(t, c) : undefined;
}
/** Les catégories dans l'ordre d'affichage : chaque parent suivi de ses sous-catégories. */
export function ordered(t: Taxonomy): Category[] {
  const out: Category[] = [];
  for (const c of t.categories) {
    if (c.parent) continue;
    out.push(c, ...childrenOf(t, c.key));
  }
  // Une sous-catégorie orpheline (parent retiré) reste visible plutôt que perdue.
  for (const c of t.categories) if (!out.includes(c)) out.push(c);
  return out;
}
/** Remet le fichier dans l'ordre d'affichage : parents puis enfants. */
export function normalize(t: Taxonomy): Taxonomy {
  return { ...t, categories: ordered(t) };
}

export interface TaxonomyChange {
  key: string;
  name: string;
  kind: "added" | "removed" | "moved" | "gained";
  /** moved : ancien et nouveau libellé Gmail. */
  from?: string;
  to?: string;
  /** gained : les sous-catégories nouvelles sous ce parent. */
  children?: string[];
}
/**
 * Ce qui change entre deux taxonomies, du point de vue des emails déjà classés :
 * – added : nouvelle catégorie, rien à reclasser ;
 * – removed : ses emails n'ont plus de catégorie valable ;
 * – moved : son libellé Gmail change de nom (déplacement ou renommage), les emails suivent ;
 * – gained : un parent reçoit de nouvelles sous-catégories, ses emails pourraient descendre d'un cran.
 */
export function diff(before: Taxonomy, after: Taxonomy): TaxonomyChange[] {
  const out: TaxonomyChange[] = [];
  const was = new Map(before.categories.map((c) => [c.key, c]));
  const now = new Map(after.categories.map((c) => [c.key, c]));
  for (const c of after.categories) {
    const b = was.get(c.key);
    if (!b) { out.push({ key: c.key, name: c.name, kind: "added" }); continue; }
    const from = labelName(before, b), to = labelName(after, c);
    if (from !== to) out.push({ key: c.key, name: c.name, kind: "moved", from, to });
  }
  for (const b of before.categories) if (!now.has(b.key)) out.push({ key: b.key, name: b.name, kind: "removed", from: labelName(before, b) });
  for (const c of after.categories) {
    if (c.parent) continue;
    const beforeKids = new Set(childrenOf(before, c.key).map((k) => k.key));
    const gained = childrenOf(after, c.key).filter((k) => !beforeKids.has(k.key));
    if (gained.length) out.push({ key: c.key, name: c.name, kind: "gained", children: gained.map((k) => k.name) });
  }
  return out;
}
