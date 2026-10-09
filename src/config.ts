import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import { currentLanguage, isLanguage, LANGUAGES, setLanguage, t } from "./i18n/index.js";
import { DEFAULT_SPECIAL_LABELS, defaultTaxonomy } from "./i18n/taxonomy-defaults.js";
import { getSecret } from "./secrets.js";

/** Le code et l'interface (ui/, config/*.example*.json) : en lecture seule dans l'app (voir docs/desktop-app.md). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Tout ce que l'app écrit : MOLINOVA_HOME dans l'app (Application Support), le dépôt lui-même en mode dev. */
export const HOME = process.env.MOLINOVA_HOME ? path.resolve(process.env.MOLINOVA_HOME) : ROOT;
/** Lancé par l'app macOS (Electron) : secrets dans le trousseau, messages au processus principal. */
export const APP_MODE = process.env.MOLINOVA_APP === "1";
// Ne remplace jamais une variable déjà posée (celles que l'app passe au lancement, ou le shell).
dotenv.config({ path: path.join(HOME, ".env.local"), quiet: true });

const DATA = path.join(HOME, "data");
export const PATHS = {
  config: path.join(HOME, "config"),
  examples: path.join(ROOT, "config"),
  data: DATA,
  credentials: path.join(HOME, "credentials"),
  tokens: path.join(HOME, "tokens"),
  logs: path.join(HOME, "logs"),
  db: path.join(DATA, "molinova.sqlite"),
};

for (const dir of [PATHS.config, PATHS.data, PATHS.logs]) fs.mkdirSync(dir, { recursive: true });
// Jetons OAuth et client Google : lisibles par l'utilisateur seul (mode resserré aussi sur un dossier existant).
for (const dir of [PATHS.credentials, PATHS.tokens]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* dossier d'un autre propriétaire : on garde son mode */ }
}

/**
 * Pages publiques de Molinova (GitHub Pages, publiées depuis site/) : les trois liens et le domaine que Google exige
 * dans Branding avant de publier l'application de chaque utilisateur. Une seule source pour l'assistant et les README.
 */
export const MOLINOVA_PAGES = {
  home: "https://kasiopajg.github.io/molinova/",
  privacy: "https://kasiopajg.github.io/molinova/privacy.html",
  terms: "https://kasiopajg.github.io/molinova/terms.html",
  domain: "kasiopajg.github.io",
} as const;

type ParentPort = { postMessage(message: unknown): void };
/** Message au processus principal de l'app (Electron, utilityProcess) ; false hors de l'app. */
export function postToMain(message: { type: string } & Record<string, unknown>): boolean {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (!APP_MODE || !port) return false;
  port.postMessage(message);
  return true;
}
/** Le fuseau du système : fuseau par défaut du propriétaire tant que context.json n'en dit rien. */
export function systemTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

const Category = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  criteria: z.string().min(1),
  color: z.object({ background: z.string(), text: z.string() }),
  /** false : bruit ; n'entre dans la file d'actions que si Jev le signale important. */
  attention: z.boolean().default(true),
  /** Clé de la catégorie parente : « Maison / Jardinage ». Deux niveaux au plus. */
  parent: z.string().optional(),
  /** Sous-catégorie liée à un enfant du contexte (slug du prénom) : la réponse « enfant concerné » de Jev suffit à la choisir. */
  child: z.string().optional(),
});
const Taxonomy = z.object({ prefix: z.string().default("AI"), categories: z.array(Category).min(2) }).superRefine((tax, ctx) => {
  const keys = new Set<string>();
  for (const c of tax.categories) {
    if (keys.has(c.key)) ctx.addIssue({ code: "custom", message: t("cfg.dupKey", { key: c.key }) });
    keys.add(c.key);
  }
  for (const c of tax.categories) {
    if (!c.parent) continue;
    const p = tax.categories.find((x) => x.key === c.parent);
    if (!p) ctx.addIssue({ code: "custom", message: t("cfg.unknownParent", { name: c.name, parent: c.parent }) });
    else if (p.parent) ctx.addIssue({ code: "custom", message: t("cfg.twoLevels", { name: c.name, parent: p.name }) });
    else if (p.key === c.key) ctx.addIssue({ code: "custom", message: t("cfg.selfParent", { name: c.name }) });
  }
});
export type Taxonomy = z.infer<typeof Taxonomy>;
export type Category = z.infer<typeof Category>;

