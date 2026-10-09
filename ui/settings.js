/* Réglages › Connexions et Réglages › Tokens et coûts.
   Connexions : ce qui relie l'app au monde (passerelle Vercel et modèles, Google, WhatsApp, Telegram, stockage local).
   Coûts : chaque appel à un modèle est compté par sujet, modèle, catégorie, source et jour. Rien ici n'appelle l'IA.
   Textes : ui/lang/<langue>/settings.js (clés settings.conn.* et settings.usage.*) ; montants, tokens, unités et
   « il y a … » viennent de fmtUsd / fmtTok / fmtUnit / ago dans i18n.js. */

const status = (kind, label) => `<span class="st ${kind}">${h(label)}</span>`;
const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<span class="mono">${k}</span><span>${v}</span>`).join("")}</div>`;
/** D'où vient un secret (clé, client Google, jeton Telegram) : trousseau macOS, .env.local, environnement, fichier historique, base de l'app. Sert aussi à Sources › Telegram. */
const secretSourceLabel = (src) => ({ keychain: t("settings.conn.source.keychain"), ".env.local": ".env.local", env: t("settings.conn.source.env"), file: "credentials/google-oauth.json", kv: t("settings.conn.source.kv") })[src] || src || "";
/** Le toast après « Relire modèles et tarifs », commun aux deux vues. */
const gwRefreshed = (r) => toast(`${tn("settings.conn.count.modelsRead", r.models)} · ${tn("settings.conn.count.costsRecalc", r.updated)}`);

