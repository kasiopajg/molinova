/* Canaux › Google Drive : donner le droit de lecture, choisir les dossiers et les formats, suivre l'index,
   classer le contenu (la fiche de chaque document, coût montré avant) et retrouver un document. Rien n'est jamais écrit dans Drive.
   Textes : ui/lang/<langue>/drive.js (clés drive.*). */

const DRV = { acc: null, st: null, google: { project: null, apiUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com" }, open: new Set(), q: "", poll: null, tax: null, hits: [], deep: false, edit: null };
const onDrivePage = () => location.hash.startsWith("#channel/drive");

async function viewDrive(sel) {
  let st;
  try { st = await api("/drive/status"); } catch (e) { return head("", t("drive.head.kicker"), t("drive.head.title"), h(e.message)); }
  const accs = st.accounts;
  if (st.google) DRV.google = st.google;
  const lead = t("drive.head.lead");
  if (!accs.length) {
    return head("", t("drive.head.kicker"), t("drive.head.title"), lead) +
      `<div class="card col" style="gap:8px"><h3>${h(t("drive.noGoogle.title"))}</h3><div class="small muted">${h(t("drive.noGoogle.text"))}</div><div><a class="btn ink" href="#channel/gmail">${h(t("drive.noGoogle.cta"))}</a></div></div>`;
  }
  const cur = accs.find((a) => String(a.id) === String(sel)) || accs.find((a) => a.id === DRV.acc) || accs.find((a) => a.enabled) || accs.find((a) => a.scope) || accs[0];
  if (DRV.acc !== cur.id) DRV.open.clear();
  DRV.acc = cur.id; DRV.st = cur;

  setTimeout(() => driveBind(cur));
  clearTimeout(DRV.poll);
  // Une lecture tourne (sur ce compte ou un autre) : la page suit jusqu'à la fin, sans rechargement manuel.
  if (accs.some((a) => a.busy)) DRV.poll = setTimeout(() => { if (onDrivePage() && !document.querySelector(".drawer, .dlg")) route(); }, 2500);
  // Un classement tourne : seul le bloc des fiches se met à jour, la recherche en cours reste à l'écran.
  else if (accs.some((a) => a.cards?.job && !a.cards.job.finishedAt)) DRV.poll = setTimeout(driveCardsTick, 3000);

  const apiErr = cur.scope && cur.errorCode === "drive.apiDisabled" ? driveApiError(cur) : "";
  const body = apiErr + (!cur.scope ? driveSetup(cur) : cur.root ? driveScope(cur) : apiErr ? "" : driveFirstRead(cur));
  return head("", t("drive.head.kicker"), t("drive.head.title"), lead) +
    `<div class="drv-accs">${accs.map((a) => driveAccCard(a, a.id === cur.id)).join("")}</div>${body}${driveNever(cur)}`;
}

/** L'état d'une boîte, en une ligne. */
function driveLine(a) {
  if (!a.scope) return h(t("drive.acc.noScope"));
  if (a.busy) return h(a.busy.phase === "list" ? t("drive.acc.listing", { n: fmt(a.busy.n) }) : t("drive.acc.changes"));
  if (a.error) return `<span style="color:var(--signal);font-weight:600">${h(a.error)}</span>`;
  if (!a.enabled) return h(t("drive.acc.paused"));
  if (!a.syncedAt) return h(t("drive.acc.waiting"));
  return h([tn("drive.acc.docs", a.docs), t("drive.acc.read", { ago: ago(a.syncedAt) }), a.nextAt ? t("drive.acc.next", { in: until(Date.parse(a.nextAt)) }) : ""].filter(Boolean).join(" · "));
}
function driveAccCard(a, on) {
  const led = !a.scope ? "off" : a.error ? "err" : a.enabled ? "on" : "off";
  const btns = !a.scope ? "" : a.enabled
    ? `<button class="btn sm drsync" data-id="${a.id}" ${a.busy ? "disabled" : ""}>${h(t("drive.btn.sync"))}</button><button class="btn sm ghost drpause" data-id="${a.id}" data-on="0">${h(t("drive.btn.pause"))}</button>`
    : `<button class="btn sm ink drpause" data-id="${a.id}" data-on="1">${h(t("drive.btn.resume"))}</button>`;
  return `<a class="card col drv-acc ${on ? "on" : ""}" href="#channel/drive/${a.id}" style="gap:8px">
    <div class="row" style="align-items:center;gap:10px"><span class="led ${led}"></span><b>${h(a.email)}</b>${a.scope ? `<span class="st ok" style="margin-left:auto">${h(t("drive.acc.readOnly"))}</span>` : ""}</div>
    <div class="small" style="color:var(--g800)">${driveLine(a)}</div>
    ${btns ? `<div class="row" style="gap:8px">${btns}</div>` : ""}
  </a>`;
}

// ---------- avant l'accès : activer l'API dans son projet Google, puis autoriser la lecture (même forme que l'assistant)
/** « (n° 1234…) » : le projet Google de Molinova, lu dans l'identifiant du client OAuth ; rien si on ne le connaît pas. */
const driveProjectNote = () => (DRV.google.project ? t("drive.api.projectNote", { project: DRV.google.project }) : "");
const driveApiKey = () => `ea.driveApi:${DRV.google.project || ""}`;
function driveApiDone() { try { return localStorage.getItem(driveApiKey()) === "1"; } catch { return false; } }
const driveOpenApi = (cls = "ink") => `<a class="btn ${cls}" href="${h(DRV.google.apiUrl)}" target="_blank" rel="noopener">${h(t("drive.api.open"))} ↗</a>`;
/** Une liste numérotée où les lignes « – … » sont les cas d'une même étape (sous-liste), pas des étapes de plus. */
function driveSteps(text) {
  const items = [];
  for (const line of String(text).split("\n").filter((x) => x.trim())) {
    if (/^\s*–\s*/.test(line) && items.length) items[items.length - 1].subs.push(line.replace(/^\s*–\s*/, ""));
    else items.push({ text: line, subs: [] });
  }
  return `<ol class="gl">${items.map((it) => `<li>${richText(it.text)}${it.subs.length ? `<ul class="gl" style="margin-top:6px">${it.subs.map((x) => `<li>${richText(x)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ol>`;
}
const driveStuck = (text) => `<details class="gstuck"><summary>${h(t("setup.google.step.stuck"))}</summary>${richList(text)}</details>`;

function driveSetup(a) {
  const project = driveProjectNote();
  const apiDone = driveApiDone();
  const stepApi = apiDone
    ? `<div class="row" style="align-items:center;gap:10px"><span class="setup-ok">✓</span><span>${h(t("drive.api.doneShort"))}</span><button class="btn link" id="drapiredo">${h(t("drive.api.redo"))}</button></div>`
    : `<section class="col" style="gap:16px">
        <h3>${h(t("drive.api.title"))}</h3>
        <div class="gcols">${gsec(t("setup.google.step.do"), driveSteps(t("drive.api.do", { projectNote: project })))}${gsec(t("drive.api.goodSign"), richList(t("drive.api.see")))}</div>
        <div class="gcalm"><div class="mono">${h(t("setup.google.step.reassure"))}</div>${richList(t("drive.api.reassure"))}
          <div class="gdont"><div class="mono">${h(t("drive.api.dontTitle"))}</div>${richList(t("drive.api.dont"))}</div></div>
        <div class="gopen">${driveOpenApi()}<button class="btn" id="drapidone">${h(t("drive.api.done"))}</button></div>
        ${driveStuck(t("drive.api.stuck", { projectNote: project }))}
      </section>`;
  const stepAllow = !apiDone ? `<div class="small muted">${h(t("drive.allow.after"))}</div>` : `<section class="col" style="gap:16px">
      <h3>${h(t("drive.allow.title"))}</h3>
      ${gsec(t("setup.google.step.do"), richList(t("drive.allow.do", { email: a.email }), {}, "ol"))}
      <div class="gcalm"><div class="mono">${h(t("setup.google.step.reassure"))}</div>${richList(t("drive.allow.reassure"))}</div>
      <div class="gopen"><button class="btn ink" id="drconnect">${h(t("drive.setup.allow.btn"))}</button></div>
      <div class="card small" id="drwait" hidden style="color:var(--g800)"><b>${h(t("drive.setup.waitTitle"))}</b> ${h(t("drive.setup.waitText"))} <button class="btn link" id="drcancel">${h(t("common.cancel"))}</button></div>
      ${driveStuck(t("drive.allow.stuck", { email: a.email }))}
    </section>`;
  return `<div class="card col" style="gap:20px"><div><h2>${h(t("drive.setup.title", { email: a.email }))}</h2><div class="small muted" style="margin-top:4px">${h(t("drive.setup.note"))}</div></div>
    ${stepApi}<hr style="margin:0">${stepAllow}</div>`;
}

/** L'accès est donné, mais Google répond que l'API n'est pas activée dans le projet : la marche à suivre, et Réessayer. */
function driveApiError(a) {
  return `<div class="gwarn" style="margin-bottom:24px"><b>${h(t("drive.apiErr.title"))}</b>${richList(t("drive.apiErr.text", { projectNote: driveProjectNote() }), {}, "ol")}
    <div class="gopen">${driveOpenApi()}<button class="btn drsync" data-id="${a.id}" ${a.busy ? "disabled" : ""}>${h(t("drive.apiErr.retry"))}</button></div>
    ${driveStuck(t("drive.api.stuck", { projectNote: driveProjectNote() }))}</div>`;
}

function driveFirstRead(a) {
  const text = a.busy ? (a.busy.phase === "list" ? t("drive.first.listing", { n: fmt(a.busy.n) }) : t("drive.acc.changes")) : a.error ? a.error : a.enabled ? t("drive.first.soon") : t("drive.first.paused");
  return `<div class="card col" style="gap:8px"><h3>${h(t("drive.first.title"))}</h3><div class="small ${a.error ? "" : "muted"}" style="${a.error ? "color:var(--signal)" : ""}">${h(text)}</div>
    ${!a.busy && a.enabled ? `<div><button class="btn sm ink drsync" data-id="${a.id}">${h(t("drive.btn.syncNow"))}</button></div>` : ""}</div>`;
}

// ---------- le périmètre : dossiers lus, figés ou exclus, et formats retenus
const DRIVE_FORMATS = ["pdf", "google", "office", "text", "image"];
function driveScope(a) {
  const r = a.root;
  const fmts = DRIVE_FORMATS.map((f) => {
    const on = a.settings.formats.includes(f);
    return `<button class="btn sm ${on ? "ink" : ""} drfmt" data-f="${f}" aria-pressed="${on}">${h(t("drive.format." + f))} <span class="${on ? "" : "muted"}" style="opacity:.75">${fmt(a.formats[f] || 0)}</span></button>`;
  }).join("");
  return driveCards(a) + `<div class="row" style="align-items:flex-start;gap:24px;flex-wrap:wrap">
    <div class="card col grow" style="gap:10px;min-width:340px">
      <div class="row" style="align-items:baseline"><h3>${h(t("drive.scope.title"))}</h3><span class="small muted" id="drtotal" style="margin-left:auto">${h(t("drive.scope.total", { n: fmt(r.nScope), total: fmt(r.nDocs) }))}</span></div>
      <div class="small muted">${h(t("drive.scope.lead"))}</div>
      ${driveModesTable()}
      <div id="drroot">${driveRootRow(a)}</div>
      <div id="drtree" class="drv-tree"><div class="small muted" style="padding:8px 0">${h(t("drive.scope.loading"))}</div></div>
    </div>
    <div class="col" style="gap:24px;width:360px;max-width:100%">
      <div class="card col" style="gap:10px"><h3>${h(t("drive.formats.title"))}</h3><div class="small muted">${h(t("drive.formats.lead"))}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${fmts}</div>
        <label class="field" style="max-width:200px"><span class="mono">${h(t("drive.formats.maxMb"))}</span><input type="number" min="1" max="2000" id="drmax" value="${a.settings.maxMb}"></label></div>
      <div class="card col" style="gap:10px"><h3>${h(t("drive.search.title"))}</h3><div class="small muted">${h(t("drive.search.lead"))}</div>
        <form id="drqf" class="row" style="gap:6px"><input type="search" id="drq" class="grow" placeholder="${h(t("drive.search.ph"))}" value="${h(DRV.q)}"><button class="btn sm" type="submit" title="${h(t("drive.search.deepHint"))}">${h(t("drive.search.deep"))}</button></form>
        <div id="drhits" class="col" style="gap:0"></div></div>
    </div>
  </div>`;
}

const driveRootRow = (a) => driveFolderRow({ id: a.rootId, name: t("drive.scope.root"), mode: a.root.mode, effective: a.root.effective || "in", nDocs: a.root.nDocs, nScope: a.root.nScope, nSub: 0 }, -1);
/** Ce que chaque choix change, ligne par ligne : la recherche, la lecture du contenu (payante), les pièces jointes, le rangement. */
function driveModesTable() {
  const Y = `<td class="drv-yes">${h(t("drive.table.yes"))}</td>`, N = `<td class="muted">${h(t("drive.table.no"))}</td>`, NEVER = `<td><b>${h(t("drive.table.never"))}</b></td>`;
  const rows = [["search", Y, Y, N], ["content", Y, Y, N], ["attach", Y, Y, N], ["move", Y, NEVER, NEVER]];
  return `<details class="drv-modes" open><summary class="mono">${h(t("drive.table.title"))}</summary>
    <table class="drv-mtable"><thead><tr><th></th>${["in", "frozen", "out"].map((m) => `<th>${h(t("drive.mode." + m))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([k, ...cells]) => `<tr><th>${h(t("drive.table." + k))}</th>${cells.join("")}</tr>`).join("")}</tbody></table>
    <div class="small muted">${h(t("drive.table.today"))}</div></details>`;
}
/** Une ligne de dossier : nom, compte « lus / documents », et le choix Lu · Figé · Exclu (hérité : en clair). */
function driveFolderRow(f, depth) {
  const inherited = !f.mode;
  const seg = ["in", "frozen", "out"].map((m) => `<button class="${f.effective === m ? "on" : ""}" data-mode="${m}" title="${h(t("drive.mode." + m + ".hint"))}">${h(t("drive.mode." + m))}</button>`).join("");
  const caret = f.nSub ? `<button class="btn link drcaret" data-id="${h(f.id)}" aria-expanded="${DRV.open.has(f.id)}">${DRV.open.has(f.id) ? "▾" : "▸"}</button>` : `<span class="drv-nocaret"></span>`;
  const note = inherited ? (f.defaultOut ? t("drive.mode.defaultOut") : depth >= 0 ? t("drive.mode.inherited") : "") : depth >= 0 || f.mode ? t("drive.mode.chosen") : "";
  return `<div class="drv-row ${f.effective === "out" ? "out" : ""}" data-id="${h(f.id)}" style="padding-left:${Math.max(0, depth) * 18}px">
    ${depth >= 0 ? caret : ""}<span class="drv-name" title="${h(f.path || f.name)}">${depth < 0 ? `<b>${h(f.name)}</b>` : h(f.name)}</span>
    <span class="small muted drv-n">${h(t("drive.scope.count", { n: fmt(f.nScope), total: fmt(f.nDocs) }))}</span>
    <span class="small muted drv-note">${h(note)}${!inherited && depth >= 0 ? ` <button class="btn link drreset" title="${h(t("drive.mode.resetHint"))}">↺</button>` : ""}</span>
    <span class="seg ${inherited ? "inh" : ""}">${seg}</span>
  </div>`;
}

async function driveTree() {
  const el = $("#drtree"); if (!el || !DRV.st) return;
  const acc = DRV.acc;
  const load = async (parent, depth) => {
    const r = await api(`/drive/${acc}/folders?parent=${encodeURIComponent(parent)}`);
    let html = "";
    for (const f of r.folders) {
      html += driveFolderRow(f, depth);
      if (f.nSub && DRV.open.has(f.id)) html += await load(f.id, depth + 1);
    }
    return html;
  };
  try {
    const html = await load(DRV.st.rootId, 0);
    if (DRV.acc === acc && $("#drtree")) $("#drtree").innerHTML = html || `<div class="small muted" style="padding:8px 0">${h(t("drive.scope.empty"))}</div>`;
  } catch (e) { if ($("#drtree")) $("#drtree").innerHTML = `<div class="small" style="color:var(--signal)">${h(e.message)}</div>`; }
}

/**
 * La fiche des documents : combien sont classés, ce qui attend, le classement en cours. « Classer le contenu » montre
 * d'abord le coût (fenêtre « Avant de lancer l'IA », avec un échantillon réparti sur les dossiers et les années).
 */
function driveCards(a) {
  const c = a.cards || { inScope: 0, classified: 0, pending: 0, job: null, ocr: false };
  const job = c.job, running = job && !job.finishedAt;
  const line = running
    ? t("drive.cards.running", { done: fmt(job.done), total: fmt(job.total) }) + (job.ocr ? " · " + tn("drive.cards.ocr", job.ocr) : "")
    : [t("drive.cards.count", { n: fmt(c.classified), total: fmt(c.inScope) }), c.pending ? tn("drive.cards.pending", c.pending) : t("drive.cards.upToDate")].join(" · ");
  const last = !running && job ? `<div class="small muted">${h(job.stopped ? t("drive.cards.lastStopped", { n: fmt(job.done), ago: ago(job.finishedAt) }) : t("drive.cards.last", { n: fmt(job.done), ago: ago(job.finishedAt) }))}${job.errors ? " · " + h(tn("drive.cards.errors", job.errors)) : ""}${job.lastError ? ` <span title="${h(job.lastError)}">ⓘ</span>` : ""}</div>` : "";
  const btn = running
    ? `<button class="btn sm ghost" id="drcstop">${h(t("drive.cards.stop"))}</button>`
    : c.pending ? `<button class="btn sm ink" id="drclassify">${h(t("drive.cards.go"))}</button>` : c.classified ? `<button class="btn sm ghost" id="drredo">${h(t("drive.cards.redo"))}</button>` : "";
  return `<div class="card col" id="drcards" style="gap:8px;margin-bottom:24px">
    <div class="row" style="align-items:baseline;gap:12px;flex-wrap:wrap"><h3>${h(t("drive.cards.title"))}</h3><span class="small" style="color:var(--g800)">${h(line)}</span><span class="grow"></span>${btn}</div>
    ${running ? `<div class="bar" style="height:4px"><i style="width:${job.total ? Math.round((job.done / job.total) * 100) : 0}%"></i></div>` : ""}
    <div class="small muted">${h(t("drive.cards.lead"))}${c.ocr ? "" : " " + h(t("drive.cards.noOcr"))}${c.auto ? " " + h(t("drive.cards.auto")) : ""}</div>
    ${last}
  </div>`;
}

async function driveCardsTick() {
  if (!onDrivePage() || !$("#drcards")) return;
  let st; try { st = await api("/drive/status"); } catch { DRV.poll = setTimeout(driveCardsTick, 5000); return; }
  const a = st.accounts.find((x) => x.id === DRV.acc);
  if (!a || !$("#drcards")) return;
  DRV.st = a;
  $("#drcards").outerHTML = driveCards(a);
  driveBindCards(a);
  const running = st.accounts.some((x) => x.cards?.job && !x.cards.job.finishedAt);
  if (running) DRV.poll = setTimeout(driveCardsTick, 3000);
  else if (DRV.q) driveSearch(false);
}
function driveBindCards(a) {
  const act = async (fn) => { try { return await fn(); } catch (e) { toast(e.message); return null; } };
  $("#drclassify")?.addEventListener("click", async () => {
    const ok = await estimateThen(`/estimate/drive/${a.id}`, { method: "POST" }, (r) => ({
      title: t("cost.drive.title", { email: a.email }), what: t("cost.drive.what", { n: fmt(r.estimate.n) }), cta: t("cost.drive.cta"),
      sample: true, sampleHint: t("cost.sample.drive"),
    }));
    if (!ok || ok.max === 0) return;
    if (await act(() => api(`/drive/${a.id}/classify`, { method: "POST", body: { max: ok.max } }))) { toast(t("drive.toast.classify")); route(); }
  });
  $("#drredo")?.addEventListener("click", async () => {
    const ok = await estimateThen(`/estimate/drive/${a.id}`, { method: "POST", body: { redo: true } }, (r) => ({
      title: t("cost.drive.redoTitle", { email: a.email }), what: t("cost.drive.redoWhat", { n: fmt(r.estimate.n) }), cta: t("cost.drive.cta"),
    }));
    if (!ok || ok.max === 0) return;
    if (await act(() => api(`/drive/${a.id}/classify`, { method: "POST", body: { redo: true } }))) { toast(t("drive.toast.classify")); route(); }
  });
  $("#drcstop")?.addEventListener("click", async () => { if (await act(() => api(`/drive/${a.id}/classify/stop`, { method: "POST" }))) toast(t("drive.toast.classifyStop")); });
}

/** Une recherche : à la frappe, l'index local seul (gratuit) ; sur Entrée, Google dans le contenu et la relecture par Jev. */
async function driveSearch(deep = false) {
  const el = $("#drhits"); if (!el) return;
  const q = DRV.q.trim();
  if (!q) { el.innerHTML = ""; DRV.hits = []; return; }
  if (deep) el.innerHTML = `<div class="small muted" style="padding:6px 0">${h(t("drive.search.deepRunning"))}</div>`;
  try {
    const hits = await api(`/drive/search?account=${DRV.acc}&q=${encodeURIComponent(q)}${deep ? "&deep=1" : ""}`);
    if (DRV.q.trim() !== q || !$("#drhits")) return;
    DRV.hits = hits; DRV.deep = deep; DRV.edit = null;
    driveHits();
  } catch (e) { el.innerHTML = `<div class="small" style="color:var(--signal)">${h(e.message)}</div>`; }
}
function driveExpiry(d) {
  const date = fmtDate(new Date(d.expiry + "T12:00:00"), { day: "numeric", month: "short", year: "numeric" });
  return d.valid === 0 || d.expiry < todayYmd() ? t("drive.hit.expired", { date }) : t("drive.hit.until", { date });
}
function driveHits() {
  const el = $("#drhits"); if (!el) return;
  const chip = (x, cls = "") => (x ? `<span class="pill ${cls}" style="font-size:11.5px;padding:1px 8px">${h(x)}</span>` : "");
  el.innerHTML = (DRV.deep ? `<div class="small muted" style="padding:4px 0">${h(t("drive.search.deepNote"))}</div>` : "") + (DRV.hits.length ? DRV.hits.map((d, i) => `<div class="drv-hit" data-i="${i}">
      <a class="drv-hit-name" href="${h(d.link || "#")}" target="_blank" rel="noopener">${h(d.title || d.name)}</a>
      <span class="small muted">${d.title ? h(d.name) + " · " : ""}${h(d.path || t("drive.scope.root"))}${d.modifiedAt ? " · " + h(fmtDate(new Date(d.modifiedAt), { day: "numeric", month: "short", year: "numeric" })) : ""}</span>
      <span class="row" style="gap:4px;flex-wrap:wrap;align-items:center">${chip(d.typeName, "strong")}${chip(d.contextName)}${d.peopleNames.map((n) => chip(n)).join("")}${d.expiry ? chip(driveExpiry(d)) : ""}${d.frozen ? chip(t("drive.hit.frozen")) : ""}${d.sensitive ? chip(t("drive.hit.sensitive")) : ""}${d.classified ? "" : `<span class="small muted">${h(t("drive.hit.noCard"))}</span>`}${d.by === "user" ? `<span class="small muted">${h(t("drive.hit.corrected"))}</span>` : ""}
        <button class="btn link small drfix" data-i="${i}">${h(t("drive.hit.fix"))}</button></span>
      ${DRV.edit === i ? driveFixForm(d) : ""}
    </div>`).join("")
    : `<div class="small muted" style="padding:6px 0">${h(t("drive.search.none"))}</div>`);
}
/** Corriger une fiche : Type, Contexte, personnes. La correction devient un exemple pour Jev. */
function driveFixForm(d) {
  const tx = DRV.tax; if (!tx) return `<div class="small muted">${h(t("drive.scope.loading"))}</div>`;
  const opt = (list, cur, label) => `<option value="">—</option>` + list.map((x) => `<option value="${h(x.key)}" ${x.key === cur ? "selected" : ""}>${h(label(x))}</option>`).join("");
  const ctxLabel = (x) => (x.parent ? `${tx.contexts.find((p) => p.key === x.parent)?.name ?? ""} › ${x.name}` : x.name);
  return `<form class="drfixf col" style="gap:8px;padding:8px 0 4px">
    <div class="row" style="gap:8px;flex-wrap:wrap"><label class="field" style="min-width:160px"><span class="mono">${h(t("drive.fix.type"))}</span><select name="type">${opt(tx.types, d.type, (x) => x.name)}</select></label>
      <label class="field" style="min-width:180px"><span class="mono">${h(t("drive.fix.context"))}</span><select name="context">${opt(tx.contexts, d.context, ctxLabel)}</select></label></div>
    <div class="agrow"><span class="mono agl">${h(t("drive.fix.people"))}</span>${tx.members.map((m) => `<label class="agchk"><input type="checkbox" name="people" value="${h(m.key)}" ${d.people.includes(m.key) ? "checked" : ""}>${h(m.name)}</label>`).join("")}</div>
    <div class="row" style="gap:8px"><button class="btn sm ink" type="submit">${h(t("drive.fix.save"))}</button><button class="btn sm ghost" type="button" data-cancel>${h(t("common.cancel"))}</button><span class="small muted">${h(t("drive.fix.note"))}</span></div>
  </form>`;
}

// ---------- ce que Molinova ne fera jamais, et comment tout retirer
function driveNever(a) {
  const items = ["delete", "trash", "share", "content"].map((k) => `<li>${h(t("drive.never." + k))}</li>`).join("");
  return `<div class="card col" style="gap:8px;margin-top:24px;border-color:var(--g200)"><div class="mono">${h(t("drive.never.title"))}</div>
    <ul class="small" style="margin:0;padding-left:18px;color:var(--g800)">${items}</ul>
    <div class="small" style="color:var(--g800)">${h(t("drive.later"))}</div>
    <div class="small muted">${h(t("drive.never.revoke"))} <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">myaccount.google.com</a></div>
    ${a.scope && (a.root || a.enabled) ? `<div><button class="btn sm ghost" id="drforget" style="color:var(--signal)">${h(t("drive.btn.forget"))}</button></div>` : ""}</div>`;
}

function driveBind(a) {
  const act = async (fn) => { try { const r = await fn(); return r; } catch (e) { toast(e.message); return null; } };
  // Les boutons d'une carte de compte ne changent pas de compte : on reste où on est.
  document.querySelectorAll(".drv-acc button").forEach((b) => b.addEventListener("click", (e) => e.preventDefault()));
  document.querySelectorAll(".drsync").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    if (await act(() => api(`/drive/${b.dataset.id}/sync`, { method: "POST" }))) toast(t("drive.toast.sync"));
    route();
  }));
  document.querySelectorAll(".drpause").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    await act(() => api(`/drive/${b.dataset.id}/enable`, { method: "POST", body: { on: b.dataset.on === "1" } }));
    refreshLive(); route();
  }));
  $("#drconnect")?.addEventListener("click", async () => {
    const b = $("#drconnect"); b.disabled = true; b.textContent = t("drive.setup.allow.waiting");
    $("#drwait").hidden = false;
    try {
      const r = await api(`/drive/${a.id}/connect`, { method: "POST" });
      (r.warnings || []).forEach((w) => toast(w));
      if (r.scope) toast(t("drive.toast.connected", { email: a.email }));
      refreshLive(); route();
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = t("drive.setup.allow.btn"); if ($("#drwait")) $("#drwait").hidden = true; }
  });
  $("#drapidone")?.addEventListener("click", () => { try { localStorage.setItem(driveApiKey(), "1"); } catch {} route(); });
  $("#drapiredo")?.addEventListener("click", () => { try { localStorage.removeItem(driveApiKey()); } catch {} route(); });
  $("#drcancel")?.addEventListener("click", () => api("/accounts/add/cancel", { method: "POST" }).catch(() => {}));
  $("#drforget")?.addEventListener("click", async () => {
    if (!confirm(t("drive.confirm.forget", { email: a.email }))) return;
    if (await act(() => api(`/drive/${a.id}/index`, { method: "DELETE" }))) { toast(t("drive.toast.forgotten")); refreshLive(); route(); }
  });
  if (!a.root) return;

  driveTree();
  // Dossiers : déplier, choisir Lu · Figé · Exclu, revenir à l'héritage.
  $("#main").querySelector(".drv-tree")?.parentElement.addEventListener("click", async (e) => {
    const row = e.target.closest(".drv-row"); if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".drcaret")) { DRV.open.has(id) ? DRV.open.delete(id) : DRV.open.add(id); driveTree(); return; }
    const reset = e.target.closest(".drreset");
    const btn = e.target.closest(".seg button");
    if (!reset && !btn) return;
    const mode = reset ? null : btn.dataset.mode;
    const r = await act(() => api(`/drive/${a.id}/folders/${encodeURIComponent(id)}`, { method: "PUT", body: { mode } }));
    if (!r) return;
    DRV.st = r;
    if (id === a.rootId) { route(); return; }
    const total = $("#drtotal");
    if (total && r.root) total.textContent = t("drive.scope.total", { n: fmt(r.root.nScope), total: fmt(r.root.nDocs) });
    if ($("#drroot") && r.root) $("#drroot").innerHTML = driveRootRow(r);
    driveTree(); refreshLive();
    if (DRV.q) driveSearch();
  });
  document.querySelectorAll(".drfmt").forEach((b) => b.addEventListener("click", async () => {
    const formats = DRV.st.settings.formats.includes(b.dataset.f) ? DRV.st.settings.formats.filter((f) => f !== b.dataset.f) : [...DRV.st.settings.formats, b.dataset.f];
    if (await act(() => api(`/drive/${a.id}/settings`, { method: "PUT", body: { formats } }))) route();
  }));
  $("#drmax")?.addEventListener("change", async (e) => {
    if (await act(() => api(`/drive/${a.id}/settings`, { method: "PUT", body: { maxMb: Number(e.target.value) } }))) route();
  });
  let timer;
  $("#drq")?.addEventListener("input", (e) => { DRV.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => driveSearch(false), 200); });
  $("#drqf")?.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); DRV.q = $("#drq").value; driveSearch(true); });
  if (DRV.q) driveSearch(false);
  // Fiches : lancer (coût d'abord), arrêter.
  driveBindCards(a);
  // Résultats : corriger une fiche.
  $("#drhits")?.addEventListener("click", async (e) => {
    const fix = e.target.closest(".drfix");
    if (fix) { e.preventDefault(); const i = Number(fix.dataset.i); DRV.edit = DRV.edit === i ? null : i; if (!DRV.tax) { try { DRV.tax = await api("/drive/taxonomy"); } catch (err) { toast(err.message); } } driveHits(); return; }
    if (e.target.closest("[data-cancel]")) { DRV.edit = null; driveHits(); }
  });
  $("#drhits")?.addEventListener("submit", async (e) => {
    const f = e.target.closest(".drfixf"); if (!f) return;
    e.preventDefault();
    const d = DRV.hits[DRV.edit]; if (!d) return;
    const fd = new FormData(f);
    const body = { people: fd.getAll("people") };
    if (fd.get("type")) body.type = fd.get("type");
    if (fd.get("context")) body.context = fd.get("context");
    if (await act(() => api(`/drive/${d.accountId}/docs/${encodeURIComponent(d.id)}/card`, { method: "PUT", body }))) { toast(t("drive.toast.fixed")); DRV.edit = null; driveSearch(DRV.deep); }
  });
}