const Settings = z.object({
  jevModel: z.string().default("typesafe-ai/jev"),
  zeroDataRetention: z.boolean().default(true),
  thresholds: z.object({
    categoryConfidence: z.number().default(0.7),
    replyExpected: z.number().default(0.8),
    spam: z.number().default(0.9),
    toPay: z.number().default(0.85),
    attention: z.number().default(0.8),
    event: z.number().default(0.8),
    /** « Quelque chose à faire » (apporter, signer, confirmer…) : verbe Tâche dans Actions. */
    task: z.number().default(0.8),
    /** Mêmes signaux sur une conversation WhatsApp : messages courts, moins de structure, la barre est plus basse. */
    eventChat: z.number().default(0.65),
    taskChat: z.number().default(0.65),
    urgentScore: z.number().default(2.5),
    /** Code à usage unique ou alerte de connexion (question `ephemeral`) : Actions seulement dans les 30 minutes. */
    ephemeral: z.number().default(0.7),
    /** Importance « haute » et « normale » : seuils sur le score de priorité Jev (0 à 3). */
    highScore: z.number().default(1.5),
    normalScore: z.number().default(0.5),
  }).prefault({}),
  concurrency: z.number().int().positive().default(16),
  bodyExcerptChars: z.number().int().positive().default(1500),
  /** Libellés Gmail spéciaux. Absents : ceux par défaut de la langue (voir parseSettings). */
  specialLabels: z.object({ review: z.string(), reply: z.string(), toPay: z.string(), suspect: z.string(), important: z.string().default("Important") }).optional(),
  senderMemoryMinCount: z.number().int().positive().default(3),
  examplesPerCategory: z.number().int().nonnegative().default(8),
  /** Modèle texte pour les brouillons (via AI Gateway, ZDR). */
  writerModel: z.string().default("openai/gpt-5.4-mini"),
  /** Modèle du coordinateur Telegram : lit la base, appelle des outils, écrit des messages courts. Petit et rapide, ZDR. */
  chatModel: z.string().default("google/gemini-3.1-flash-lite"),
  /** Nombre d'emails envoyés lus pour apprendre le style. */
  styleSamples: z.number().int().nonnegative().default(15),
  /** Jours sans réponse après ton dernier message avant de proposer une relance. */
  followUpDays: z.number().int().positive().default(5),
  /**
   * Nettoyage : les emails reçus avant ce jour (AAAA-MM-JJ, jour du Mac) sont ignorés dans Actions et les rappels.
   * Rien n'est changé dans Gmail ni dans les décisions ; effacer la date les fait revenir.
   */
  ignoreBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Format des dates saisies et affichées : eu = JJ/MM/AAAA 24 h, iso = AAAA-MM-JJ, us = MM/JJ/AAAA. */
  dateFormat: z.enum(["eu", "iso", "us"]).default("eu"),
  /** Langue de l'app : interface, Telegram, brouillons, erreurs. Les noms de catégories par défaut la suivent aussi. Anglais pour une nouvelle installation. */
  language: z.enum(LANGUAGES).default("en"),
});
export type Settings = Omit<z.infer<typeof Settings>, "specialLabels"> & { specialLabels: NonNullable<z.infer<typeof Settings>["specialLabels"]> };

