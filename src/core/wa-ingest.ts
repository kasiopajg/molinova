/**
 * WhatsApp → Jev. Un message de groupe seul ne dit rien : on lit chaque conversation écoutée par
 * « fenêtres » (messages rapprochés dans le temps), et chaque fenêtre devient un élément classé comme un email.
 */
import * as wa from "../connectors/whatsapp.js";
import { dateToApple } from "../connectors/whatsapp.js";
import type { Item } from "../connectors/types.js";
import { kvGet, kvSet, logActivity, saveDecision, upsertAccount, upsertItem } from "../db.js";
import { classify, type Classifier } from "./classify.js";
import { settleProposal } from "./proposals.js";
import { clip } from "./text.js";

/** Deux messages séparés de plus de trois heures ouvrent une nouvelle fenêtre. */
export const WINDOW_GAP_MS = 3 * 3600_000;
/** Une fenêtre ne dépasse pas ce nombre de messages. */
export const WINDOW_MAX = 12;
/** Une conversation encore chaude (dernier message trop récent) attend le prochain passage. */
export const SETTLE_MS = 20 * 60_000;

/**
 * Le curseur `wa.cursor:<pk>` est l'horodatage Apple brut (secondes, avec microsecondes) du dernier message traité.
 * Les anciens curseurs étaient en millisecondes epoch : la fraction perdue est inférieure à 1 ms, on ajoute donc 1 ms
 * pour exclure le message déjà traité sans en sauter aucun.
 */
export function cursorAfter(stored: number): number {
  if (!stored) return 0;
  return stored > 1e11 ? dateToApple(new Date(stored)) + 0.001 : stored;
}

/** Découpe une liste chronologique de messages en fenêtres. */
export function windows<T extends { date: Date }>(msgs: T[], gapMs = WINDOW_GAP_MS, max = WINDOW_MAX): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const m of msgs) {
    const last = cur[cur.length - 1];
    if (last && (m.date.getTime() - last.date.getTime() > gapMs || cur.length >= max)) { out.push(cur); cur = []; }
    cur.push(m);
  }
  if (cur.length) out.push(cur);
  return out;
}

const fmtLine = (m: Item): string => {
  const d = m.date;
  const stamp = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${stamp} · ${m.fromName} : ${m.bodyExcerpt}`;
};

/** Une fenêtre de conversation sous la forme commune, prête pour Jev. */
export function windowItem(chat: { jid: string; name: string }, msgs: Item[], accountId: number, maxChars: number): Item {
  const first = msgs[0], last = msgs[msgs.length - 1];
  const firstText = msgs.find((m) => !m.isOutgoing)?.bodyExcerpt ?? first.bodyExcerpt;
  let body = msgs.map(fmtLine).join("\n");
  body = clip(body, maxChars, "…");
  return {
    externalId: `${chat.jid}#${first.externalId}`, threadId: chat.jid, accountId, source: "whatsapp",
    fromName: chat.name, fromAddress: chat.jid, to: [], subject: `WhatsApp · ${chat.name} · ${clip(firstText.replace(/\s+/g, " "), 70)}`,
    date: last.date, bodyExcerpt: body, hasAttachments: msgs.some((m) => m.hasAttachments), hasListUnsubscribe: false,
    // Mes propres messages comptent aussi (« RDV dentiste Léo jeudi 16h ») : l'auteur est dans chaque ligne, Jev fait la part des choses.
    isOutgoing: false, labels: ["INBOX"],
  };
}

/** `flagged` : fenêtres encore d'actualité avec une date ou une chose à faire (les dépassées ne comptent pas). */
export interface IngestStats { at: string; chats: number; messages: number; windows: number; jevCalls: number; flagged: number; deferred: number; errors: string[] }

/** Le compte « whatsapp » de la base de l'agent (créé au besoin). */
export function whatsappAccountId(c: Classifier): number {
  return upsertAccount(c.db, "whatsapp", "whatsapp").id;
}

let running: Promise<IngestStats> | undefined;
export function ingesting(): boolean { return !!running; }

