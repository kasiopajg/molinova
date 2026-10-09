import { gateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate, type Experimental_EvaluationModel as EvaluationModel, type Experimental_EvaluationQuestion as Question } from "ai";
import { requireGatewayKey, type Settings } from "../config.js";
import type { Questions } from "./questions.js";
import { costFromMeta, recordUsage, type UsageMeta } from "./usage.js";
import { wellFormedDeep } from "./text.js";

export interface JevOutcome<Q extends Record<string, Question> = Questions> {
  answers: Awaited<ReturnType<typeof evaluate<Q>>>["answers"];
  /** Concentration de la distribution par question, 0 (indécis) à 1 (sûr). */
  confidence: Record<string, number>;
  inputTokens: number;
  latencyMs: number;
}

let cachedModel: EvaluationModel | undefined;
export function jevModel(settings: Settings, override?: EvaluationModel): EvaluationModel {
  if (override) return override;
  if (!cachedModel) {
    requireGatewayKey();
    cachedModel = gateway.evaluationModel(settings.jevModel);
  }
  return cachedModel;
}

/** Un seul appel, toutes les questions. Les questions des emails par défaut ; celles des documents (doc-questions.ts) aussi. */
export async function askJev<Q extends Record<string, Question> = Questions>(state: unknown, questions: Q, settings: Settings, model?: EvaluationModel, usage: UsageMeta = {}): Promise<JevOutcome<Q>> {
  const t0 = Date.now();
  const result = await evaluate<Q>({
    model: jevModel(settings, model),
    // Un texte mal formé (moitié d'emoji) fait refuser toute la requête : on le répare avant l'envoi.
    state: wellFormedDeep(state) as Parameters<typeof evaluate>[0]["state"],
    questions,
    // La passerelle a parfois un raté passager : on insiste un peu avant d'abandonner l'email.
    maxRetries: 4,
    providerOptions: settings.zeroDataRetention ? { gateway: { zeroDataRetention: true } } : undefined,
  });
  const meta = result.providerMetadata?.typesafe as { confidence?: Record<string, number> } | undefined;
  const latencyMs = Date.now() - t0;
  const inputTokens = result.usage.inputTokens ?? 0;
  recordUsage({ purpose: usage.purpose ?? "classify", model: settings.jevModel, inputTokens, outputTokens: result.usage.outputTokens ?? 0, cost: costFromMeta(result.providerMetadata), itemId: usage.itemId, accountId: usage.accountId, latencyMs });
  return {
    answers: result.answers,
    confidence: meta?.confidence ?? deriveConfidence(result.answers),
    inputTokens,
    latencyMs,
  };
}

/** Si le fournisseur n'expose pas de confiance, on la déduit de l'écart entre les deux meilleures probabilités. */
function deriveConfidence(answers: Record<string, { type: string; probability?: number; probabilities?: Record<string, number> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, a] of Object.entries(answers)) {
    if (a.type === "boolean" && a.probability !== undefined) out[k] = Math.abs(a.probability - 0.5) * 2;
    else if (a.probabilities) {
      const sorted = Object.values(a.probabilities).sort((x, y) => y - x);
      out[k] = sorted.length > 1 ? sorted[0] - sorted[1] : (sorted[0] ?? 0);
    } else out[k] = 0;
  }
  return out;
}
