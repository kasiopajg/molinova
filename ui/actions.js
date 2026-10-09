/* Vue « Actions » : la file de travail, filtrable par importance et par libellé, traitée par paquets.
   Un email sort de la file quand l'outil le constate (répondu, lu, archivé, événement créé) ou sur « Ignorer ».
   Textes : ui/lang/<langue>/actions.js (et quelques mail.* partagés avec le volet de lecture). */

const ACT = { imp: "", cats: [], date: "", account: "", rows: [], total: 0, noise: 0, counts: null, selected: new Set(), showAll: false };
const GROUP_ORDER = ["important", "reply", "followUp", "toPay", "event", "task", "read"];
const IMP_KEYS = ["", "urgent", "high", "normal", "low", "obsolete"];
// Titre de groupe, verbe de ligne et libellé d'importance : résolus au rendu, dans la langue courante.
const groupTitle = (g) => t("actions.group." + g);
const verbOf = (g) => t("actions.verb." + g);
const impLabel = (v) => (v ? t("prio." + v) : t("common.all"));

function impOf(r, th) {
  if (r.obsolete) return "obsolete";
  const s = prioScore(r) ?? 1;
  return s >= th.urgent ? "urgent" : s >= th.high ? "high" : s >= th.normal ? "normal" : "low";
}
/** « Obsolète » n'est pas un niveau de la file : c'est un autre ensemble (sorti de la file), avec son archivage en bloc. */
function actFilter() {
  const base = ACT.imp === "obsolete" ? ["obsolete"] : ["queue", ACT.imp && "imp:" + ACT.imp];
  return [...base, ACT.cats.length && "cat:" + ACT.cats.join(","), ACT.date && "date:" + ACT.date].filter(Boolean).join("+");
}

async function loadActions() {
  const p = new URLSearchParams({ filter: actFilter(), limit: "200", sort: "priority" });
  const cp = new URLSearchParams();
  if (ACT.imp && ACT.imp !== "obsolete") cp.set("imp", ACT.imp);
  if (ACT.cats.length) cp.set("cat", ACT.cats.join(","));
  if (ACT.date) cp.set("date", ACT.date);
  if (ACT.account) { p.set("account", ACT.account); cp.set("account", ACT.account); }
  const np = new URLSearchParams({ filter: "noise", limit: "1" }); if (ACT.account) np.set("account", ACT.account);
  const rp = new URLSearchParams({ filter: "review", limit: "1" }); if (ACT.account) rp.set("account", ACT.account);
  const [r, counts, noise, review] = await Promise.all([api("/mail?" + p), api("/actions/counts?" + cp), api("/mail?" + np), api("/mail?" + rp)]);
  ACT.counts = counts; ACT.total = r.total; ACT.noise = noise.total; ACT.review = review.total;
  // Groupés par verbe, du plus urgent au moins urgent ; dans un groupe, l'ordre du serveur (priorité Jev, puis date).
  ACT.rows = r.rows.map((x, i) => [x, i]).sort((a, b) => GROUP_ORDER.indexOf(groupOf(a[0])) - GROUP_ORDER.indexOf(groupOf(b[0])) || a[1] - b[1]).map((x) => x[0]);
  ACT.selected = new Set([...ACT.selected].filter((id) => ACT.rows.some((x) => x.id === id)));
  MAIL.rows = ACT.rows; MAIL.total = ACT.total; // pour J / K et la lecture
  badges.actions = counts.total || ""; renderNav();
  renderActions();
}

/**
 * Ce que la ligne dit : pour un élément « Agenda » ou « Tâche » dont l'IA a compris l'objet, son titre et sa date
 * (« Rendre la box internet · avant le ven. 23 oct. ») plutôt que la première phrase de la conversation. Pour un email,
 * l'objet d'origine suit en gris ; pour WhatsApp, il reste au survol.
 */
