/* Vue « Agenda » (écran D) : un couloir par membre du foyer, la carte « À caler » en tête, les conflits signalés.
   Un événement concerne une personne (trait plein) et peut en mobiliser une autre (pointillé). */

const AG = { start: null, view: "person", week: null, toCalIdx: 0, toCalOpen: false, hidden: new Set(), tasks: [], showDoneTasks: false };
try { AG.hidden = new Set(JSON.parse(localStorage.getItem("ea.agHidden") || "[]")); AG.view = localStorage.getItem("ea.agView") || "person"; } catch {}

// Jours et mois abrégés lus au moment de l'usage (le dictionnaire peut changer de langue en cours de route).
const dayShort = (i) => tl("day.short")[i];
const monthShort = (m) => tl("month.short")[m];
const localDay = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shiftYmd = (ymd, n) => { const d = localDay(ymd); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hm = (iso, tz) => fmtTime(iso, { timeZone: tz });
function rangeLabel(days) {
  const a = localDay(days[0]), b = localDay(days[6]);
  const same = a.getMonth() === b.getMonth();
  return same ? `${a.getDate()} – ${b.getDate()} ${monthShort(b.getMonth())} ${b.getFullYear()}` : `${a.getDate()} ${monthShort(a.getMonth())} – ${b.getDate()} ${monthShort(b.getMonth())} ${b.getFullYear()}`;
}
function fmtDraftWhen(d) {
  if (!d?.start) return "—";
  const s = localDay(d.start.slice(0, 10));
  const day = `${tl("day.dot")[s.getDay()]} ${s.getDate()} ${monthShort(s.getMonth())}`;
  if (d.allDay) { const e = d.end && d.end.slice(0, 10) !== d.start.slice(0, 10) ? ` → ${localDay(d.end.slice(0, 10)).getDate()} ${monthShort(localDay(d.end.slice(0, 10)).getMonth())}` : ""; return `${day}${e} · ${t("agenda.allDay")}`; }
  return `${day} · ${d.start.slice(11, 16)}${d.end ? ` – ${d.end.slice(11, 16)}` : ""}`;
}
const memberName = (key) => AG.week?.members.find((m) => m.key === key)?.name ?? key;

views.agenda = async (rest = []) => {
  if (rest[0] === "reglages") return agendaSettings();
  AG.source = rest[0] === "whatsapp" ? "whatsapp" : null;
  AG.start = AG.start || null;
  setTimeout(loadWeek);
  return head("05", AG.source ? t("agenda.head.kickerWa") : t("agenda.head.kicker"), t("agenda.head.title"), t("agenda.head.lead"),
    `<div class="agnav"><button class="btn sm" id="agtoday">${t("agenda.nav.today")}</button><button class="btn sm" id="agprev" aria-label="${t("agenda.nav.prev")}">‹</button><span class="mono agrange" id="agrange" style="color:var(--ink)">…</span><button class="btn sm" id="agnext" aria-label="${t("agenda.nav.next")}">›</button><span class="agsep"></span><button class="fchip ${AG.view === "calendar" ? "on" : ""}" data-view="calendar">${t("agenda.view.calendar")}</button><button class="fchip ${AG.view === "person" ? "on" : ""}" data-view="person">${t("agenda.view.person")}</button><a class="btn sm ghost" href="#agenda/reglages" title="${t("agenda.nav.settingsTitle")}">${t("agenda.nav.settings")}</a></div>`) +
    `<div id="agwarn"></div><div id="agtocal"></div><div id="aglanes"><div class="empty">${t("agenda.loading")}</div></div><div id="aglegend"></div><div id="agtasks"></div>`;
};

async function loadWeek() {
  const p = new URLSearchParams(); if (AG.start) p.set("start", AG.start); if (AG.source) p.set("source", AG.source);
  try { AG.week = await api("/agenda/week?" + p); } catch (e) { $("#aglanes").innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  AG.start = AG.week.start;
  badges.agenda = AG.week.toCal.count || ""; renderNav();
  $("#agrange").textContent = rangeLabel(AG.week.days);
  $("#agtoday").onclick = () => { AG.start = null; loadWeek(); };
  $("#agprev").onclick = () => { AG.start = shiftYmd(AG.week.start, -7); loadWeek(); };
  $("#agnext").onclick = () => { AG.start = shiftYmd(AG.week.start, 7); loadWeek(); };
  document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { AG.view = b.dataset.view; try { localStorage.setItem("ea.agView", AG.view); } catch {} document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("on", x === b)); renderLanes(); }));
  $("#agwarn").innerHTML = AG.week.warning ? `<div class="agwarn">${h(AG.week.warning)}${AG.week.account ? "" : ` <a href="#channel/gmail">${t("chan.gmail")}</a>`}</div>` : "";
  renderToCal();
  renderLanes();
  loadTasks();
}

// ---------- la carte « À caler »
/**
 * La croix d'un événement dans un couloir. `mode` : unpresent (cette personne n'accompagne plus), unfor (retirer ce membre
 * des concernés), delete (supprimer l'événement). Pour une occurrence de série : cette occurrence ou toute la série.
 */