// ---------- Réglages › Connexions
/** « Vérifier maintenant » : le prochain rendu interroge chaque service (solde de la passerelle, profil Gmail). */
const CONN = { check: false };
views.settings = async () => {
  let c;
  const live = CONN.check; CONN.check = false;
  try { c = await api(live ? "/connections?check=1" : "/connections"); } catch (e) { return head("06", t("settings.conn.head.kicker"), t("nav.settings.settings"), e.message); }
  // Dans l'app macOS seulement : ouverture à la connexion, veille, fermeture dans la barre des menus (app.json).
  const app = window.molinova?.isApp ? await api("/app/settings").catch(() => null) : null;
  // Boîtes à reconnecter : jeton refusé par Google au dernier passage (GET /api/app/status) ou absent.
  const appStatus = await api("/app/status").catch(() => null);
  if (live) toast(t("settings.conn.toast.checked"));
  setTimeout(() => {
    bindAppSettings();
    $("#chk")?.addEventListener("click", () => {
      const b = $("#chk"); b.disabled = true; b.textContent = t("settings.conn.btn.checking");
      CONN.check = true; route();
    });
    $("#gwrefresh")?.addEventListener("click", async () => {
      const b = $("#gwrefresh"); b.disabled = true; b.textContent = t("settings.conn.btn.reading");
      try { gwRefreshed(await api("/gateway/refresh", { method: "POST" })); } catch (e) { toast(e.message); }
      route();
    });
  });

  const g = c.gateway;
  const gwState = !g.keySet ? status("bad", t("settings.conn.status.noKey")) : g.models.error && !g.models.count ? status("bad", t("settings.conn.status.unreachable")) : g.models.error ? status("warn", t("settings.conn.status.cacheFailed")) : status("ok", t("settings.conn.status.connected"));
  const roles = g.roles.map((r) => `<div class="mrole">
      <div class="row" style="align-items:baseline;gap:10px"><b>${h(r.role)}</b><span style="margin-left:auto">${r.available === null ? status("", t("settings.conn.status.unchecked")) : r.available ? status("ok", t("settings.conn.status.available")) : status("bad", t("settings.conn.status.notOnGateway"))}</span></div>
      <div class="small muted">${h(r.detail)}</div>
      <div class="id">${h(r.id)}${r.name ? ` <span class="muted" style="font-family:var(--sans)">· ${h(r.name)}</span>` : ""}</div>
      <div class="num" style="text-align:left">${r.pricing ? t("settings.conn.gw.priceIn", { price: fmtUsd(r.pricing.inputPerM, 2) }) + (r.pricing.outputPerM ? ` · ${t("settings.conn.gw.priceOut", { price: fmtUsd(r.pricing.outputPerM, 2) })}` : "") : t("settings.conn.gw.priceUnknown")} · ${r.usage30 ? t("settings.conn.gw.usage30", { calls: tn("settings.conn.count.calls", r.usage30.calls), tokens: fmtTok(r.usage30.inputTokens + r.usage30.outputTokens), cost: fmtUsd(r.usage30.cost) }) : t("settings.conn.gw.usage30None")}</div>
    </div>`).join("");
  const gatewayCard = `<div class="card live"><div class="row" style="align-items:baseline"><h3>Vercel AI Gateway</h3><span style="margin-left:auto">${gwState}</span></div>
    ${kv([
      [t("settings.conn.gw.key"), g.keySet ? `<code>${h(g.keyHint)}</code> <span class="muted small">· ${h(secretSourceLabel(g.keySource))}</span>` : `<span style="color:var(--signal)">${t("settings.conn.gw.keyMissing")}</span>`],
      [t("settings.conn.gw.models"), g.models.count ? tn("settings.conn.gw.modelsCount", g.models.count, { ago: ago(g.models.fetchedAt) }) : t("settings.conn.gw.modelsNever")],
      g.models.error && [t("settings.conn.gw.lastCall"), `<span style="color:var(--signal)">${h(g.models.error)}</span>`],
      [t("settings.conn.gw.credits"), g.credits ? t("settings.conn.gw.balance", { balance: fmtUsd(g.credits.balance, 2), used: fmtUsd(g.credits.totalUsed, 2) }) : `<span class="muted">${t("settings.conn.gw.balanceHint")}</span>`],
      [t("settings.conn.gw.retention"), g.zeroDataRetention ? t("settings.conn.gw.zdrOn") : `<span style="color:var(--signal)">${t("settings.conn.gw.zdrOff")}</span>`],
    ])}
    <div><div class="mono" style="margin-top:6px">${t("settings.conn.gw.modelsUsed")}</div>${roles}</div>
    <div class="row" style="gap:8px;margin-top:auto"><button class="btn sm" id="gwrefresh">${t("settings.conn.btn.reloadModels")}</button><a class="btn sm ghost" href="#usage">${t("settings.conn.btn.seeCosts")}</a></div></div>`;

  const go = c.google;
  const reauth = new Set([...(appStatus?.tokenErrors || []), ...go.accounts.filter((a) => !a.tokenSet).map((a) => a.email)]);
  // Cause probable et remède : l'app Google restée en Test (étape 7 du guide), ou le mot de passe Google changé.
  const reauthHint = `<div class="greauth small">${t("settings.conn.google.reauth", { publish: `<a href="#setup/google/perso/7">${t("settings.conn.google.reauthPublish")}</a>`, sources: `<a href="#channel/gmail">${t("settings.conn.google.reauthSources")}</a>` })}</div>`;
  const accs = go.accounts.map((a) => {
    const st = reauth.has(a.email) && !(a.live && a.live.ok) ? status("bad", t("settings.conn.status.reconnect")) : a.live ? (a.live.ok ? status("ok", t("settings.conn.status.ok")) : status("bad", t("settings.conn.status.error"))) : a.tokenSet ? status("ok", t("settings.conn.status.tokenPresent")) : status("bad", t("settings.conn.status.noToken"));
    const rights = [a.scopes.mail && t("settings.conn.google.scopeMail"), a.scopes.drafts && t("settings.conn.google.scopeDrafts"), a.scopes.calendar && t("settings.conn.google.scopeCalendar")].filter(Boolean).join(", ") || t("settings.conn.google.scopeNone");
    return `<div style="padding:10px 0;border-top:1px solid var(--g100)"><div class="row" style="align-items:baseline;gap:10px"><b style="overflow:hidden;text-overflow:ellipsis">${h(a.email)}</b><span style="margin-left:auto">${st}</span></div>
      <div class="small muted">${t("settings.conn.google.rights", { rights })}${a.scopes.calendar ? "" : ` · ${t("settings.conn.google.reconnectAgenda")}`}</div>
      <div class="small muted">${a.messagesTotal ? `${tn("settings.conn.google.inGmail", a.messagesTotal)} · ` : ""}${tn("settings.conn.google.readByAgent", a.items)}${a.lastFetch ? ` · ${t("settings.conn.google.lastFetch", { ago: ago(a.lastFetch) })}` : ""}${a.watching ? ` · <span style="color:#0c7a56">${t("settings.conn.google.watching")}</span>` : a.backfillDone ? ` · ${t("settings.conn.google.backfilled")}` : ""}</div>
      ${a.live && !a.live.ok ? `<div class="small" style="color:var(--signal)">${h(a.live.error)}</div>` : ""}
      ${reauth.has(a.email) && !(a.live && a.live.ok) ? reauthHint : ""}</div>`;
  }).join("");
  const googleCard = `<div class="card ${go.accounts.length ? "live" : ""}"><div class="row" style="align-items:baseline"><h3>${t("settings.conn.google.title")}</h3><span style="margin-left:auto">${go.accounts.length ? status("ok", tn("settings.conn.google.accounts", go.accounts.length)) : status("", t("settings.conn.status.noAccount"))}</span></div>
    ${kv([[t("settings.conn.google.oauthClient"), go.secretsSource ? h(secretSourceLabel(go.secretsSource)) : `<span style="color:var(--signal)">${t("settings.conn.google.oauthMissing")}</span>`], [t("settings.conn.google.calendars"), `${go.agendaCalendars ? tn("settings.conn.google.calendarsLinked", go.agendaCalendars) : t("settings.conn.google.calendarsNone")} · <a href="#agenda/reglages">${t("settings.conn.google.configure")}</a>`]])}
    <div>${accs || `<div class="small muted">${t("settings.conn.google.noMailbox")}</div>`}</div>
    <div class="row" style="gap:8px;margin-top:auto;flex-wrap:wrap"><a class="btn sm ${go.accounts.length ? "ghost" : "ink"}" href="#channel/gmail">${go.accounts.length ? t("settings.conn.btn.manageSources") : t("settings.conn.btn.connectAccount")}</a><a class="btn sm ghost" href="#setup/google">${t("settings.conn.google.guide")}</a></div></div>`;

  const w = c.whatsapp;
  const waCard = `<div class="card ${w.enabled ? "live" : ""}"><div class="row" style="align-items:baseline"><h3>WhatsApp Desktop</h3><span style="margin-left:auto">${w.enabled ? (w.schemaOk === false ? status("bad", t("settings.conn.status.dbUnreadable")) : status("ok", t("settings.conn.status.plugged"))) : w.supported === false ? status("", t("settings.conn.status.macOnly")) : w.dbFound ? status("warn", t("settings.conn.status.readyToPlug")) : w.appInstalled ? status("", t("settings.conn.status.toConnect")) : status("", t("settings.conn.status.notInstalled"))}</span></div>
    ${kv([[t("settings.conn.wa.reading"), w.enabled ? tn("settings.conn.wa.listened", w.listened) : t("settings.conn.wa.localCopy")], [t("settings.conn.wa.db"), w.dbFound ? t("settings.conn.wa.synced", { ago: ago(w.dbUpdatedAt) }) : w.probed === false ? t("settings.conn.wa.notChecked") : t("settings.conn.wa.dbMissing")], w.lastIngest && [t("settings.conn.wa.lastPass"), t("settings.conn.wa.lastPassDetail", { ago: ago(w.lastIngest.at || w.lastIngest.finishedAt), windows: tn("settings.conn.wa.windows", w.lastIngest.windows ?? 0), calls: tn("settings.conn.wa.jevCalls", w.lastIngest.jevCalls ?? 0) })]])}
    <div style="margin-top:auto"><a class="btn sm ${w.enabled ? "ghost" : "ink"}" href="#channel/whatsapp">${w.enabled ? t("settings.conn.btn.manageChats") : t("settings.conn.btn.plug")}</a></div></div>`;

  const tg = c.telegram;
  const tgCard = `<div class="card ${tg.running ? "live" : ""}"><div class="row" style="align-items:baseline"><h3>Telegram</h3><span style="margin-left:auto">${!tg.tokenSet ? status("", t("settings.conn.status.noBot")) : tg.running ? status("ok", t("settings.conn.status.listening")) : tg.enabled ? status("bad", t("settings.conn.status.cantStart")) : status("warn", t("settings.conn.status.stopped"))}</span></div>
    ${kv([[t("settings.conn.tg.bot"), tg.botName ? t("settings.conn.tg.botToken", { name: h(tg.botName), source: h(secretSourceLabel(tg.tokenSource)) }) : t("settings.conn.tg.createWith")], [t("settings.conn.tg.owner"), tg.owner ? t("settings.conn.tg.ownerLinked", { name: h(tg.owner.name || t("common.you")) }) : t("settings.conn.tg.ownerNone")], [t("settings.conn.tg.contacts"), tn("settings.conn.tg.contactsLinked", tg.contacts)], tg.running && [t("settings.conn.tg.activity"), t("settings.conn.tg.activityDetail", { ago: ago(tg.lastPollAt), received: tn("settings.conn.tg.received", tg.stats.received), sent: tn("settings.conn.tg.sent", tg.stats.sent), calls: tn("settings.conn.tg.modelCalls", tg.stats.chatCalls) })], tg.lastError && [t("settings.conn.tg.error"), `<span style="color:var(--signal)">${h(tg.lastError)}</span>`]])}
    <div style="margin-top:auto"><a class="btn sm ${tg.running ? "ghost" : "ink"}" href="#channel/telegram">${tg.running ? t("settings.conn.btn.configure") : t("settings.conn.btn.plug")}</a></div></div>`;

  const l = c.local;
  const localCard = `<div class="card"><div class="row" style="align-items:baseline"><h3>${t("settings.conn.local.title")}</h3><span style="margin-left:auto">${status("ok", t("settings.conn.status.local"))}</span></div>
    ${kv([
      [t("settings.conn.local.server"), t("settings.conn.local.serverDetail", { port: l.port, node: h(l.node), ago: ago(l.startedAt) })],
      [t("settings.conn.local.db"), `${t("settings.conn.local.dbDetail", { size: fmtUnit(l.db.bytes / 1048576, "megabyte"), items: tn("settings.conn.local.items", l.db.items), decisions: tn("settings.conn.local.decisions", l.db.decisions) })}<div class="small muted"><code>${h(l.db.path)}</code></div>`],
      [t("settings.conn.local.config"), l.config.map((f) => `<code>${h(f.file)}</code>${f.exists ? ` <span class="muted small">${ago(f.updatedAt)}</span>` : ` <span class="small" style="color:var(--signal)">${t("settings.conn.local.missing")}</span>`}`).join("<br>")],
      [t("settings.conn.local.googleTokens"), `<code>${h(l.tokensDir)}</code>`],
      [t("settings.conn.local.cloud"), `<span class="muted">${t("settings.conn.local.cloudNote")}</span>`],
    ])}</div>`;

  // L'assistant du premier lancement reste accessible : refaire une étape (clé, client Google, boîte, fréquence).
  const setupCard = `<div class="card"><div class="row" style="align-items:baseline"><h3>${t("settings.conn.setup.title")}</h3></div>
    <div class="small muted">${t("settings.conn.setup.text")}</div>
    <div style="margin-top:auto"><a class="btn sm" href="#setup/welcome">${t("settings.conn.setup.open")}</a></div></div>`;
  const appCard = app ? `<div class="card"><div class="row" style="align-items:baseline"><h3>${t("settings.conn.app.title")}</h3><span style="margin-left:auto">${status("ok", window.molinova.version ? `Molinova ${window.molinova.version}` : "Molinova")}</span></div>${window.MOLINOVA_UPDATE ? `<div class="row" style="gap:10px;align-items:center;margin-top:6px"><span class="small"><b>${h(t("update.banner", { version: window.MOLINOVA_UPDATE.version }))}</b></span><a class="btn sm ink" href="${h(window.MOLINOVA_UPDATE.url)}" target="_blank" rel="noopener">${h(t("update.download"))}</a></div>` : ""}
    ${appSettingRows(app)}</div>` : "";

  return head("06", t("settings.conn.head.kicker"), t("settings.conn.head.title"), t("settings.conn.head.lead"), `<button class="btn ink" id="chk">${t("settings.conn.btn.check")}</button>`) +
    `<div class="conn">${gatewayCard}${googleCard}${waCard}${tgCard}${appCard}${localCard}${setupCard}</div>`;
};

