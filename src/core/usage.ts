/**
 * Suivi des tokens et du coût : chaque appel à un modèle (Jev, rédaction, extraction, chat Telegram)
 * laisse une ligne dans la table `usage`, avec son sujet, son modèle et son coût.
 * Le coût vient de la passerelle Vercel quand elle le renvoie ; sinon il est estimé au tarif du modèle
 * (liste des modèles mise en cache 24 h). Rien n'est enregistré pendant les tests.
 */
import { gateway } from "@ai-sdk/gateway";
import type { Settings } from "../config.js";
import { kvGet, kvSet, openDb, type Db } from "../db.js";
import { t } from "../i18n/index.js";
import { getSecret } from "../secrets.js";

/** Le sujet d'un appel : ce que l'app était en train de faire. */
export type Purpose = "classify" | "reclassify" | "test" | "draft" | "extract_event" | "extract_task" | "chat" | "doc_classify" | "doc_search" | "declutter";
export const PURPOSES: Purpose[] = ["classify", "reclassify", "test", "draft", "extract_event", "extract_task", "chat", "doc_classify", "doc_search", "declutter"];
/** Le libellé d'un sujet dans la langue de l'app. */
export const purposeLabel = (p: Purpose): string => (PURPOSES.includes(p) ? t(`purpose.${p}`) : p);

export interface UsageMeta { purpose?: Purpose; itemId?: number; accountId?: number }
export interface UsageRow { purpose: Purpose; model: string; inputTokens: number; outputTokens: number; cost: number | null; itemId?: number; accountId?: number; latencyMs?: number }

/** Tarif de repli quand la passerelle n'a pas encore été interrogée : USD par token. */
const FALLBACK_PRICING: Record<string, { input: number; output: number }> = { "typesafe-ai/jev": { input: 0.042e-6, output: 0 } };

export interface GatewayModel { id: string; name: string; pricing?: { input: string; output: string; cachedInputTokens?: string }; type?: string }
interface ModelsCache { fetchedAt: string; models: GatewayModel[]; error?: string }
const MODELS_KEY = "gateway.models";
const MODELS_TTL = 24 * 3600_000;

/** Liste des modèles de la passerelle (avec tarifs), en cache 24 h. `refresh` force l'appel. */
export async function gatewayModels(db: Db, refresh = false): Promise<ModelsCache> {
  const cached = kvGet<ModelsCache | null>(db, MODELS_KEY, null);
  if (!refresh && cached && Date.now() - new Date(cached.fetchedAt).getTime() < MODELS_TTL) return cached;
  if (!getSecret("AI_GATEWAY_API_KEY")) return { fetchedAt: new Date().toISOString(), models: cached?.models ?? [], error: t("cfg.missingKey") };
  try {
    const r = await gateway.getAvailableModels();
    const models = r.models.map((m) => ({ id: m.id, name: m.name, pricing: m.pricing ? { input: m.pricing.input, output: m.pricing.output, cachedInputTokens: m.pricing.cachedInputTokens } : undefined, type: (m as { modelType?: string }).modelType }));
    const next: ModelsCache = { fetchedAt: new Date().toISOString(), models };
    kvSet(db, MODELS_KEY, next);
    return next;
  } catch (e) {
    return { fetchedAt: cached?.fetchedAt ?? new Date().toISOString(), models: cached?.models ?? [], error: (e as Error).message };
  }
}

/** Tarif d'un modèle en USD par token, depuis le cache ou le repli. */
export function pricingFor(db: Db, model: string): { input: number; output: number } | null {
  const cached = kvGet<ModelsCache | null>(db, MODELS_KEY, null);
  const m = cached?.models.find((x) => x.id === model);
  if (m?.pricing) return { input: Number(m.pricing.input) || 0, output: Number(m.pricing.output) || 0 };
  return FALLBACK_PRICING[model] ?? null;
}
export function estimateCost(db: Db, model: string, inputTokens: number, outputTokens: number): number | null {
  const p = pricingFor(db, model);
  return p ? inputTokens * p.input + outputTokens * p.output : null;
}

/** Le coût réel renvoyé par la passerelle dans les métadonnées d'une réponse, s'il y est. */
export function costFromMeta(meta: unknown): number | null {
  const g = (meta as { gateway?: { cost?: unknown; totalCost?: unknown } } | undefined)?.gateway;
  const raw = g?.cost ?? g?.totalCost;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}
/** Somme des coûts d'une réponse en plusieurs étapes (outils) ; null si aucune étape ne le donne. */
export function costFromSteps(steps: Array<{ providerMetadata?: unknown }>): number | null {
  let sum = 0, found = false;
  for (const s of steps) { const c = costFromMeta(s.providerMetadata); if (c != null) { sum += c; found = true; } }
  return found ? sum : null;
}

/** Enregistre un appel. Best effort : une erreur ici n'arrête jamais le travail en cours. */
export function recordUsage(row: UsageRow): void {
  if (process.env.VITEST) return;
  try {
    const db = openDb();
    const cost = row.cost ?? estimateCost(db, row.model, row.inputTokens, row.outputTokens);
    db.prepare("INSERT INTO usage (purpose, model, input_tokens, output_tokens, cost, estimated, item_id, account_id, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      row.purpose, row.model, row.inputTokens || 0, row.outputTokens || 0, cost, row.cost == null ? 1 : 0, row.itemId ?? null, row.accountId ?? null, row.latencyMs ?? null,
    );
  } catch { /* le suivi ne doit jamais casser le classement */ }
}

