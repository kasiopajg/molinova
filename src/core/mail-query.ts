/**
 * Filtres SQL de la boîte : la file Actions, les signaux, l'importance, une catégorie, un domaine.
 * Partagé par l'interface et par le coordinateur Telegram. Ne touche jamais au réseau.
 */
import type { Classifier } from "./classify.js";
import { STATE_PAST } from "./proposals.js";

/** Au-delà de cet âge (jours), un email ne peut plus être « urgent » ; au-delà du second, plus « haut » non plus. */
export const URGENT_MAX_DAYS = 3;
export const HIGH_MAX_DAYS = 14;

/**
 * Le score de priorité tel qu'il compte aujourd'hui (SQL, alias i = items, d = decisions) : celui de Jev (0 à 3,
 * 1 sans réponse Jev), plafonné par l'âge de l'email. Une échéance « dans les 48 h » ne reste pas urgente trois
 * semaines, et un rattrapage qui lit de vieux emails ne remplit pas la file d'urgences passées. La réponse de Jev,
 * elle, reste telle quelle en base.
 */
export function priorityScoreSql(t: { highScore: number; normalScore: number }): string {
  const raw = "COALESCE(json_extract(d.answers_json, '$.priority.score'), 1)";
  const age = "(julianday('now') - julianday(i.date))";
  return `MIN(${raw}, CASE WHEN ${age} <= ${URGENT_MAX_DAYS} THEN 3 WHEN ${age} <= ${HIGH_MAX_DAYS} THEN ${t.highScore} ELSE ${t.normalScore} END)`;
}

/** Délais au-delà desquels un email à portée limitée dans le temps devient « obsolète » (jours). */
export const OBSOLETE_URGENT_DAYS = 3;
export const OBSOLETE_DAYS = 14;

/**
 * L'email est-il obsolète (SQL, alias i, d) : sa portée était limitée dans le temps et ce délai est passé.
 * - Jev a répondu « portée limitée » (time_bound) : obsolète après 3 jours s'il était urgent (une échéance de 48 h),
 *   après 14 jours sinon.
 * - Classé avant cette question (ou par une règle) : obsolète après 14 jours s'il est dans une catégorie qui ne demande
 *   pas l'attention (promotions, notifications…). Aucun appel à l'IA pour l'historique.
 * Jamais obsolète : un envoi de ma part, un email à payer, ou une relance en cours.
 * Vaut toujours 0 ou 1, jamais NULL : un « inconnu » ferait disparaître l'email de la file (NOT NULL est NULL).
 */
export function obsoleteSql(c: Classifier): string {
  const t = c.settings.thresholds;
  const age = "(julianday('now') - julianday(i.date))";
  const tb = "json_extract(d.answers_json, '$.time_bound.probability')";
  const raw = "COALESCE(json_extract(d.answers_json, '$.priority.score'), 1)";
  const quiet = c.taxonomy.categories.filter((x) => !x.attention).map((x) => `'${x.key.replace(/'/g, "''")}'`).join(",") || "''";
  return `COALESCE((i.is_outgoing = 0 AND COALESCE(json_extract(d.flags_json, '$.toPay'), 0) = 0 AND COALESCE(json_extract(d.flags_json, '$.followUp'), 0) = 0 AND (
    (${tb} >= 0.5 AND ${age} > ${OBSOLETE_URGENT_DAYS} AND ${raw} >= ${t.urgentScore})
    OR (${tb} >= 0.5 AND ${age} > ${OBSOLETE_DAYS})
    OR (${tb} IS NULL AND ${age} > ${OBSOLETE_DAYS} AND d.category IN (${quiet})))), 0)`;
}