function subjectHtml(r) {
  const subj = h(r.subject || t("common.noSubject"));
  if (!r.prop_found || !r.prop_title || r.prop_kind === "invitation") return subj;
  let when = "";
  if (r.prop_kind === "task" && r.prop_due) when = t("actions.prop.due", { date: fmtDate(new Date(`${r.prop_due.slice(0, 10)}T12:00`), { weekday: "short", day: "numeric", month: "short" }) });
  else if (r.prop_start) {
    const d = new Date(r.prop_start.length === 10 ? `${r.prop_start}T12:00` : r.prop_start);
    const day = fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
    when = r.prop_all_day || r.prop_start.length === 10 ? day : `${day} · ${fmtTime(d)}`;
  }
  const head = `<b style="color:var(--ink)">${h(r.prop_title)}</b>${when ? ` <span class="pill">${h(when)}</span>` : ""}`;
  return r.source === "whatsapp" ? head : `${head} <span class="muted">· ${subj}</span>`;
}

/** Code ou alerte de connexion : un repère, et le temps qui reste avant que Molinova le sorte de la file (30 min). */
function ephChip(r) {
  const k = rawFlags(r).ephemeral;
  if (k !== "code" && k !== "signin") return "";
  const left = Math.max(1, Math.round(30 - (Date.now() - Date.parse(r.date)) / 60_000));
  return `<span class="pill strong" title="${h(t("actions.eph.hint"))}">${h(k === "code" ? t("actions.eph.code", { n: left }) : t("actions.eph.signin", { n: left }))}</span> `;
}

