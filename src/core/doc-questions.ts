/**
 * Les questions posées à Jev pour la fiche d'un document, en un seul appel : Type, Contexte, personnes concernées,
 * validité, sensibilité, action, importance, et l'échéance et le tiers choisis parmi ce que le code a trouvé dans le texte.
 * Le code décide ensuite, avec des seuils, comme pour les emails (questions.ts).
 */
import fs from "node:fs";
import path from "node:path";
import type { Experimental_EvaluationQuestion as Question } from "ai";
import { PATHS, type Context } from "../config.js";
import type { Db } from "../db.js";
import { currentLanguage, t } from "../i18n/index.js";
import { defaultDocTaxonomy, type DocTaxonomy } from "../i18n/doc-taxonomy-defaults.js";
import type { Member } from "./agenda.js";
import type { DateCandidate } from "./doc-facts.js";
import type { Examples } from "./questions.js";

export type { DocTaxonomy };

/** La taxonomie documents : config/doc-taxonomy.json si l'utilisateur l'a écrite, sinon celle de la langue de l'app. */
export function loadDocTaxonomy(): DocTaxonomy {
  const file = path.join(PATHS.config, "doc-taxonomy.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DocTaxonomy>;
    if (Array.isArray(raw.types) && raw.types.length >= 2 && Array.isArray(raw.contexts) && raw.contexts.length >= 2) return raw as DocTaxonomy;
  } catch { /* absent ou illisible : les valeurs par défaut */ }
  return defaultDocTaxonomy(currentLanguage());
}
export const typeName = (tax: DocTaxonomy, key: string | null | undefined): string => tax.types.find((x) => x.key === key)?.name ?? "";
/** « Maison › Assurance maison » pour un sous-contexte, le nom seul sinon. */
export function contextName(tax: DocTaxonomy, key: string | null | undefined): string {
  const c = tax.contexts.find((x) => x.key === key);
  if (!c) return "";
  const parent = c.parent ? tax.contexts.find((x) => x.key === c.parent) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Les corrections de l'utilisateur sur les fiches deviennent des exemples, par valeur : « Fichier : x · Dossier : y ». */
export function docExamples(db: Db, facet: "type" | "context", perValue = 6): Examples {
  const rows = db.prepare(`SELECT c.after v, d.name, COALESCE(d.path, '') path FROM doc_corrections c JOIN docs d ON d.account_id = c.account_id AND d.file_id = c.file_id
    WHERE c.facet = ? AND c.after IS NOT NULL ORDER BY c.id DESC LIMIT ?`).all(facet, perValue * 20) as Array<{ v: string; name: string; path: string }>;
  const out: Examples = {};
  for (const r of rows) { const l = (out[r.v] ??= []); if (l.length < perValue) l.push(`${r.name}${r.path ? ` · ${r.path}` : ""}`); }
  return out;
}

export interface DocCandidates { dates: DateCandidate[]; parties: string[] }

export function buildDocQuestions(tax: DocTaxonomy, ctx: Context, members: Member[], cand: DocCandidates, examples: { type?: Examples; context?: Examples } = {}, today = new Date()) {
  const owner = ctx.owner.name;
  const withEx = (crit: string, ex?: string[]) => (ex?.length ? crit + t("jev.examples", { owner, examples: ex.map((e) => `« ${e} »`).join(" ; ") }) : crit);
  const typeCrit: Record<string, string> = {};
  for (const x of tax.types) typeCrit[x.key] = withEx(`${x.name}. ${x.criteria}`, examples.type?.[x.key]);
  const ctxCrit: Record<string, string> = {};
  for (const x of tax.contexts) {
    const parent = x.parent ? tax.contexts.find((p) => p.key === x.parent) : undefined;
    const kids = tax.contexts.filter((k) => k.parent === x.key);
    let crit = parent ? t("jevdoc.child", { path: `${parent.name} › ${x.name}`, criteria: x.criteria }) : `${x.name}. ${x.criteria}`;
    if (kids.length) crit += t("jevdoc.parent", { children: kids.map((k) => k.name).join(", ") });
    ctxCrit[x.key] = withEx(crit, examples.context?.[x.key]);
  }
  const questions: Record<string, Question> = {
    type: { type: "choice", instructions: t("jevdoc.type", { owner }), criteria: typeCrit },
    context: { type: "choice", instructions: t("jevdoc.context", { owner }), criteria: ctxCrit },
    valid: { type: "boolean", instructions: t("jevdoc.valid", { today: today.toISOString().slice(0, 10) }), criteria: { true: t("jevdoc.valid.true"), false: t("jevdoc.valid.false") } },
    sensitive: { type: "boolean", instructions: t("jevdoc.sensitive"), criteria: { true: t("jevdoc.sensitive.true"), false: t("jevdoc.sensitive.false") } },
    action: { type: "boolean", instructions: t("jevdoc.action", { owner }), criteria: { true: t("jevdoc.action.true"), false: t("jevdoc.action.false") } },
    importance: { type: "score", instructions: t("jevdoc.importance", { owner }), criteria: [t("jevdoc.importance.0"), t("jevdoc.importance.1"), t("jevdoc.importance.2"), t("jevdoc.importance.3")] },
  };
  // Une question par membre du foyer : « concerne Léo ? ». Le foyer entier n'est pas une personne.
  const people = members.filter((m) => m.kind !== "family");
  people.forEach((m, i) => {
    const name = m.key === "me" ? owner : m.name;
    questions[`person_${i}`] = { type: "boolean", instructions: t("jevdoc.person", { name }), criteria: { true: t("jevdoc.person.true", { name }), false: t("jevdoc.person.false") } };
  });
  if (cand.dates.length) {
    const crit: Record<string, string> = { none: t("jevdoc.expiry.none") };
    cand.dates.forEach((d, i) => (crit[`d${i}`] = `${d.date} (« ${d.snippet} »)`));
    questions.expiry = { type: "choice", instructions: t("jevdoc.expiry"), criteria: crit };
  }
  if (cand.parties.length) {
    const crit: Record<string, string> = { none: t("jevdoc.party.none") };
    cand.parties.forEach((p, i) => (crit[`p${i}`] = p));
    questions.party = { type: "choice", instructions: t("jevdoc.party"), criteria: crit };
  }
  return { questions, people };
}

type Answer = { type: string; choice?: string; probabilities?: Record<string, number>; probability?: number; score?: number };

export interface CardFacets {
  type: string | null; typeP: number | null;
  context: string | null; context2: string | null; contextP: number | null;
  people: string[]; valid: number | null; sensitive: number; action: number; importance: number | null;
  expiry: string | null; party: string | null;
}
/** Les réponses de Jev deviennent une fiche, avec des seuils : une personne à 0,5, un second contexte au-dessus de 0,3. */
export function decideCard(answers: Record<string, Answer>, people: Member[], cand: DocCandidates): CardFacets {
  const choice = (a?: Answer) => (a?.choice ? { key: a.choice, p: a.probabilities?.[a.choice] ?? null } : { key: null, p: null });
  const prob = (a?: Answer) => a?.probability ?? null;
  const type = choice(answers.type), ctx = choice(answers.context);
  const second = Object.entries(answers.context?.probabilities ?? {}).filter(([k]) => k !== ctx.key).sort((a, b) => b[1] - a[1])[0];
  const valid = prob(answers.valid);
  const ex = choice(answers.expiry), pa = choice(answers.party);
  return {
    type: type.key, typeP: type.p,
    context: ctx.key, context2: second && second[1] > 0.3 ? second[0] : null, contextP: ctx.p,
    people: people.filter((_, i) => (prob(answers[`person_${i}`]) ?? 0) >= 0.5).map((m) => m.key),
    valid: valid == null ? null : valid >= 0.5 ? 1 : 0,
    sensitive: (prob(answers.sensitive) ?? 0) >= 0.5 ? 1 : 0,
    action: (prob(answers.action) ?? 0) >= 0.6 ? 1 : 0,
    importance: answers.importance?.score ?? null,
    expiry: ex.key && ex.key !== "none" && (ex.p ?? 0) >= 0.4 ? cand.dates[Number(ex.key.slice(1))]?.date ?? null : null,
    party: pa.key && pa.key !== "none" && (pa.p ?? 0) >= 0.4 ? cand.parties[Number(pa.key.slice(1))] ?? null : null,
  };
}

/** La question de la recherche : ce document répond-il à la demande ? Un appel par candidat, toutes réponses en parallèle. */
export function matchQuestion(ctx: Context, request: string) {
  return { match: { type: "boolean", instructions: t("jevdoc.match", { owner: ctx.owner.name, request }), criteria: { true: t("jevdoc.match.true"), false: t("jevdoc.match.false") } } } satisfies Record<string, Question>;
}
