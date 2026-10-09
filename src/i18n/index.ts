/**
 * Langue de l'app : une seule, globale, lue dans settings.json (`language`).
 * `loadSettings()` la pose à chaque lecture ; tout ce qui parle à l'utilisateur (Telegram, erreurs, brouillons,
 * agenda) passe par `t()`. Le français est le dictionnaire de référence : une clé absente en anglais ou en espagnol
 * est une erreur de compilation (voir en.ts / es.ts).
 */
import { fr } from "./fr.js";
import { en } from "./en.js";
import { es } from "./es.js";

export const LANGUAGES = ["fr", "en", "es"] as const;
export type Language = (typeof LANGUAGES)[number];
export type Key = keyof typeof fr;
/** Les clés qui ont une forme plurielle : « x.one » et « x.other ». */
type PluralOf<K> = K extends `${infer P}.other` ? P : never;
export type PluralKey = PluralOf<Key>;
export type Params = Record<string, string | number>;

const DICTS: Record<Language, Record<Key, string>> = { fr, en, es };
const LOCALES: Record<Language, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };
/** Anglais tant que settings.json n'a rien dit : c'est la langue d'une nouvelle installation. */
let current: Language = "en";

/** `x` si c'est une clé du dictionnaire (le `code` d'une erreur levée par fail()), sinon undefined (ENOENT, code HTTP…). */
export const keyOf = (x: unknown): Key | undefined => (typeof x === "string" && Object.hasOwn(fr, x) ? (x as Key) : undefined);
export const isLanguage = (x: unknown): x is Language => typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
export function setLanguage(l: Language): void { current = l; }
export function currentLanguage(): Language { return current; }
export function locale(lang: Language = current): string { return LOCALES[lang]; }

const interpolate = (s: string, params?: Params): string => (params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s);

/** Le texte d'une clé dans la langue courante (ou `lang`), avec `{param}` remplacés. Retombe sur le français. */
export function t(key: Key, params?: Params, lang: Language = current): string {
  const s = DICTS[lang][key] ?? fr[key] ?? key;
  return interpolate(s, params);
}
/** Forme plurielle selon `n` (Intl.PluralRules) : « {n} tâche » / « {n} tâches ». `n` est disponible comme `{n}`. */
export function tn(key: PluralKey, n: number, params?: Params, lang: Language = current): string {
  const form = new Intl.PluralRules(locale(lang)).select(n);
  const k = `${key}.${form}` as Key, fallback = `${key}.other` as Key;
  return t(DICTS[lang][k] !== undefined ? k : fallback, { n, ...params }, lang);
}
/** Le nom d'une langue, écrit dans une autre : languageName("en", "fr") = « anglais ». Sert aux consignes des modèles. */
export function languageName(lang: Language, inLang: Language = current): string {
  return t(`lang.${lang}` as Key, undefined, inLang);
}

// ---------- dates, via Intl : plus de tableaux de jours ni de mois en dur
export interface DateOpts { lang?: Language; timeZone?: string }
const dtf = (o: DateOpts | undefined, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(o?.lang ?? current), { ...opts, ...(o?.timeZone ? { timeZone: o.timeZone } : {}) });
const asDate = (d: string | Date): Date => {
  if (d instanceof Date) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
};
/** « jeudi 24 sept. » / « Thursday 24 Sept » / « jueves, 24 sept ». */
export function fmtDayLong(d: string | Date, o?: DateOpts): string { return dtf(o, { weekday: "long", day: "numeric", month: "short" }).format(asDate(d)); }
/** « 24 sept. » / « 24 Sept » / « 24 sept ». Accepte AAAA-MM-JJ (ou un ISO complet) tel quel. */
export function fmtDayShort(d: string | Date, o?: DateOpts): string {
  if (typeof d === "string" && !/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  return dtf(o, { day: "numeric", month: "short" }).format(asDate(d));
}
/** « lundi 28 » / « Monday 28 » / « lunes 28 ». */
export function fmtWeekdayDay(d: string | Date, o?: DateOpts): string { return dtf(o, { weekday: "long", day: "numeric" }).format(asDate(d)); }
/** Le nom du jour : une date, ou un numéro 1 = lundi … 7 = dimanche. */
export function fmtWeekday(d: string | Date | number, o?: DateOpts): string {
  const date = typeof d === "number" ? new Date(2024, 0, d) /* 2024-01-01 est un lundi */ : asDate(d);
  return dtf(o, { weekday: "long" }).format(date);
}
export const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