function renderActions() {
  if (!$("#actions")) return;
  const k = ACT.counts, th = k.thresholds;
  const all = Object.entries(k.byImp).reduce((s, [v, x]) => s + (v === "obsolete" ? 0 : x), 0);
  $("#acount").innerHTML = t("actions.head.count", { n: fmt(k.total) });
  // Bruit = encore en boîte de réception, mais sans rien à faire : ni signal, ni « à revoir », catégorie sans attention.
  $("#anoise").innerHTML = ACT.noise ? `${tn("actions.noise.count", ACT.noise)} · <a href="#mail/noise" title="${t("actions.noise.seeHint")}">${t("actions.noise.see")}</a> · <a href="#" id="anoise-go" style="font-weight:600" title="${t("actions.noise.archiveHint")}">${t("actions.noise.archive")}</a>` : "";
  // Date : se cumule avec l'importance et le libellé ; « Tout sélectionner » puis une action en lot agit sur cette période.
  $("#adate").innerHTML = dateFilterHtml(ACT.date);
  bindDateFilter($("#adate"), ACT.date, (v) => { ACT.date = v; ACT.selected.clear(); loadActions(); });
  $("#aimp").innerHTML = IMP_KEYS.filter((v) => v !== "obsolete" || k.byImp.obsolete || ACT.imp === "obsolete").map((v) => `<button class="fchip ${ACT.imp === v ? "on" : ""}" data-imp="${v}">${impLabel(v)} <b>${v ? k.byImp[v] : all}</b></button>`).join("");
  const cats = TAX.categories.filter((c) => k.byCat[c.key] || ACT.cats.includes(c.key)).sort((a, b) => (k.byCat[b.key] || 0) - (k.byCat[a.key] || 0));
  $("#acats").innerHTML = cats.map((c) => `<button class="fchip fcat ${ACT.cats.includes(c.key) ? "on" : ""}" data-cat="${c.key}" style="--cb:${c.color.background};--ct:${c.color.text}">${h(c.name)} <b>${k.byCat[c.key] || 0}</b></button>`).join("") + (k.byCat[""] ? `<button class="fchip ${ACT.cats.includes("") ? "on" : ""}" data-cat="">${t("actions.filter.review")} <b>${k.byCat[""]}</b></button>` : "") || `<span class="small muted">${t("actions.filter.none")}</span>`;

  const rowHtml = (r) => {
    const g = groupOf(r), imp = impOf(r, th), sel = ACT.selected.has(r.id);
    const c = TAX.categories.find((x) => x.key === r.category);
    const [act, label] = g === "reply" ? ["reply", verbOf("reply")] : g === "followUp" ? ["followUp", verbOf("followUp")] : g === "event" || g === "task" ? ["agenda", g === "event" ? t("actions.btn.schedule") : verbOf("task")] : ["open", t("actions.btn.open")];
    return `<div class="arow ${sel ? "sel" : ""}" data-id="${r.id}">
      <input type="checkbox" class="acb" ${sel ? "checked" : ""} aria-label="${t("actions.row.select")}">
      <span class="averb">${verbOf(g)}</span>
      <span class="afrom" title="${h(r.from_address)}">${h(whoLabel(r))}</span>
      <span class="asub" title="${h(r.subject || "")}">${ephChip(r)}${r.has_attachments ? `<span title="${t("mail.attachment")}">⌘</span> ` : ""}${subjectHtml(r)}</span>
      <span class="acatpick"><button type="button" class="acat" style="${c ? `background:${c.color.background};color:${c.color.text}` : ""}" title="${t("actions.row.changeLabel")}">${h(r.needs_review ? t("actions.filter.review") : catName(r.category))}</button></span>
      <span class="aimp ${imp === "urgent" ? "ur" : imp === "high" ? "hi" : ""}">${t("prio." + imp)}</span>
      <span class="adate">${fmtMailDate(r.date)}</span>
      <button type="button" class="btn sm aopen ${g === "important" || g === "reply" || g === "followUp" ? "ink" : ""}" data-act="${act}">${label}</button>
      <button type="button" class="btn sm ghost aopen aignore" title="${t("actions.row.ignoreHint")}">${t("actions.btn.ignore")}</button>
    </div>`;
  };
  let html = "";
  // Obsolètes : ce qu'ils sont, et un seul geste pour s'en débarrasser (archivés, jamais supprimés).
  if (ACT.imp === "obsolete" && ACT.total) html += `<div class="card col" style="gap:10px;margin:12px 0"><div class="small">${h(t("actions.obsolete.lead"))}</div><div><button class="btn signal" id="aobs-go">${h(tn("actions.obsolete.archive", ACT.total))}</button></div></div>`;
  for (const g of GROUP_ORDER) {
    let rows = ACT.rows.filter((r) => groupOf(r) === g);
    if (!rows.length) continue;
    let hidden = 0;
    // « À lire » : seuls les urgents et hauts sont dépliés d'office, le reste attend un clic.
    if (g === "read" && !ACT.showAll) { const keep = rows.filter((r) => ["urgent", "high"].includes(impOf(r, th))); if (keep.length && keep.length < rows.length) { hidden = rows.length - keep.length; rows = keep; } }
    html += `<div class="agrp"><span class="t">${groupTitle(g)}</span><span class="n">${fmt(ACT.imp === "obsolete" ? rows.length : k.groups[g] ?? rows.length)}</span>${g === "read" ? `<span class="small muted">${t("actions.group.readHint")}</span>` : ""}<span style="flex-grow:1"></span><a href="#" class="small" data-selgrp="${g}">${t("actions.group.selectAll")}</a></div>`;
    html += rows.map(rowHtml).join("");
    if (hidden) html += `<div class="amore"><span class="muted">${tn("actions.more.hidden", hidden)}</span> · <a href="#" data-showall>${t("actions.more.show")}</a></div>`;
  }
  if (!html) html = `<div class="empty" style="margin-top:12px">${ACT.imp || ACT.cats.length || ACT.date ? t("actions.empty.filter") : t("actions.empty.done")}</div>`;
  else if (ACT.total > ACT.rows.length) html += `<div class="amore muted">${t("actions.more.truncated", { shown: fmtNum(ACT.rows.length), total: fmt(ACT.total) })}</div>`;
  // Nettoyage par date (Réglages › Règles) : on dit pourquoi les vieux emails n'apparaissent plus.
  if (k.ignoreBefore) html += `<div class="amore muted">${h(t("actions.cutoff", { date: fmtDate(new Date(`${k.ignoreBefore}T12:00`), { day: "2-digit", month: "2-digit", year: "numeric" }) }))} · <a href="#rules">${h(t("actions.cutoff.link"))}</a></div>`;
  // Les emails « à classer » n'ont rien à faire ici : on dit où ils sont, sans les mélanger au travail.
  if (ACT.review) html += `<div class="amore muted">${tn("actions.classifyNote", ACT.review)} · <a href="#classify">${t("actions.classifyLink")}</a></div>`;
  $("#alist").innerHTML = html;

  const n = ACT.selected.size;
  $("#abulk").innerHTML = n ? `<div class="abulk"><b>${tn("actions.bulk.selected", n)}</b>
    <span style="flex-grow:1"></span>
    <button class="btn sm" data-bulk="read" title="${t("actions.bulk.markReadHint")}">${t("actions.bulk.markRead")}</button>
    <button class="btn sm" data-bulk="archive" title="${t("actions.bulk.archiveHint")}">${t("actions.bulk.archive")}</button>
    <button class="btn sm" data-bulk="quiet" title="${t("actions.row.ignoreHint")}">${t("actions.btn.ignore")}</button>
    <button class="btn sm" data-bulk="rejev" title="${t("common.rejevHint")}">${t("common.rejev")}</button>
    <span class="acatpick"><button class="btn sm" id="abulkcat">${t("actions.bulk.reclass")}</button></span>
    <button class="btn sm" data-rule="address" title="${t("actions.bulk.neverHint")}">${t("actions.bulk.never")}</button>
    <button class="btn sm link" data-bulk="none">${t("common.cancel")}</button></div>` : "";
}

