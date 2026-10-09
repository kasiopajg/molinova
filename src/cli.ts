#!/usr/bin/env tsx
/**
 * Molinova — ligne de commande.
 *
 *   pnpm ea accounts add [--drafts]     connecter un compte Gmail
 *   pnpm ea accounts list
 *   pnpm ea inventory <compte> [--max N] statistiques par expéditeur, sans IA
 *   pnpm ea preview <compte> [--n 50]   classe un échantillon, ne touche pas à Gmail
 *   pnpm ea labels sync <compte>        crée les libellés AI/… dans Gmail
 *   pnpm ea backfill <compte> [--max N] classe l'historique et pose les libellés
 *   pnpm ea watch <compte>              classe les nouveaux emails (boucle)
 *   pnpm ea review <compte>             passe en revue les emails incertains
 *   pnpm ea stats
 */
import { loadContext, loadRules, loadSettings, loadTaxonomy, saveRules } from "./config.js";
import { GmailConnector, HistoryExpiredError, authorizeNewAccount } from "./connectors/gmail.js";
import type { Item } from "./connectors/types.js";
import { allLabels, classify, labelsFor, makeClassifier, type Classifier } from "./core/classify.js";
import { labelName } from "./core/taxonomy.js";
import { domainOf, parseAddress } from "./core/text.js";
import { finishRun, getAccount, listAccounts, markApplied, openDb, rememberSender, saveDecision, startRun, upsertAccount, upsertItem, type AccountRow, type Decision } from "./db.js";
import { t } from "./i18n/index.js";

// La langue de l'app est posée par loadSettings() ; sans settings.json (premier lancement), les messages restent en français.
try { loadSettings(); } catch { /* pas encore de configuration */ }

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? "true");
};
const has = (name: string) => args.includes(`--${name}`);
/** Argument positionnel n° i (après la commande), en ignorant les --options et leurs valeurs. */
const positional = (i: number): string | undefined => {
  const out: string[] = [];
  for (let k = 1; k < args.length; k++) {
    if (args[k].startsWith("--")) {
      if (args[k + 1] && !args[k + 1].startsWith("--")) k++;
      continue;
    }
    out.push(args[k]);
  }
  return out[i];
};