// ---------- Réglages › Tokens et coûts
const USE = { days: "30" };
views.usage = async (rest = []) => {
  // La période vient de l'adresse (#usage/…) : un nombre de jours ou « all », rien d'autre ne s'affiche.
  if (rest[0]) USE.days = /^(\d{1,4}|all)$/.test(rest[0]) ? rest[0] : "30";
  let u, o;
  try { [u, o] = await Promise.all([api(`/usage?days=${encodeURIComponent(USE.days)}`), api("/overview")]); } catch (e) { return head("07", t("settings.usage.head.kicker"), t("nav.settings.usage"), e.message); }
  TAX = o.taxonomy;
  const periodLabel = { "7": t("period.7d"), "30": t("period.30d"), "90": t("period.90d"), all: t("settings.usage.period.all") }[USE.days] || t("settings.usage.period.days", { n: USE.days });
  const T = u.totals;
  const unknown = u.pricingKnown.filter((p) => !p.known);
  setTimeout(() => {
    document.querySelectorAll(".uopen").forEach((r) => r.addEventListener("click", () => openDrawer(Number(r.dataset.id))));
    $("#gwrefresh2")?.addEventListener("click", async () => {
      const b = $("#gwrefresh2"); b.disabled = true; b.textContent = t("settings.conn.btn.reading");
      try { gwRefreshed(await api("/gateway/refresh", { method: "POST" })); } catch (e) { toast(e.message); }
      route();
    });
  });

  const segLabels = { "7": t("settings.usage.seg.7"), "30": t("settings.usage.seg.30"), "90": t("settings.usage.seg.90"), all: t("settings.usage.seg.all") };
  const seg = `<div class="seg">${Object.keys(segLabels).map((k) => `<a href="#usage/${k}" class="${USE.days === k ? "on" : ""}" style="text-decoration:none;display:inline-block;padding:4px 13px;border-radius:999px;font-size:13px;color:${USE.days === k ? "var(--paper)" : "var(--g800)"};background:${USE.days === k ? "var(--ink)" : "transparent"};font-weight:${USE.days === k ? 600 : 400}">${segLabels[k]}</a>`).join("")}</div>`;
  const tile = (n, label, cls = "") => `<div class="tile ${cls}"><div class="tnum">${n}</div><div class="tlabel">${label}</div></div>`;
  const costSuffix = !T.calls ? "" : T.estimated === T.calls ? t("settings.usage.tile.costEstimated") : T.estimated ? tn("settings.usage.tile.costPartial", T.estimated, { total: fmt(T.calls) }) : t("settings.usage.tile.costReal");
  const tiles = `<div class="tiles">
    ${tile(fmtUsd(T.cost), t("settings.usage.tile.cost") + (costSuffix ? ` · ${costSuffix}` : ""), "strong")}
    ${tile(fmt(T.calls), t("settings.usage.tile.calls"))}
    ${tile(fmtTok(T.inputTokens), t("settings.usage.tile.in"))}
    ${tile(fmtTok(T.outputTokens), t("settings.usage.tile.out"))}
  </div>`;

  const share = (x, max) => `<div class="ubar"><div class="bar"><i style="width:${max ? Math.round((x / max) * 100) : 0}%"></i></div><span class="num muted" style="font-size:12px">${T.cost ? fmtPct(x / T.cost) : "—"}</span></div>`;
  const table = (title, note, col, rows, key) => {
    const max = Math.max(0, ...rows.map((r) => r.cost || 0));
    return `<section class="col" style="gap:8px"><div class="row" style="align-items:baseline"><h2>${title}</h2><span class="small muted" style="margin-left:auto">${note}</span></div>
      ${rows.length ? `<table class="usage"><thead><tr><th>${col}</th><th class="r">${t("settings.usage.th.calls")}</th><th class="r">${t("settings.usage.th.in")}</th><th class="r">${t("settings.usage.th.out")}</th><th class="r">${t("settings.usage.th.cost")}</th><th class="r">${t("settings.usage.th.perCall")}</th><th class="share">${t("settings.usage.th.share")}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${key(r)}</td><td class="r num">${fmt(r.calls)}</td><td class="r num">${fmtTok(r.inputTokens)}</td><td class="r num">${r.outputTokens == null ? "—" : fmtTok(r.outputTokens)}</td><td class="r num" style="color:var(--ink);font-weight:600">${fmtUsd(r.cost)}</td><td class="r num muted">${r.calls ? fmtUsd(r.cost / r.calls, 5) : "—"}</td><td class="share">${share(r.cost || 0, max)}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">${t("settings.usage.table.empty")}</div>`}</section>`;
  };
  const byPurpose = table(t("settings.usage.byPurpose.title"), t("settings.usage.byPurpose.note"), t("settings.usage.byPurpose.col"), u.byPurpose, (r) => `<b>${h(r.label)}</b>`);
  const byModel = table(t("settings.usage.byModel.title"), t("settings.usage.byModel.note"), t("settings.usage.byModel.col"), u.byModel, (r) => `<span class="mono" style="text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)">${h(r.model)}</span>`);
  const srcLabel = { gmail: "Gmail", whatsapp: "WhatsApp", telegram: "Telegram" };
  const bySource = table(t("settings.usage.bySource.title"), t("settings.usage.bySource.note"), t("settings.usage.bySource.col"), u.bySource, (r) => `<b>${h(srcLabel[r.source] || r.source)}</b>`);
  const byCat = table(t("settings.usage.byCat.title"), t("settings.usage.byCat.note"), t("common.category"), u.byCategory.map((r) => ({ ...r, outputTokens: null })), (r) => (r.category ? chip(r.category) : `<span class="chip">${t("settings.usage.byCat.none")}</span>`));

  const days = u.byDay;
  const maxD = Math.max(0, ...days.map((d) => d.cost));
  const monthly = USE.days === "all" || Number(USE.days) > 92;
  const dayLabel = (d) => (monthly ? fmtDate(d + "-01", { month: "short", year: "2-digit" }) : fmtDate(d, { day: "numeric", month: "short" }));
  const chart = days.length ? `<section class="col" style="gap:6px"><div class="row" style="align-items:baseline"><h2>${monthly ? t("settings.usage.byMonth.title") : t("settings.usage.byDay.title")}</h2><span class="small muted" style="margin-left:auto">${monthly ? t("settings.usage.byMonth.note", { period: periodLabel }) : t("settings.usage.byDay.note", { period: periodLabel })}</span></div>
    <div class="udays">${days.map((d) => `<div class="d"><span class="tip">${t("settings.usage.chart.tip", { day: dayLabel(d.day), cost: fmtUsd(d.cost), calls: tn("settings.usage.count.calls", d.calls), tokens: fmtTok(d.tokens) })}</span><i style="height:${maxD ? Math.max(2, Math.round((d.cost / maxD) * 100)) : 2}%"></i></div>`).join("")}</div>
    <div class="uaxis"><span>${dayLabel(days[0].day)}</span><span>${days.length > 1 ? dayLabel(days[days.length - 1].day) : ""}</span></div></section>` : "";

  // Les sept sujets d'appel connus ; un sujet inconnu s'affiche tel quel.
  const P = { classify: t("settings.usage.purpose.classify"), reclassify: t("settings.usage.purpose.reclassify"), test: t("settings.usage.purpose.test"), draft: t("settings.usage.purpose.draft"), extract_event: t("settings.usage.purpose.extract_event"), extract_task: t("settings.usage.purpose.extract_task"), chat: t("settings.usage.purpose.chat"), doc_classify: t("settings.usage.purpose.doc_classify"), doc_search: t("settings.usage.purpose.doc_search") };
  const recent = `<section class="col" style="gap:8px"><div class="row" style="align-items:baseline"><h2>${t("settings.usage.recent.title")}</h2><span class="small muted" style="margin-left:auto">${t("settings.usage.recent.note")}</span></div>
    ${u.recent.length ? `<table class="usage"><thead><tr><th style="width:120px">${t("settings.usage.th.when")}</th><th style="width:110px">${t("settings.usage.byPurpose.col")}</th><th>${t("settings.usage.th.item")}</th><th style="width:200px">${t("settings.usage.byModel.col")}</th><th class="r" style="width:90px">${t("settings.usage.th.tokens")}</th><th class="r" style="width:90px">${t("settings.usage.th.cost")}</th></tr></thead><tbody>
      ${u.recent.map((r) => `<tr class="${r.itemId ? "clickable uopen" : ""}" data-id="${r.itemId ?? ""}"><td class="num muted" style="text-align:left;font-size:12px">${ago(r.at)}</td><td><span class="pill">${P[r.purpose] || h(r.purpose)}</span></td><td class="cell">${r.subject ? `${r.category ? chip(r.category) + " " : ""}<span title="${h(r.subject)}">${h(r.subject)}</span> <span class="muted small">· ${h(r.from || "")}</span>` : `<span class="muted">—</span>`}</td><td class="cell mono" style="text-transform:none;letter-spacing:0;font-size:12px">${h(r.model)}</td><td class="r num">${fmtTok(r.inputTokens + r.outputTokens)}</td><td class="r num">${fmtUsd(r.cost)}${r.estimated ? "" : ` <span title="${t("settings.usage.recent.realCost")}" style="color:#0c7a56">●</span>`}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">${t("settings.usage.recent.empty")}</div>`}</section>`;

  const note = `<div class="small muted">${t("settings.usage.note.text", { dot: `<span style="color:#0c7a56">●</span>`, fetched: u.pricingFetchedAt ? ` ${ago(u.pricingFetchedAt)}` : "", calls: tn("settings.usage.count.calls", u.allTime.calls), cost: fmtUsd(u.allTime.cost) })}${unknown.length ? ` <span style="color:var(--signal)">${t("settings.usage.note.unknownPricing", { models: unknown.map((p) => `<code>${h(p.model)}</code>`).join(", ") })}</span> : <button class="btn link" id="gwrefresh2">${t("settings.usage.btn.reloadPricing")}</button>.` : ""}</div>`;

  return head("07", t("settings.usage.head.kicker"), t("settings.usage.head.title"), t("settings.usage.head.lead"), seg) +
    `<div class="col" style="gap:28px">${tiles}${note}${byPurpose}<div class="row" style="align-items:flex-start"><div class="grow">${byModel}</div><div class="grow">${bySource}</div></div>${byCat}${chart}${recent}</div>`;
};