/** Menu de catégories en pastilles, avec l'option « toujours pour ce domaine ». */
function catMenu(host, { current, domain, onPick }) {
  document.querySelectorAll(".catmenu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "catmenu";
  menu.innerHTML = `<div class="mono" style="width:100%;padding:0 4px 4px">${t("actions.catMenu.title")}</div>` +
    TAX.categories.map((c) => `<button type="button" class="fchip" data-k="${c.key}" style="background:${c.color.background};color:${c.color.text};border-color:${c.key === current ? "var(--ink)" : c.color.background};font-weight:600">${h(c.name)}</button>`).join("") +
    (domain ? `<label class="rule"><input type="checkbox" id="crule" style="width:14px;height:14px;accent-color:#1B1C1F;margin:0">${t("actions.catMenu.always", { domain: h(domain) })}</label>` : "");
  host.appendChild(menu);
  menu.addEventListener("click", (e) => e.stopPropagation());
  menu.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { const rule = !!menu.querySelector("#crule")?.checked; menu.remove(); onPick(b.dataset.k, rule); }));
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", close); } };
  setTimeout(() => document.addEventListener("click", close));
}

/** Ouvre l'email dans un volet à droite, avec le volet de lecture de la Boîte ; `act` déclenche tout de suite un geste. */
async function openActionsMail(id, act) {
  if (act === "agenda") { AG.focusId = id; location.hash = "#agenda"; return; }
  closeDrawer();
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><aside class="drawer adrawer"><div id="mailread" class="mread"></div></aside>`);
  $(".drawer-bg").onclick = () => { closeDrawer(); loadActions(); };
  await selectMail(id);
  if (act && act !== "open") $(`#mailread [data-act=${act}]`)?.click();
}

/** « Ignorer » sur une ligne : sort de la file et marque lu dans Gmail, rien d'autre. */
async function ignoreAction(id) {
  try { await api(`/actions/${id}/state`, { method: "POST", body: { state: 2 } }); toast(t("mail.toast.ignored")); ACT.selected.delete(id); loadActions(); refreshWa?.(); } catch (e) { toast(e.message); }
}

async function bulkActions(action, category) {
  const ids = [...ACT.selected];
  if (!ids.length) return;
  const what = action === "category" ? t("mail.confirm.category", { name: catName(category) }) : t("mail.confirm." + action);
  if (!confirm(tn("mail.confirm.bulk", ids.length, { what }))) return;
  try { const r = await api("/mail/bulk", { method: "POST", body: { ids, action, category } }); toast(tn("mail.toast.processed", r.n)); ACT.selected.clear(); await loadActions(); } catch (e) { toast(e.message); }
}