async function deleteEvent({ cal, id, series, title, mode = "delete", lane, for: forStr = "", present: presentStr = "" }) {
  const who = memberName(lane);
  const run = async (scope) => {
    try {
      if (mode === "delete") { await api("/agenda/events/delete", { method: "POST", body: { calendarId: cal, eventId: id, seriesId: series || undefined, scope } }); toast(scope === "series" ? t("agenda.toast.seriesDeleted") : t("agenda.toast.eventDeleted")); }
      else {
        const forKeys = forStr.split(",").filter(Boolean).filter((k) => mode !== "unfor" || k !== lane);
        const present = presentStr.split(",").filter(Boolean).filter((k) => mode !== "unpresent" || k !== lane);
        await api("/agenda/events/members", { method: "POST", body: { calendarId: cal, eventId: id, seriesId: series || undefined, scope, forKeys, present } });
        toast(mode === "unpresent" ? t("agenda.ev.unpresent", { who }) : t("agenda.toast.removed", { who }));
      }
      await loadWeek();
    } catch (e) { toast(e.message); }
  };
  const question = mode === "unpresent" ? t("agenda.confirm.unpresent", { who, title }) : mode === "unfor" ? t("agenda.confirm.unfor", { who, title }) : t("agenda.confirm.delete", { title });
  if (!series) { if (confirm(question)) await run("one"); return; }
  const kicker = mode === "unpresent" ? t("agenda.ev.unpresent", { who }) : mode === "unfor" ? t("agenda.ev.unfor", { who }) : t("common.delete");
  const note = mode === "delete" ? t("agenda.series.noteDelete") : t("agenda.series.noteMembers");
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><div class="dlg" role="dialog" aria-modal="true" style="width:min(520px,94vw)">
    <div><div class="kicker">${h(kicker)}</div><h2 style="margin-top:6px">${h(title)}<span class="stop">.</span></h2></div>
    <p class="small muted">${note}</p>
    <div class="foot"><button class="btn ghost" id="ed-cancel">${t("common.cancel")}</button><span class="spacer"></span><button class="btn" id="ed-one">${t("agenda.series.thisOne")}</button><button class="btn ${mode === "delete" ? "signal" : "ink"}" id="ed-series">${t("agenda.series.whole")}</button></div>
  </div>`);
  const close = () => document.querySelectorAll(".dlg, .drawer-bg").forEach((x) => x.remove());
  $("#ed-cancel").onclick = close; $(".drawer-bg").onclick = close;
  $("#ed-one").onclick = async () => { close(); await run("one"); };
  $("#ed-series").onclick = async () => { close(); await run("series"); };
}

const srcChip = (it) => it.source === "whatsapp" ? '<span class="srcchip"><span class="dotwa" style="margin:0"></span>WhatsApp</span>' : `<span class="srcchip mail">${t("agenda.src.email")}</span>`;

async function renderToCal() {
  const w = AG.week, box = $("#agtocal");
  if (!w.toCal.count) { box.innerHTML = AG.source ? `<div class="empty">${t("agenda.tocal.emptyWa")}</div>` : ""; return; }
  if (AG.focusId) { const i = w.toCal.items.findIndex((x) => x.id === AG.focusId); if (i >= 0) AG.toCalIdx = i; AG.focusId = null; }
  if (AG.toCalIdx >= w.toCal.count) AG.toCalIdx = 0;
  const cur = w.toCal.items[AG.toCalIdx];
  const others = w.toCal.items.filter((_, i) => i !== AG.toCalIdx);
  box.innerHTML = `<div class="tocal"><div class="tocal-head"><span class="mono">${AG.source ? t("agenda.tocal.titleWa") : t("agenda.tocal.title")}</span><span class="mono" style="color:var(--ink)">${AG.toCalIdx + 1} <span class="muted">${t("agenda.tocal.of", { n: w.toCal.total ?? w.toCal.count })}</span></span>${others.length ? `<a href="#" id="tocal-more">${AG.toCalOpen ? t("agenda.tocal.fold") : tn("agenda.tocal.seeOthers", others.length)}</a>` : ""}${w.toCal.count > 1 ? `<a href="#" id="tocal-clean" title="${h(t("agenda.tocal.cleanHint"))}">${t("agenda.tocal.clean")}</a>` : ""}<span class="grow"></span><a href="#actions" class="small muted">${t("agenda.tocal.alsoInActions")}</a></div>
    <div id="tocal-body"><div class="small muted">${t("agenda.tocal.reading")}</div></div>
    ${AG.toCalOpen && others.length ? `<div class="tocal-list">${w.toCal.items.map((it, i) => i === AG.toCalIdx ? "" : `<a href="#" data-tocal="${i}">${srcChip(it)}<span class="pill">${it.kind === "task" ? t("flags.task") : t("flags.event")}</span><b>${h(it.from_name || it.from_address)}</b><span class="muted">${h(it.subject || t("common.noSubject"))}</span></a>`).join("")}</div>` : ""}
  </div>`;
  $("#tocal-more")?.addEventListener("click", (e) => { e.preventDefault(); AG.toCalOpen = !AG.toCalOpen; renderToCal(); });
  // Nettoyer le bruit : Jev relit chaque proposition et ignore les sollicitations (promotions, newsletters, appels aux dons…).
  $("#tocal-clean")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const a = $("#tocal-clean"), body = AG.source ? { source: AG.source } : {};
    const ok = await estimateThen("/estimate/declutter", { method: "POST", body }, (r) => ({ title: t("cost.declutter.title"), what: t("cost.declutter.what", { n: fmt(r.estimate.n) }), cta: t("cost.declutter.cta") }));
    if (!ok) return;
    a.textContent = t("agenda.tocal.cleaning"); a.style.pointerEvents = "none";
    try {
      const r = await api("/agenda/declutter", { method: "POST", body });
      toast([tn("agenda.toast.cleaned", r.ignored.length, { kept: fmt(r.kept) }), r.errors ? tn("agenda.toast.cleanErrors", r.errors) : ""].filter(Boolean).join(" · "));
    } catch (err) { toast(err.message); }
    AG.toCalIdx = 0; await loadWeek(); refreshWa();
  });
  document.querySelectorAll("[data-tocal]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); AG.toCalIdx = Number(a.dataset.tocal); AG.toCalOpen = false; renderToCal(); }));
  // Deux lectures peuvent se croiser (navigation rapide) : seule la dernière a le droit d'écrire.
  const token = (AG.tocalReq = (AG.tocalReq || 0) + 1);
  let d;
  try { d = await api(`/agenda/tocal/${cur.id}`); } catch (e) { if (token === AG.tocalReq) $("#tocal-body").innerHTML = `<div class="small" style="color:var(--signal)">${h(e.message)}</div>`; return; }
  if (token !== AG.tocalReq || $("#tocal-body") == null) return;
  if (d.kind === "past") { toast(t("agenda.toast.past")); AG.toCalIdx = 0; refreshWa(); return loadWeek(); }
  if (d.kind === "invitation") return renderInvitation(cur, d);
  if (d.kind === "task") return renderTaskProposal(cur, d);
  renderEventProposal(cur, d, false);
}

/**
 * Un événement repéré dans un message. Deux cas : un nouvel événement (« Créer dans Famille »), ou une modification
 * d'un événement déjà dans l'agenda (« Mettre à jour ») : on montre alors l'avant → l'après, et on peut encore créer à la place.
 */
function renderEventProposal(cur, d, asNew) {
  const draft = d.draft;
  const upd = asNew ? null : d.update;
  const members = d.members;
  const forSel = new Set(d.suggested);
  const chk = (group, m, checked, extra = "") => `<label class="agchk"><input type="checkbox" name="${group}" value="${h(m.key)}" ${checked ? "checked" : ""}>${h(m.name)}${extra}</label>`;
  const pct = (k) => d.probs[k] != null && d.probs[k] > 0.005 ? ` <span class="mono" style="letter-spacing:0">${fmtPct(d.probs[k])}</span>` : "";
  const ruleMember = d.suggested[0];
  const same = upd && !upd.changed.length;
  // Avant → après, champ par champ : seulement ce qui change vraiment.
  const diffRow = (label, a, b) => `<div class="small"><span class="mono agl">${label}</span><s class="muted">${h(a || "—")}</s> → <b>${h(b || "—")}</b></div>`;
  const when = (e) => fmtDraftWhen(e);
  const diff = upd ? [
    upd.changed.includes("start") || upd.changed.includes("end") ? diffRow(t("agenda.update.when"), when(upd), when(draft)) : "",
    upd.changed.includes("location") ? diffRow(t("agenda.update.where"), upd.location, draft.location) : "",
    upd.changed.includes("title") ? diffRow(t("agenda.update.what"), upd.title, draft.title) : "",
  ].join("") : "";
  const updParams = upd ? { title: `<a href="${h(upd.link || "#")}" target="_blank" rel="noopener"><b>${h(upd.title)}</b></a>`, when: h(when(upd)) } : null;
  const updHead = upd ? `<div class="tocal-upd">
        <div class="small"><span class="pill strong">${same ? t("agenda.update.samePill") : t("agenda.update.pill")}</span> ${same ? t("agenda.update.sameText", updParams) : t("agenda.update.text", updParams)}</div>
        ${upd.change ? `<div class="small">${h(upd.change)}</div>` : ""}${diff}
      </div>` : "";
  const buttons = upd
    ? (same
      ? `<button class="btn sm" id="tc-new">${t("agenda.update.createAnyway")}</button><button class="btn sm ink" id="tc-ignore">${t("agenda.update.nothing")}</button>`
      : `<button class="btn sm ghost" id="tc-ignore">${t("agenda.tocal.ignore")}</button><button class="btn sm" id="tc-new">${t("agenda.update.createInstead")}</button><button class="btn sm ink" id="tc-update">${t("agenda.update.apply")}</button>`)
    : `<button class="btn sm ghost" id="tc-ignore">${t("agenda.tocal.ignore")}</button><button class="btn sm" id="tc-task">${t("agenda.tocal.toTask")}</button><button class="btn sm ink" id="tc-create">${t("agenda.tocal.create")}</button>`;
  $("#tocal-body").innerHTML = `<div class="tocal-main">
      <div class="tocal-ev">
        ${srcChip(d.item)}
        ${updHead}
        <input type="text" id="tc-title" value="${h(draft.title)}" aria-label="${t("agenda.tocal.titleLabel")}">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">${dtField("tc-start", draft.start, !draft.allDay, "width:190px;height:34px")}<span class="muted small">→</span>${dtField("tc-end", draft.end || draft.start, !draft.allDay, "width:190px;height:34px")}<label class="agchk"><input type="checkbox" id="tc-allday" ${draft.allDay ? "checked" : ""}>${t("agenda.allDay")}</label><input type="text" id="tc-loc" value="${h(draft.location || "")}" placeholder="${t("agenda.tocal.location")}" style="width:200px;height:34px"></div>
        <div class="small muted">${h(fmtDraftWhen(draft))}${draft.uncertain?.length ? ` · ${t("agenda.tocal.guessed", { fields: h(draft.uncertain.join(", ")) })}` : ""}${draft.found ? "" : ` · ${t("agenda.tocal.unsureEvent")}`}</div>
        ${sourceLine(d.item)}
      </div>
      <div class="tocal-who">
        ${upd ? `<div class="small muted">${t("agenda.update.keepsWho")}</div>` : `<div class="agrow"><span class="mono agl">${t("agenda.tocal.for")}</span>${members.map((m) => chk("for", m, forSel.has(m.key), pct(m.key))).join("")}</div>
        <div class="agrow"><span class="mono agl">${t("agenda.tocal.present")}</span>${members.filter((m) => m.kind === "adult").map((m) => chk("present", m, false)).join("")}<span class="small muted">${t("agenda.tocal.presentHint")}</span></div>
        <div class="agrow"><span class="mono agl"></span><label class="agchk" id="tc-always-l" ${ruleMember && ruleMember !== "family" ? "" : "hidden"}><input type="checkbox" id="tc-always" ${d.rule ? "checked disabled" : ""}>${t("agenda.tocal.always", { name: `<b id="tc-always-name">${h(memberName(ruleMember || ""))}</b>`, target: d.item.source === "whatsapp" ? t("agenda.tocal.thisGroup") : `<code>${h(d.domain)}</code>` })}</label></div>`}
        <div class="agrow" style="justify-content:flex-end;gap:8px;margin-top:4px">${buttons}</div>
      </div>
    </div>`;
  const readDraft = () => {
    const allDay = $("#tc-allday").checked;
    const s = dtRead("tc-start", !allDay), e = dtRead("tc-end", !allDay) || s;
    if (!s) throw new Error(t("agenda.err.badStart", { format: DT[DATE_FMT].date + (allDay ? "" : " " + DT[DATE_FMT].time) }));
    return { ...draft, title: $("#tc-title").value.trim(), allDay, start: s, end: e, location: $("#tc-loc").value.trim() };
  };
  // Journée entière : on retire ou remet l'heure dans les deux champs.
  $("#tc-allday").addEventListener("change", () => { const allDay = $("#tc-allday").checked; for (const id of ["tc-start", "tc-end"]) { const v = dtParse($("#" + id).value, !allDay) || dtParse($("#" + id).value, allDay); if (v) $("#" + id).value = dtFmt(allDay ? v.slice(0, 10) : v.length === 10 ? v + "T09:00" : v, !allDay); $("#" + id).placeholder = DT[DATE_FMT].date + (allDay ? "" : " " + DT[DATE_FMT].time); } });
  const keys = (group) => [...document.querySelectorAll(`input[name=${group}]:checked`)].map((i) => i.value);
  const syncAlways = () => { const f = keys("for"); const one = f.length === 1 && f[0] !== "family" ? f[0] : null; $("#tc-always-l").hidden = !one; if (one) $("#tc-always-name").textContent = memberName(one); };
  document.querySelectorAll("input[name=for]").forEach((i) => i.addEventListener("change", syncAlways));
  const done = async (msg) => { toast(msg); AG.toCalIdx = 0; await loadWeek(); refreshWa(); };
  $("#tc-create")?.addEventListener("click", async () => {
    const b = $("#tc-create"); b.disabled = true; b.textContent = t("agenda.tocal.creating");
    try { const body = { draft: readDraft(), forKeys: keys("for"), present: keys("present"), always: $("#tc-always").checked && !$("#tc-always").disabled }; const r = await api(`/agenda/tocal/${cur.id}/create`, { method: "POST", body }); await done(t("agenda.toast.created", { link: r.link })); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = t("agenda.tocal.create"); }
  });
  $("#tc-update")?.addEventListener("click", async () => {
    const b = $("#tc-update"); b.disabled = true; b.textContent = t("agenda.update.applying");
    try { await api(`/agenda/tocal/${cur.id}/update`, { method: "POST", body: { draft: readDraft() } }); await done(t("agenda.toast.updated")); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = t("agenda.update.apply"); }
  });
  $("#tc-new")?.addEventListener("click", () => renderEventProposal(cur, d, true));
  $("#tc-ignore").onclick = async () => { try { await api(`/agenda/tocal/${cur.id}/ignore`, { method: "POST" }); await done(same ? t("agenda.toast.alreadyThere") : t("agenda.toast.ignoredEvent")); } catch (e) { toast(e.message); } };
  $("#tc-task")?.addEventListener("click", async () => {
    const f = keys("for");
    try { const dr = readDraft(); await api(`/agenda/tocal/${cur.id}/task`, { method: "POST", body: { title: dr.title, due: dr.start.slice(0, 10), forMember: f[0] || null } }); await done(t("agenda.toast.taskAdded")); } catch (e) { toast(e.message); }
  });
}

