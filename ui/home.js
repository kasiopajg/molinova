/* Accueil : ce que Molinova fait tout seul (en direct), ce qu'il te reste à faire pour que tout tourne, ce qui sort de
   chaque canal, et le fil de ce qui s'est passé. Rien ici n'appelle l'IA : /api/home et /api/activity lisent la base.
   L'état en direct (LIVE) est relu toutes les 30 s par app.js ; la page se redessine alors sans rechargement.
   Textes : ui/lang/<langue>/home.js (clés home.*, activity.*, chan.*). */

/** `expanded` : le fil déplié par « Tout voir » ; sinon il s'arrête à la hauteur du bloc de gauche. */
const HOME = { activity: [], more: false, busy: false, expanded: false };
const FEED_PAGE = 30;

views.home = async () => {
  const [, act, tax] = await Promise.all([refreshLive(), api(`/activity?limit=${FEED_PAGE}`).catch(() => []), api("/config/taxonomy").catch(() => null)]);
  if (tax) TAX = tax;
  HOME.activity = act;
  HOME.more = act.length === FEED_PAGE;
  HOME.expanded = false;
  setTimeout(() => { bindHome(); startHomeScan(); fitFeed(); });
  const today = fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" });
  return head("", t("home.head.kicker"), t("home.head.title"), t("home.head.lead", { date: today })) + `<div id="home" class="home">${homeHtml()}</div>`;
};

/** Appelé par refreshLive() quand l'Accueil est affiché : on redessine, fil compris, sauf pendant une action. */
function homeLive() {
  const el = $("#home");
  if (!el || HOME.busy || document.querySelector(".dlg, .drawer")) return;
  api(`/activity?limit=${Math.max(FEED_PAGE, HOME.activity.length)}`).then((a) => { HOME.activity = a; }).catch(() => {}).finally(() => { if ($("#home")) { $("#home").innerHTML = homeHtml(); startHomeScan(); fitFeed(); } });
}

function homeHtml() {
  if (!LIVE) return `<div class="empty">${t("common.loading")}</div>`;
  return homePromo() + `<div class="homegrid"><div class="col" style="gap:28px;min-width:0">${homeLiveSection()}${homeAlerts()}${homeMatrix()}</div><div class="col" style="min-width:0;gap:28px">${homeScan()}${homeFeed()}</div></div>`;
}