function bindActions() {
  const root = $("#actions");
  root.addEventListener("change", (e) => {
    if (e.target.classList.contains("acb")) { const id = Number(e.target.closest(".arow").dataset.id); if (e.target.checked) ACT.selected.add(id); else ACT.selected.delete(id); renderActions(); }
    if (e.target.id === "aacc") { ACT.account = e.target.value; ACT.selected.clear(); loadActions(); }
  });
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-imp], [data-cat], [data-selgrp], [data-showall], .acat, .aopen, [data-bulk], [data-rule], #abulkcat, #anoise-go, #aobs-go, .arow");
    if (!el) return;
    if (el.matches("[data-imp]")) { ACT.imp = el.dataset.imp; return loadActions(); }
    if (el.matches("[data-cat]")) { const k = el.dataset.cat; ACT.cats = ACT.cats.includes(k) ? ACT.cats.filter((x) => x !== k) : [...ACT.cats, k]; return loadActions(); }
    if (el.matches("[data-selgrp]")) { e.preventDefault(); const g = el.dataset.selgrp; const ids = ACT.rows.filter((r) => groupOf(r) === g).map((r) => r.id); const allIn = ids.every((id) => ACT.selected.has(id)); ids.forEach((id) => (allIn ? ACT.selected.delete(id) : ACT.selected.add(id))); return renderActions(); }
    if (el.matches("[data-showall]")) { e.preventDefault(); ACT.showAll = true; return renderActions(); }
    if (el.matches("#anoise-go")) { e.preventDefault(); return openNoiseDialog(); }
    if (el.matches("#aobs-go")) { e.preventDefault(); return archiveObsolete(el); }
    if (el.matches("[data-bulk]")) {
      if (el.dataset.bulk === "none") { ACT.selected.clear(); return renderActions(); }
      if (el.dataset.bulk === "rejev") { if (await rejev([...ACT.selected])) { ACT.selected.clear(); renderActions(); } return; }
      return bulkActions(el.dataset.bulk);
    }
    if (el.matches("#abulkcat")) { e.stopPropagation(); return catMenu(el.parentElement, { current: "", onPick: (k) => bulkActions("category", k) }); }
    if (el.matches("[data-rule]")) {
      const ids = [...ACT.selected];
      const senders = new Set(ids.map((id) => ACT.rows.find((r) => r.id === id)?.from_address).filter(Boolean));
      if (!confirm(tn("actions.confirm.rule", senders.size, { list: [...senders].join(", ") }))) return;
      try { const r = await api("/actions/quiet-rule", { method: "POST", body: { ids, by: "address" } }); toast(`${tn("actions.toast.rules", r.rules)} · ${tn("actions.toast.outOfQueue", r.n)}`); ACT.selected.clear(); loadActions(); } catch (err) { toast(err.message); }
      return;
    }
    if (el.matches(".acat")) {
      e.stopPropagation();
      const row = ACT.rows.find((r) => r.id === Number(el.closest(".arow").dataset.id));
      return catMenu(el.parentElement, { current: row.category, domain: (row.from_address || "").split("@")[1], onPick: async (k, makeRule) => {
        if (k === row.category && !makeRule) return;
        try { await api(`/items/${row.id}/category`, { method: "POST", body: { category: k, makeRule, apply: !!row.applied_at } }); toast(makeRule ? t("actions.toast.categoryRule", { name: catName(k) }) : catName(k)); loadActions(); } catch (err) { toast(err.message); }
      } });
    }
    if (el.matches(".aignore")) { e.stopPropagation(); return ignoreAction(Number(el.closest(".arow").dataset.id)); }
    if (el.matches(".aopen")) { e.stopPropagation(); return openActionsMail(Number(el.closest(".arow").dataset.id), el.dataset.act); }
    if (el.matches(".arow") && !e.target.closest(".acb, .acatpick, .catmenu")) return openActionsMail(Number(el.dataset.id));
  });
}
/** Archive tous les obsolètes du filtre courant, en un appel Gmail par compte ; le bouton dit que ça travaille. */
async function archiveObsolete(b) {
  const p = new URLSearchParams({ filter: actFilter() }); if (ACT.account) p.set("account", ACT.account);
  const ids = await api("/mail/ids?" + p);
  if (!ids.length) return loadActions();
  if (!confirm(tn("actions.obsolete.confirm", ids.length))) return;
  b.disabled = true; b.textContent = t("actions.obsolete.busy");
  try { const r = await api("/mail/bulk", { method: "POST", body: { ids, action: "archive" } }); toast(tn("actions.noise.toast.archived", r.n)); ACT.imp = ""; }
  catch (err) { toast(err.message); }
  loadActions();
}
/** Modale « Archiver le bruit » : dit ce qu'est le bruit, montre ce qui va partir, explique ce qu'archiver change. */
async function openNoiseDialog() {
  const p = new URLSearchParams({ filter: "noise" }); if (ACT.account) p.set("account", ACT.account);
  const quiet = TAX.categories.filter((c) => !c.attention);
  const [ids, sample, ...perCat] = await Promise.all([
    api("/mail/ids?" + p),
    api("/mail?" + new URLSearchParams({ ...Object.fromEntries(p), limit: "6", sort: "date" })),
    ...quiet.map((c) => api("/mail?" + new URLSearchParams({ ...Object.fromEntries(p), filter: "noise+cat:" + c.key, limit: "1" }))),
  ]);
  const n = ids.length;
  if (!n) { toast(t("actions.noise.none")); return loadActions(); }
  const byCat = quiet.map((c, i) => [c, perCat[i].total]).filter(([, cnt]) => cnt > 0).sort((a, b) => b[1] - a[1]);
  const counted = byCat.reduce((s, [, cnt]) => s + cnt, 0);
  const html = `<div class="drawer-bg"></div><div class="dlg" role="dialog" aria-modal="true" id="noisedlg">
    <div><div class="kicker">${t("actions.noise.kicker")}</div><h2 style="margin-top:6px">${tn("actions.noise.title", n)}<span class="stop">.</span></h2></div>
    <p style="margin:0">${t("actions.noise.lead", { cats: quiet.map((c) => `<span class="chip">${h(c.name)}</span>`).join(" ") })}</p>
    <div class="grid" style="grid-template-columns:1fr 1.4fr;gap:22px;align-items:start">
      <div><div class="mono" style="letter-spacing:.06em;margin-bottom:8px">${t("actions.noise.byCat")}</div>
        ${byCat.map(([c, cnt]) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--g100)">${chip(c.key)}<span class="num">${fmt(cnt)}</span></div>`).join("")}
        ${counted < n ? `<div class="row" style="justify-content:space-between;padding:6px 0"><span class="muted small">${t("actions.noise.uncategorized")}</span><span class="num">${fmt(n - counted)}</span></div>` : ""}</div>
      <div><div class="mono" style="letter-spacing:.06em;margin-bottom:8px">${t("actions.noise.recent")}</div>
        ${sample.rows.map((r) => `<div style="padding:6px 0;border-bottom:1px solid var(--g100);font-size:13px"><div class="row" style="gap:8px"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(r.from_name || r.from_address)}</b><span class="muted mono" style="margin-left:auto;flex-shrink:0">${fmtMailDate(r.date)}</span></div><div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(r.subject || t("common.noSubject"))}</div></div>`).join("")}
        ${n > sample.rows.length ? `<div class="small muted" style="padding-top:8px">${tn("actions.noise.others", n - sample.rows.length)} · <a href="#mail/noise" id="noise-see">${t("actions.noise.seeAll")}</a></div>` : ""}</div>
    </div>
    <p class="small muted" style="margin:0">${t("actions.noise.explain")}</p>
    <div class="foot"><span class="spacer"></span><button class="btn ghost" id="noise-cancel">${t("common.cancel")}</button><button class="btn signal" id="noise-go">${tn("actions.noise.go", n)}</button></div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  const close = () => document.querySelectorAll("#noisedlg, .drawer-bg").forEach((e) => e.remove());
  $("#noise-cancel").onclick = close; $(".drawer-bg").onclick = close; $("#noise-see")?.addEventListener("click", close);
  $("#noise-go").onclick = async () => {
    $("#noise-go").disabled = true; $("#noise-go").textContent = t("actions.noise.busy");
    try { const r = await api("/mail/bulk", { method: "POST", body: { ids, action: "archive" } }); close(); toast(tn("actions.noise.toast.archived", r.n)); loadActions(); }
    catch (err) { close(); toast(err.message); }
  };
  $("#noise-go").focus();
}
// Échap ferme le volet : la liste se rafraîchit, car lire un email peut l'avoir sorti de la file.
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#actions") && $(".adrawer")) setTimeout(loadActions, 0); });