// ---------- les couloirs
function renderLanes() {
  const w = AG.week, tz = w.timezone, today = todayYmd();
  const conflicts = Object.fromEntries(w.conflicts.map((c) => [c.day, c.note]));
  const dayHead = w.days.map((d, i) => { const x = localDay(d); return `<div class="agday ${d === today ? "today" : ""}"><span>${dayShort(i)}</span> <b>${x.getDate()}</b>${conflicts[d] ? `<span class="agconf">${h(conflicts[d])}</span>` : ""}</div>`; }).join("");
  const ev = (e, laneKey) => {
    const time = e.allDay ? "" : hm(e.start, tz);
    const suffix = e.role === "present" || (e.forKeys.length > 1 && laneKey !== "family") ? e.forKeys.filter((k) => k !== laneKey && k !== "family").map((k) => (w.members.find((m) => m.key === k)?.short ?? k)).join(", ") : "";
    const src = e.source === "gmail" ? "✉ " : e.source === "whatsapp" ? '<span class="dotwa" style="margin-right:4px"></span>' : e.source === "telegram" ? '<span class="dotwa" style="margin-right:4px;background:#2aabee"></span>' : "";
    const chip = `<a class="agev ${e.role === "present" ? "dash" : ""} ${e.free ? "free" : ""} ${e.allDay ? "allday" : ""}" href="${h(e.link || "#")}" target="_blank" rel="noopener" title="${h(e.title)}${e.location ? " · " + h(e.location) : ""}"><span class="agt">${time}${src}</span>${h(e.title)}${suffix ? ` <span class="muted">· ${h(suffix)}</span>` : ""}${e.confirm ? ' <b class="agq">?</b>' : ""}</a>`;
    // Suppression rapide, dans n'importe quel agenda où on a le droit d'écrire : la croix apparaît au survol.
    if (!w.writable?.[e.calendarId]) return chip;
    // Dans le couloir d'un accompagnant, la croix retire l'accompagnement ; chez un concerné parmi d'autres, elle le retire ;
    // sinon (seul concerné, couloir Famille, vue par agenda), elle supprime l'événement.
    const present = (e.props?.ea_present || "").split(",").filter(Boolean);
    const mode = e.role === "present" ? "unpresent" : e.forKeys.length > 1 && laneKey !== "family" && e.forKeys.includes(laneKey) ? "unfor" : "delete";
    const who = w.members.find((m) => m.key === laneKey)?.name ?? laneKey;
    const label = mode === "unpresent" ? t("agenda.ev.unpresent", { who }) : mode === "unfor" ? t("agenda.ev.unfor", { who }) : t("agenda.ev.delete");
    return `<span class="agevw">${chip}<button type="button" class="agevdel" data-cal="${h(e.calendarId)}" data-id="${h(e.id)}" data-series="${h(e.recurringEventId || "")}" data-title="${h(e.title)}" data-mode="${mode}" data-lane="${h(laneKey)}" data-for="${h(e.forKeys.join(","))}" data-present="${h(present.join(","))}" title="${h(label)}">×</button></span>`;
  };
  let rows;
  if (AG.view === "person") {
    rows = w.lanes.map((l) => {
      const k = l.member.key, hidden = AG.hidden.has(k);
      const sub = l.member.kind === "adult" && !l.connected ? t("agenda.lane.notConnected") : l.calendars.length ? l.calendars.join(" + ") : l.member.kind === "family" ? t("agenda.lane.familyCalendar") : "";
      const cnt = `${t("agenda.lane.thisWeek", { n: l.count })}${l.presentCount ? ` · ${t("agenda.lane.asPresent", { n: l.presentCount })}` : ""}`;
      const name = `<div class="aglane ${hidden ? "off" : ""}"><div class="agname"><span class="mono">${h(l.member.short)}</span><span>${h(l.member.name)}</span><label class="agvis"><input type="checkbox" data-lane="${h(k)}" ${hidden ? "" : "checked"} aria-label="${t("agenda.lane.show", { name: h(l.member.name) })}"></label></div>${sub ? `<div class="small muted">${h(sub)}</div>` : ""}<div class="small muted">${cnt}</div></div>`;
      const cells = w.days.map((d) => `<div class="agcell">${hidden ? "" : l.events.filter((e) => e.day === d).map((e) => ev(e, k)).join("")}</div>`).join("");
      return name + cells;
    }).join("");
  } else {
    rows = (w.byCalendar.length ? w.byCalendar : []).map((c) => {
      const name = `<div class="aglane"><div class="agname"><span class="mono">${h((c.name[0] || "?").toUpperCase())}</span><span>${h(c.name)}</span></div><div class="small muted">${t("agenda.cal.lane", { lane: h(c.member === "hidden" ? t("agenda.lane.hidden") : memberName(c.member)) })} · ${t("agenda.lane.thisWeek", { n: c.events.length })}</div></div>`;
      const cells = w.days.map((d) => `<div class="agcell">${c.events.filter((e) => e.day === d).map((e) => ev({ ...e, role: "for", forKeys: [], source: e.props?.ea_source?.startsWith("whatsapp") ? "whatsapp" : e.props?.ea_source?.startsWith("gmail") ? "gmail" : null }, c.member)).join("")}</div>`).join("");
      return name + cells;
    }).join("") || `<div class="empty" style="grid-column:1/-1">${t("agenda.cal.empty")} ${w.account ? `<a href="#agenda/reglages">${t("agenda.cal.attach")}</a>.` : ""}</div>`;
  }
  $("#aglanes").innerHTML = `<div class="aggrid"><div class="agcorner"></div>${dayHead}${rows}</div>`;
  document.querySelectorAll(".agevdel").forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); deleteEvent(b.dataset); }));
  document.querySelectorAll("[data-lane]").forEach((i) => i.addEventListener("change", () => { if (i.checked) AG.hidden.delete(i.dataset.lane); else AG.hidden.add(i.dataset.lane); try { localStorage.setItem("ea.agHidden", JSON.stringify([...AG.hidden])); } catch {} renderLanes(); }));
  $("#aglegend").innerHTML = `<div class="aglegend"><span><i class="lg-solid"></i>${t("agenda.legend.for")}</span><span><i class="lg-dash"></i>${t("agenda.legend.present")}</span><span><b class="agq">?</b> ${t("agenda.legend.confirm")}</span><span>✉ ${t("agenda.legend.fromEmail")}</span><span><span class="dotwa"></span>${t("agenda.legend.fromWhatsapp")}</span><span><span class="dotwa" style="background:#2aabee"></span>${t("agenda.legend.fromTelegram")}</span>${w.conflicts.map((c) => `<span class="agnote">${t("agenda.legend.conflict", { day: h(dayShort(w.days.indexOf(c.day)) ?? c.day), note: h(c.note) })}</span>`).join("")}</div>`;
}