export function mailWhere(c: Classifier, filterIn: string, account: string | null, search: string): { where: string[]; params: unknown[] } {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  // Plusieurs critères se cumulent : "cat:notifications+important+unread".
  const tokens = (filterIn || "all").split(/[+ ]/).map((t) => t.trim()).filter(Boolean); // "+" ou espace (un "+" en URL devient un espace)
  // « nocutoff » : la file sans le nettoyage par date (pour compter, dans les Réglages, ce qu'une date ignorerait).
  const noCutoff = tokens.includes("nocutoff");
  for (const token of tokens) {
  let filter = token;
  if (filter === "review") where.push("d.needs_review = 1", "d.action_state = 0", "COALESCE(i.is_outgoing, 0) = 0");
  else if (filter === "todo") where.push("d.needs_review = 0");
  else if (filter === "done") where.push("d.action_state <> 0", `d.action_state <> ${STATE_PAST}`);
  else if (filter === "past") where.push(`d.action_state = ${STATE_PAST}`);
  else if (filter === "filed") where.push("d.action_state = 0", "d.needs_review = 0", "i.labels_json NOT LIKE '%INBOX%'");
  else if (filter === "reply") where.push("json_extract(d.flags_json, '$.reply') = 1 AND d.action_state = 0");
  else if (filter === "important") where.push("json_extract(d.flags_json, '$.important') = 1 AND d.action_state = 0");
  else if (filter === "toPay") where.push("json_extract(d.flags_json, '$.toPay') = 1 AND d.action_state = 0");
  else if (filter === "event") where.push("json_extract(d.flags_json, '$.event') = 1 AND d.action_state = 0");
  else if (filter === "task") where.push("json_extract(d.flags_json, '$.task') = 1 AND d.action_state = 0");
  else if (filter === "followUp") where.push("json_extract(d.flags_json, '$.followUp') = 1 AND d.action_state = 0");
  else if (filter === "unread") where.push("i.labels_json LIKE '%UNREAD%'");
  else if (filter === "sent") where.push("COALESCE(i.is_outgoing, 0) = 1");
  else if (filter === "received") where.push("COALESCE(i.is_outgoing, 0) = 0");
  else if (filter.startsWith("date:")) {
    // Date de l'email : « date:1d » (24 h), « date:7d », « date:30d », ou une période choisie au calendrier
    // « date:2026-09-01..2026-09-30 » (jours du Mac, bornes comprises). Se cumule avec les autres critères.
    const v = filter.slice(5), n = /^(\d{1,4})d$/.exec(v), r = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(v);
    if (n) where.push(`julianday(i.date) >= julianday('now', '-${Number(n[1])} days')`);
    else if (r) { where.push("date(i.date, 'localtime') BETWEEN ? AND ?"); params.push(r[1] <= r[2] ? r[1] : r[2], r[1] <= r[2] ? r[2] : r[1]); }
  }
  if (filter === "todo") filter = "queue";
  if (filter === "queue" || filter === "noise") {
    const attentive = c.taxonomy.categories.filter((x) => x.attention).map((x) => x.key);
    const inList = attentive.map(() => "?").join(",") || "''";
    // Un envoi de ma part à relancer n'est pas en boîte de réception : il entre dans la file quand même.
    where.push("d.action_state = 0", filter === "queue" ? "(i.labels_json LIKE '%INBOX%' OR COALESCE(json_extract(d.flags_json, '$.followUp'), 0) = 1)" : "i.labels_json LIKE '%INBOX%'");
    // COALESCE : un drapeau absent (décision ancienne) vaut 0, sinon NOT (… OR NULL) écarte la ligne.
    const flagged = "(" + ["reply", "toPay", "important", "event", "task", "followUp"].map((f) => `COALESCE(json_extract(d.flags_json, '$.${f}'), 0) = 1`).join(" OR ") + ")";
    // File : un signal, ou un email non lu d'une catégorie qui te concerne. Une règle « quiet » en sort toujours.
    // Un email « à classer » (libellé incertain) n'y entre que par un signal : le classer n'est pas du travail, il a sa page.
    // Un email obsolète n'est plus du travail : il a son filtre (« obsolete ») et son archivage en bloc.
    if (filter === "queue") where.push("COALESCE(json_extract(d.flags_json, '$.quiet'), 0) = 0", `(${flagged} OR (d.needs_review = 0 AND d.category IN (${inList}) AND i.labels_json LIKE '%UNREAD%'))`, `NOT ${obsoleteSql(c)}`);
    else where.push(`NOT ${flagged}`, "d.needs_review = 0", `d.category NOT IN (${inList})`);
    params.push(...attentive);
    // Nettoyage (Réglages › Règles) : avant cette date, plus rien n'est du travail. Valeur validée (AAAA-MM-JJ) : écrite telle quelle.
    const cutoff = c.settings.ignoreBefore;
    if (filter === "queue" && !noCutoff && cutoff && /^\d{4}-\d{2}-\d{2}$/.test(cutoff)) where.push(`date(i.date, 'localtime') >= '${cutoff}'`);
  }
  else if (filter === "obsolete") where.push("d.action_state = 0", "i.labels_json LIKE '%INBOX%'", obsoleteSql(c));
  else if (filter.startsWith("imp:")) {
    // Importance = score de priorité Jev (0 à 3) plafonné par l'âge, en quatre niveaux. Sans réponse Jev (règle, mémoire) : normale.
    const t = c.settings.thresholds, score = priorityScoreSql(t), lvl = filter.slice(4);
    if (lvl === "urgent") where.push(`${score} >= ${t.urgentScore}`);
    else if (lvl === "high") where.push(`${score} >= ${t.highScore} AND ${score} < ${t.urgentScore}`);
    else if (lvl === "normal") where.push(`${score} >= ${t.normalScore} AND ${score} < ${t.highScore}`);
    else if (lvl === "low") where.push(`${score} < ${t.normalScore}`);
  }
  else if (filter.startsWith("cat:")) { const keys = filter.slice(4).split(",").filter(Boolean); where.push(`d.category IN (${keys.map(() => "?").join(",") || "''"})`); params.push(...keys); }
  // Domaine expéditeur : "domain:ecole.example.org" (depuis la carte de la boîte ou une ligne de la liste par domaine).
  else if (filter.startsWith("domain:")) { const dom = filter.slice(7).trim().toLowerCase(); if (dom) { where.push("lower(i.from_address) LIKE ? ESCAPE '\\'"); params.push("%@" + dom.replace(/[%_\\]/g, "\\$&")); } }
  }
  if (account) { where.push("i.account_id = ?"); params.push(Number(account)); }
  if (search) { where.push("(lower(i.subject) LIKE ? OR lower(i.from_name) LIKE ? OR lower(i.from_address) LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  return { where, params };
}
export function mailCount(c: Classifier, filter: string, account: string | null = null): number {
  const { where, params } = mailWhere(c, filter, account, "");
  return (c.db.prepare(`SELECT COUNT(*) n FROM items i JOIN decisions d ON d.item_id = i.id WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
}
