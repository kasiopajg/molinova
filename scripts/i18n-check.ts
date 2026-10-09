/**
 * Contrôle des dictionnaires de l'interface (ui/lang/<langue>/*.js) et des appels t()/tn()/tl() dans ui/*.js.
 *   pnpm i18n            → erreurs et avertissements
 *   pnpm i18n --strict   → les avertissements (clé inutilisée, résidu français) deviennent des erreurs
 * Erreurs : clé du français absente en en/es, clé en trop, {params} ou formes plurielles différentes, clé appelée
 * dans le code mais absente du français, clé définie deux fois dans une langue. Avertissements : clé jamais
 * appelée, littéral français dans ui/*.js hors dictionnaires.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "ui");
const LANGS = ["fr", "en", "es"] as const;
type Dict = Record<string, unknown>;
const strict = process.argv.includes("--strict");
const errors: string[] = [];
const warnings: string[] = [];

/** Charge ui/lang/<langue>/*.js dans un bac à sable, en repérant les clés définies deux fois. */
function loadDict(lang: string): Dict {
  const dir = path.join(UI, "lang", lang);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort() : [];
  const seen = new Map<string, string>();
  const dict: Dict = {};
  for (const f of files) {
    const part: Dict = {};
    const win = { EA_DICT: {} as Record<string, Dict> };
    const ctx = vm.createContext({ window: win, EA_DICT: win.EA_DICT, Object });
    // Chaque fichier fait EA_DICT.<lang> = Object.assign(EA_DICT.<lang> || {}, {...}) : on lui donne un objet vide à remplir.
    (ctx as { EA_DICT: Record<string, Dict> }).EA_DICT[lang] = part;
    try { vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f }); }
    catch (e) { errors.push(`${lang}/${f} : ${(e as Error).message}`); continue; }
    const filled = (ctx as { EA_DICT: Record<string, Dict> }).EA_DICT[lang] ?? part;
    for (const [k, v] of Object.entries(filled)) {
      if (seen.has(k)) errors.push(`${lang} : clé « ${k} » définie dans ${seen.get(k)} et ${f}`);
      seen.set(k, f);
      dict[k] = v;
    }
  }
  if (!files.length) errors.push(`${lang} : aucun dictionnaire dans ui/lang/${lang}/`);
  return dict;
}

const params = (v: unknown): string => {
  const texts = typeof v === "string" ? [v] : Array.isArray(v) ? v.map(String) : v && typeof v === "object" ? Object.values(v as Dict).map(String) : [];
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(",");
};
const shape = (v: unknown): string => (typeof v === "string" ? "string" : Array.isArray(v) ? `array:${v.length}` : v && typeof v === "object" ? `plural:${Object.keys(v as Dict).sort().join("|")}` : typeof v);

const dicts = Object.fromEntries(LANGS.map((l) => [l, loadDict(l)])) as Record<(typeof LANGS)[number], Dict>;
const frKeys = Object.keys(dicts.fr);
for (const lang of ["en", "es"] as const) {
  for (const k of frKeys) {
    if (!(k in dicts[lang])) { errors.push(`${lang} : manque « ${k} »`); continue; }
    const a = dicts.fr[k], b = dicts[lang][k];
    if (typeof b === "string" && !b.trim() && (dicts.fr[k] as string).trim()) errors.push(`${lang} : « ${k} » est vide`);
    if (params(a) !== params(b)) errors.push(`${lang} : « ${k} » n'a pas les mêmes {params} ({${params(a)}} vs {${params(b)}})`);
    const sa = shape(a), sb = shape(b);
    // Les formes plurielles peuvent différer par langue (one/other suffisent en fr/en/es), mais le type doit être le même.
    if (sa.split(":")[0] !== sb.split(":")[0] || (sa.startsWith("array") && sa !== sb)) errors.push(`${lang} : « ${k} » n'a pas la même forme (${sa} vs ${sb})`);
  }
  for (const k of Object.keys(dicts[lang])) if (!(k in dicts.fr)) errors.push(`${lang} : « ${k} » n'existe pas en français`);
}
for (const [k, v] of Object.entries(dicts.fr)) if (v && typeof v === "object" && !Array.isArray(v) && !("other" in (v as Dict))) errors.push(`fr : « ${k} » est un pluriel sans forme « other »`);