/** Reprend l'historique déjà en base (tokens Jev par décision) une seule fois, pour ne pas partir de zéro. */
export function ensureSeeded(db: Db, settings: Settings): void {
  if (kvGet(db, "usage.seeded", false)) return;
  const p = pricingFor(db, settings.jevModel);
  const rows = db.prepare("SELECT d.item_id, d.input_tokens, d.decided_at, d.latency_ms, i.account_id FROM decisions d JOIN items i ON i.id = d.item_id WHERE d.input_tokens IS NOT NULL AND d.input_tokens > 0").all() as Array<{ item_id: number; input_tokens: number; decided_at: string; latency_ms: number | null; account_id: number }>;
  const ins = db.prepare("INSERT INTO usage (at, purpose, model, input_tokens, output_tokens, cost, estimated, item_id, account_id, latency_ms) VALUES (?, 'classify', ?, ?, 0, ?, 1, ?, ?, ?)");
  db.transaction(() => {
    for (const r of rows) ins.run(r.decided_at, settings.jevModel, r.input_tokens, p ? r.input_tokens * p.input : null, r.item_id, r.account_id, r.latency_ms);
    kvSet(db, "usage.seeded", true);
  })();
}

export interface UsageReport {
  days: number | null;
  totals: { calls: number; inputTokens: number; outputTokens: number; cost: number; estimated: number };
  byPurpose: Array<{ purpose: Purpose; label: string; calls: number; inputTokens: number; outputTokens: number; cost: number }>;
  byModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }>;
  byCategory: Array<{ category: string | null; calls: number; inputTokens: number; cost: number }>;
  bySource: Array<{ source: string; calls: number; inputTokens: number; outputTokens: number; cost: number }>;
  byDay: Array<{ day: string; calls: number; cost: number; tokens: number }>;
  recent: Array<{ id: number; at: string; purpose: Purpose; model: string; inputTokens: number; outputTokens: number; cost: number | null; estimated: number; itemId: number | null; subject: string | null; from: string | null; category: string | null }>;
  allTime: { calls: number; cost: number };
}

/** Le rapport d'usage sur `days` jours (null : tout). */
export function usageReport(db: Db, days: number | null): UsageReport {
  const where = days ? `WHERE at >= datetime('now', '-${Math.max(1, Math.floor(days))} days')` : "";
  const sum = "COUNT(*) calls, COALESCE(SUM(input_tokens),0) inputTokens, COALESCE(SUM(output_tokens),0) outputTokens, COALESCE(SUM(cost),0) cost";
  const totals = db.prepare(`SELECT ${sum}, COALESCE(SUM(estimated),0) estimated FROM usage ${where}`).get() as UsageReport["totals"];
  const byPurpose = (db.prepare(`SELECT purpose, ${sum} FROM usage ${where} GROUP BY purpose ORDER BY cost DESC, calls DESC`).all() as Array<Omit<UsageReport["byPurpose"][number], "label">>)
    .map((r) => ({ ...r, label: purposeLabel(r.purpose) }));
  const byModel = db.prepare(`SELECT model, ${sum} FROM usage ${where} GROUP BY model ORDER BY cost DESC, calls DESC`).all() as UsageReport["byModel"];
  const byCategory = db.prepare(`SELECT d.category, COUNT(*) calls, COALESCE(SUM(u.input_tokens),0) inputTokens, COALESCE(SUM(u.cost),0) cost FROM usage u LEFT JOIN decisions d ON d.item_id = u.item_id ${where ? where + " AND" : "WHERE"} u.purpose IN ('classify','reclassify') GROUP BY d.category ORDER BY cost DESC, calls DESC`).all() as UsageReport["byCategory"];
  const bySource = db.prepare(`SELECT CASE WHEN u.purpose = 'chat' THEN 'telegram' ELSE COALESCE(a.source, 'gmail') END source, ${sum} FROM usage u LEFT JOIN accounts a ON a.id = u.account_id ${where} GROUP BY source ORDER BY cost DESC`).all() as UsageReport["bySource"];
  const monthly = days === null || days > 92;
  const byDay = db.prepare(`SELECT ${monthly ? "substr(at, 1, 7)" : "substr(at, 1, 10)"} day, COUNT(*) calls, COALESCE(SUM(cost),0) cost, COALESCE(SUM(input_tokens + output_tokens),0) tokens FROM usage ${where} GROUP BY day ORDER BY day`).all() as UsageReport["byDay"];
  const recent = db.prepare(`SELECT u.id, u.at, u.purpose, u.model, u.input_tokens inputTokens, u.output_tokens outputTokens, u.cost, u.estimated, u.item_id itemId, i.subject, COALESCE(i.from_name, i.from_address) "from", d.category FROM usage u LEFT JOIN items i ON i.id = u.item_id LEFT JOIN decisions d ON d.item_id = u.item_id ${where} ORDER BY u.id DESC LIMIT 25`).all() as UsageReport["recent"];
  const allTime = db.prepare("SELECT COUNT(*) calls, COALESCE(SUM(cost),0) cost FROM usage").get() as UsageReport["allTime"];
  return { days, totals, byPurpose, byModel, byCategory, bySource, byDay, recent, allTime };
}

/** Solde de la passerelle, si la clé le permet. */
export async function gatewayCredits(): Promise<{ balance: number; totalUsed: number } | null> {
  if (!getSecret("AI_GATEWAY_API_KEY")) return null;
  try { const c = await gateway.getCredits(); return { balance: Number(c.balance), totalUsed: Number(c.totalUsed) }; } catch { return null; }
}
