/**
 * Rédaction assistée : un modèle texte, via AI Gateway avec Zero Data Retention,
 * propose un brouillon dans le style de l'utilisateur. Il ne part jamais seul.
 */
import { generateText } from "ai";
import type { Context, Settings } from "../config.js";
import type { FullMessage } from "../connectors/gmail.js";
import { excerpt, htmlToText } from "./text.js";
import { costFromMeta, recordUsage } from "./usage.js";
import { currentLanguage, languageName, t } from "../i18n/index.js";

export type ComposeMode = "reply" | "replyAll" | "forward" | "followUp";

export interface ComposeInput {
  mode: ComposeMode;
  message: FullMessage;
  /** Consigne libre de l'utilisateur : « propose mardi ou jeudi », « décline poliment »… */
  instructions?: string;
  /** Extraits d'emails envoyés par l'utilisateur, pour le ton. */
  styleSamples: string[];
  ctx: Context;
  settings: Settings;
  /** Pour le suivi des coûts. */
  itemId?: number;
}

export async function composeDraft(input: ComposeInput): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const { message: m, mode, ctx, settings } = input;
  const body = excerpt(m.text || htmlToText(m.html), 4000);
  const task =
    mode === "forward"
      ? "Rédige un court message d'accompagnement pour transférer cet email à un tiers : en une ou deux phrases, dis pourquoi tu le transmets et ce que tu attends."
      : mode === "followUp"
        ? `Rédige une relance courte et cordiale : ${ctx.owner.name} a écrit en dernier dans ce fil et n'a pas eu de réponse. Rappelle en une phrase ce qui est attendu, sans reproche, et propose une suite simple.`
        : "Rédige la réponse à cet email.";
  const system = [
    `Tu écris des emails à la place de ${ctx.owner.name}, en première personne. Réponds dans la langue de l'email reçu.`,
    "Style : direct, chaleureux, sans formules creuses ni jargon. Phrases courtes. Pas de tirets décoratifs, pas d'emoji, pas de titre.",
    "Quand une information manque (une date, un chiffre, une décision), écris un repère entre crochets, par exemple [date à confirmer], plutôt que d'inventer.",
    "Ne signe pas avec un titre : termine par le prénom seulement, sur sa propre ligne.",
    "Réponds uniquement avec le texte du message, sans objet ni commentaire.",
    ctx.instructions ? `Consignes permanentes de ${ctx.owner.name} : ${ctx.instructions}` : "",
    input.styleSamples.length ? `Voici des emails que ${ctx.owner.name} a écrits, pour t'imprégner de son ton (ne les recopie pas) :\n\n${input.styleSamples.map((s, i) => `--- exemple ${i + 1} ---\n${s}`).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = [
    task,
    input.instructions ? `Consigne pour ce message : ${input.instructions}` : "",
    `--- Email reçu ---\nDe : ${m.from}\nÀ : ${m.to}\nDate : ${m.date}\nObjet : ${m.subject}\n\n${body}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const t0 = Date.now();
  const r = await generateText({
    model: settings.writerModel,
    system,
    prompt,
    providerOptions: settings.zeroDataRetention ? { gateway: { zeroDataRetention: true } } : undefined,
  });
  recordUsage({ purpose: "draft", model: settings.writerModel, inputTokens: r.usage.inputTokens ?? 0, outputTokens: r.usage.outputTokens ?? 0, cost: costFromMeta(r.providerMetadata), itemId: input.itemId, latencyMs: Date.now() - t0 });
  return { text: r.text.trim(), model: settings.writerModel, inputTokens: r.usage.inputTokens ?? 0, outputTokens: r.usage.outputTokens ?? 0 };
}

/** Objet de réponse ou de transfert, à la manière des clients mail. « Re: » est universel ; le préfixe de transfert suit la langue. */
export function subjectFor(mode: ComposeMode, subject: string): string {
  const clean = subject.replace(/^\s*((re|fwd?|tr|rv|aw|wg)\s*:\s*)+/i, "").trim();
  return mode === "forward" ? `${t("mail.fwdPrefix")} ${clean}` : `Re: ${clean}`;
}

