/**
 * « Nettoyer le bruit » de la carte À caler : Jev relit chaque proposition (tâche ou événement) avec une seule question,
 * « cet email demande-t-il vraiment une action ou un rendez-vous à {owner} ? ». Les sollicitations (promotion, newsletter,
 * appel aux dons, webinar marketing…) sont ignorées comme avec le bouton « Ignorer » ; un rappel de paiement, les impôts,
 * un document à signer ou un rendez-vous restent. Rien ne change dans Gmail. Le coût est montré avant (estimate.ts).
 */
import type { Experimental_EvaluationQuestion as Question } from "ai";
import type { Classifier } from "./classify.js";
import { toCalWhere } from "./agenda-access.js";
import { askJev } from "./jev.js";
import { cachedProposal } from "./proposals.js";
import { t } from "../i18n/index.js";

/** Sous ce seuil de « vraie action », la proposition est ignorée. Au-dessus (ou en cas de doute), elle reste. */
export const DECLUTTER_KEEP = 0.4;

export function declutterQuestions(owner: string) {
  return {
    real_action: {
      type: "boolean",
      instructions: t("jev.realAction", { owner }),
      criteria: { true: t("jev.realAction.true"), false: t("jev.realAction.false", { owner }) },
    },
  } as const satisfies Record<string, Question>;
}

export type ToCalRow = { id: number; account_id: number; from_name: string | null; from_address: string | null; subject: string | null; date: string | null; body_excerpt: string | null; source: string };

/** Toutes les propositions en attente (pas seulement les 50 affichées), d'une source ou de toutes. */
export function toCalRows(c: Classifier, source?: string | null): ToCalRow[] {
  return c.db.prepare(`SELECT i.id, i.account_id, i.from_name, i.from_address, i.subject, i.date, i.body_excerpt, a.source
    FROM items i JOIN decisions d ON d.item_id = i.id JOIN accounts a ON a.id = i.account_id
    WHERE ${toCalWhere}${source ? " AND a.source = ?" : ""} ORDER BY i.date DESC`).all(...(source ? [source] : [])) as ToCalRow[];
}

export interface DeclutterResult { checked: number; ignored: Array<{ id: number; from: string; subject: string }>; kept: number; errors: number; lastError?: string }

/** Relit les propositions par petits groupes simultanés ; une erreur sur l'une laisse la proposition en place. */
export async function declutter(c: Classifier, rows: ToCalRow[]): Promise<DeclutterResult> {
  const out: DeclutterResult = { checked: 0, ignored: [], kept: 0, errors: 0 };
  const questions = declutterQuestions(c.ctx.owner.name);
  const ignore = c.db.prepare("UPDATE decisions SET action_state = 2 WHERE item_id = ? AND action_state = 0");
  const today = new Date().toISOString().slice(0, 10);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const r = rows[next++];
      const prop = cachedProposal(c.db, r.id) as { title?: string } | null;
      // Le texte de l'email est une donnée : Jev ne répond qu'à une question fermée, rien de ce qu'il contient ne déclenche quoi que ce soit.
      const state = {
        owner: c.ctx.owner.name, today,
        from: { name: r.from_name ?? "", address: r.from_address ?? "" },
        channel: r.source === "whatsapp" ? t("jev.channelWhatsapp") : t("jev.channelEmail"),
        subject: r.subject ?? "", date: (r.date ?? "").slice(0, 10), body: r.body_excerpt ?? "",
        proposal: prop?.title ?? "",
      };
      try {
        const res = await askJev(state, questions, c.settings, c.model, { purpose: "declutter", itemId: r.id, accountId: r.account_id });
        const a = res.answers.real_action as { probability?: number } | undefined;
        out.checked++;
        if (a?.probability != null && a.probability < DECLUTTER_KEEP) {
          ignore.run(r.id);
          out.ignored.push({ id: r.id, from: r.from_name || r.from_address || "", subject: r.subject ?? "" });
        } else out.kept++;
      } catch (err) {
        out.errors++;
        out.lastError = (err as Error).message.slice(0, 160);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(c.settings.concurrency, 8)) }, worker));
  return out;
}
