import type { Experimental_EvaluationModel as EvaluationModel } from "ai";
import type { Context, Rule, Settings, Taxonomy } from "../config.js";
import type { Item } from "../connectors/types.js";
import { recallSender, type Db, type Decision } from "../db.js";
import { askJev, type JevOutcome } from "./jev.js";
import type { UsageMeta } from "./usage.js";
import { buildQuestions, buildState, type Examples, type Questions } from "./questions.js";
import { matchRule } from "./rules.js";
import { childrenOf, findCategory, labelName, ordered } from "./taxonomy.js";

export interface Classifier {
  taxonomy: Taxonomy;
  settings: Settings;
  rules: Rule[];
  ctx: Context;
  questions: Questions;
  db: Db;
  /** Pour les tests : un modèle simulé à la place de Jev. */
  model?: EvaluationModel;
}

export function makeClassifier(parts: Omit<Classifier, "questions">): Classifier {
  return { ...parts, questions: buildQuestions(parts.taxonomy, parts.ctx, recentCorrections(parts.db, parts.settings.examplesPerCategory)) };
}

/** Les dernières corrections de l'utilisateur, par catégorie, sous forme d'exemples courts. */
export function recentCorrections(db: Db, perCategory: number): Examples {
  if (perCategory === 0) return {};
  const rows = db
    .prepare(
      `SELECT c.to_category cat, i.from_name, i.from_address, i.subject FROM corrections c JOIN items i ON i.id = c.item_id
       ORDER BY c.made_at DESC LIMIT ?`,
    )
    .all(perCategory * 12) as Array<{ cat: string; from_name: string; from_address: string; subject: string }>;
  const out: Examples = {};
  for (const r of rows) {
    const list = (out[r.cat] ??= []);
    if (list.length < perCategory) list.push(`De : ${r.from_name || r.from_address} · Objet : ${r.subject.slice(0, 80)}`);
  }
  return out;
}

export type Outcome = Omit<Decision, "itemId"> & { jev?: JevOutcome };

/**
 * La cascade : règles → mémoire expéditeur → Jev → « à revoir ».
 * Chaque niveau s'arrête dès qu'il est sûr de lui.
 */
export async function classify(c: Classifier, item: Item, opts: { ignoreMemory?: boolean; /** Pour le suivi des coûts : sujet et élément concernés. */ usage?: UsageMeta } = {}): Promise<Outcome> {
  const noFlags = { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false, task: false, awaitReply: false };

  // Une règle ou la mémoire fixent la catégorie. Jev reste consulté pour les signaux
  // (important, réponse attendue, paiement, spam), sauf si la règle dit « stop ».
  const rule = matchRule(item, c.rules);
  // Une règle « quiet » ne consulte pas Jev non plus : ces emails ne passent jamais par la file.
  if (rule?.stop || rule?.quiet) return { decidedBy: "rule", ruleId: rule.id, category: rule.category, confidence: 1, needsReview: false, flags: { ...noFlags, quiet: rule.quiet } };
  const recalled = rule || opts.ignoreMemory ? undefined : recallSender(c.db, item.accountId, item.fromAddress, c.settings.senderMemoryMinCount);
  // Une catégorie mémorisée qui n'existe plus (taxonomie modifiée à la main) ne compte pas : Jev décide.
  const remembered = recalled && c.taxonomy.categories.some((x) => x.key === recalled) ? recalled : undefined;
  const fixed = rule?.category ?? remembered;

  const jev = await askJev(buildState(item, c.ctx), c.questions, c.settings, c.model, { accountId: item.accountId, ...opts.usage });
  const a = jev.answers;
  const t = c.settings.thresholds;
  const catConf = fixed ? 1 : (jev.confidence.category ?? 0);
  let category = fixed ?? (a.category.type === "choice" ? a.category.choice : null);
  // Une sous-catégorie liée à un enfant (Famille · Activités / Léo) : la réponse « enfant concerné » suffit à descendre d'un cran.
  category = routeByChild(c, category, a, t.categoryConfidence);
  const validCategory = category !== null && c.taxonomy.categories.some((x) => x.key === category);
  // Un email envoyé par soi-même n'est jamais « à revoir » ni du travail : il reçoit le meilleur libellé de Jev pour le rangement, et c'est tout.
  const needsReview = !item.isOutgoing && (!validCategory || catConf < t.categoryConfidence);

  // Un envoi de ma part n'attend rien de moi (réponse, paiement, alerte), mais une date ou une chose à faire que j'annonce compte.
  const out = item.isOutgoing;
  const chat = item.source === "whatsapp";
  const flags = {
    reply: false,
    toPay: !out && a.to_pay.type === "boolean" && a.to_pay.probability >= t.toPay,
    spam: !out && a.spam.type === "boolean" && a.spam.probability >= t.spam,
    urgent: !out && a.priority.type === "score" && a.priority.score >= t.urgentScore,
    important: false,
    event: a.event.type === "boolean" && a.event.probability >= (chat ? t.eventChat : t.event),
    task: a.task?.type === "boolean" && a.task.probability >= (chat ? t.taskChat : t.task),
    // Un envoi de ma part qui attend un retour : le suivi des fils le mettra dans « Relancer » si le silence dure.
    awaitReply: out && !chat && a.awaits_reply?.type === "boolean" && a.awaits_reply.probability >= t.replyExpected,
  };
  if (!out) flags.reply = a.reply_expected.type === "boolean" && a.reply_expected.probability >= t.replyExpected;
  // Important = problème signalé, ou urgence élevée, quelle que soit la catégorie.
  flags.important = !out && ((a.attention.type === "boolean" && a.attention.probability >= t.attention) || flags.urgent);
  // Code à usage unique ou alerte de connexion : rien à répondre ni à faire ; le nettoyage le sort de la file après 30 min.
  const eph = a.ephemeral as { type?: string; choice?: string; probabilities?: Record<string, number> } | undefined;
  const ephemeral = !out && !chat && eph?.type === "choice" && (eph.choice === "code" || eph.choice === "signin") && (eph.probabilities?.[eph.choice] ?? 1) >= t.ephemeral ? eph.choice : null;
  if (ephemeral) { flags.reply = false; flags.task = false; }

  return {
    decidedBy: rule ? "rule" : remembered ? "memory" : "jev",
    ruleId: rule?.id,
    category: validCategory ? category : null,
    confidence: catConf,
    answers: a,
    needsReview,
    flags: { ...flags, ...(ephemeral ? { ephemeral } : {}) },
    latencyMs: jev.latencyMs,
    inputTokens: jev.inputTokens,
    jev,
  };
}