/**
 * « Actualiser » : fils de discussion, emails lus ou archivés ailleurs, propositions sans date encore lues, puis le
 * nettoyage (codes expirés, échéances passées). `loud` : clic sur le bouton, on dit toujours le résultat.
 */
let ACT_AUTO = null;
async function refreshActionsNow(loud) {
  const b = $("#arefresh");
  if (b) { b.disabled = true; b.textContent = t("actions.refresh.busy"); }
  try {
    const s = await api("/actions/refresh", { method: "POST", body: {} });
    const out = (s.codes || 0) + (s.signins || 0) + (s.past || 0) + (s.read || 0) + (s.archived || 0);
    if (s.replied || s.followUp || s.reopened || s.answered) toast(t("actions.toast.threads", { replied: fmtNum(s.replied), followUp: fmtNum(s.followUp), reopened: fmtNum(s.reopened), answered: s.answered ? t("actions.toast.threadsAnswered", { n: fmtNum(s.answered) }) : "" }));
    else if (out) toast(tn("actions.refresh.done", out));
    else if (loud) toast(t("actions.refresh.nothing"));
    if (out || s.replied || s.followUp || s.reopened || s.answered || loud) await loadActions();
    if ($("#arefreshed")) $("#arefreshed").textContent = t("actions.refresh.at", { time: fmtTime(new Date()) });
  } catch (e) { if (loud) toast(e.message); }
  finally { const b2 = $("#arefresh"); if (b2) { b2.disabled = false; b2.textContent = t("actions.refresh.btn"); } }
}