// ---------- les appels dans le code
// i18n.js appelle lui-même quelques clés (time.*) : il compte pour l'usage, pas pour les résidus français.
const codeFiles = fs.readdirSync(UI).filter((f) => f.endsWith(".js")).map((f) => path.join(UI, f));
const used = new Set<string>();
const prefixes = new Set<string>();
for (const f of codeFiles) {
  const src = fs.readFileSync(f, "utf8");
  // Un préfixe dynamique (t("x." + k), t(`x.${k}`)) n'est pas une clé : il est traité juste en dessous.
  for (const m of src.matchAll(/\bt[nl]?\(\s*(["'`])([^"'`]+)\1/g)) if (!m[2].endsWith(".") && !m[2].includes("${")) used.add(m[2]);
  // t("prefix." + x) ou t(`prefix.${x}`) : préfixe dynamique, on accepte toute clé qui commence ainsi.
  for (const m of src.matchAll(/\bt[nl]?\(\s*"([\w.-]+\.)"\s*\+/g)) prefixes.add(m[1]);
  for (const m of src.matchAll(/\bt[nl]?\(\s*`([\w.-]+\.)\$\{/g)) prefixes.add(m[1]);
}
for (const k of used) if (!(k in dicts.fr) && !(`${k}.other` in dicts.fr)) errors.push(`code : t("${k}") sans clé française`);
for (const k of frKeys) {
  const base = k.replace(/\.(one|other|zero|two|few|many)$/, "");
  if (!used.has(k) && !used.has(base) && ![...prefixes].some((p) => k.startsWith(p))) warnings.push(`fr : « ${k} » n'est jamais appelée`);
}

// ---------- résidus français dans le code (hors dictionnaires et commentaires)
const WHITELIST = /RESET|Français|English|Español|Gmail|WhatsApp|Telegram|Jev|Vercel|Google|BotFather|Mac|fr-FR|en-GB|es-ES|à\.|Ctrl|Shift|Outfit|IBM Plex/;
const FRENCH = /[àâéèêëîïôûùüçœÀÉÈÊÇŒ]|\b(le|la|les|des|une|pour|dans|avec|sur|aucun|aucune|tout|toute|tous|encore|déjà|rien|jamais|depuis|ici|clique|glisse|choisis|enregistrer|fermer|ouvrir|retirer|ajouter|semaine|jours?|mois|libellés?|boîte|règles?|réglages|compte|comptes|tâches?)\b/;
for (const f of codeFiles.filter((x) => !x.endsWith("i18n.js"))) {
  const lines = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    // Les littéraux : "…", '…' et les morceaux de gabarit hors ${…}.
    const literals = [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, " "));
    for (const lit of literals) {
      const text = lit.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
      if (FRENCH.test(text) && !WHITELIST.test(text) && /[A-Za-zÀ-ÿ]{3,}/.test(text)) { warnings.push(`${path.basename(f)}:${i + 1} : « ${text.trim().slice(0, 70)} »`); break; }
    }
  });
}

const n = (k: string) => Object.keys(dicts[k as "fr"]).length;
console.log(`Dictionnaires : fr ${n("fr")} clés · en ${n("en")} · es ${n("es")} · ${used.size} clés appelées dans ui/*.js`);
for (const w of warnings) console.log(`  avertissement · ${w}`);
for (const e of errors) console.log(`  ERREUR · ${e}`);
console.log(`${errors.length} erreur(s), ${warnings.length} avertissement(s)`);
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