// ---------- Telegram en tête tant que le téléphone n'est pas relié
function homePromo() {
  const tg = LIVE.channels.telegram;
  if (tg.owner) return "";
  return `<a class="card dark hpromo" href="#channel/telegram">
    <div class="hpromo-ico" aria-hidden="true">${phoneIcon()}</div>
    <div class="grow"><div style="font-size:19px;font-weight:700">${t("home.promo.title")}</div><div class="small" style="color:var(--g200);margin-top:4px">${t("home.promo.text")}</div></div>
    <span class="btn" style="background:var(--paper);color:var(--ink);border-color:var(--paper)">${t("home.promo.cta")}</span>
  </a>`;
}
const phoneIcon = () => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>`;

// ---------- En direct : une ligne par mécanisme qui tourne seul
function liveRow(state, name, text, href) {
  return `<a class="hlive" href="${href}"><span class="led ${ledOf(state)}"></span><span class="hname">${h(name)}</span><span class="htext">${text}</span></a>`;
}
function homeLiveSection() {
  const c = LIVE.channels;
  const tg = c.telegram, g = c.gmail, wa = c.whatsapp, th = c.threads, dr = c.drive;
  const tgText = tg.state === "on"
    ? [t("home.live.tg.on", { bot: h(tg.botName || "") }), tg.lastMessageAt ? t("home.live.tg.lastMessage", { ago: ago(tg.lastMessageAt) }) : "", t("home.live.tg.next", { time: h(nextDigest(tg.schedule)) })].filter(Boolean).join(" · ")
    : tg.state === "error" ? `<span class="err">${h(tg.error || "")}</span>` : t("home.live.tg." + tg.state);
  const watching = g.accounts.filter((a) => a.watching);
  const last = Math.max(0, ...watching.map((a) => a.lastPassAt || 0));
  const next = Math.min(Infinity, ...watching.map((a) => a.nextPassAt || Infinity));
  const busy = g.accounts.find((a) => a.busy);
  const gText = g.state === "setup" ? t("home.live.gmail.setup")
    : g.state === "error" ? `<span class="err">${h(t("home.live.gmail.error"))}</span>`
    : !watching.length ? t("home.live.gmail.off")
    : [tn("home.live.gmail.on", watching.length, { total: g.accounts.length }), last ? t("home.live.read", { ago: ago(new Date(last).toISOString()) }) : t("home.live.firstPass"), Number.isFinite(next) ? t("home.live.next", { in: until(next) }) : ""].filter(Boolean).join(" · ");
  const gFull = busy ? `${gText} · ${t("home.live.gmail.busy", { kind: t("dash.kind." + busy.busy.kind), n: fmt(busy.busy.processed), total: busy.busy.total ? fmt(busy.busy.total) : "…" })}` : gText;
  const waText = wa.state === "on"
    ? [tn("home.live.wa.on", wa.listened), wa.ingesting ? t("home.live.wa.reading") : t("home.live.read", { ago: ago(wa.lastIngestAt) }), wa.nextAt && !wa.ingesting ? t("home.live.next", { in: until(wa.nextAt) }) : ""].filter(Boolean).join(" · ")
    : wa.state === "error" ? `<span class="err">${h(wa.error || "")}</span>` : t("home.live.wa." + wa.state);
  const drText = dr.state === "on"
    ? [tn("home.live.drive.on", dr.docs), dr.busy ? t("home.live.drive.reading") : dr.lastAt ? t("home.live.read", { ago: ago(dr.lastAt) }) : t("home.live.firstPass"), dr.nextAt && !dr.busy ? t("home.live.next", { in: until(Date.parse(dr.nextAt)) }) : ""].filter(Boolean).join(" · ")
    : dr.state === "error" ? `<span class="err">${h((dr.accounts.find((a) => a.error) || {}).error || "")}</span>` : t("home.live.drive." + dr.state);
  const thText = th.lastAt ? t("home.live.threads.on", { ago: ago(th.lastAt), every: th.everyMinutes }) : t("home.live.threads.wait", { every: th.everyMinutes });
  const rows = [
    liveRow(tg.state, t("chan.telegram"), tgText, "#channel/telegram"),
    liveRow(g.state, t("chan.gmail"), gFull, "#channel/gmail"),
    liveRow(dr.state, t("chan.drive"), drText, "#channel/drive"),
    wa.state === "unsupported" ? "" : liveRow(wa.state, t("chan.whatsapp"), waText, "#channel/whatsapp"),
    g.accounts.length ? liveRow(th.lastAt ? "on" : "off", t("home.live.threads"), thText, "#actions") : "",
  ].join("");
  return `<section class="col" style="gap:8px"><div class="mono">${t("home.live.title")}</div><div class="hlives">${rows}</div></section>`;
}
/** Le prochain résumé : le matin à l'heure dite, ou la semaine le dimanche soir s'il vient avant. */
function nextDigest(s) {
  const now = new Date();
  const at = (hm, addDays = 0) => { const [hh, mm] = String(hm || "07:30").split(":").map(Number); const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(hh, mm, 0, 0); return d; };
  let morning = at(s.morning); if (morning <= now) morning = at(s.morning, 1);
  const sunday = (7 - now.getDay()) % 7;
  let weekly = at(s.weekly, sunday); if (weekly <= now) weekly = at(s.weekly, sunday + 7);
  const day = (d) => (d.toDateString() === now.toDateString() ? "" : `${fmtDate(d, { weekday: "long" })} `);
  return weekly < morning ? t("home.live.tg.weekly", { when: `${day(weekly)}${fmtTime(weekly)}` }) : t("home.live.tg.morning", { when: `${day(morning)}${fmtTime(morning)}` });
}

// ---------- À faire de ton côté : seulement ce qui empêche Molinova de tourner ou attend un geste
function homeAlerts() {
  const rows = LIVE.alerts.map((a) => {
    const btn = (label, act, extra = "", cls = "") => `<button class="btn sm ${cls}" data-hact="${act}" ${extra}>${h(label)}</button>`;
    const link = (label, href, cls = "") => `<a class="btn sm ${cls}" href="${href}">${h(label)}</a>`;
    const who = h(String(a.email || ""));
    switch (a.kind) {
      case "backfill": return [tn("home.alert.backfill", a.n, { email: who }), btn(t("gmail.acc.backfill"), "backfill", `data-id="${a.accountId}" data-n="${a.n}"`, "signal")];
      case "reconnect": return [t("home.alert.reconnect", { email: who }), link(t("gmail.acc.reconnect"), "#channel/gmail", "ink")];
      case "gmailError": return [t("home.alert.gmailError", { email: who, error: h(a.error || "") }), link(t("home.alert.see"), "#channel/gmail")];
      case "watchOff": return [t("home.alert.watchOff", { email: who }), btn(t("gmail.acc.startWatch"), "watch", `data-id="${a.accountId}"`, "ink")];
      case "pending": return [tn("home.alert.pending", a.n, { email: who }), btn(t("gmail.acc.applyPending"), "apply", `data-id="${a.accountId}" data-n="${a.n}"`)];
      case "review": return [tn("home.alert.review", a.n), link(t("home.alert.classify"), "#classify")];
      case "waError": return [t("home.alert.waError", { error: h(a.error || "") }), link(t("home.alert.see"), "#channel/whatsapp")];
      case "waClosed": return [t("home.alert.waClosed"), link(t("home.alert.see"), "#channel/whatsapp")];
      case "tgError": return [t("home.alert.tgError", { error: h(a.error || "") }), link(t("home.alert.see"), "#channel/telegram")];
      case "driveError": return [t("home.alert.driveError", { email: who, error: h(a.error || "") }), link(t("home.alert.see"), `#channel/drive/${a.accountId}`)];
      case "tgOff": return [t("home.alert.tgOff"), btn(t("telegram.btn.start"), "tgstart", "", "ink")];
      default: return null;
    }
  }).filter(Boolean);
  const body = rows.length
    ? rows.map(([text, action]) => `<div class="halert"><span class="hwarn" aria-hidden="true">!</span><span class="grow">${text}</span>${action}</div>`).join("")
    : `<div class="small muted" style="padding:6px 2px">${t("home.alert.none")}</div>`;
  return `<section class="col" style="gap:8px"><div class="mono">${t("home.alert.title")}</div><div class="halerts">${body}</div></section>`;
}