/** Lit les conversations écoutées depuis le dernier passage et classe chaque nouvelle fenêtre. Un seul passage à la fois. */
export function ingestWhatsApp(c: Classifier, opts: { captions: boolean; historyDays: number; ownerName: string }): Promise<IngestStats> {
  if (running) return running;
  running = (async () => {
    const stats: IngestStats = { at: new Date().toISOString(), chats: 0, messages: 0, windows: 0, jevCalls: 0, flagged: 0, deferred: 0, errors: [] };
    await wa.snapshot();
    const accountId = whatsappAccountId(c);
    const listened = c.db.prepare("SELECT pk, jid, name FROM wa_chats WHERE listen = 1").all() as Array<{ pk: number; jid: string; name: string }>;
    const now = Date.now();
    for (const chat of listened) {
      stats.chats++;
      try {
        const cursor = cursorAfter(kvGet<number>(c.db, `wa.cursor:${chat.pk}`, 0));
        const from = cursor ? { after: cursor } : { since: new Date(now - opts.historyDays * 86_400_000) };
        // Du plus ancien au plus récent, 2000 au plus : le curseur avance sans jamais sauter de messages ; le reste viendra au passage suivant.
        const page = wa.readMessagesPage(chat.pk, accountId, { captions: opts.captions, ...from, limit: 2000, ownerName: opts.ownerName, order: "asc" });
        const msgs = page.items;
        stats.messages += msgs.length;
        let advanceTo = cursor;
        const wins = windows(msgs);
        // Lecture coupée par la limite : la dernière fenêtre continue peut-être au-delà, elle sera lue entière la prochaine fois.
        if (page.truncated && wins.length > 1) wins.pop();
        for (const w of wins) {
          const last = w[w.length - 1];
          if (now - last.date.getTime() < SETTLE_MS) { stats.deferred++; break; } // encore chaude : au prochain passage
          const item = windowItem(chat, w, accountId, c.settings.bodyExcerptChars * 2);
          const itemId = upsertItem(c.db, item);
          const done = c.db.prepare("SELECT 1 FROM decisions WHERE item_id = ?").get(itemId);
          if (!done) {
            const o = await classify(c, item, { usage: { purpose: "classify", itemId } });
            stats.windows++;
            if (o.jev) stats.jevCalls++;
            const useful = !!(o.flags.event || o.flags.task);
            // Une fenêtre sans date ni chose à faire ne doit apparaître nulle part : ni à revoir, ni à lire, aucun signal.
            const flags = useful ? { ...o.flags, reply: false, spam: false, urgent: false, important: false } : { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false, task: false };
            saveDecision(c.db, { itemId, ...o, needsReview: false, flags });
            if (!useful) c.db.prepare("UPDATE decisions SET action_state = 2 WHERE item_id = ?").run(itemId);
            else {
              stats.flagged++;
              try {
                const r = await settleProposal(c, itemId, flags, () => ({ from: item.fromName, subject: item.subject, date: item.date.toISOString(), text: item.bodyExcerpt, channel: "whatsapp" as const }));
                if (r.past) stats.flagged--;
                else logActivity(c.db, "whatsapp", "proposal", { chat: chat.name, kind: flags.event ? "event" : "task", text: item.subject.split(" · ").slice(2).join(" · ") }, itemId);
              }
              catch (e) { stats.errors.push(`${chat.name} : ${(e as Error).message.slice(0, 100)}`); }
            }
          }
          advanceTo = Math.max(advanceTo, last.at);
        }
        if (advanceTo > cursor) kvSet(c.db, `wa.cursor:${chat.pk}`, advanceTo);
      } catch (e) {
        stats.errors.push(`${chat.name} : ${(e as Error).message.slice(0, 120)}`);
      }
    }
    kvSet(c.db, "wa.lastIngest", stats);
    if (stats.windows) logActivity(c.db, "whatsapp", "pass", { chats: stats.chats, windows: stats.windows, flagged: stats.flagged });
    if (stats.errors.length) logActivity(c.db, "whatsapp", "error", { error: stats.errors[0], n: stats.errors.length });
    return stats;
  })().finally(() => { running = undefined; });
  return running;
}