function fmtPct(x: number | null | undefined): string {
  return x === null || x === undefined ? "  —" : `${Math.round(x * 100).toString().padStart(3)}%`;
}
function short(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function buildClassifier(): Classifier {
  return makeClassifier({ settings: loadSettings(), taxonomy: loadTaxonomy(), rules: loadRules(), ctx: loadContext(), db: openDb() });
}
function connectorFor(acc: AccountRow, c: Classifier): GmailConnector {
  return new GmailConnector(acc.id, acc.email, c.ctx.owner.emails.map((e) => e.toLowerCase()), c.settings.bodyExcerptChars);
}
function requireAccount(arg: string | undefined): AccountRow {
  const db = openDb();
  const accounts = listAccounts(db);
  if (!arg) {
    if (accounts.length === 1) return accounts[0];
    throw new Error(t("cli.specifyAccount", { accounts: accounts.map((a) => a.email).join(", ") || t("cli.noAccounts") }));
  }
  const acc = getAccount(db, arg);
  if (!acc) throw new Error(t("cli.unknownAccount", { account: arg }));
  return acc;
}

/** Exécute fn sur les éléments avec au plus `limit` appels en parallèle. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function cmdAccounts() {
  const sub = args[1];
  const db = openDb();
  if (sub === "add") {
    const { email } = await authorizeNewAccount({ drafts: has("drafts") });
    const acc = upsertAccount(db, "gmail", email);
    console.log(t("cli.accountConnected", { email, id: acc.id }));
    return;
  }
  for (const a of listAccounts(db)) console.log(`${a.id}  ${a.email}  ${a.backfill_done ? t("cli.backfillDone") : t("cli.backfillPending")}`);
}

async function cmdInventory() {
  const acc = requireAccount(positional(0));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  const max = Number(flag("max") ?? 2000);
  const bySender = new Map<string, { n: number; unsub: number; name: string }>();
  let token: string | undefined;
  let seen = 0;
  const runId = startRun(c.db, "inventory", acc.id);
  while (seen < max) {
    const page = await gm.listMetadata({ pageToken: token, pageSize: Math.min(100, max - seen) });
    for (const r of page.rows) {
      const p = parseAddress(r.from);
      const e = bySender.get(p.address) ?? { n: 0, unsub: 0, name: p.name };
      e.n++;
      if (r.listUnsubscribe) e.unsub++;
      bySender.set(p.address, e);
    }
    seen += page.rows.length;
    process.stdout.write(`\r${t("cli.emailsRead", { n: seen })}`);
    token = page.nextPageToken;
    if (!token) break;
  }
  finishRun(c.db, runId, { processed: seen, jevCalls: 0, inputTokens: 0 });
  console.log(`\n\n${t("cli.inventorySummary", { senders: bySender.size, emails: seen })}\n`);
  const top = [...bySender.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40);
  for (const [addr, e] of top) console.log(`${String(e.n).padStart(5)}  ${(e.unsub ? t("cli.listTag") : "").padEnd(5)}  ${short(addr, 42)}  ${short(e.name, 30)}`);
  console.log(`\n${t("cli.listLegend")}`);
}

async function processItems(c: Classifier, gm: GmailConnector, items: Item[], opts: { apply: boolean; verbose: boolean }) {
  const stats = { processed: 0, jevCalls: 0, inputTokens: 0, review: 0, byCategory: new Map<string, number>() };
  await pool(items, c.settings.concurrency, async (item) => {
    const itemId = upsertItem(c.db, item);
    // Déjà décidé (aperçu précédent, correction) : on réutilise, sans rappeler Jev.
    const prev = c.db.prepare("SELECT decided_by, category, confidence, needs_review, flags_json FROM decisions WHERE item_id = ?").get(itemId) as
      | { decided_by: Decision["decidedBy"]; category: string | null; confidence: number | null; needs_review: number; flags_json: string | null } | undefined;
    let o: Awaited<ReturnType<typeof classify>>;
    try {
      o = prev
        ? { decidedBy: prev.decided_by, category: prev.category, confidence: prev.confidence, needsReview: !!prev.needs_review, flags: prev.flags_json ? JSON.parse(prev.flags_json) : { reply: false, toPay: false, spam: false, urgent: false, important: false, event: false } }
        : await classify(c, item);
    } catch (err) {
      console.error(`\n${t("cli.itemError", { subject: item.subject, error: (err as Error).message })}`);
      return;
    }
    if (!prev) saveDecision(c.db, { itemId, ...o });
    stats.processed++;
    if (o.jev) {
      stats.jevCalls++;
      stats.inputTokens += o.inputTokens ?? 0;
    }
    if (o.needsReview) stats.review++;
    if (o.category) stats.byCategory.set(o.category, (stats.byCategory.get(o.category) ?? 0) + 1);
    if (!prev && o.category && !o.needsReview && o.decidedBy === "jev") rememberSender(c.db, item.accountId, item.fromAddress, o.category);

    const labels = labelsFor(c, o);
    if (opts.apply && labels.length) {
      try { await gm.applyLabels(item.externalId, labels, []); markApplied(c.db, itemId, labels); }
      catch (err) { console.error(`\n${t("cli.itemError", { subject: item.subject, error: (err as Error).message })}`); }
    }
    if (opts.verbose) {
      const src = o.decidedBy === "jev" ? "jev " : o.decidedBy === "rule" ? t("cli.srcRule") : t("cli.srcMemory");
      const cat = o.category ?? "?";
      const flags = [o.flags.reply && t("cli.flagReply"), o.flags.toPay && t("cli.flagToPay"), o.flags.spam && t("cli.flagSpam"), o.flags.urgent && t("cli.flagUrgent"), o.needsReview && t("cli.flagReview")].filter(Boolean).join(" ");
      console.log(`${src}  ${fmtPct(o.confidence)}  ${short(cat, 18)}  ${short(item.fromAddress, 32)}  ${short(item.subject, 48)}  ${flags}`);
    } else {
      process.stdout.write(`\r${t("cli.progress", { done: stats.processed, total: items.length, review: stats.review })}`);
    }
  });
  return stats;
}

function printStats(stats: Awaited<ReturnType<typeof processItems>>, c: Classifier) {
  console.log(`\n${t("cli.statsLine", { n: stats.processed, calls: stats.jevCalls, tokens: stats.inputTokens, cost: ((stats.inputTokens / 1e6) * 0.042).toFixed(4), review: stats.review })}`);
  for (const [k, n] of [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    const name = c.taxonomy.categories.find((x) => x.key === k)?.name ?? k;
    console.log(`  ${String(n).padStart(5)}  ${name}`);
  }
}

async function cmdPreview() {
  const acc = requireAccount(positional(0));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  const n = Number(flag("n") ?? 50);
  const runId = startRun(c.db, "preview", acc.id);
  const page = await gm.list({ pageSize: n, query: flag("q") });
  console.log(`${t("cli.previewIntro", { n: page.items.length })}\n`);
  const stats = await processItems(c, gm, page.items, { apply: false, verbose: true });
  finishRun(c.db, runId, { processed: stats.processed, jevCalls: stats.jevCalls, inputTokens: stats.inputTokens });
  printStats(stats, c);
}

async function cmdLabels() {
  if (args[1] !== "sync") throw new Error(t("cli.usageLabels"));
  const acc = requireAccount(positional(1));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  const ids = await gm.ensureLabels(allLabels(c));
  for (const [name, id] of ids) console.log(`${name}  ${id}`);
}

async function cmdBackfill() {
  const acc = requireAccount(positional(0));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  const max = Number(flag("max") ?? Infinity);
  await gm.ensureLabels(allLabels(c));
  if (!acc.history_id) c.db.prepare("UPDATE accounts SET history_id = ? WHERE id = ?").run(await gm.currentHistoryId(), acc.id);
  const runId = startRun(c.db, "backfill", acc.id);
  let token = acc.backfill_page_token ?? undefined;
  const total = { processed: 0, jevCalls: 0, inputTokens: 0, review: 0, byCategory: new Map<string, number>() };
  // Du plus récent au plus ancien ; on ne retraite pas ce qui est déjà décidé.
  while (total.processed < max) {
    const page = await gm.list({ pageToken: token, pageSize: 50, query: `-label:${c.taxonomy.prefix}` });
    const stats = await processItems(c, gm, page.items, { apply: true, verbose: false });
    total.processed += stats.processed;
    total.jevCalls += stats.jevCalls;
    total.inputTokens += stats.inputTokens;
    total.review += stats.review;
    for (const [k, n] of stats.byCategory) total.byCategory.set(k, (total.byCategory.get(k) ?? 0) + n);
    token = page.nextPageToken;
    c.db.prepare("UPDATE accounts SET backfill_page_token = ?, backfill_done = ? WHERE id = ?").run(token ?? null, token ? 0 : 1, acc.id);
    if (!token) break;
  }
  finishRun(c.db, runId, total);
  printStats(total, c);
}

async function cmdWatch() {
  const acc = requireAccount(positional(0));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  await gm.ensureLabels(allLabels(c));
  const every = Number(flag("every") ?? 300) * 1000;
  let historyId = acc.history_id ?? (await gm.currentHistoryId());
  console.log(t("cli.watching", { email: acc.email, seconds: every / 1000 }));
  for (;;) {
    try {
      const { ids, historyId: next } = await gm.newMessagesSince(historyId);
      if (ids.length) {
        const items = (await Promise.all(ids.map((id) => gm.fetch(id)))).filter((x): x is Item => x !== undefined && !x.labels.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH"));
        const stats = await processItems(c, gm, items, { apply: true, verbose: true });
        console.log(t("cli.newClassified", { time: new Date().toLocaleTimeString(), n: stats.processed }));
      }
      historyId = next;
      c.db.prepare("UPDATE accounts SET history_id = ? WHERE id = ?").run(historyId, acc.id);
    } catch (err) {
      if (err instanceof HistoryExpiredError) {
        // Historique Gmail expiré : on repart de maintenant (un backfill rattrape le reste).
        try { historyId = await gm.currentHistoryId(); c.db.prepare("UPDATE accounts SET history_id = ? WHERE id = ?").run(historyId, acc.id); } catch { /* prochain passage */ }
      }
      console.error(t("cli.error", { error: (err as Error).message }));
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