// ---------- Ce qui en sort : canal × (à traiter, à caler, tâches), ouvert maintenant
function homeMatrix() {
  const m = LIVE.matrix, c = LIVE.channels;
  const cell = (n, href) => (n == null ? `<td class="r muted">–</td>` : n ? `<td class="r num"><a href="${href}">${fmt(n)}</a></td>` : `<td class="r num muted">0</td>`);
  const row = (name, v, links) => `<tr><th>${h(name)}</th>${cell(v.queue, links[0])}${cell(v.toCal, links[1])}${cell(v.tasks, "#agenda")}</tr>`;
  const soon = (name) => `<tr class="soon"><th>${h(name)}</th><td colspan="3" class="r small">${t("sources.soon")}</td></tr>`;
  const rows = [
    c.gmail.state !== "setup" ? row(t("chan.gmail"), m.gmail, ["#actions", "#agenda"]) : "",
    c.whatsapp.state !== "setup" && c.whatsapp.state !== "unsupported" ? row(t("chan.whatsapp"), m.whatsapp, ["#actions/whatsapp", "#agenda/whatsapp"]) : "",
    c.telegram.state !== "setup" ? row(t("chan.telegram"), m.telegram, ["", ""]) : "",
    m.app.tasks ? row(t("home.matrix.byHand"), { queue: null, toCal: null, tasks: m.app.tasks }, ["", ""]) : "",
    soon("Outlook · IMAP"),
  ].join("");
  return `<section class="col" style="gap:8px"><div class="row" style="align-items:baseline"><div class="mono">${t("home.matrix.title")}</div><span class="small muted" style="margin-left:auto">${t("home.matrix.now")}</span></div>
    <table class="hmatrix"><thead><tr><th></th><th class="r">${t("home.matrix.queue")}</th><th class="r">${t("home.matrix.toCal")}</th><th class="r">${t("home.matrix.tasks")}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

// ---------- L'animation : le réseau qui vit au rythme de Molinova (en direct), ou qui grandit pendant un rattrapage
/** Le passage ponctuel en cours (rattrapage, aperçu), s'il y en a un. */
const homeBusy = () => LIVE.channels.gmail.accounts.find((a) => a.busy);
function homeScan() {
  const busy = homeBusy();
  const watching = LIVE.channels.gmail.accounts.filter((a) => a.watching && a.nextPassAt);
  const next = watching.length ? Math.min(...watching.map((a) => a.nextPassAt)) : null;
  const r = LIVE.read;
  const phase = busy
    ? t("home.scan.busy", { kind: t("dash.kind." + busy.busy.kind), n: fmt(busy.busy.processed), total: busy.busy.total ? fmt(busy.busy.total) : "…" })
    : next ? t("home.scan.next", { in: until(next) }) : t("home.scan.idle");
  const today = [tn("home.scan.mail", r.today.gmail), LIVE.channels.whatsapp.state === "on" ? tn("home.scan.wa", r.today.whatsapp) : ""].filter(Boolean).join(" · ");
  return `<a class="scanwrap homescan" href="#channel/gmail"><canvas id="scan" width="300" height="300"></canvas><div class="scancap">
    <div class="mono" style="color:#D8DBDF"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#FF3B30;margin-right:8px;vertical-align:middle;animation:blink 1.2s infinite"></span>${h(t("home.scan.kicker"))} / ${h(fmtTime(new Date()))}</div>
    <div style="font-weight:600;color:#FBFBFC" id="hscan-phase">${h(phase)}</div>
    <div class="mono" style="color:#A6ABB2;letter-spacing:.06em">${h(t("home.scan.today", { what: today }))}</div>
    <div class="mono" style="color:#6F747C;letter-spacing:.06em;font-size:11px">${h(tn("home.scan.net", r.week, { nodes: netSizeFor(r.week).nodes }))}</div>
  </div></a>`;
}
let homeScanTimer;
/** Lance l'animation ; pendant un rattrapage, suit sa progression toutes les 1,5 s, sinon vit au rythme de la veille. */
function startHomeScan() {
  clearTimeout(homeScanTimer);
  if (!$("#scan") || !LIVE) return;
  const busy = homeBusy();
  if (!busy) { liveScan(LIVE); return; }
  const tick = async () => {
    if (currentPage() !== "home" || !$("#scan")) return;
    try {
      const j = (await api("/jobs")).find((x) => x.accountId === busy.id && x.kind !== "watch" && x.status === "running");
      if (!j) { refreshLive(); return; }
      ensureScan(j.total ? Math.min(1, (j.scanned ?? j.processed) / j.total) : null, j.phase, false, j.processed, j.total);
      const el = $("#hscan-phase");
      if (el) el.textContent = t("home.scan.busy", { kind: t("dash.kind." + j.kind), n: fmt(j.processed), total: j.total ? fmt(j.total) : "…" });
    } catch {}
    homeScanTimer = setTimeout(tick, 1500);
  };
  tick();
}

// ---------- Fil d'activité
const CHAN_SHORT = { gmail: "Gmail", whatsapp: "WhatsApp", telegram: "Telegram", drive: "Drive", threads: "", app: "Molinova" };
function activityText(a) {
  const p = a.params || {};
  const q = (s) => h(String(s ?? ""));
  const k = `${a.channel}.${a.kind}`;
  switch (k) {
    case "gmail.pass": return [tn("activity.gmail.pass", p.n, { email: q(p.email) }), p.todo ? tn("activity.gmail.todo", p.todo) : "", p.toCal ? tn("activity.gmail.toCal", p.toCal) : "", p.review ? tn("activity.gmail.review", p.review) : ""].filter(Boolean).join(" · ");
    case "gmail.jobDone": return tn("activity.gmail.jobDone", p.n, { kind: t("dash.job." + p.kind), email: q(p.email), status: t("dash.status." + p.status) }) + (p.changed != null ? ` · ${tn("dash.scan.changed", p.changed)}` : "");
    case "gmail.jobError": return p.auth ? t("activity.gmail.authError", { email: q(p.email) }) : t("activity.gmail.jobError", { kind: t("dash.job." + p.kind), email: q(p.email), error: q(p.error) });
    case "whatsapp.pass": return [tn("activity.wa.pass", p.windows, { chats: fmt(p.chats) }), p.flagged ? tn("activity.wa.flagged", p.flagged) : ""].filter(Boolean).join(" · ");
    case "whatsapp.proposal": return p.kind === "task" ? t("activity.wa.task", { text: q(p.text), chat: q(p.chat) }) : t("activity.wa.event", { text: q(p.text), chat: q(p.chat) });
    case "whatsapp.error": return t("activity.wa.error", { error: q(p.error) });
    case "telegram.effect": return t("activity.tg.effect", { who: q(p.who), text: q(p.text) });
    case "telegram.eventCreated": return t("activity.tg.eventCreated", { who: q(p.who), label: q(p.label) });
    case "telegram.taskDone": return t("activity.tg.taskDone", { who: q(p.who), title: q(p.title) });
    case "telegram.messageSent": return t("activity.tg.messageSent", { who: q(p.who), to: q(p.to) });
    case "telegram.documentSent": return t("activity.tg.documentSent", { who: q(p.who), name: q(p.name) });
    case "telegram.followUpSent": return t("activity.tg.followUpSent", { to: q(p.to) });
    case "telegram.morning": return t("activity.tg.morning");
    case "telegram.weekly": return (p.contacts || []).length ? t("activity.tg.weeklyFamily", { names: q((p.contacts || []).join(", ")) }) : t("activity.tg.weekly");
    case "telegram.reminders": return tn("activity.tg.reminders", p.n);
    case "telegram.paired": return t("activity.tg.paired", { name: q(p.name) });
    case "telegram.contactPaired": return t("activity.tg.contactPaired", { name: q(p.name) });
    case "telegram.relatives": return tn("activity.tg.relatives", p.n);
    case "drive.scan": return t("activity.drive.scan", { email: q(p.email), docs: fmt(p.docs), folders: fmt(p.folders) });
    case "drive.pass": return tn("activity.drive.pass", p.changed, { email: q(p.email) });
    case "drive.error": return t("activity.drive.error", { email: q(p.email), error: q(p.error) });
    case "drive.classified": return tn("activity.drive.classified", p.n, { email: q(p.email) }) + (p.errors ? " · " + tn("drive.cards.errors", p.errors) : "");
    case "app.declutter": return tn("activity.declutter", p.n, { kept: fmt(p.kept) });
    case "app.sweep": return t("activity.sweep", { list: [["codes", p.codes], ["signins", p.signins], ["past", p.past], ["read", p.read], ["archived", p.archived]].filter(([, n]) => n > 0).map(([k, n]) => tn("activity.sweep." + k, n)).join(", ") });
    case "threads.check": return [p.followUp ? tn("activity.threads.followUp", p.followUp) : "", p.reopened ? tn("activity.threads.reopened", p.reopened) : ""].filter(Boolean).join(" · ");
    default: return q(k);
  }
}
function activityHref(a) {
  const k = `${a.channel}.${a.kind}`;
  if (k === "gmail.pass") return a.params?.todo ? "#actions" : a.params?.review ? "#classify" : "#mail";
  if (k.startsWith("gmail.")) return "#channel/gmail";
  if (k === "whatsapp.proposal") return "#agenda/whatsapp";
  if (k.startsWith("whatsapp.")) return "#channel/whatsapp";
  if (k === "threads.check") return "#actions";
  if (k === "app.sweep") return "#mail/past";
  if (k.startsWith("drive.")) return "#channel/drive";
  if (k === "telegram.effect" || k === "telegram.eventCreated" || k === "telegram.taskDone") return "#agenda";
  return "#channel/telegram";
}
function feedWhen(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `${t("time.yesterday")} ${fmtTime(d)}`;
  return fmtDate(d, { day: "numeric", month: "short" });
}
function feedHtml() {
  if (!HOME.activity.length) return `<div class="small muted" style="padding:6px 2px">${t("home.feed.empty")}</div>`;
  return HOME.activity.map((a) => `<a class="hfeed-row" href="${activityHref(a)}"><span class="hwhen">${h(feedWhen(a.at))}</span><span class="hchan ${h(a.channel)}">${h(CHAN_SHORT[a.channel] ?? a.channel) || t("home.live.threads")}</span><span class="htext">${activityText(a)}</span></a>`).join("") +
    (HOME.expanded && HOME.more ? `<button class="btn sm ghost" data-hact="more" style="align-self:flex-start;margin-top:6px">${t("home.feed.more")}</button>` : "");
}
function homeFeed() {
  return `<section class="col" style="gap:8px"><div class="row" style="align-items:baseline"><div class="mono">${t("home.feed.title")}</div><a href="#" class="small" data-hact="expand" id="hfeed-expand" style="margin-left:auto" hidden></a></div><div class="hfeed" id="hfeed">${feedHtml()}</div></section>`;
}

/**
 * Le fil s'arrête au bas du bloc de gauche (en direct, à faire, ce qui en sort) : les deux colonnes finissent
 * ensemble. Sur une colonne unique (petit écran), les FEED_SHORT derniers. « Tout voir » déplie le reste.
 */
const FEED_SHORT = 8;
function fitFeed() {
  const feed = $("#hfeed"), left = $(".homegrid > .col:first-child"), btn = $("#hfeed-expand");
  if (!feed || !left || !btn) return;
  const rows = [...feed.querySelectorAll(".hfeed-row")];
  rows.forEach((r) => (r.hidden = false));
  btn.hidden = !HOME.expanded;
  btn.textContent = t("home.feed.less");
  if (HOME.expanded || !rows.length) return;
  const oneColumn = getComputedStyle($(".homegrid")).gridTemplateColumns.split(" ").length < 2;
  let keep = rows.length;
  if (oneColumn) keep = Math.min(rows.length, FEED_SHORT);
  else {
    const limit = left.getBoundingClientRect().bottom + 1;
    keep = rows.findIndex((r) => r.getBoundingClientRect().bottom > limit);
    if (keep < 0) keep = rows.length;
    keep = Math.max(1, keep);
  }
  rows.slice(keep).forEach((r) => (r.hidden = true));
  const hidden = rows.length - keep;
  if (hidden > 0 || HOME.more) { btn.hidden = false; btn.textContent = t("home.feed.all"); }
}
window.addEventListener("resize", () => { if (currentPage() === "home") fitFeed(); });

// ---------- gestes de l'Accueil
function bindHome() {
  const root = $("#home");
  // Une seule fois par page : deux rendus rapprochés programment chacun bindHome sur le même #home, et un clic lancerait l'action deux fois.
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-hact]");
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.hact, id = Number(b.dataset.id), n = Number(b.dataset.n);
    if (act === "expand") { HOME.expanded = !HOME.expanded; $("#hfeed").innerHTML = feedHtml(); fitFeed(); return; }
    if (act === "more") {
      const last = HOME.activity[HOME.activity.length - 1];
      try { const more = await api(`/activity?limit=${FEED_PAGE}&before=${last.id}`); HOME.activity.push(...more); HOME.more = more.length === FEED_PAGE; $("#hfeed").innerHTML = feedHtml(); } catch (err) { toast(err.message); }
      return;
    }
    let sampleMax = null;
    if (act === "backfill") {
      const ok = await gmailCostOk({ kind: "backfill", accountId: id, period: "all", onlyNew: true }, (LIVE.channels.gmail.accounts.find((x) => x.id === id) || {}).email || "");
      if (!ok) return;
      sampleMax = ok.max;
    }
    if (act === "apply" && !confirm(tn("dash.confirm.apply", n, { prefix: TAX.prefix }))) return;
    HOME.busy = true; b.disabled = true;
    try {
      if (act === "backfill") { await api("/jobs", { method: "POST", body: { kind: "backfill", accountId: id, period: "all", onlyNew: true, ...(sampleMax != null ? { max: sampleMax } : {}) } }); toast(t("dash.toast.backfill")); }
      else if (act === "watch") { await api("/jobs", { method: "POST", body: { kind: "watch", accountId: id } }); toast(t("dash.toast.watch")); }
      else if (act === "apply") { const r = await api("/labels/apply-pending", { method: "POST", body: { accountId: id } }); toast(tn("dash.toast.applied", r.n)); }
      else if (act === "tgstart") { await api("/telegram/enable", { method: "POST" }); toast(t("telegram.toast.listening")); }
    } catch (err) { toast(err.message); }
    HOME.busy = false;
    refreshLive();
  });
}
