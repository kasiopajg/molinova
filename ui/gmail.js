/* Canaux › Gmail : les boîtes, leur veille, leur historique, et le moteur de classement (aperçu, rattrapage, veille).
   Repris de l'ancienne page Progression : l'Accueil dit ce qui tourne, cette page dit comment et permet d'agir.
   Textes : ui/lang/<langue>/gmail.js (clés gmail.*) et app.js (clés dash.*, partagées avec l'animation). */

const onGmailPage = () => location.hash === "#channel/gmail";
let pollTimer, lastRunning = null;
/** La ligne de compteurs d'un passage : « 12 sur 300 · 4 réutilisés · 2 déjà connus · 1 à revoir · 1 sauté ». */
function jobCounts(j) {
  return [
    j.total ? t("dash.scan.ofTotal", { n: fmt(j.processed), total: fmt(j.total) }) : tn("dash.scan.classified", j.processed),
    j.reused ? tn("dash.scan.reused", j.reused) : "",
    j.skipped ? tn("dash.scan.known", j.skipped) : "",
    j.changed != null ? tn("dash.scan.changed", j.changed) : "",
    j.review ? tn("dash.scan.review", j.review) : "",
    j.errors ? tn("dash.scan.skipped", j.errors) : "",
  ].filter(Boolean).join(" · ");
}

/** Une boîte : sa veille (dernier et prochain passage), son historique, ce qui reste à poser. */
function gmailAccountCard(a, live, o) {
  const total = a.messages_total || 0;
  const p = total ? a.applied / total : 0;
  const watch = o.jobs.find((j) => j.accountId === a.id && j.kind === "watch" && j.status === "running");
  const busy = o.jobs.find((j) => j.accountId === a.id && j.kind !== "watch" && j.status === "running");
  const led = live?.tokenError ? "err" : watch ? "on" : "off";
  const watchLine = live?.tokenError
    ? `<span style="color:var(--signal);font-weight:600">${h(t("gmail.acc.tokenError"))}</span> <button class="btn sm ink greconnect">${h(t("gmail.acc.reconnect"))}</button>`
    : watch
      ? `${h(t("gmail.acc.watching", { last: live?.lastPassAt ? ago(new Date(live.lastPassAt).toISOString()) : t("gmail.acc.firstPass"), next: live?.nextPassAt ? until(live.nextPassAt) : "—", every: Math.round((watch.every || 300) / 60) }))} <button class="btn sm ghost gwatch-stop" data-job="${watch.id}">${h(t("gmail.acc.stopWatch"))}</button>`
      : `${h(t("gmail.acc.watchOff"))} <button class="btn sm ink gwatch-start" data-id="${a.id}" ${busy ? "disabled" : ""}>${h(t("gmail.acc.startWatch"))}</button>`;
  const never = Math.max(0, total - a.items);
  const history = a.backfill_done
    ? `<span>${h(t("gmail.acc.historyDone"))}</span>`
    : busy && busy.kind === "backfill"
      ? `<span>${h(t("gmail.acc.historyRunning"))}</span>`
      : `<span><b>${h(total ? tn("gmail.acc.historyTodo", never) : t("gmail.acc.historyCounting"))}</b></span>${live?.tokenError ? "" : ` <button class="btn sm signal gbackfill" data-id="${a.id}" data-n="${never}" ${busy ? "disabled" : ""}>${h(t("gmail.acc.backfill"))}</button>`}`;
  const nums = [[t("dash.steps.gmail"), fmt(total)], [t("dash.steps.items"), fmt(a.items)], [t("dash.steps.applied"), fmt(a.applied)], [t("dash.steps.corrected"), fmt(a.corrected)]];
  const review = live?.review ?? 0;
  return `<div class="card col gacc" style="gap:10px">
    <div class="row" style="align-items:center;gap:10px"><span class="led ${led}"></span><b style="font-size:16px">${h(a.email)}</b><span class="small muted" id="scopes-${a.id}" style="margin-left:auto"></span></div>
    <div class="small gline">${watchLine}</div>
    <div class="small gline">${h(t("gmail.acc.history"))} ${history}</div>
    <div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:28px;font-weight:700;letter-spacing:-.03em">${fmtPct(p, p < 0.1 ? 1 : 0)}</span><span class="muted small">${h(t("dash.labeledShare"))}${total ? "" : " " + h(t("dash.labeledShareCounting"))}</span></div>
    <div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>
    <div class="gnums">${nums.map(([l, n]) => `<div><div class="mono" style="letter-spacing:.06em">${h(l)}</div><div class="num" style="text-align:left;font-size:17px">${n}</div></div>`).join("")}<a href="#classify" class="gnum-link"><div class="mono" style="letter-spacing:.06em">${h(t("nav.classify"))}</div><div class="num" style="text-align:left;font-size:17px;${review ? "color:var(--signal)" : ""}">${fmt(review)}</div></a></div>
    ${a.pending && !live?.tokenError ? `<div class="small gline"><span style="color:var(--signal)">⚠</span> ${h(tn("gmail.acc.pending", a.pending))} <button class="btn sm apply-pending" data-id="${a.id}" data-n="${a.pending}">${h(t("gmail.acc.applyPending"))}</button></div>` : ""}
    <div><button class="btn sm ghost sync" data-id="${a.id}">${h(t("sources.gmail.createLabels", { prefix: TAX.prefix }))}</button></div>
  </div>`;
}

