/* Sources › WhatsApp : brancher (prérequis vérifiés), puis choisir les conversations que l'agent écoute.
   Tout est lu depuis la copie locale de la base WhatsApp Desktop ; aucun appel IA sur cette page.
   Textes : ui/lang/<langue>/whatsapp.js (clés whatsapp.*) ; le « il y a … » vient de ago() dans i18n.js. */

const WAV = { filter: "active", q: "", days: 30, chats: [], st: null };

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = fmtTime(d);
  if (sameDay) return time;
  if (d.toDateString() === yest.toDateString()) return `${t("time.yesterday")} ${time}`;
  if (now - d < 6 * 86400000) return `${fmtDate(d, { weekday: "short" })} ${time}`;
  return fmtDate(d, { day: "numeric", month: "short" });
}
const check = (ok, pending) => `<span class="pill ${ok ? "strong" : ""}" style="width:28px;text-align:center;flex-shrink:0">${ok ? "✓" : pending ? "…" : "✗"}</span>`;

/** Écouter une conversation lit son historique au prochain passage : le coût d'abord. Résout true pour l'écouter. */
function waCostOk(chat) {
  return estimateThen(`/estimate/whatsapp/${chat.pk}`, {}, (r) => ({
    title: t("cost.wa.title", { name: chat.name }),
    what: r.historyDays ? t("cost.wa.what", { messages: fmt(r.messages), days: r.historyDays, n: fmt(r.estimate.n) }) : t("cost.wa.whatSince", { messages: fmt(r.messages), n: fmt(r.estimate.n) }),
    cta: t("cost.wa.cta"),
  }));
}

async function viewWhatsApp() {
  let st;
  // probe=1 : c'est ici seulement (et au branchement) que Molinova regarde le dossier de WhatsApp.
  try { st = await api("/whatsapp/status?probe=1"); } catch (e) { return head("", t("whatsapp.head.kicker"), t("whatsapp.head.title"), e.message); }
  WAV.st = st;
  if (!st.enabled && st.supported === false) return waUnsupported();
  return st.enabled ? waMain(st) : waSetup(st);
}

// ---------- hors macOS : WhatsApp Desktop n'y est pas lisible, les prérequis n'ont pas de sens
function waUnsupported() {
  return head("", t("whatsapp.head.kickerAdd"), t("whatsapp.head.title"), t("whatsapp.unsupported.lead")) +
    `<div class="card col" style="gap:6px"><h3>${t("whatsapp.unsupported.title")}</h3><div class="small muted">${t("whatsapp.unsupported.text")}</div></div>`;
}