const Rule = z.object({
  id: z.string(),
  when: z.object({
    fromDomain: z.string().optional(),
    fromAddress: z.string().optional(),
    subjectContains: z.array(z.string()).optional(),
    hasListUnsubscribe: z.boolean().optional(),
  }),
  category: z.string(),
  origin: z.enum(["user", "learned", "system"]).default("user"),
  /** true : on ne consulte pas Jev du tout (aucun signal important/réponse/paiement). */
  stop: z.boolean().default(false),
  /** true : ces emails n'entrent jamais dans la file Actions (implique stop). */
  quiet: z.boolean().default(false),
});
export type Rule = z.infer<typeof Rule>;
const Rules = z.object({ rules: z.array(Rule) });

const Context = z.object({
  owner: z.object({ name: z.string(), emails: z.array(z.string()), languages: z.array(z.string()).default([]), timezone: z.string().default(systemTimeZone) }),
  family: z
    .object({
      children: z.array(z.object({ name: z.string(), school: z.string().optional(), activities: z.array(z.string()).default([]) })).default([]),
      schoolDomains: z.array(z.string()).default([]),
      activityDomains: z.array(z.string()).default([]),
    })
    .default({ children: [], schoolDomains: [], activityDomains: [] }),
  keyPeople: z.array(z.object({ name: z.string(), relation: z.string(), emails: z.array(z.string()).default([]), effect: z.string().optional() })).default([]),
  projects: z.array(z.string()).default([]),
  instructions: z.string().default(""),
});
export type Context = z.infer<typeof Context>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
/** Le fichier s'il existe ; sinon undefined : une nouvelle installation n'a encore aucun fichier de config. */
function readJsonIfExists(file: string): unknown | undefined {
  return fs.existsSync(file) ? readJson(file) : undefined;
}

/** taxonomy.json, ou la taxonomie par défaut dans la langue de l'app (écrite aussitôt) pour une nouvelle installation. */
export function loadTaxonomy(): Taxonomy {
  const raw = readJsonIfExists(path.join(PATHS.config, "taxonomy.json"));
  if (raw !== undefined) return Taxonomy.parse(raw);
  const t0 = Taxonomy.parse(defaultTaxonomy(currentLanguage()));
  saveTaxonomy(t0);
  return t0;
}
export function parseTaxonomy(raw: unknown): Taxonomy {
  return Taxonomy.parse(raw);
}
export function saveTaxonomy(t: Taxonomy): void {
  fs.writeFileSync(path.join(PATHS.config, "taxonomy.json"), JSON.stringify(t, null, 2) + "\n");
}
/** Valide des réglages bruts ; sans fichier (undefined), ce sont les défauts : anglais, seuils standard, libellés spéciaux de la langue. */
export function parseSettings(raw: unknown): Settings {
  const s = Settings.parse(raw ?? {});
  return { ...s, specialLabels: s.specialLabels ?? { ...DEFAULT_SPECIAL_LABELS[s.language] } };
}
/** Lit settings.json et pose la langue courante : tout ce qui parle à l'utilisateur la suit dès la prochaine phrase. */
export function loadSettings(): Settings {
  const s = parseSettings(readJsonIfExists(path.join(PATHS.config, "settings.json")));
  setLanguage(s.language);
  return s;
}
export function saveSettings(s: Settings): void {
  fs.writeFileSync(path.join(PATHS.config, "settings.json"), JSON.stringify(s, null, 2) + "\n");
  setLanguage(s.language);
}
/** Valide un contenu de rules.json ({ rules: [...] }) sans l'écrire. */
export function parseRules(raw: unknown): Rule[] {
  return Rules.parse(raw).rules;
}
/** Valide un contenu de context.json sans l'écrire. */
export function parseContext(raw: unknown): Context {
  return Context.parse(raw);
}
export function loadRules(): Rule[] {
  return Rules.parse(readJsonIfExists(path.join(PATHS.config, "rules.json")) ?? { rules: [] }).rules;
}
export function saveRules(rules: Rule[]): void {
  fs.writeFileSync(path.join(PATHS.config, "rules.json"), JSON.stringify({ rules }, null, 2) + "\n");
}
/** context.json est privé (gitignoré) ; on retombe sur l'exemple de la langue courante s'il n'existe pas encore. */
export function loadContext(): Context {
  const real = path.join(PATHS.config, "context.json");
  // Les exemples restent à côté du code (ROOT/config), en lecture seule dans l'app.
  const example = path.join(PATHS.examples, `context.example.${currentLanguage()}.json`);
  if (fs.existsSync(real)) return Context.parse(readJson(real));
  const ctx = Context.parse(readJson(fs.existsSync(example) ? example : path.join(PATHS.examples, "context.example.json")));
  // Un exemple ne connaît pas le fuseau de ce Mac : celui du système fait foi.
  return { ...ctx, owner: { ...ctx.owner, timezone: systemTimeZone() } };
}
export { isLanguage };