/** Aperçu ou rattrapage : compte exact des emails, puis la fenêtre « Avant de lancer l'IA ». Résout false, ou { max } (curseur). */
function gmailCostOk(body, email) {
  const k = body.kind === "backfill" ? "backfill" : "preview";
  return estimateThen("/estimate/gmail", { method: "POST", body }, (r) => ({
    title: t(`cost.gmail.${k}.title`, { email }),
    what: t(`cost.gmail.${k}.what`, { n: fmt(r.estimate.n), total: fmt(r.total), prefix: TAX?.prefix || "" }),
    cta: t(`cost.gmail.${k}.cta`),
    sample: true, sampleHint: t("cost.sample.gmail"),
  }));
}

/** Reclasser ou relancer Jev : le nombre d'emails déjà classés concernés, puis la fenêtre « Avant de lancer l'IA ». */
function reclassCostOk(body, email) {
  return estimateThen("/estimate/reclass", { method: "POST", body }, (r) => ({
    title: body.ids ? t("cost.reclass.titleSel") : t("cost.reclass.title", { email }),
    what: t("cost.reclass.what", { n: fmt(r.estimate.n) }),
    cta: t("cost.reclass.cta"),
    sample: !body.ids, sampleHint: t("cost.sample.gmail"),
  }));
}

/** Ce que dit le lancement : parti tout de suite, ou en file derrière le travail en cours (ou les deux, sur plusieurs boîtes). */
function reclassToast(r) {
  toast([r.n ? tn("dash.toast.reclass", r.n) : "", r.queued ? tn("dash.toast.reclassQueued", r.queued) : ""].filter(Boolean).join(" · "));
}
/** « Relancer Jev » sur des emails précis (cochés, ou tout un filtre de la Boîte) : le coût d'abord, puis le reclassement en fond. */
async function rejev(ids) {
  if (!ids.length) return false;
  const ok = await reclassCostOk({ ids }, "");
  if (!ok) return false;
  try { const r = await api("/reclass", { method: "POST", body: { ids } }); reclassToast(r); refreshLive(); return true; }
  catch (e) { toast(e.message); return false; }
}