async function cmdReview() {
  const acc = requireAccount(positional(0));
  const c = buildClassifier();
  const gm = connectorFor(acc, c);
  const rows = c.db
    .prepare(
      `SELECT i.id, i.external_id, i.from_address, i.subject, i.body_excerpt, d.category, d.answers_json
       FROM items i JOIN decisions d ON d.item_id = i.id
       WHERE i.account_id = ? AND d.needs_review = 1 ORDER BY i.date DESC LIMIT 50`,
    )
    .all(acc.id) as Array<{ id: number; external_id: string; from_address: string; subject: string; body_excerpt: string; category: string | null; answers_json: string | null }>;
  if (!rows.length) return console.log(t("cli.nothingToReview"));
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cats = c.taxonomy.categories;
  const review = `${c.taxonomy.prefix}/${c.settings.specialLabels.review}`;
  for (const r of rows) {
    const probs = r.answers_json ? (JSON.parse(r.answers_json).category?.probabilities as Record<string, number> | undefined) : undefined;
    const top = probs ? Object.entries(probs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, p]) => `${cats.find((x) => x.key === k)?.name ?? k} ${Math.round(p * 100)}%`).join(" · ") : "";
    console.log(`\n${r.from_address}\n${r.subject}\n${r.body_excerpt.slice(0, 240)}\n→ ${top}`);
    cats.forEach((x, i) => process.stdout.write(`${i + 1}.${x.name}  `));
    const ans = (await rl.question(`\n${t("cli.reviewPrompt")}`)).trim();
    if (ans === "q") break;
    if (ans === "s" || ans === "") continue;
    const makeRule = ans.startsWith("r");
    const idx = Number(ans.replace("r", "")) - 1;
    const cat = cats[idx];
    if (!cat) continue;
    c.db.prepare("INSERT INTO corrections (item_id, from_category, to_category) VALUES (?, ?, ?)").run(r.id, r.category, cat.key);
    c.db.prepare("UPDATE decisions SET category = ?, needs_review = 0, decided_by = 'user', confidence = 1 WHERE item_id = ?").run(cat.key, r.id);
    rememberSender(c.db, acc.id, r.from_address, cat.key);
    await gm.applyLabels(r.external_id, [labelName(c.taxonomy, cat)], [review]);
    if (makeRule) {
      const rules = loadRules();
      const domain = domainOf(r.from_address);
      rules.push({ id: `learned-${domain}-${Date.now()}`, when: { fromDomain: domain }, category: cat.key, origin: "learned", stop: false, quiet: false });
      saveRules(rules);
      console.log(t("cli.ruleAdded", { domain, category: cat.name }));
    }
  }
  rl.close();
}