// ---------- avant le branchement : trois prérequis, vérifiés par l'app
function waSetup(st) {
  const fresh = st.dbUpdatedAt && Date.now() - new Date(st.dbUpdatedAt).getTime() < 6 * 3600000;
  const canPlug = st.dbFound && st.schemaOk !== false;
  // macOS attend une réponse sur l'accès au dossier de WhatsApp : on revérifie tant qu'on est sur cet écran.
  if (st.probing) setTimeout(() => { if (location.hash.startsWith("#channel/whatsapp")) route(); }, 3000);
  setTimeout(() => {
    $("#waplug")?.addEventListener("click", async () => {
      const b = $("#waplug"); b.disabled = true; b.textContent = t("whatsapp.btn.plugging");
      toast(t("whatsapp.toast.macosPrompt"));
      // Si la copie traîne, c'est presque toujours la fenêtre macOS qui attend une réponse : on le dit sur la ligne concernée.
      const hint = setTimeout(() => { const el = $("#wamacos"); if (el) { el.textContent = t("whatsapp.status.macosWaiting"); el.style.color = "var(--signal)"; } b.textContent = t("whatsapp.btn.macosWaiting"); }, 5000);
      try { await api("/whatsapp/enable", { method: "POST" }); clearTimeout(hint); toast(t("whatsapp.toast.plugged")); renderFoot(); route(); }
      catch (e) { clearTimeout(hint); toast(e.message); b.disabled = false; b.textContent = t("whatsapp.btn.plug"); }
    });
    $("#warecheck")?.addEventListener("click", () => route());
  });
  const row = (ok, pending, title, how, state, id = "") => `<div class="task" style="grid-template-columns:28px 1fr auto;align-items:flex-start">${check(ok, pending)}<span><b>${title}</b><div class="small muted">${how}</div></span><span class="small ${ok ? "muted" : ""}" ${id ? `id="${id}"` : ""} style="color:${ok ? "" : pending ? "var(--g600)" : "var(--signal)"};white-space:nowrap">${state}</span></div>`;
  const store = `<a href="https://apps.apple.com/app/whatsapp-messenger/id310633997" target="_blank" rel="noopener">Mac App Store</a>`;
  return head("", t("whatsapp.head.kickerAdd"), t("whatsapp.head.title"), t("whatsapp.head.leadSetup"), `<button class="btn" id="warecheck">${t("whatsapp.btn.recheck")}</button>`) +
    `<div class="row">
      <div class="card grow col" style="gap:4px"><h3>${t("whatsapp.setup.title")}</h3><div class="small muted" style="margin-bottom:8px">${t("whatsapp.setup.note")}</div>
        <div class="tasks">
          ${row(st.appInstalled, false, t("whatsapp.setup.app.title"), t("whatsapp.setup.app.how", { store }), st.appInstalled ? t("whatsapp.setup.app.found") : t("whatsapp.setup.app.missing"))}
          ${row(st.dbFound, !st.appInstalled, t("whatsapp.setup.phone.title"), t("whatsapp.setup.phone.how"), st.dbFound ? t("whatsapp.setup.phone.found") : st.appInstalled ? t("whatsapp.setup.phone.noDb") : t("whatsapp.setup.phone.afterInstall"))}
          ${row(false, true, t("whatsapp.setup.macos.title"), t("whatsapp.setup.macos.how"), st.copying || st.probing ? t("whatsapp.status.macosWaiting") : t("whatsapp.setup.macos.askedOnPlug"), "wamacos")}
          ${row(st.appRunning || fresh, !st.dbFound, t("whatsapp.setup.open.title"), t("whatsapp.setup.open.how"), st.appRunning ? t("whatsapp.setup.open.running") : st.dbUpdatedAt ? t("whatsapp.setup.open.lastSync", { ago: ago(st.dbUpdatedAt) }) : "—")}
        </div>
        ${st.schemaOk === false ? `<div class="small" style="color:var(--signal);margin-top:10px">${h(st.schemaError || t("whatsapp.setup.schemaError"))}</div>` : ""}
      </div>
      <div class="card dark col" style="width:320px;flex-shrink:0;gap:8px"><div class="mono" style="color:var(--g400)">${t("whatsapp.setup.side.kicker")}</div><h3>${t("whatsapp.setup.side.title")}</h3>
        <p class="small" style="color:var(--g200)">${t("whatsapp.setup.side.text")}</p>
        <button class="btn" id="waplug" ${canPlug ? "" : "disabled"} style="margin-top:8px;background:var(--paper);color:var(--ink);border-color:var(--paper);font-weight:600">${t("whatsapp.btn.plug")}</button>
        ${canPlug ? `<div class="small" style="color:var(--g400)">${st.totalMessages == null ? t("whatsapp.setup.side.plugNote") : tn("whatsapp.setup.side.plugNoteN", st.totalMessages)}</div>` : ""}
      </div>
    </div>
    ${waFallback()}`;
}

function waFallback(open) {
  return `<details class="card" ${open ? "open" : ""}><summary style="cursor:pointer;font-weight:600">${t("whatsapp.fallback.summary")}</summary>
    <div class="small" style="color:var(--g800);margin-top:10px;display:flex;flex-direction:column;gap:6px">
      <div>${t("whatsapp.fallback.intro")}</div>
      <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px"><li>${t("whatsapp.fallback.step1")}</li><li>${t("whatsapp.fallback.step2")}</li><li>${t("whatsapp.fallback.step3")}</li></ol>
      <div class="muted">${t("whatsapp.fallback.outro")}</div>
    </div></details>`;
}