// ---------- tâches, sous les couloirs
async function loadTasks() {
  try { AG.tasks = await api("/tasks" + (AG.showDoneTasks ? "?all=1" : "")); } catch (e) { $("#agtasks").innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  renderTasks();
}
function renderTasks() {
  const today = todayYmd(), soon = shiftYmd(today, 3);
  const open = AG.tasks.filter((x) => !x.done_at), done = AG.tasks.filter((x) => x.done_at);
  const due = (x) => !x.due ? "" : x.due < today ? `<span class="due late">${t("agenda.tasks.late", { date: h(fmtDate(localDay(x.due), { day: "2-digit", month: "2-digit" })) })}</span>` : x.due <= soon ? `<span class="due soon">${x.due === today ? t("time.today") : h(fmtDate(localDay(x.due), { weekday: "short", day: "numeric" }))}</span>` : `<span class="due">${h(fmtDate(localDay(x.due), { weekday: "short", day: "numeric", month: "short" }))}</span>`;
  const row = (x) => `<div class="agtask ${x.done_at ? "done" : ""}" data-id="${x.id}"><input type="checkbox" ${x.done_at ? "checked" : ""} aria-label="${t("agenda.tasks.done")}"><span>${h(x.title)}${x.for_member ? ` <span class="chip" style="font-size:11px">${h(memberName(x.for_member))}</span>` : ""}</span>${x.source === "gmail" ? '<span class="srcchip mail">✉</span>' : x.source === "whatsapp" ? '<span class="srcchip"><span class="dotwa" style="margin:0"></span></span>' : x.source === "telegram" ? `<span class="srcchip" title="${t("agenda.tasks.byTelegram")}"><span class="dotwa" style="margin:0;background:#2aabee"></span>${x.created_by && x.created_by !== "me" ? " " + h(memberName(x.created_by)) : ""}</span>` : "<span></span>"}${due(x)}<button class="btn sm ghost agdel" aria-label="${t("common.delete")}">×</button></div>`;
  $("#agtasks").innerHTML = `<div class="card col" style="gap:6px"><div class="row" style="align-items:baseline;justify-content:space-between"><h3>${t("agenda.tasks.title")}</h3><span class="small muted">${tn("agenda.tasks.open", open.length)} · ${t("agenda.tasks.sub")}</span></div>
    <div class="tasks">${open.map(row).join("") || `<div class="small muted" style="padding:8px 4px">${t("agenda.tasks.empty")}</div>`}${done.length ? done.map(row).join("") : ""}</div>
    <div class="agrow" style="margin-top:6px;gap:8px"><input type="text" id="task-title" placeholder="${t("agenda.tasks.newPlaceholder")}" style="flex:1 1 240px;height:36px">${dtField("task-due", "", false, "width:150px;height:36px")}<select id="task-for" class="fsel" style="height:36px;border-radius:8px"><option value="">${t("agenda.tasks.forPlaceholder")}</option>${AG.week.members.map((m) => `<option value="${h(m.key)}">${h(m.name)}</option>`).join("")}</select><button class="btn sm ink" id="task-add">${t("common.add")}</button><a href="#" id="task-done" class="small muted" style="margin-left:auto">${AG.showDoneTasks ? t("agenda.tasks.hideDone") : t("agenda.tasks.showDone")}</a></div></div>`;
  $("#task-add").onclick = async () => { const title = $("#task-title").value.trim(); if (!title) return; const due = dtRead("task-due", false); if ($("#task-due").value.trim() && !due) return toast(t("agenda.err.badDue", { format: DT[DATE_FMT].date })); try { await api("/tasks", { method: "POST", body: { title, due, forMember: $("#task-for").value || null } }); loadTasks(); } catch (e) { toast(e.message); } };
  $("#task-title").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#task-add").click(); });
  $("#task-done").onclick = (e) => { e.preventDefault(); AG.showDoneTasks = !AG.showDoneTasks; loadTasks(); };
  document.querySelectorAll(".agtask input").forEach((i) => i.addEventListener("change", async () => { try { await api(`/tasks/${i.closest(".agtask").dataset.id}/toggle`, { method: "POST" }); loadTasks(); } catch (e) { toast(e.message); } }));
  document.querySelectorAll(".agdel").forEach((b) => b.addEventListener("click", async () => { try { await api(`/tasks/${b.closest(".agtask").dataset.id}`, { method: "DELETE" }); loadTasks(); } catch (e) { toast(e.message); } }));
}

// ---------- réglages : quel agenda Google alimente quel couloir
async function agendaSettings() {
  let s;
  try { s = await api("/agenda/calendars"); } catch (e) { return head("05", t("agenda.settings.kicker"), t("agenda.settings.titleErr"), e.message); }
  setTimeout(() => {
    $("#agsave")?.addEventListener("click", async () => {
      const map = {}; document.querySelectorAll("[data-cal]").forEach((sel) => (map[sel.dataset.cal] = sel.value));
      try { await api("/agenda/calendars", { method: "PUT", body: { map } }); toast(t("agenda.settings.saved")); location.hash = "#agenda"; } catch (e) { toast(e.message); }
    });
    $("#agfam")?.addEventListener("click", async () => { const b = $("#agfam"); b.disabled = true; try { const r = await api("/agenda/family-calendar", { method: "POST" }); toast(t("agenda.settings.familyReady", { id: r.id })); route(); } catch (e) { toast(e.message); b.disabled = false; } });
  });
  const opts = (cur) => [["hidden", t("agenda.settings.hiddenOption")], ...s.members.map((m) => [m.key, m.name])].map(([k, n]) => `<option value="${h(k)}" ${cur === k ? "selected" : ""}>${h(n)}</option>`).join("");
  return head("05", t("agenda.settings.kicker"), t("agenda.settings.title"), t("agenda.settings.lead"), `<a class="btn sm ghost" href="#agenda">${t("common.back")}</a><button class="btn ink" id="agsave" ${s.account ? "" : "disabled"}>${t("common.save")}</button>`) +
    (s.account ? `<div class="card col"><div class="row" style="align-items:baseline"><h3>${t("agenda.settings.account")}</h3><span class="mono" style="margin-left:auto">${h(s.account)}</span></div>
      ${s.canList ? "" : `<div class="agwarn">${t("agenda.settings.eventsOnly")}</div>`}
      <table><thead><tr><th>${t("agenda.settings.colCalendar")}</th><th style="width:220px">${t("agenda.settings.colLane")}</th><th style="width:160px">${t("agenda.settings.colRights")}</th></tr></thead><tbody>
      ${s.calendars.map((c) => `<tr><td><span class="legend" style="background:${h(c.color || "var(--g400)")}"></span><b>${h(c.name)}</b>${c.primary ? ` <span class="pill">${t("agenda.settings.primary")}</span>` : ""}${c.id === s.familyCalendar ? ` <span class="pill strong">${t("agenda.settings.familyPill")}</span>` : ""}</td><td><select class="fsel" data-cal="${h(c.id)}" style="width:100%;height:34px;border-radius:8px">${opts(s.map[c.id] ?? "hidden")}</select></td><td class="small muted">${c.canWrite ? t("agenda.settings.readWrite") : t("agenda.settings.readOnly")}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="card row" style="align-items:center"><div class="grow"><h3>${t("agenda.settings.familyTitle")}</h3><div class="small muted">${s.familyCalendar ? t("agenda.settings.familyFound") : t("agenda.settings.familyNone")}</div></div>${s.familyCalendar ? "" : `<button class="btn" id="agfam" ${s.canCreate ? "" : `disabled title="${t("agenda.settings.reconnect")}"`}>${t("agenda.settings.createFamily")}</button>`}</div>`
    : `<div class="empty">${t("agenda.settings.noAccount", { link: `<a href="#channel/gmail">${t("agenda.settings.connectLink")}</a>` })}</div>`);
}

/** Une vraie invitation : on répond, on ne recrée rien. L'organisateur est prévenu, comme depuis Google Agenda. */
function renderInvitation(cur, d) {
  const inv = d.invite;
  const STATUS = { accepted: [t("agenda.inv.status.accepted"), "strong"], tentative: [t("agenda.inv.status.tentative"), ""], declined: [t("agenda.inv.status.declined"), ""], needsAction: [t("agenda.inv.status.needsAction"), ""] };
  const [stLabel, stCls] = STATUS[inv.myStatus] ?? STATUS.needsAction;
  const when = fmtDraftWhen({ start: inv.allDay ? inv.start : inv.start.replace(/([+-]\d{2}:\d{2}|Z)$/, ""), end: inv.allDay ? inv.end : inv.end.replace(/([+-]\d{2}:\d{2}|Z)$/, ""), allDay: inv.allDay });
  const who = inv.organizer?.name || inv.organizer?.email || d.item.from_name || d.item.from_address;
  const others = inv.attendees.filter((a) => a.email !== (inv.organizer?.email || "")).length;
  const members = d.members;
  const chk = (m, checked) => `<label class="agchk"><input type="checkbox" name="for" value="${h(m.key)}" ${checked ? "checked" : ""}>${h(m.name)}</label>`;
  $("#tocal-body").innerHTML = `<div class="tocal-main">
      <div class="tocal-ev">
        <span class="srcchip mail">${inv.cancelled ? t("agenda.inv.chipCancelled") : t("agenda.inv.chip")}</span>
        <div style="font-size:18px;font-weight:700;line-height:1.2">${h(inv.summary)}</div>
        <div class="small"><b>${h(when)}</b>${inv.location ? ` · ${h(inv.location)}` : ""}${inv.tzid && inv.tzid !== AG.week.timezone ? ` <span class="muted">· ${t("agenda.inv.tz", { tz: h(inv.tzid) })}</span>` : ""}</div>
        <div class="small">${t("agenda.inv.organizedBy", { who: `<b>${h(who)}</b>` })}${others ? ` · ${tn("agenda.inv.guests", others)}` : ""} · ${t("agenda.inv.yourReply")} <span class="pill ${stCls}">${stLabel}</span>${inv.inGoogle ? "" : ` <span class="muted">· ${t("agenda.inv.notInGoogle")}</span>`}</div>
        ${inv.description ? `<div class="small muted" style="white-space:pre-wrap;max-height:80px;overflow:auto">${h(inv.description)}</div>` : ""}
        <div class="small muted">${t("agenda.quoted", { text: h(d.item.subject || "") })} · ${fmtDate(d.item.date, { day: "numeric", month: "short" })}</div>
      </div>
      <div class="tocal-who">
        <div class="agrow"><span class="mono agl">${t("agenda.tocal.for")}</span>${members.map((m) => chk(m, m.key === "me")).join("")}</div>
        <div class="small muted" style="padding-left:72px">${t("agenda.inv.hint")}</div>
        ${inv.cancelled ? `<div class="agrow" style="justify-content:flex-end;gap:8px;margin-top:4px"><span class="small muted">${t("agenda.inv.cancelledNote")}</span><button class="btn sm ink" id="inv-ignore">${t("agenda.inv.gotIt")}</button></div>`
        : `<div class="agrow" style="justify-content:flex-end;gap:8px;margin-top:4px"><button class="btn sm ghost" id="inv-ignore">${t("agenda.inv.later")}</button><button class="btn sm" data-rsvp="declined">${t("agenda.inv.decline")}</button><button class="btn sm" data-rsvp="tentative">${t("agenda.inv.maybe")}</button><button class="btn sm ink" data-rsvp="accepted">${t("agenda.inv.accept")}</button></div>
        <div class="small muted" style="text-align:right">${t("agenda.inv.replyNote")}</div>`}
      </div>
    </div>`;
  const keys = () => [...document.querySelectorAll("input[name=for]:checked")].map((i) => i.value).filter((k) => k !== "me");
  const done = async (msg) => { toast(msg); AG.toCalIdx = 0; await loadWeek(); };
  document.querySelectorAll("[data-rsvp]").forEach((b) => (b.onclick = async () => {
    document.querySelectorAll("[data-rsvp]").forEach((x) => (x.disabled = true)); b.textContent = t("agenda.inv.sending");
    try { const r = await api(`/agenda/tocal/${cur.id}/respond`, { method: "POST", body: { status: b.dataset.rsvp, forKeys: keys() } }); await done(t("agenda.toast.replied", { status: STATUS[r.status][0], link: r.link })); }
    catch (e) { toast(e.message); renderInvitation(cur, d); }
  }));
  $("#inv-ignore").onclick = async () => { try { await api(`/agenda/tocal/${cur.id}/ignore`, { method: "POST" }); await done(inv.cancelled ? t("agenda.toast.noted") : t("agenda.toast.leftUnanswered")); } catch (e) { toast(e.message); } };
}

/** La ligne d'origine sous une proposition : expéditeur et objet d'un email, ou groupe WhatsApp et les messages lus. */
function sourceLine(item) {
  const when = fmtDate(item.date, { day: "numeric", month: "short" });
  if (item.source !== "whatsapp") return `<div class="small"><b>${h(item.from_name || item.from_address)}</b> · ${t("agenda.quoted", { text: h(item.subject || "") })} · ${when}</div>`;
  return `<div class="small">${t("agenda.src.group", { name: `<b>${h(item.from_name)}</b>` })} · ${when}</div><details class="small muted"><summary style="cursor:pointer">${t("agenda.src.messagesRead")}</summary><div class="waquote">${h(item.text || "")}</div></details>`;
}

/** Une chose à faire, sans date d'événement : titre, échéance, pour qui, puis « Ajouter en tâche ». */
function renderTaskProposal(cur, d) {
  const tk = d.task, members = d.members, forSel = new Set(d.suggested);
  const chk = (m, checked, extra = "") => `<label class="agchk"><input type="checkbox" name="for" value="${h(m.key)}" ${checked ? "checked" : ""}>${h(m.name)}${extra}</label>`;
  const pct = (k) => d.probs[k] != null && d.probs[k] > 0.005 ? ` <span class="mono" style="letter-spacing:0">${fmtPct(d.probs[k])}</span>` : "";
  const srcChip = d.item.source === "whatsapp" ? '<span class="srcchip"><span class="dotwa" style="margin:0"></span>WhatsApp</span>' : `<span class="srcchip mail">${t("agenda.src.email")}</span>`;
  $("#tocal-body").innerHTML = `<div class="tocal-main">
      <div class="tocal-ev">
        <div class="agrow">${srcChip}<span class="pill strong">${t("agenda.task.pill")}</span></div>
        <input type="text" id="tk-title" value="${h(tk.title)}" aria-label="${t("agenda.task.pill")}">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><span class="mono">${t("agenda.task.before")}</span>${dtField("tk-due", tk.due || "", false, "width:150px;height:34px")}</div>
        <div class="small muted">${h(tk.notes || "")}${tk.uncertain?.length ? ` · ${t("agenda.tocal.guessed", { fields: h(tk.uncertain.join(", ")) })}` : ""}${tk.found ? "" : ` · ${t("agenda.task.unsure")}`}</div>
        ${sourceLine(d.item)}
      </div>
      <div class="tocal-who">
        <div class="agrow"><span class="mono agl">${t("agenda.tocal.for")}</span>${members.map((m) => chk(m, forSel.has(m.key), pct(m.key))).join("")}</div>
        <div class="agrow" style="justify-content:flex-end;gap:8px;margin-top:4px"><button class="btn sm ghost" id="tk-ignore">${t("agenda.tocal.ignore")}</button><button class="btn sm ink" id="tk-add">${t("agenda.task.add")}</button></div>
        <div class="small muted" style="text-align:right">${t("agenda.task.note")}</div>
      </div>
    </div>`;
  const done = async (msg) => { toast(msg); AG.toCalIdx = 0; await loadWeek(); refreshWa(); };
  $("#tk-add").onclick = async () => {
    const f = [...document.querySelectorAll("input[name=for]:checked")].map((i) => i.value);
    const due = dtRead("tk-due", false); if ($("#tk-due").value.trim() && !due) return toast(t("agenda.err.badDue", { format: DT[DATE_FMT].date }));
    try { await api(`/agenda/tocal/${cur.id}/task`, { method: "POST", body: { title: $("#tk-title").value.trim(), due, forMember: f[0] || null } }); await done(t("agenda.toast.taskAdded")); } catch (e) { toast(e.message); }
  };
  $("#tk-ignore").onclick = async () => { try { await api(`/agenda/tocal/${cur.id}/ignore`, { method: "POST" }); await done(t("agenda.toast.ignoredTask")); } catch (e) { toast(e.message); } };
}
