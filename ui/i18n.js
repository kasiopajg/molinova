/* Langue de l'interface. Chargé avant tout le reste : les dictionnaires (ui/lang/<langue>/*.js, servis concaténés
   par /lang/<langue>.js) posent window.EA_DICT.<langue> ; le serveur injecte window.EA_LANG dans index.html,
   donc la langue est connue avant le premier rendu, sans flash de français. Le français est la référence :
   une clé absente dans une autre langue retombe dessus. */
const LOCALE = { fr: "fr-FR", en: "en-GB", es: "es-ES" };
const I18N = {
  lang: "en",
  locale: "en-GB",
  missing: new Set(),
  set(lang) {
    this.lang = LOCALE[lang] ? lang : "en";
    this.locale = LOCALE[this.lang];
    document.documentElement.lang = this.lang;
    try { localStorage.setItem("ea.lang", this.lang); } catch {}
  },
  dict(lang) { return (window.EA_DICT && window.EA_DICT[lang]) || {}; },
};
(() => {
  let lang = window.EA_LANG;
  if (!lang) { try { lang = localStorage.getItem("ea.lang"); } catch {} }
  // Sans indication du serveur ni choix mémorisé : anglais, la langue d'une nouvelle installation.
  I18N.set(lang || "en");
})();

/** Le texte d'une clé, avec {param} remplacés. Manquante dans la langue : français ; manquante partout : la clé. */
function t(key, params) {
  let s = I18N.dict(I18N.lang)[key];
  if (s === undefined) {
    s = I18N.dict("fr")[key];
    if (!I18N.missing.has(key) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) { I18N.missing.add(key); console.warn(`[i18n] ${s === undefined ? "clé inconnue" : "manque en " + I18N.lang} : ${key}`); }
    if (s === undefined) return key;
  }
  if (typeof s === "object") s = s.other ?? "";
  return params ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : String(s);
}
/** Pluriel : la valeur est { one, other } sous une clé, ou deux clés à plat « x.one » / « x.other » ; n est disponible comme {n}. */
function tn(key, n, params) {
  const forms = (lang) => {
    const d = I18N.dict(lang);
    if (d[key] !== undefined) return typeof d[key] === "object" ? d[key] : { other: d[key] };
    if (d[key + ".other"] !== undefined) return { zero: d[key + ".zero"], one: d[key + ".one"], two: d[key + ".two"], few: d[key + ".few"], many: d[key + ".many"], other: d[key + ".other"] };
    return null;
  };
  const f = forms(I18N.lang) ?? forms("fr") ?? { other: key };
  const form = new Intl.PluralRules(I18N.locale).select(Number(n) || 0);
  const s = f[form] ?? f.other ?? key;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k === "n" ? fmtNum(n) : params && k in params ? params[k] : m));
}
/** La valeur brute (tableau ou objet) : jours, mois, cartes de libellés. */
function tl(key) { return I18N.dict(I18N.lang)[key] ?? I18N.dict("fr")[key]; }

// ---------- nombres, dates, unités : toujours dans la locale de la langue
function fmtNum(n, opts) { return Number(n ?? 0).toLocaleString(I18N.locale, opts); }
function fmtPct(x, digits = 0) { return x == null ? "—" : new Intl.NumberFormat(I18N.locale, { style: "percent", maximumFractionDigits: digits }).format(x); }
/** Un montant en dollars US, au format de la langue (« 1,25 $ » / « $1.25 »). */
function fmtUsd(x, digits) {
  if (x == null) return "—";
  const d = digits ?? (x < 0.01 ? 4 : x < 1 ? 3 : 2);
  return new Intl.NumberFormat(I18N.locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
}
/** Mégaoctets, kilo-tokens… avec le symbole de la langue (« Mo » / « MB »). */
function fmtUnit(x, unit, opts) { return new Intl.NumberFormat(I18N.locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1, ...opts }).format(x); }
function fmtTok(n) { return n == null ? "—" : n >= 1e6 ? `${fmtNum(n / 1e6, { maximumFractionDigits: 2 })} M` : n >= 1e4 ? `${fmtNum(n / 1e3, { maximumFractionDigits: 1 })} k` : fmtNum(n); }
function fmtDate(d, opts) { return new Date(d).toLocaleDateString(I18N.locale, opts); }
function fmtTime(d, opts) { return new Date(d).toLocaleTimeString(I18N.locale, { hour: "2-digit", minute: "2-digit", ...opts }); }
function fmtDateTime(d, opts) { return new Date(d).toLocaleString(I18N.locale, opts); }
/** « il y a 3 min » / « 3 min ago ». Accepte l'ISO ou le « AAAA-MM-JJ HH:MM:SS » de SQLite (en UTC). */
function ago(iso) {
  if (!iso) return t("time.never");
  const s = String(iso);
  const d = new Date(s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s) || !s.includes(" ") ? s : s.replace(" ", "T") + "Z");
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return t("time.now");
  if (m < 60) return t("time.min", { n: m });
  const hh = Math.round(m / 60);
  return hh < 36 ? t("time.h", { n: hh }) : t("time.d", { n: Math.round(hh / 24) });
}
/** « dans 3 min » / « in 3 min » : l'heure d'un prochain passage (ISO ou millisecondes). */
function until(when) {
  if (!when) return "—";
  const m = Math.round((new Date(when).getTime() - Date.now()) / 60000);
  if (m <= 0) return t("time.in.now");
  if (m < 60) return t("time.in.min", { n: m });
  return t("time.in.h", { n: Math.round(m / 60) });
}
/** Les libellés du format de date (« JJ/MM/AAAA » / « DD/MM/YYYY ») pour les champs texte de l'app. */
function dateFmtLabels() { return { eu: { date: t("dt.eu"), time: t("dt.time") }, us: { date: t("dt.us"), time: t("dt.time") }, iso: { date: t("dt.iso"), time: t("dt.time") } }; }