// ---------- après le branchement : état, conversations écoutées, ce que l'IA voit
function waMain(st) {
  setTimeout(async () => {
    $("#warefresh").addEventListener("click", async () => {
      const b = $("#warefresh"); b.disabled = true; b.textContent = t("whatsapp.btn.refreshing");
      try {
        const r = await api("/whatsapp/refresh", { method: "POST" }); const g = r.ingest;
        toast(g ? t("whatsapp.toast.ingested", { windows: tn("whatsapp.count.windowsClassified", g.windows), flagged: fmt(g.flagged) }) + (g.errors?.length ? " · " + g.errors[0] : "") : t("whatsapp.toast.reread"));
        refreshWa(); route();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = t("whatsapp.btn.refresh"); }
    });
    $("#waunplug").addEventListener("click", async () => {
      if (!confirm(t("whatsapp.confirm.unplug"))) return;
      try { await api("/whatsapp/disable", { method: "POST" }); toast(t("whatsapp.toast.unplugged")); renderFoot(); route(); } catch (e) { toast(e.message); }
    });
    $("#wadays").addEventListener("change", () => { WAV.days = Number($("#wadays").value); loadChats(); });
    const saveSettings = async (patch) => { try { st.settings = await api("/whatsapp/settings", { method: "PUT", body: patch }); toast(t("whatsapp.toast.saved")); } catch (e) { toast(e.message); } };
    $("#wacaptions").addEventListener("click", () => { const on = !$("#wacaptions").classList.contains("on"); $("#wacaptions").classList.toggle("on", on); saveSettings({ captions: on }); });
    $("#wahist").addEventListener("change", () => saveSettings({ historyDays: Number($("#wahist").value) }));
    $("#waevery").addEventListener("change", () => saveSettings({ everyMinutes: Number($("#waevery").value) }));
    await loadChats();
  });
  const spouse = st.members.find((m) => m.key === "spouse");
  const li = st.lastIngest;
  const lastPass = li
    ? t("whatsapp.lastPass.detail", { messages: tn("whatsapp.count.messagesRead", li.messages), windows: tn("whatsapp.count.windowsClassified", li.windows), flagged: fmt(li.flagged) }) + (li.errors?.length ? ` · ${tn("whatsapp.count.errors", li.errors.length)}` : "")
    : t("whatsapp.lastPass.nothing");
  const numInput = (id, v, max) => `<input type="number" id="${id}" min="1" max="${max}" value="${v}" style="width:80px;height:32px">`;
  return head("", t("whatsapp.head.kicker"), t("whatsapp.head.title"), t("whatsapp.head.lead"), `<div style="display:flex;gap:8px"><button class="btn ghost" id="waunplug">${t("whatsapp.btn.unplug")}</button><button class="btn ink" id="warefresh">${t("whatsapp.btn.refresh")}</button></div>`) +
    `<div class="card"><div class="row" style="align-items:flex-start">
      <div class="grow"><div class="mono">${t("common.status")}</div><div style="font-size:17px;font-weight:600"><span class="dotwa ${st.appRunning ? "" : "dim"}"></span>${st.appRunning ? t("whatsapp.state.appOpen") : t("whatsapp.state.appClosed")} · ${t("whatsapp.state.synced", { ago: ago(st.dbUpdatedAt) })}</div><div class="small muted">${t("whatsapp.state.detail", { ago: ago(st.snapshotAt), messages: tn("whatsapp.count.messages", st.totalMessages), groups: tn("whatsapp.count.groups", st.chats?.groups), direct: tn("whatsapp.count.direct", st.chats?.direct) })}</div></div>
      <div><div class="mono">${t("whatsapp.listened.label")}</div><div style="font-size:17px;font-weight:600" id="walistened">${tn("whatsapp.listened.count", st.listened)}</div><div class="small muted">${t("whatsapp.listened.note")}</div></div>
      <div><div class="mono">${t("whatsapp.lastPass.label")}</div><div style="font-size:17px;font-weight:600">${st.ingesting ? t("whatsapp.lastPass.running") : li ? ago(li.at) : t("time.never")}</div><div class="small muted">${lastPass} · ${t("whatsapp.lastPass.every", { n: st.settings.everyMinutes })}</div>${st.ingestError ? `<div class="small" style="color:var(--signal)">${h(t("whatsapp.lastPass.error", { error: st.ingestError }))}</div>` : ""}</div>
    </div></div>
    <div class="row" style="align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div><h3>${t("whatsapp.chats.title")}</h3><div class="small muted">${t("whatsapp.chats.note")}</div></div>
      <div class="filters" style="gap:6px"><span class="mono" style="margin-right:4px">${t("whatsapp.chats.window")}</span><select id="wadays" class="fsel">${[7, 30, 90].map((d) => `<option value="${d}" ${WAV.days === d ? "selected" : ""}>${tn("whatsapp.chats.days", d)}</option>`).join("")}</select></div>
    </div>
    <div class="filters" id="wafilters" style="gap:6px"></div>
    <div id="wachats"><div class="empty">${t("whatsapp.chats.loading")}</div></div>
    <div class="row">
      <div class="card grow col" style="gap:4px"><h3>${t("whatsapp.ai.title")}</h3><div class="small muted" style="margin-bottom:8px">${t("whatsapp.ai.note")}</div>
        <div class="tasks">
          <div class="task" style="grid-template-columns:44px 1fr auto"><button class="toggle on" disabled aria-label="${t("whatsapp.ai.alwaysOn")}"></button><span>${t("whatsapp.ai.text")}</span><span class="small muted">${t("whatsapp.ai.textNote")}</span></div>
          <div class="task" style="grid-template-columns:44px 1fr auto" id="waspouse-row">${spouse ? `<button class="toggle" id="waspouse" aria-label="${t("whatsapp.ai.spouse.aria", { name: h(spouse.name) })}"></button><span>${t("whatsapp.ai.spouse.label", { name: h(spouse.name) })}</span><span class="small muted" id="waspouse-note">${t("whatsapp.ai.spouse.note")}</span>` : `<button class="toggle" disabled aria-label="${t("whatsapp.ai.spouse.unavailable")}"></button><span class="muted">${t("whatsapp.ai.spouse.none")}</span><span class="small muted">${t("whatsapp.ai.spouse.noneNote")}</span>`}</div>
          <div class="task" style="grid-template-columns:44px 1fr auto"><button class="toggle" disabled aria-label="${t("whatsapp.ai.direct.aria")}"></button><span>${t("whatsapp.ai.direct.label")}</span><span class="small muted">${t("whatsapp.ai.direct.note")}</span></div>
          <div class="task" style="grid-template-columns:44px 1fr auto"><button class="toggle ${st.settings.captions ? "on" : ""}" id="wacaptions" aria-label="${t("whatsapp.ai.captions.label")}"></button><span>${t("whatsapp.ai.captions.label")}</span><span class="small muted">${t("whatsapp.ai.captions.note")}</span></div>
          <div class="task" style="grid-template-columns:44px 1fr auto"><span></span><span>${t("whatsapp.ai.history.label")}</span><span class="small" style="display:flex;gap:6px;align-items:center">${t("whatsapp.ai.history.control", { input: numInput("wahist", st.settings.historyDays, 365) })}</span></div>
          <div class="task" style="grid-template-columns:44px 1fr auto"><span></span><span>${t("whatsapp.ai.every.label")}</span><span class="small" style="display:flex;gap:6px;align-items:center">${t("whatsapp.ai.every.control", { input: numInput("waevery", st.settings.everyMinutes, 1440) })}</span></div>
        </div></div>
      <div style="width:340px;flex-shrink:0">${waFallback()}</div>
    </div>`;
}