function cmdStats() {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT a.email, d.category, COUNT(*) n FROM decisions d JOIN items i ON i.id = d.item_id JOIN accounts a ON a.id = i.account_id
       GROUP BY a.email, d.category ORDER BY a.email, n DESC`,
    )
    .all() as Array<{ email: string; category: string | null; n: number }>;
  const tax = loadTaxonomy();
  for (const r of rows) console.log(`${short(r.email, 30)}  ${String(r.n).padStart(6)}  ${r.category ? (tax.categories.find((x) => x.key === r.category)?.name ?? r.category) : t("cli.toReview")}`);
  const runs = db.prepare("SELECT kind, processed, jev_calls, input_tokens, started_at FROM runs ORDER BY id DESC LIMIT 5").all() as Array<{ kind: string; processed: number; jev_calls: number; input_tokens: number; started_at: string }>;
  console.log(`\n${t("cli.lastRuns")}`);
  for (const r of runs) console.log(`  ${r.started_at}  ${short(r.kind, 10)}  ${t("cli.runStats", { n: r.processed, calls: r.jev_calls, tokens: r.input_tokens })}`);
}

const commands: Record<string, () => Promise<void> | void> = {
  accounts: cmdAccounts,
  inventory: cmdInventory,
  preview: cmdPreview,
  labels: cmdLabels,
  backfill: cmdBackfill,
  watch: cmdWatch,
  review: cmdReview,
  stats: cmdStats,
};

const run = commands[cmd ?? ""];
if (!run) {
  console.log(t("cli.commands"));
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(run()).catch((err: Error) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