views.actions = async (rest = []) => {
  const o = await api("/overview");
  TAX = o.taxonomy;
  // #actions/whatsapp : la file limitée à ce qui vient de WhatsApp.
  const fromWa = rest[0] === "whatsapp";
  if (fromWa) { if (!WA.accountId) await refreshWa(); ACT.account = WA.accountId ? String(WA.accountId) : ""; } else if (ACT.account && String(ACT.account) === String(WA.accountId)) ACT.account = "";
  MAIL.mode = "actions"; MAIL.filter = "queue"; MAIL.selected = null; MAIL.full = null; MAIL.reload = loadActions;
  ACT.selected.clear(); ACT.showAll = false;
  setTimeout(async () => {
    bindActions();
    await loadActions();
    // Ce que tu as fait ailleurs, et ce qui a vieilli : un passage à l'ouverture, puis toutes les 30 minutes tant que la page est ouverte.
    refreshActionsNow(false);
    clearInterval(ACT_AUTO);
    ACT_AUTO = setInterval(() => {
      if (currentPage() !== "actions") { clearInterval(ACT_AUTO); return; }
      if (document.hidden || document.querySelector(".drawer, .dlg, .adrawer") || ACT.selected.size) return;
      refreshActionsNow(false);
    }, 30 * 60_000);
    $("#arefresh")?.addEventListener("click", () => refreshActionsNow(true));
  });
  return `<div class="actions" id="actions">
    <div class="ahead"><h1 style="font-size:30px">${fromWa ? t("actions.head.fromWhatsApp") : t("nav.actions")}<span class="stop">.</span></h1>${fromWa ? '<span class="srcchip"><span class="dotwa" style="margin:0"></span>WhatsApp</span>' : ""}<span class="muted" id="acount"></span><span style="flex-grow:1"></span>
      ${o.accounts.length > 1 ? `<select id="aacc" style="height:34px;width:auto"><option value="">${t("actions.sources.all")}</option>${o.accounts.map((a) => `<option value="${a.id}" ${String(a.id) === String(ACT.account) ? "selected" : ""}>${a.source === "whatsapp" ? "WhatsApp" : h(a.email)}</option>`).join("")}</select>` : ""}
      <span class="small muted" id="anoise"></span><span class="small muted" id="arefreshed" title="${h(t("actions.refresh.hint"))}"></span><button class="btn sm" id="arefresh" title="${h(t("actions.refresh.hint"))}">${h(t("actions.refresh.btn"))}</button></div>
    <div class="afilters">
      <div class="fgroup"><span class="mono flabel">${t("actions.filter.importance")}</span><span class="fgroup" id="aimp"></span></div>
      <div class="fgroup"><span class="mono flabel">${t("common.label")}</span><span class="fgroup" id="acats"></span></div>
      <div class="fgroup" id="adate"></div>
    </div>
    <div id="abulk"></div>
    <div id="alist"></div>
  </div>`;
};