/** Le texte cité sous une réponse ou un transfert, avec les en-têtes dans la langue de l'app. */
export function quoted(mode: ComposeMode, m: FullMessage): string {
  const text = (m.text || htmlToText(m.html)).trim();
  const sep = currentLanguage() === "fr" ? " : " : ": ";
  if (mode === "forward") return `\n\n${t("mail.forwardedHeader")}\n${t("mail.from")}${sep}${m.from}\n${t("mail.date")}${sep}${m.date}\n${t("mail.subject")}${sep}${m.subject}\n${t("mail.to")}${sep}${m.to}\n\n${text}`;
  return `\n\n${t("mail.wrote", { date: m.date, from: m.from })}\n${text.split("\n").map((l) => "> " + l).join("\n")}`;
}

// ---------- extraction d'événement
import { generateObject } from "ai";
import { z } from "zod";
import type { EventDraft } from "../connectors/calendar.js";

const EventSchema = z.object({
  found: z.boolean().describe("true si l'email contient bien un événement datable"),
  title: z.string(),
  start: z.string().describe("Début, format YYYY-MM-DDTHH:mm en heure locale, ou YYYY-MM-DD si journée entière"),
  end: z.string().describe("Fin, même format. Si inconnue : début + 1 h. Journée entière : le dernier jour inclus, le même jour si un seul jour"),
  allDay: z.boolean(),
  location: z.string().describe("Lieu, ou chaîne vide"),
  description: z.string().describe("2 à 4 lignes : l'essentiel à savoir, sans recopier tout l'email"),
  uncertain: z.array(z.string()).describe("Ce que tu as dû deviner : année, heure, durée, lieu…"),
});
/** Quand des événements déjà dans l'agenda pourraient être celui dont parle le message : le modèle dit s'il le modifie. */
const EventUpdateSchema = EventSchema.extend({
  updates: z.string().describe("La référence (E1, E2…) de l'événement déjà dans l'agenda que ce message déplace, modifie ou précise. Chaîne vide si c'est un autre événement, nouveau."),
  change: z.string().describe("Si updates est rempli : ce qui change ou se précise, en une phrase courte (« L'heure passe de 10:00 à 15:00 », « Apporter une tenue de sport »). Sinon chaîne vide."),
});

/** Le modèle texte lit l'email et propose un événement. L'utilisateur corrige et confirme avant toute création. */
/** Ce qu'il faut d'un message pour en extraire quelque chose : un email complet, ou une fenêtre de conversation WhatsApp. */
export type SourceText = Pick<FullMessage, "from" | "subject" | "date" | "text"> & { html?: string; channel?: "email" | "whatsapp" };