async function viewGmail() {
  const [o] = await Promise.all([api("/overview"), refreshLive()]);
  TAX = o.taxonomy;
  const gaccs = o.accounts.filter((a) => a.source === "gmail");
  o.accounts = gaccs; // le moteur ne travaille que sur les boîtes Gmail
  const liveAccs = LIVE?.channels?.gmail?.accounts || [];
  // Le moteur montre les passages ponctuels (aperçu, rattrapage, reclassement) ; la veille vit sur la carte de chaque boîte.
  const running = o.jobs.find((j) => j.status === "running" && j.kind !== "watch");
  // Le dernier passage terminé reste affiché jusqu'au clic sur OK (repéré par son heure de fin, stable entre redémarrages).
  let ackAt = 0; try { ackAt = Number(localStorage.getItem("ea.ackJobAt") || 0); } catch {}
  const finished = !running ? o.jobs.find((j) => j.status !== "running" && j.kind !== "watch" && (j.finishedAt || 0) > ackAt) : null;
  const shown = running || finished;
  // Rien de ponctuel en cours, mais une veille active : le réseau vit au rythme de ses passages.
  const liveMode = !shown && !!LIVE?.read && liveAccs.some((a) => a.watching && a.nextPassAt);
  const accountsHtml = gaccs.map((a) => gmailAccountCard(a, liveAccs.find((x) => x.id === a.id), o)).join("") || `<div class="empty">${t("gmail.empty")}</div>`;
  const catHtml = gaccs.length ? mapSection(o) : "";
  const spark = running && running.latencies.length > 1
    ? `<svg class="spark" viewBox="0 0 240 34" preserveAspectRatio="none"><polyline fill="none" stroke="#6F747C" stroke-width="1.5" points="${running.latencies.map((l, i, arr) => `${(i / (arr.length - 1)) * 240},${34 - Math.min(34, (l / Math.max(...arr)) * 30)}`).join(" ")}"/></svg>`
    : "";
  const lat = running && running.latencies.length ? Math.round(running.latencies.reduce((a, b) => a + b, 0) / running.latencies.length) : null;
  const cost = o.totals.cost != null ? o.totals.cost : (o.totals.tokens / 1e6) * 0.042;
  const scanCap = shown ? (() => {
    const when = fmtTime(finished ? shown.finishedAt : Date.now());
    const kind = t("dash.kind." + shown.kind);
    const status = finished ? " · " + t("dash.status." + shown.status) : "";
    const phase = finished && shown.processed === 0 && !shown.error ? (shown.skipped ? tn("dash.scan.nothingKnown", shown.skipped) : t("dash.scan.nothing")) : (shown.phase || t("dash.scan.running"));
    return `<div class="scanwrap ${finished ? "done" : ""}"><canvas id="scan" width="300" height="300"></canvas><div class="scancap"><div class="mono" style="color:#D8DBDF"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#FF3B30;margin-right:8px;vertical-align:middle;${finished ? "" : "animation:blink 1.2s infinite"}"></span>${when} / ${h(kind)}${h(status)}</div><div style="font-weight:600;color:#FBFBFC">${h(phase)}${shown.error ? ` : ${h(shown.error)}` : ""}</div><div class="mono" style="color:#A6ABB2;letter-spacing:.06em">${h(jobCounts(shown))}</div><div class="mono" style="color:#6F747C;letter-spacing:.06em;font-size:11px">${h(t("dash.scan.net", { nodes: netSizeFor(shown.total).nodes, n: fmt(shown.total || 0) }))}</div>${finished ? `<button class="btn sm" id="ackjob" style="align-self:flex-start;margin-top:8px;background:#FBFBFC;color:#1B1C1F;border-color:#FBFBFC">${h(t("common.ok"))}</button>` : ""}</div></div>`;
  })() : liveMode
    ? `<div class="scanwrap"><canvas id="scan" width="300" height="300"></canvas><div class="scancap"><div class="mono" style="color:#D8DBDF"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#FF3B30;margin-right:8px;vertical-align:middle;animation:blink 1.2s infinite"></span>${h(t("home.scan.kicker"))} / ${h(t("dash.kind.watch"))}</div><div style="font-weight:600;color:#FBFBFC">${h(t("home.scan.next", { in: until(Math.min(...liveAccs.filter((a) => a.watching && a.nextPassAt).map((a) => a.nextPassAt))) }))}</div><div class="mono" style="color:#A6ABB2;letter-spacing:.06em">${h(t("home.scan.today", { what: tn("home.scan.mail", LIVE.read.today.gmail) }))}</div></div></div>`
    : `<div class="mono" style="letter-spacing:.06em">${h(t("dash.scan.idle"))}</div>`;
  const periodSel = localStorage.getItem("ea.period") || "30d";
  const execHtml = `<div class="resizer" id="rs-run" title="${h(t("app.resizeHint"))}"></div><aside class="card runpanel" style="width:var(--run-w);flex-shrink:0;display:flex;flex-direction:column;gap:14px">
    <div><h2>${h(t("dash.scan.title"))}</h2><div class="small muted" style="margin-top:4px">${h(t("dash.scan.lead"))}</div></div>
    ${scanCap}
    ${o.gmail?.throttledFor ? `<div class="small" style="color:var(--signal);font-weight:600">${h(t("dash.throttled", { s: o.gmail.throttledFor }))}</div>` : ""}
    ${running && o.queued?.[running.accountId] ? `<div class="small" style="font-weight:600">${h(tn("dash.scan.queued", o.queued[running.accountId]))}</div>` : ""}
    ${running ? `<div>${running.reused ? `<div class="small muted">${h(tn("dash.scan.reusedNoJev", running.reused))}</div>` : ""}${running.errors ? `<div class="small" style="color:var(--signal)">${h(tn("dash.scan.skippedError", running.errors, { error: running.lastError || "" }))}</div>` : ""}</div>` : ""}
    ${spark}
    ${running ? `<button class="btn" id="stop">${h(t("dash.stop"))}</button>` : `<div class="col" style="gap:10px"><div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field"><span class="mono">${h(t("common.mailbox"))}</span><select id="acc">${o.accounts.map((a) => `<option value="${a.id}">${h(a.email)}</option>`).join("")}</select></label><label class="field"><span class="mono">${h(t("common.period"))}</span><select id="period">${["1d", "3d", "7d", "30d", "90d", "365d", "1095d", "all"].map((pk) => `<option value="${pk}" ${pk === periodSel ? "selected" : ""}>${h(t("period." + pk))}</option>`).join("")}</select></label></div>
      <div class="small muted" id="periodhint"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="onlynew" checked style="width:16px;height:16px;accent-color:#1B1C1F">${h(t("dash.onlyNew"))}</label>
      <div class="col" style="gap:6px"><button class="btn ink" id="preview" ${o.accounts.length ? "" : "disabled"}>${h(t("dash.preview"))}</button><div class="small muted">${h(t("dash.preview.hint"))}</div></div>
      <div class="col" style="gap:6px"><button class="btn signal" id="backfill" ${o.accounts.length ? "" : "disabled"}>${h(t("dash.backfill"))}</button><div class="small muted">${h(t("dash.backfill.hint", { prefix: TAX.prefix }))}</div></div>
      <div class="col" style="gap:6px"><div class="row" style="gap:8px;align-items:center"><button class="btn" id="reclass" ${o.accounts.length ? "" : "disabled"}>${h(t("dash.reclass"))}</button><select id="reclasscat" style="width:auto;height:36px;flex:1;min-width:0" aria-label="${h(t("common.category"))}"><option value="">${h(t("dash.reclass.allCats"))}</option>${TAX.categories.map((c) => `<option value="${h(c.key)}">${h(c.name)}</option>`).join("")}</select></div><div class="small muted">${h(t("dash.reclass.hint"))}</div></div>
      <div class="col" style="gap:6px"><button class="btn" id="watch" ${o.accounts.length ? "" : "disabled"}>${h(t("dash.watch"))}</button><div class="small muted">${h(t("dash.watch.hint"))}</div></div></div>`}
    <hr>
    <div class="grid" style="grid-template-columns:1fr 1fr"><div><div class="mono">${h(t("dash.jevCalls"))}</div><div class="num" style="text-align:left;font-size:16px">${fmt(o.totals.jev)}</div></div><div><div class="mono">${h(t("dash.totalCost"))} · <a href="#usage" style="color:inherit">${h(t("dash.costDetail"))}</a></div><div class="num" style="text-align:left;font-size:16px">${fmtUsd(cost, 3)}</div></div>${running ? `<div><div class="mono">${h(t("dash.latency"))}</div><div class="num" style="text-align:left;font-size:16px">${lat ?? "—"} ms</div></div><div><div class="mono">${h(t("common.toReview"))}</div><div class="num" style="text-align:left;font-size:16px">${running.review}</div></div>` : ""}</div>
    ${o.jobs.filter((j) => j.status !== "running").slice(0, 3).map((j) => {
      const bits = [`${t("dash.job." + j.kind)} · ${tn("dash.job.emails", j.processed)}${j.reused ? ` (${tn("dash.scan.reused", j.reused)})` : ""}`];
      if (j.skipped) bits.push(tn("dash.job.known", j.skipped));
      bits.push(t("dash.status." + j.status) + (j.errors ? ` · ${tn("dash.scan.skipped", j.errors)}` : "") + (j.error ? " : " + j.error : ""));
      return `<div class="small ${j.status === "error" ? "" : "muted"}" style="${j.status === "error" ? "color:var(--signal);font-weight:600" : ""}">${h(bits.join(" · "))}</div>`;
    }).join("")}
  </aside>`;


  const connect = async () => {
    toast(t("sources.toast.google"));
    try { const a = await api("/accounts/add", { method: "POST", body: { drafts: $("#drafts")?.checked ?? true, calendar: $("#calendar")?.checked ?? true } }); toast(t("sources.toast.connected", { email: a.email })); (a.warnings || []).forEach((w) => toast(w)); refreshLive(); route(); } catch (e) { toast(e.message); }
  };
  setTimeout(() => {
    $("#addacc")?.addEventListener("click", connect);
    document.querySelectorAll(".greconnect").forEach((b) => b.addEventListener("click", connect));
    gaccs.forEach(async (a) => {
      try {
        const sc = await api(`/accounts/${a.id}/scopes`); const el = $(`#scopes-${a.id}`);
        if (el) el.textContent = [t("sources.scopes.base"), sc.drafts ? t("sources.scopes.send") : "", sc.calendar ? t("sources.scopes.calendar") : "", sc.drive ? t("sources.scopes.drive") : ""].filter(Boolean).join(", ") + (sc.calendar ? "" : " · " + t("sources.scopes.reconnect"));
      } catch {}
    });
    document.querySelectorAll(".sync").forEach((b) => b.addEventListener("click", async () => { try { const r = await api(`/accounts/${b.dataset.id}/labels`, { method: "POST" }); toast(tn("sources.toast.labels", Object.keys(r).length)); } catch (e) { toast(e.message); } }));
    document.querySelectorAll(".gwatch-start").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { await api("/jobs", { method: "POST", body: { kind: "watch", accountId: Number(b.dataset.id) } }); toast(t("dash.toast.watch")); refreshLive(); route(); } catch (e) { toast(e.message); b.disabled = false; } }));
    document.querySelectorAll(".gwatch-stop").forEach((b) => b.addEventListener("click", async () => { if (!confirm(t("gmail.confirm.stopWatch"))) return; b.disabled = true; try { await api(`/jobs/${b.dataset.job}/stop`, { method: "POST" }); setTimeout(() => { refreshLive(); route(); }, 400); } catch (e) { toast(e.message); b.disabled = false; } }));
    document.querySelectorAll(".gbackfill").forEach((b) => b.addEventListener("click", async () => {
      const body = { kind: "backfill", accountId: Number(b.dataset.id), period: "all", onlyNew: true };
      const email = gaccs.find((a) => a.id === body.accountId)?.email || "";
      b.disabled = true;
      const ok = await gmailCostOk(body, email);
      if (!ok) { b.disabled = false; return; }
      if (ok.max != null) body.max = ok.max;
      try { await api("/jobs", { method: "POST", body }); toast(t("dash.toast.backfill")); refreshLive(); route(); } catch (e) { toast(e.message); b.disabled = false; }
    }));
  });
  setTimeout(() => {
    $("#stop")?.addEventListener("click", async () => { $("#stop").disabled = true; $("#stop").textContent = t("dash.stopping"); try { await api(`/jobs/${running.id}/stop`, { method: "POST" }); } catch (e) { toast(e.message); } setTimeout(route, 400); });
    if (running) ensureScan(running.total ? Math.min(1, (running.scanned ?? running.processed) / running.total) : null, running.phase, false, running.processed, running.total);
    else if (liveMode) liveScan(LIVE);
    else if (finished) { ensureScan(finished.status === "done" ? 1 : finished.total ? finished.processed / finished.total : null, finished.phase, true, finished.processed, finished.total); $("#ackjob")?.addEventListener("click", () => { try { localStorage.setItem("ea.ackJobAt", String(finished.finishedAt || Date.now())); } catch {} route(); }); }
    // Le panneau est à droite : tirer vers la gauche l'élargit.
    setupResizer($("#rs-run"), "--run-w", 260, 560, "ea.runW", -1);
    mapInit(o);
    const start = (kind) => async () => {
      try {
        const period = $("#period").value; try { localStorage.setItem("ea.period", period); } catch {}
        const body = { kind, accountId: Number($("#acc").value), period: kind === "watch" ? undefined : period, onlyNew: $("#onlynew").checked };
        // Aperçu et rattrapage passent par l'IA : le coût d'abord. La veille ne lit que le courrier qui arrive.
        if (kind !== "watch") {
          const ok = await gmailCostOk(body, $("#acc").selectedOptions[0]?.textContent || "");
          if (!ok) return;
          if (ok.max != null) body.max = ok.max;
        }
        await api("/jobs", { method: "POST", body });
        toast(t("dash.toast." + kind));
        route(); refreshLive();
      } catch (e) { toast(e.message); }
    };
    const hint = () => {
      const el = $("#periodhint"), p = $("#period")?.value; if (!el || !p) return;
      const d = /^(\d+)d$/.exec(p);
      if (!d) { el.textContent = t("dash.hint.all"); return; }
      const n = Number(d[1]); const from = new Date(Date.now() - n * 86400000);
      const f = (x) => fmtDate(x, { day: "numeric", month: "long", year: "numeric" });
      el.textContent = n === 1 ? t("dash.hint.yesterday", { time: fmtTime(from) }) : t("dash.hint.range", { from: f(from), to: f(new Date()) });
    };
    $("#period")?.addEventListener("change", hint); hint();
    $("#preview")?.addEventListener("click", start("preview"));
    $("#backfill")?.addEventListener("click", start("backfill"));
    // Reclasser : Jev relit les emails déjà classés de la boîte et de la période (une catégorie, ou toutes), coût montré avant.
    $("#reclass")?.addEventListener("click", async () => {
      const period = $("#period").value, category = $("#reclasscat").value;
      const body = { accountId: Number($("#acc").value), period, ...(category ? { category } : {}) };
      const ok = await reclassCostOk(body, $("#acc").selectedOptions[0]?.textContent || "");
      if (!ok) return;
      try { const r = await api("/reclass", { method: "POST", body: { ...body, ...(ok.max != null ? { max: ok.max } : {}) } }); reclassToast(r); route(); refreshLive(); }
      catch (e) { toast(e.message); }
    });
    $("#watch")?.addEventListener("click", start("watch"));
    document.querySelectorAll(".apply-pending").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(tn("dash.confirm.apply", Number(b.dataset.n), { prefix: TAX.prefix }))) return;
      b.disabled = true; b.textContent = t("dash.applying");
      try { const r = await api("/labels/apply-pending", { method: "POST", body: { accountId: Number(b.dataset.id) } }); toast(`${tn("dash.toast.applied", r.n)}${r.errors ? `, ${tn("dash.toast.errors", r.errors)}` : ""}`); route(); } catch (e) { toast(e.message); route(); }
    }));

    clearTimeout(pollTimer);
    // Pendant un passage : on rafraîchit les chiffres en place, sans reconstruire la page (l'animation reste fluide).
    if (running) {
      const tick = async () => {
        if (!onGmailPage()) return;
        try {
          const jobs = await api("/jobs");
          const j = jobs.find((x) => x.id === running.id);
          if (!j || j.status !== "running") { route(); return; }
          const cap = $(".scancap");
          if (cap) {
            cap.children[1].textContent = j.phase || t("dash.scan.running");
            cap.children[2].textContent = jobCounts(j);
          }
          ensureScan(j.total ? Math.min(1, (j.scanned ?? j.processed) / j.total) : null, j.phase, false, j.processed, j.total);
          if (cap && cap.children[3]) cap.children[3].textContent = t("dash.scan.netLive", { visible: Math.min(netSizeFor(j.total).nodes, ANIM.net ? ANIM.net.visible : 0), nodes: netSizeFor(j.total).nodes, n: fmt(j.total || 0) });
          pollTimer = setTimeout(tick, 1500);
        } catch { pollTimer = setTimeout(tick, 3000); }
      };
      pollTimer = setTimeout(tick, 1500);
      lastRunning = running.id;
      return;
    }
    if (running) lastRunning = running.id;
    else if (lastRunning) { const j = o.jobs.find((x) => x.id === lastRunning); lastRunning = null; if (j && j.status === "error") toast(t("dash.toast.failed", { error: j.error })); }
    if (running) pollTimer = setTimeout(() => { if (onGmailPage()) route(); }, 2000);
  });

  return head("", t("gmail.head.kicker"), t("gmail.head.title"), t("gmail.head.lead"),
    `<div class="col" style="align-items:flex-end;gap:8px"><button class="btn ink" id="addacc">${h(t("gmail.connect"))}</button><div class="small" style="display:flex;gap:12px"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="drafts" checked style="width:16px;height:16px;accent-color:#1B1C1F">${h(t("sources.gmail.drafts"))}</label><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="calendar" checked style="width:16px;height:16px;accent-color:#1B1C1F">${h(t("sources.gmail.calendar"))}</label></div></div>`) +
    `<div class="row"><div class="col grow" style="gap:24px;min-width:0">${accountsHtml}<div class="small muted">${h(t("sources.gmail.access"))}</div>${catHtml}</div>${execHtml}</div>`;
}