/**
 * Si la catégorie retenue a des sous-catégories liées aux enfants et que Jev a désigné un enfant
 * avec assez d'assurance, on retient la sous-catégorie de cet enfant.
 */
export function routeByChild(c: Classifier, category: string | null, answers: Record<string, unknown> | undefined, minConfidence: number): string | null {
  if (!category || !answers) return category;
  const child = answers.child as { type?: string; choice?: string; probabilities?: Record<string, number> } | undefined;
  if (!child || child.type !== "choice" || !child.choice || child.choice === "none") return category;
  const p = child.probabilities?.[child.choice] ?? 1;
  if (p < minConfidence) return category;
  const sub = childrenOf(c.taxonomy, category).find((k) => k.child === child.choice);
  return sub ? sub.key : category;
}

/** Les libellés Gmail à poser pour une décision. */
export function labelsFor(c: Classifier, o: Outcome): string[] {
  const p = c.taxonomy.prefix;
  const s = c.settings.specialLabels;
  const out: string[] = [];
  const cat = findCategory(c.taxonomy, o.category);
  if (cat) out.push(labelName(c.taxonomy, cat));
  if (o.needsReview) out.push(`${p}/${s.review}`);
  if (o.flags.reply) out.push(`${p}/${s.reply}`);
  if (o.flags.toPay) out.push(`${p}/${s.toPay}`);
  if (o.flags.spam) out.push(`${p}/${s.suspect}`);
  if (o.flags.important) out.push(`${p}/${s.important}`);
  return out;
}

/** Tous les libellés que l'agent peut poser, avec leurs couleurs, pour les créer d'un coup. */
export function allLabels(c: Classifier): Array<{ name: string; color?: { background: string; text: string } }> {
  const p = c.taxonomy.prefix;
  const s = c.settings.specialLabels;
  // Parents d'abord : Gmail veut que « AI/Maison » existe avant « AI/Maison/Jardinage ».
  return [
    ...ordered(c.taxonomy).map((cat) => ({ name: labelName(c.taxonomy, cat), color: cat.color })),
    { name: `${p}/${s.review}`, color: { background: "#fad165", text: "#594c05" } },
    { name: `${p}/${s.reply}`, color: { background: "#fb4c2f", text: "#ffffff" } },
    { name: `${p}/${s.toPay}`, color: { background: "#ffad47", text: "#7a2e0b" } },
    { name: `${p}/${s.suspect}`, color: { background: "#cc3a21", text: "#ffffff" } },
    { name: `${p}/${s.important}`, color: { background: "#1c4587", text: "#ffffff" } },
  ];
}