/** `known` : quelques événements de l'agenda (« E1 · 2026-10-05T10:00 → 11:00 · Dentiste Léo »), choisis par le code ; vide = pas de question de modification. */
export async function extractEvent(message: SourceText, ctx: Context, settings: Settings, today = new Date(), itemId?: number, known: Array<{ ref: string; line: string }> = []): Promise<EventDraft & { found: boolean; uncertain: string[]; updates?: string; change?: string }> {
  const body = excerpt(message.text || htmlToText(message.html ?? ""), 5000);
  const wa = message.channel === "whatsapp";
  const t0 = Date.now();
  const updateRule = known.length
    ? " Le message peut aussi concerner un événement déjà dans l'agenda (liste plus bas) : changement d'heure, de date, de lieu, ou précision. Dans ce cas, updates = sa référence, change = ce qui change, et title, start, end, allDay, location décrivent l'événement APRÈS modification : recopie de l'événement existant tout ce que le message ne change pas, titre compris, mot pour mot. Un simple rappel du même événement, sans rien de nouveau : updates = sa référence, change vide. Un événement différent, même ressemblant (autre jour d'une série, autre enfant) : updates vide."
    : "";
  const knownBlock = known.length ? `\n\nDéjà dans l'agenda :\n${known.map((k) => k.line).join("\n")}` : "";
  const r = await generateObject({
    model: settings.writerModel,
    schema: known.length ? EventUpdateSchema : EventSchema,
    system: `Tu extrais un événement d'agenda depuis ${wa ? "une conversation de groupe WhatsApp (messages courts, horodatés, de plusieurs personnes)" : "un email"}, pour ${ctx.owner.name} et sa famille. Fuseau : ${ctx.owner.timezone}. Aujourd'hui : ${today.toISOString().slice(0, 10)}. Une date sans année ou relative (« jeudi 21 », « demain », « la semaine prochaine ») se lit à partir de la date ${wa ? "du dernier message" : "de l'email"}, jamais d'aujourd'hui : prends sa première occurrence après cette date, même si elle est passée. Si l'heure manque, journée entière. Réponds dans la langue ${wa ? "de la conversation" : "de l'email"} pour le titre et la description.${wa ? " Ne retiens que l'événement le plus concret ; s'il n'y en a aucun, found = false." : ""}${updateRule}`,
    prompt: `${wa ? "Groupe" : "De"} : ${message.from}\n${wa ? "Dernier message" : "Date de l'email"} : ${message.date}\n${wa ? "Sujet" : "Objet"} : ${message.subject}\n\n${body}${knownBlock}`,
    providerOptions: settings.zeroDataRetention ? { gateway: { zeroDataRetention: true } } : undefined,
  });
  recordUsage({ purpose: "extract_event", model: settings.writerModel, inputTokens: r.usage.inputTokens ?? 0, outputTokens: r.usage.outputTokens ?? 0, cost: costFromMeta(r.providerMetadata), itemId, latencyMs: Date.now() - t0 });
  const o = r.object as z.infer<typeof EventSchema> & { updates?: string; change?: string };
  // Une référence inventée (absente de la liste) ne vaut rien : c'est alors un nouvel événement.
  const updates = o.updates?.trim() && known.some((k) => k.ref === o.updates!.trim()) ? o.updates.trim() : undefined;
  return { found: o.found, title: o.title, start: o.start, end: o.end, allDay: o.allDay, timezone: ctx.owner.timezone, location: o.location, description: o.description, uncertain: o.uncertain, ...(updates ? { updates, change: o.change ?? "" } : {}) };
}

const TaskSchema = z.object({
  found: z.boolean().describe("true s'il y a bien quelque chose de concret à faire pour le destinataire ou sa famille"),
  title: z.string().describe("La tâche, à l'infinitif, courte : « Signer l'autorisation de sortie »"),
  due: z.string().describe("Échéance au format YYYY-MM-DD, ou chaîne vide si aucune"),
  notes: z.string().describe("Une ligne de contexte utile, ou chaîne vide"),
  uncertain: z.array(z.string()).describe("Ce que tu as dû deviner"),
});

/** Le modèle texte lit le message et propose une tâche. L'utilisateur corrige et confirme avant d'ajouter. */
export async function extractTask(message: SourceText, ctx: Context, settings: Settings, today = new Date(), itemId?: number): Promise<z.infer<typeof TaskSchema>> {
  const body = excerpt(message.text || htmlToText(message.html ?? ""), 5000);
  const wa = message.channel === "whatsapp";
  const t0 = Date.now();
  const r = await generateObject({
    model: settings.writerModel,
    schema: TaskSchema,
    system: `Tu extrais une tâche à faire depuis ${wa ? "une conversation de groupe WhatsApp" : "un email"}, pour ${ctx.owner.name} et sa famille. Aujourd'hui : ${today.toISOString().slice(0, 10)}. Une échéance sans année ou relative (« vendredi », « avant le 15 ») se lit à partir de la date ${wa ? "du dernier message" : "de l'email"}, jamais d'aujourd'hui : prends sa première occurrence après cette date, même si elle est passée. Réponds en ${languageName(settings.language, "fr")} pour le titre.`,
    prompt: `${wa ? "Groupe" : "De"} : ${message.from}\nDate : ${message.date}\nSujet : ${message.subject}\n\n${body}`,
    providerOptions: settings.zeroDataRetention ? { gateway: { zeroDataRetention: true } } : undefined,
  });
  recordUsage({ purpose: "extract_task", model: settings.writerModel, inputTokens: r.usage.inputTokens ?? 0, outputTokens: r.usage.outputTokens ?? 0, cost: costFromMeta(r.providerMetadata), itemId, latencyMs: Date.now() - t0 });
  return r.object;
}