export function requireGatewayKey(): string {
  const key = getSecret("AI_GATEWAY_API_KEY");
  if (!key) throw new Error(t("cfg.missingKey"));
  return key;
}

// ---------- réglages de l'app macOS (HOME/config/app.json), lus aussi par le processus principal
const AppSettings = z.object({
  /** Ouvrir Molinova à l'ouverture de session. */
  openAtLogin: z.boolean().default(true),
  /** Empêcher la mise en veille de l'app, sur secteur seulement. */
  preventSleep: z.boolean().default(true),
  /** Fermer la fenêtre garde l'app dans la barre des menus. */
  closeToTray: z.boolean().default(true),
});
export type AppSettings = z.infer<typeof AppSettings>;
const appSettingsFile = () => path.join(PATHS.config, "app.json");
/** Valide des réglages d'app (défauts pour les absents) ; lève une ZodError sur un type faux. */
export function parseAppSettings(raw: unknown): AppSettings {
  return AppSettings.parse(raw ?? {});
}
/** app.json, ou les défauts : un fichier illisible ne bloque pas l'app. */
export function loadAppSettings(): AppSettings {
  try { return parseAppSettings(readJsonIfExists(appSettingsFile())); } catch { return parseAppSettings({}); }
}
/** Fusionne un changement partiel avec les réglages en cours, valide, écrit. */
export function saveAppSettings(patch: Record<string, unknown>): AppSettings {
  const next = parseAppSettings({ ...loadAppSettings(), ...patch });
  fs.writeFileSync(appSettingsFile(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

// ---------- premier lancement (l'assistant)
/**
 * Version des conditions d'utilisation (site/terms.html) que l'utilisateur accepte au premier écran de l'assistant.
 * La changer quand les conditions changent sur le fond : chacun les réaccepte une fois au lancement suivant.
 */
export const TERMS_VERSION = "2026-10-09";
export interface SetupInputs { appMode: boolean; terms: boolean; gateway: boolean; google: boolean; account: boolean; context: boolean; finished: boolean }
export interface SetupState { complete: boolean; appMode: boolean; steps: Omit<SetupInputs, "appMode"> }
/**
 * Où en est l'installation. Rien n'est complet sans les conditions acceptées (dans leur version en cours) : une
 * installation existante repasse une fois par le premier écran pour les accepter. Ensuite, une installation existante
 * (clé, client Google, un compte, un profil context.json) est complète même sans « terminer » : elle ne repasse jamais
 * par l'assistant. Sans profil, c'est une installation neuve au milieu de l'assistant : recharger la page après la
 * connexion de Gmail ne doit pas sauter les dernières étapes.
 */
export function setupState(i: SetupInputs): SetupState {
  const steps = { terms: i.terms, gateway: i.gateway, google: i.google, account: i.account, context: i.context, finished: i.finished };
  const complete = i.terms && (i.finished || (i.gateway && i.google && i.account && i.context));
  return { complete, appMode: i.appMode, steps };
}
