import type { Settings } from "../config.js";
import type { Db } from "../db.js";
import { pricingFor } from "./usage.js";

/**
 * Ce qu'un lancement en masse coûtera en IA, avant de le lancer : rattrapage ou aperçu Gmail, historique d'une
 * conversation WhatsApp, reclassement, et plus tard le classement d'un Drive. Règle de Molinova : jamais d'appel en masse
 * sans ce chiffre sous les yeux.
 *
 * Le calcul part de ce que Molinova a vraiment dépensé sur cette source (90 derniers jours) : coût moyen d'un appel à
 * Jev, part des éléments qui passent par Jev (les règles et la mémoire des expéditeurs s'en passent), part des
 * éléments qui déclenchent une extraction (événement, tâche). Sans assez d'historique, des valeurs prudentes :
 * chaque élément compte pour un appel à Jev.
 */

export type EstimateSource = "gmail" | "whatsapp" | "drive";
interface CallCost { inputTokens: number; outputTokens: number; cost: number | null }
export interface AiRate {
  basis: "measured" | "default";
  /** Éléments classés sur la période mesurée (0 sans historique). */
  sample: number;
  jevModel: string;
  /** Part des éléments qui passent par Jev, et part qui déclenche une extraction par le modèle texte. */
  jevShare: number;
  extractShare: number;
  jev: CallCost;
  extract: CallCost;
}
export interface Estimate {
  n: number;
  inputTokens: number;
  outputTokens: number;
  /** Coût probable (part réelle de Jev) et coût maximal (chaque élément passe par Jev) ; null si un tarif manque. */
  cost: number | null;
  maxCost: number | null;
  /** Le tarif du modèle d'extraction est inconnu : le coût ne compte que Jev (l'extraction touche une petite part). */
  partial: boolean;
}

const MIN_SAMPLE = 30;
/** Mesuré sur une vraie boîte en octobre 2026 : un appel à Jev ≈ 3 000 tokens lus, 160 écrits ; une extraction ≈ 850 et 130. */
const DEFAULT_JEV = { inputTokens: 3000, outputTokens: 160 };
const DEFAULT_EXTRACT = { inputTokens: 850, outputTokens: 130 };
/** Une fiche de document, mesurée le 3 oct. 2026 sur 25 papiers : ≈ 2 600 tokens lus, ≈ 490 écrits (une question par membre du foyer). */
const DEFAULT_DOC = { inputTokens: 2600, outputTokens: 500 };
const DEFAULT_EXTRACT_SHARE = 0.05;

const priced = (db: Db, model: string, t: { inputTokens: number; outputTokens: number }): number | null => {
  const p = pricingFor(db, model);
  return p ? t.inputTokens * p.input + t.outputTokens * p.output : null;
};

export function aiRate(db: Db, settings: Pick<Settings, "jevModel" | "writerModel">, source: EstimateSource): AiRate {
  if (source === "drive") return driveRate(db, settings);
  const since = "datetime('now', '-90 days')";
  const ofSource = "u.item_id IN (SELECT i.id FROM items i JOIN accounts a ON a.id = i.account_id WHERE a.source = ?)";
  const items = (db.prepare(`SELECT COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id JOIN accounts a ON a.id = i.account_id WHERE a.source = ? AND d.decided_at >= ${since}`).get(source) as { n: number }).n;
  const avg = (purposes: string[], model: string) => db.prepare(`SELECT COUNT(*) n, AVG(u.input_tokens) i, AVG(u.output_tokens) o, AVG(u.cost) c, SUM(u.cost IS NULL) nulls
    FROM usage u WHERE u.purpose IN (${purposes.map(() => "?").join(",")}) AND u.model = ? AND u.at >= ${since} AND ${ofSource}`).get(...purposes, model, source) as { n: number; i: number | null; o: number | null; c: number | null; nulls: number };
  const jevRow = avg(["classify", "reclassify"], settings.jevModel);
  const exRow = avg(["extract_event", "extract_task"], settings.writerModel);
  const measured = items >= MIN_SAMPLE && jevRow.n > 0;
  const call = (row: typeof jevRow, model: string, fallback: { inputTokens: number; outputTokens: number }): CallCost => {
    if (measured && row.n > 0) {
      const t = { inputTokens: Math.round(row.i ?? 0), outputTokens: Math.round(row.o ?? 0) };
      // Coût réel moyen quand chaque ligne en a un ; sinon le tarif du modèle sur les tokens moyens.
      return { ...t, cost: row.nulls === 0 && row.c != null ? row.c : priced(db, model, t) };
    }
    return { ...fallback, cost: priced(db, model, fallback) };
  };
  return {
    basis: measured ? "measured" : "default",
    sample: measured ? items : 0,
    jevModel: settings.jevModel,
    jevShare: measured ? Math.min(1, jevRow.n / items) : 1,
    extractShare: measured ? Math.min(1, exRow.n / items) : DEFAULT_EXTRACT_SHARE,
    jev: call(jevRow, settings.jevModel, DEFAULT_JEV),
    extract: call(exRow, settings.writerModel, DEFAULT_EXTRACT),
  };
}

/**
 * Drive : un document = un appel à Jev pour sa fiche (le texte est lu sur le Mac, sans modèle). Mesuré sur les fiches
 * déjà faites (purpose doc_classify), sinon DEFAULT_DOC : un début de texte de 6 000 caractères et les questions.
 */
function driveRate(db: Db, settings: Pick<Settings, "jevModel" | "writerModel">): AiRate {
  const row = db.prepare(`SELECT COUNT(*) n, AVG(input_tokens) i, AVG(output_tokens) o, AVG(cost) c, SUM(cost IS NULL) nulls FROM usage
    WHERE purpose = 'doc_classify' AND model = ? AND at >= datetime('now', '-90 days')`).get(settings.jevModel) as { n: number; i: number | null; o: number | null; c: number | null; nulls: number };
  const measured = row.n >= MIN_SAMPLE;
  const t = measured ? { inputTokens: Math.round(row.i ?? 0), outputTokens: Math.round(row.o ?? 0) } : DEFAULT_DOC;
  const cost = measured && row.nulls === 0 && row.c != null ? row.c : priced(db, settings.jevModel, t);
  return { basis: measured ? "measured" : "default", sample: measured ? row.n : 0, jevModel: settings.jevModel, jevShare: 1, extractShare: 0, jev: { ...t, cost }, extract: { inputTokens: 0, outputTokens: 0, cost: 0 } };
}

/** Le coût de `n` éléments à ce taux. `allJev` : chaque élément passe par Jev (reclassement). */
export function estimateFor(rate: AiRate, n: number, opts: { allJev?: boolean } = {}): Estimate {
  const share = opts.allJev ? 1 : rate.jevShare;
  const tokens = (k: "inputTokens" | "outputTokens") => Math.round(n * (share * rate.jev[k] + rate.extractShare * rate.extract[k]));
  const money = (s: number) => (rate.jev.cost == null ? null : n * (s * rate.jev.cost + rate.extractShare * (rate.extract.cost ?? 0)));
  return { n, inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens"), cost: money(share), maxCost: money(1), partial: rate.jev.cost != null && rate.extract.cost == null };
}
