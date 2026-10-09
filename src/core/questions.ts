import type { Experimental_EvaluationQuestion as Question } from "ai";
import type { Context, Taxonomy } from "../config.js";
import type { Item } from "../connectors/types.js";
import { childrenOf, parentOf } from "./taxonomy.js";
import { t } from "../i18n/index.js";

/**
 * Les questions posées à Jev pour chaque élément. Jev répond à toutes en un
 * seul appel, avec des probabilités ; le code décide ensuite selon des seuils.
 */
/** Exemples validés par l'utilisateur, par clé de catégorie : « De : x · Objet : y ». */
export type Examples = Record<string, string[]>;

export function buildQuestions(taxonomy: Taxonomy, ctx: Context, examples: Examples = {}) {
  const categoryCriteria: Record<string, string> = {};
  for (const c of taxonomy.categories) {
    let crit = enrichCriteria(c.key, c.criteria, ctx);
    // Sous-catégorie : Jev voit le chemin et le cadre du parent. Parent : il sait que des sous-catégories plus précises existent.
    const parent = parentOf(taxonomy, c);
    const kids = childrenOf(taxonomy, c.key);
    if (parent) crit = t("jev.subcategoryOf", { path: `${parent.name} › ${c.name}`, criteria: crit, parent: parent.name, parentCriteria: enrichCriteria(parent.key, parent.criteria, ctx) });
    else if (kids.length) crit += t("jev.general", { children: kids.map((k) => k.name).join(", ") });
    const ex = examples[c.key] ?? [];
    // Tes corrections deviennent des exemples : l'agent apprend du contenu, pas seulement de l'expéditeur.
    if (ex.length) crit += t("jev.examples", { owner: ctx.owner.name, examples: ex.map((e) => `« ${e} »`).join(" ; ") });
    categoryCriteria[c.key] = crit;
  }

  const owner = ctx.owner.name;
  const questions = {
    category: {
      type: "choice",
      instructions: t("jev.category", { owner }),
      criteria: categoryCriteria,
    },
    reply_expected: {
      type: "boolean",
      instructions: t("jev.reply", { owner }),
      criteria: { true: t("jev.reply.true"), false: t("jev.reply.false") },
    },
    awaits_reply: {
      type: "boolean",
      instructions: t("jev.awaits", { owner }),
      criteria: { true: t("jev.awaits.true", { owner }), false: t("jev.awaits.false", { owner }) },
    },
    priority: {
      type: "score",
      instructions: t("jev.priority", { owner }),
      criteria: [t("jev.priority.low"), t("jev.priority.normal"), t("jev.priority.high"), t("jev.priority.urgent")],
    },
    spam: {
      type: "boolean",
      instructions: t("jev.spam"),
      criteria: { true: t("jev.spam.true"), false: t("jev.spam.false") },
    },
    attention: {
      type: "boolean",
      instructions: t("jev.attention", { owner }),
      criteria: { true: t("jev.attention.true"), false: t("jev.attention.false") },
    },
    event: {
      type: "boolean",
      instructions: t("jev.event", { owner }),
      criteria: { true: t("jev.event.true"), false: t("jev.event.false") },
    },
    task: {
      type: "boolean",
      instructions: t("jev.task", { owner }),
      criteria: { true: t("jev.task.true"), false: t("jev.task.false") },
    },
    to_pay: {
      type: "boolean",
      instructions: t("jev.toPay"),
      criteria: { true: t("jev.toPay.true"), false: t("jev.toPay.false") },
    },
    // Portée limitée dans le temps : passé son délai, l'email devient « obsolète » et sort de la file (core/mail-query.ts).
    time_bound: {
      type: "boolean",
      instructions: t("jev.timeBound", { owner }),
      criteria: { true: t("jev.timeBound.true"), false: t("jev.timeBound.false", { owner }) },
    },
    // Durée de vie courte : un code ou une alerte de connexion ne demande une action que dans les minutes qui suivent (core/ephemeral.ts).
    ephemeral: {
      type: "choice",
      instructions: t("jev.ephemeral"),
      criteria: { code: t("jev.ephemeral.code"), signin: t("jev.ephemeral.signin"), none: t("jev.ephemeral.none") },
    },
    ...(ctx.family.children.length > 0
      ? {
          child: {
            type: "choice",
            instructions: t("jev.child"),
            criteria: Object.fromEntries([
              ...ctx.family.children.map((c) => [slug(c.name), `${c.name}${c.school ? ` (${c.school})` : ""}${c.activities.length ? t("jev.child.activities", { activities: c.activities.join(", ") }) : ""}`]),
              ["none", t("jev.child.none")],
            ]),
          },
        }
      : {}),
  } as const satisfies Record<string, Question>;
  return questions;
}
export type Questions = ReturnType<typeof buildQuestions>;

/** Les infos du contexte enrichissent les définitions envoyées à Jev. */
function enrichCriteria(key: string, base: string, ctx: Context): string {
  const extra: string[] = [];
  if (key === "famille_ecole") {
    const schools = ctx.family.children.map((c) => c.school).filter(Boolean);
    if (schools.length) extra.push(t("jev.knownSchools", { list: schools.join(" ; ") }));
    if (ctx.family.schoolDomains.length) extra.push(t("jev.domains", { list: ctx.family.schoolDomains.join(", ") }));
  }
  if (key === "famille_activites") {
    const acts = ctx.family.children.flatMap((c) => c.activities);
    if (acts.length) extra.push(t("jev.knownActivities", { list: acts.join(" ; ") }));
    if (ctx.family.activityDomains.length) extra.push(t("jev.domains", { list: ctx.family.activityDomains.join(", ") }));
  }
  if (key === "clients" && ctx.projects.length) extra.push(t("jev.projects", { list: ctx.projects.join(" ; ") }));
  return extra.length ? `${base} ${extra.join(" ")}` : base;
}

export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "x";
}

/** L'état partagé : ce que Jev voit de l'email. Expéditeur, objet, début du corps — jamais l'email complet. */
export function buildState(item: Item, ctx: Context) {
  const known = ctx.keyPeople.find((p) => p.emails.map((e) => e.toLowerCase()).includes(item.fromAddress));
  // Jev exige un état strictement JSON : pas de valeur undefined.
  return {
    owner: ctx.owner.name,
    instructions: ctx.instructions || "",
    from: { name: item.fromName, address: item.fromAddress, knownAs: known ? `${known.name} (${known.relation})` : "" },
    channel: item.source === "whatsapp" ? t("jev.channelWhatsapp") : t("jev.channelEmail"),
    subject: item.subject,
    date: item.date.toISOString().slice(0, 10),
    // Sans la date du jour, un vieil email lu par un rattrapage (« expire demain ») serait jugé comme s'il venait d'arriver.
    today: new Date().toISOString().slice(0, 10),
    sentByOwner: item.isOutgoing,
    hasAttachments: item.hasAttachments,
    hasListUnsubscribe: item.hasListUnsubscribe,
    body: item.bodyExcerpt,
  };
}