async function loadChats() {
  try { const r = await api(`/whatsapp/chats?days=${WAV.days}`); WAV.chats = r.chats; }
  catch (e) { $("#wachats").innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  renderChats();
  bindSpouse();
}
function bindSpouse() {
  const st = WAV.st, spouse = st.members.find((m) => m.key === "spouse");
  const tog = $("#waspouse");
  if (!spouse || !tog) return;
  // La conversation à deux dont le nom commence par le prénom de la conjointe, la plus active en cas de doute.
  const first = spouse.name.toLowerCase();
  const chat = WAV.chats.filter((c) => c.kind === "direct" && c.name.toLowerCase().startsWith(first)).sort((a, b) => b.messages - a.messages)[0];
  if (!chat) { tog.disabled = true; $("#waspouse-note").textContent = t("whatsapp.spouse.noChat", { name: spouse.name }); return; }
  tog.classList.toggle("on", chat.listen);
  $("#waspouse-note").innerHTML = t("whatsapp.spouse.status", { name: h(chat.name), messages: tn("whatsapp.count.messagesOver", chat.messages, { days: WAV.days }), state: chat.listen ? t("whatsapp.spouse.listened") : t("whatsapp.spouse.off") });
  tog.onclick = async () => {
    const on = !tog.classList.contains("on");
    if (on && !(await waCostOk(chat))) return;
    try { await api(`/whatsapp/chats/${chat.pk}`, { method: "PUT", body: { listen: on, forMember: on && !chat.forMember ? "spouse" : undefined } }); chat.listen = on; if (on && !chat.forMember) chat.forMember = "spouse"; tog.classList.toggle("on", on); renderChats(); bindSpouse(); updateListened(); }
    catch (e) { toast(e.message); }
  };
}
function updateListened() {
  const n = WAV.chats.filter((c) => c.listen).length;
  $("#walistened").textContent = tn("whatsapp.listened.count", n);
}

function renderChats() {
  const st = WAV.st, all = WAV.chats;
  const groups = all.filter((c) => c.kind === "group"), direct = all.filter((c) => c.kind === "direct");
  const counts = { active: groups.filter((c) => c.messages > 0).length, listened: all.filter((c) => c.listen).length, groups: groups.length, direct: direct.length };
  const filters = { active: t("whatsapp.filter.active"), listened: t("whatsapp.filter.listened"), groups: t("whatsapp.filter.groups"), direct: t("whatsapp.filter.direct") };
  $("#wafilters").innerHTML = Object.keys(filters)
    .map((k) => `<button class="fchip ${WAV.filter === k ? "on" : ""}" data-wf="${k}">${filters[k]} <b>${fmt(counts[k])}</b></button>`).join("") +
    `<input type="text" id="waq" class="fsel" placeholder="${t("whatsapp.search.placeholder")}" value="${h(WAV.q)}" style="margin-left:auto;width:220px;border-radius:8px">`;
  document.querySelectorAll("[data-wf]").forEach((b) => b.addEventListener("click", () => { WAV.filter = b.dataset.wf; renderChats(); }));
  $("#waq").addEventListener("input", () => { WAV.q = $("#waq").value.trim().toLowerCase(); renderChats(); const i = $("#waq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });

  let rows = WAV.filter === "active" ? groups.filter((c) => c.messages > 0) : WAV.filter === "listened" ? all.filter((c) => c.listen) : WAV.filter === "groups" ? groups : direct;
  if (WAV.q) rows = rows.filter((c) => c.name.toLowerCase().includes(WAV.q));
  if (WAV.filter === "direct" && !WAV.q) rows = rows.slice(0, 60);
  const max = Math.max(1, ...rows.map((c) => c.messages));
  const memberOpts = (c) => `<option value="">—</option>` + st.members.map((m) => `<option value="${h(m.key)}" ${c.forMember === m.key ? "selected" : ""}>${h(m.name)}</option>`).join("");
  const tr = (c) => `<tr data-pk="${c.pk}" class="${c.listen ? "" : "off"}">
    <td><button class="toggle ${c.listen ? "on" : ""}" data-t="${c.pk}" aria-label="${t("whatsapp.row.listenAria", { name: h(c.name) })}"></button></td>
    <td class="ellipsis" style="max-width:none"><b>${h(c.name)}</b><div class="small muted">${c.kind === "group" ? tn("whatsapp.count.members", c.members) : t("whatsapp.row.direct")}${c.archived ? ` · ${t("whatsapp.row.archived")}` : ""}</div></td>
    <td><select class="fsel wafor" data-f="${c.pk}" style="height:32px;width:150px;border-radius:8px">${memberOpts(c)}</select></td>
    <td><div class="pct" style="justify-content:flex-start"><div class="bar" style="width:120px"><i style="width:${Math.round((c.messages / max) * 100)}%"></i></div><span class="num" style="width:auto;text-align:left">${fmt(c.messages)}</span></div></td>
    <td class="r num">${c.dateHints ? fmt(c.dateHints) : `<span class="muted">0</span>`}</td>
    <td class="r num muted">${fmtWhen(c.lastMessageAt)}</td>
    <td class="r"><button class="btn sm wapv" data-p="${c.pk}">${t("whatsapp.btn.preview")}</button></td></tr>`;
  $("#wachats").innerHTML = rows.length
    ? `<table class="wat"><thead><tr><th style="width:60px">${t("whatsapp.th.listen")}</th><th>${t("whatsapp.th.chat")}</th><th style="width:170px">${t("whatsapp.th.forWhom")}</th><th style="width:200px">${t("whatsapp.th.messages", { days: WAV.days })}</th><th class="r" style="width:80px">${t("whatsapp.th.dates")}</th><th class="r" style="width:110px">${t("whatsapp.th.last")}</th><th style="width:90px"></th></tr></thead><tbody>${rows.map(tr).join("")}</tbody></table>${WAV.filter === "direct" && !WAV.q && direct.length > 60 ? `<div class="small muted" style="padding:8px 10px">${t("whatsapp.chats.top60")}</div>` : ""}`
    : `<div class="empty">${WAV.q ? t("whatsapp.chats.emptyFor", { q: h(WAV.q) }) : t("whatsapp.chats.empty")}</div>`;
  document.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", async () => {
    const c = all.find((x) => x.pk === Number(b.dataset.t)); const on = !c.listen;
    if (on && !(await waCostOk(c))) return;
    try { await api(`/whatsapp/chats/${c.pk}`, { method: "PUT", body: { listen: on } }); c.listen = on; b.classList.toggle("on", on); b.closest("tr").classList.toggle("off", !on); updateListened(); bindSpouse(); if (WAV.filter === "listened") renderChats(); }
    catch (e) { toast(e.message); }
  }));
  document.querySelectorAll(".wafor").forEach((s) => s.addEventListener("change", async () => {
    const c = all.find((x) => x.pk === Number(s.dataset.f));
    try { await api(`/whatsapp/chats/${c.pk}`, { method: "PUT", body: { forMember: s.value || null } }); c.forMember = s.value || null; toast(s.value ? t("whatsapp.toast.forMember", { name: h(c.name), member: h(st.members.find((m) => m.key === s.value)?.name || "") }) : t("whatsapp.toast.forRemoved")); }
    catch (e) { toast(e.message); }
  }));
  document.querySelectorAll(".wapv").forEach((b) => b.addEventListener("click", () => openPreview(all.find((x) => x.pk === Number(b.dataset.p)))));
}

/** Les derniers textes d'une conversation, tels que l'IA les verrait. Local, sans appel. */
async function openPreview(c) {
  closeDrawer();
  const kind = c.kind === "group" ? tn("whatsapp.count.members", c.members) : t("whatsapp.row.direct");
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><aside class="drawer"><div class="row" style="align-items:center"><div class="mono">${t("whatsapp.preview.kicker")}</div><button class="btn sm" id="dclose" style="margin-left:auto">${t("common.close")}</button></div><div><div style="font-size:20px;font-weight:700;line-height:1.2">${h(c.name)}</div><div class="small muted">${t("whatsapp.preview.note", { kind, messages: tn("whatsapp.count.messagesOver", c.messages, { days: WAV.days }) })}</div></div><div id="wapv" class="col" style="gap:0"><div class="muted small">${t("whatsapp.preview.loading")}</div></div></aside>`);
  $("#dclose").onclick = closeDrawer; $(".drawer-bg").onclick = closeDrawer;
  try {
    const msgs = await api(`/whatsapp/chats/${c.pk}/preview?days=7&limit=80`);
    $("#wapv").innerHTML = msgs.length ? msgs.map((m) => `<div class="wamsg ${m.me ? "me" : ""} ${m.dateHint ? "hint" : ""}"><div class="small muted"><b style="color:var(--ink)">${h(m.from)}</b> · ${fmtWhen(m.at)}${m.dateHint ? ` · <span style="color:var(--signal)">${t("whatsapp.preview.dateHint")}</span>` : ""}</div><div>${h(m.text)}</div></div>`).join("") : `<div class="empty">${t("whatsapp.preview.empty")}</div>`;
  } catch (e) { $("#wapv").innerHTML = `<div class="empty">${h(e.message)}</div>`; }
}
