/* Canaux › Telegram : Molinova dans la poche. Brancher le bot, relier son téléphone (QR code ou lien t.me), relier des
   proches, régler ce qu'il envoie. Rien ici n'appelle l'IA : la page lit et écrit des réglages.
   Textes : ui/lang/<langue>/telegram.js (clés telegram.*) ; le « il y a … » vient de ago() dans i18n.js. */

const TGV = { st: null, pairing: null, invite: null };

const tgRow = (label, control, note = "") => `<div class="task" style="grid-template-columns:minmax(0,1fr) auto;align-items:center"><span>${label}${note ? `<div class="small muted">${note}</div>` : ""}</span><span class="small" style="display:flex;gap:6px;align-items:center">${control}</span></div>`;
/** QR code en SVG (ui/vendor/qrcode.js), toujours noir sur blanc pour que le téléphone le lise. */
function qrSvg(text, px = 176) {
  if (typeof qrcode !== "function") return "";
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="${t("telegram.qr.alt")}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#1b1c1f"/></svg>`;
}
/** Le lien qui ouvre le bot et lui envoie « /start <code> » : rien à recopier. */
const pairLink = (bot, code) => `https://t.me/${bot}?start=${code}`;
/** QR + lien + code de secours, pour se relier soi-même ou pour inviter un proche. */
function pairBlock(bot, p, note) {
  const link = bot ? pairLink(bot, p.code) : null;
  const mins = Math.max(1, Math.round((new Date(p.expires).getTime() - Date.now()) / 60000));
  return `<div class="tgpair">${link ? qrSvg(link) : ""}<div class="col" style="gap:8px;min-width:0">
    <div style="font-weight:600">${note}</div>
    ${link ? `<div class="small"><a href="${link}" target="_blank" rel="noopener" class="mono" style="text-transform:none;letter-spacing:0;color:var(--ink)">${h(link.replace("https://", ""))}</a> <button class="btn sm ghost tgcopy" data-link="${h(link)}">${t("telegram.qr.copy")}</button></div>` : ""}
    <div class="small muted">${t("telegram.qr.fallback", { code: tgCode(p.code) })}</div>
    <div class="small muted">${tn("telegram.qr.expires", mins)}</div>
  </div></div>`;
}
const tgCode = (code) => `<span class="mono" style="font-size:14px;letter-spacing:.2em;color:var(--ink);background:#fff;border:1px solid var(--g200);border-radius:6px;padding:2px 8px;display:inline-block">${h(code)}</span>`;

async function viewTelegram() {
  let st;
  try { st = await api("/telegram/status"); } catch (e) { return head("", t("telegram.head.kicker"), t("telegram.head.title"), e.message); }
  TGV.st = st;
  const [wst, cals] = await Promise.all([api("/whatsapp/status").catch(() => null), api("/agenda/calendars").catch(() => null)]);
  const members = wst?.members || [];
  // Tous les agendas du compte, même ceux masqués dans l'Agenda : un proche peut suivre l'agenda de l'école d'un enfant.
  const calendars = cals?.calendars || [];
  const botLink = st.botName ? `https://t.me/${st.botName}` : null;
  const pairing = st.pairing && st.pairing.kind === "owner" ? st.pairing : null;
  const invite = st.pairing && st.pairing.kind === "contact" ? st.pairing : null;
  const spouse = members.find((m) => m.key === "spouse");
  const kidName = members.find((m) => m.kind === "child")?.name || t("telegram.pocket.aKid");

  // Un code est affiché : on guette la liaison (le téléphone a scanné) pour basculer la page sans rechargement.
  // Un seul guet à la fois : chaque rendu de la page remplace le précédent.
  const watchId = TGV.watchId = (TGV.watchId || 0) + 1;
  if (st.pairing) {
    const code = st.pairing.code;
    const watch = async () => {
      if (location.hash !== "#channel/telegram" || watchId !== TGV.watchId) return;
      try { const now = await api("/telegram/status"); if (now.pairing?.code !== code || (!!now.owner) !== (!!st.owner) || now.contacts.length !== st.contacts.length) { refreshLive(); return route(); } } catch {}
      setTimeout(watch, 3000);
    };
    setTimeout(watch, 3000);
  }
  setTimeout(() => {
    document.querySelectorAll(".tgcopy").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.link); toast(t("telegram.qr.copied")); } catch { toast(b.dataset.link); } }));
    const save = async (patch) => { try { await api("/telegram/settings", { method: "PUT", body: patch }); toast(t("telegram.toast.saved")); } catch (e) { toast(e.message); } };
    $("#tgtoken-save")?.addEventListener("click", async () => {
      const b = $("#tgtoken-save"); b.disabled = true; b.textContent = t("telegram.btn.checking");
      try { const r = await api("/telegram/token", { method: "POST", body: { token: $("#tgtoken").value } }); toast(t("telegram.toast.botRecognized", { name: r.botName })); route(); }
      catch (e) { toast(e.message); b.disabled = false; b.textContent = t("common.save"); }
    });
    $("#tgtoken-del")?.addEventListener("click", async () => { if (!confirm(t("telegram.confirm.removeToken"))) return; try { await api("/telegram/token", { method: "DELETE" }); route(); } catch (e) { toast(e.message); } });
    $("#tgplug")?.addEventListener("click", async () => {
      const b = $("#tgplug"); b.disabled = true; b.textContent = t("telegram.btn.starting");
      try { await api("/telegram/enable", { method: "POST" }); toast(t("telegram.toast.listening")); refreshLive(); route(); } catch (e) { toast(e.message); route(); }
    });
    $("#tgunplug")?.addEventListener("click", async () => { if (!confirm(t("telegram.confirm.stop"))) return; try { await api("/telegram/disable", { method: "POST" }); toast(t("telegram.toast.stopped")); refreshLive(); route(); } catch (e) { toast(e.message); } });
    $("#tgpair")?.addEventListener("click", async () => { try { await api("/telegram/pair", { method: "POST" }); route(); } catch (e) { toast(e.message); } });
    $("#tgunpair")?.addEventListener("click", async () => { if (!confirm(t("telegram.confirm.unpair"))) return; try { await api("/telegram/unpair", { method: "POST" }); route(); } catch (e) { toast(e.message); } });
    $("#tginvite")?.addEventListener("click", async () => {
      const key = $("#tginvite-who").value, name = key === "other" ? $("#tginvite-name").value.trim() : (members.find((m) => m.key === key)?.name || "");
      if (!name) { toast(t("telegram.toast.needName")); return; }
      try { await api("/telegram/invite", { method: "POST", body: { key: key === "other" ? "" : key, name } }); route(); } catch (e) { toast(e.message); }
    });
    $("#tginvite-who")?.addEventListener("change", () => { $("#tginvite-name").style.display = $("#tginvite-who").value === "other" ? "" : "none"; });
    document.querySelectorAll(".tgc-agent").forEach((b) => b.addEventListener("click", async () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); try { await api(`/telegram/contacts/${b.dataset.id}`, { method: "PUT", body: { agent: on } }); toast(on ? t("telegram.toast.contactAgent") : t("telegram.toast.contactRelay")); } catch (e) { toast(e.message); } }));
    document.querySelectorAll(".tgc-week").forEach((b) => b.addEventListener("click", async () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); try { await api(`/telegram/contacts/${b.dataset.id}`, { method: "PUT", body: { weekDigest: on } }); toast(t("telegram.toast.saved")); } catch (e) { toast(e.message); } }));
    const putContact = async (id, patch) => { try { await api(`/telegram/contacts/${id}`, { method: "PUT", body: patch }); toast(t("telegram.toast.saved")); } catch (e) { toast(e.message); } };
    document.querySelectorAll(".tgc-member").forEach((sel) => sel.addEventListener("change", async () => { await putContact(sel.dataset.id, { member: sel.value || null }); route(); }));
    const checked = (cls, id) => [...document.querySelectorAll(`.${cls}[data-id="${id}"]`)].filter((x) => x.checked).map((x) => x.value);
    document.querySelectorAll(".tgc-follow").forEach((b) => b.addEventListener("change", () => putContact(b.dataset.id, { follows: checked("tgc-follow", b.dataset.id) })));
    document.querySelectorAll(".tgc-cal").forEach((b) => b.addEventListener("change", () => putContact(b.dataset.id, { calendars: checked("tgc-cal", b.dataset.id) })));
    // Documents du Drive : chercher et recevoir, puis les documents sensibles (seulement si le premier est permis).
    document.querySelectorAll(".tgc-flag").forEach((b) => b.addEventListener("click", async (e) => { e.preventDefault(); const on = !b.classList.contains("on"); b.classList.toggle("on", on); await putContact(b.dataset.id, { [b.dataset.k]: on }); if (b.dataset.k === "drive") route(); }));
    document.querySelectorAll(".tgc-send").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); const on = !b.classList.contains("on"); b.classList.toggle("on", on); putContact(b.dataset.id, { sends: { [b.dataset.k]: on } }); }));
    document.querySelectorAll(".tgc-del").forEach((b) => b.addEventListener("click", async () => { if (!confirm(t("telegram.confirm.removeContact", { name: b.dataset.name }))) return; try { await api(`/telegram/contacts/${b.dataset.id}`, { method: "DELETE" }); route(); } catch (e) { toast(e.message); } }));
    ["morning", "weekly", "quietFrom", "quietTo"].forEach((k) => $(`#tg-${k}`)?.addEventListener("change", () => save({ [k]: $(`#tg-${k}`).value })));
    ["everyMinutes", "replyAfterDays"].forEach((k) => $(`#tg-${k}`)?.addEventListener("change", () => save({ [k]: Number($(`#tg-${k}`).value) })));
    $("#tg-reminders")?.addEventListener("click", () => { const on = !$("#tg-reminders").classList.contains("on"); $("#tg-reminders").classList.toggle("on", on); save({ reminders: on }); });
    document.querySelectorAll(".tgsend").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { const r = await api("/telegram/send", { method: "POST", body: { kind: b.dataset.kind } }); toast(r.sent ? t("telegram.toast.sent") : t("telegram.toast.nothingToSend")); } catch (e) { toast(e.message); }
      b.disabled = false;
    }));
  });

  const right = st.tokenSet ? (st.enabled ? `<button class="btn ghost" id="tgunplug">${t("telegram.btn.stop")}</button>` : `<button class="btn ink" id="tgplug">${t("telegram.btn.start")}</button>`) : "";
  const state = !st.tokenSet ? t("telegram.status.noBot") : !st.enabled ? t("telegram.status.stopped") : st.running ? t("telegram.status.listening", { name: h(st.botName) }) : t("telegram.status.cantStart");
  const stateNote = st.lastError
    ? `<span style="color:var(--signal)">${h(st.lastError)}</span>`
    : st.running
      ? t("telegram.state.activity", { ago: ago(st.lastPollAt), received: tn("telegram.count.received", st.stats.received), sent: tn("telegram.count.sent", st.stats.sent), calls: tn("telegram.count.modelCalls", st.stats.chatCalls), tokens: fmt(st.stats.inputTokens + st.stats.outputTokens) })
      : t("telegram.state.onlyWhenOpen");

  const botfather = `<a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>`;
  const tokenCard = st.tokenSet
    ? `<div class="task" style="grid-template-columns:1fr auto"><span><b>${t("telegram.token.title")}</b><div class="small muted">${st.tokenSource === "kv" ? t("telegram.token.fromApp") : t("telegram.token.from", { source: h(secretSourceLabel(st.tokenSource)) })}${botLink ? ` · <a href="${botLink}" target="_blank" rel="noopener">${botLink.replace("https://", "")}</a>` : ""}</div></span>${st.tokenSource !== "env" ? `<button class="btn sm" id="tgtoken-del">${t("common.remove")}</button>` : ""}</div>`
    : `<div class="tasks">
        <div class="task" style="grid-template-columns:28px 1fr"><span class="pill strong" style="text-align:center">1</span><span>${t("telegram.token.step1", { botfather })}</span></div>
        <div class="task" style="grid-template-columns:28px 1fr"><span class="pill strong" style="text-align:center">2</span><span>${t("telegram.token.step2")}</span></div>
        <div class="task" style="grid-template-columns:28px 1fr"><span class="pill strong" style="text-align:center">3</span><span style="display:flex;gap:8px"><input type="text" id="tgtoken" placeholder="${t("telegram.token.placeholder")}" autocomplete="off" spellcheck="false" style="font-family:var(--mono)"><button class="btn ink" id="tgtoken-save" style="flex-shrink:0">${t("common.save")}</button></span></div>
      </div>
      ${window.molinova?.isApp ? "" : `<div class="small muted" style="margin-top:8px">${t("telegram.token.orEnv")}</div>`}`;

  // Le téléphone du propriétaire : relié, en cours de liaison (QR), ou à relier.
  const phone = st.owner
    ? `<div class="col" style="gap:8px"><div class="tgok">✓</div><div style="font-weight:600">${t("telegram.owner.linked", { name: h(st.owner.name || t("common.you")) })}</div><div class="small muted">${t("telegram.owner.since", { date: fmtDate(st.owner.pairedAt) })}${botLink ? ` · <a href="${botLink}" target="_blank" rel="noopener">@${h(st.botName)}</a>` : ""}</div><div><button class="btn sm ghost" id="tgunpair">${t("telegram.btn.unpair")}</button></div></div>`
    : pairing
      ? `${pairBlock(st.botName, pairing, t("telegram.qr.scan"))}<div><button class="btn sm ghost" id="tgpair">${t("telegram.btn.newCode")}</button></div>`
      : st.running
        ? `<div class="col" style="gap:10px"><div style="font-weight:600">${t("telegram.owner.notLinked")}</div><div class="small muted">${t("telegram.pair.explainQr")}</div><div><button class="btn ink" id="tgpair">${t("telegram.btn.linkPhone")}</button></div></div>`
        : st.tokenSet
          ? `<div class="col" style="gap:10px"><div style="font-weight:600">${t("telegram.pair.startFirst")}</div><div><button class="btn ink" id="tgplug">${t("telegram.btn.start")}</button></div></div>`
          : `<div class="col" style="gap:10px"><div style="font-weight:600">${t("telegram.pair.createFirst")}</div><div class="small muted">${t("telegram.pair.createFirstNote")}</div></div>`;
  const hero = `<div class="card tghero"><div class="tghero-phone">${phone}</div>
    <div class="tghero-what"><div class="mono">${t("telegram.pocket.can")}</div>
      <ul>${["morning", "add", "ask", "remind"].map((k) => `<li>${t("telegram.pocket." + k, { kid: h(kidName) })}</li>`).join("")}</ul>
      <div class="small muted">${t("telegram.pocket.never")}</div></div></div>`;

  // Un proche : qui il est dans le foyer, ce qu'il suit (couloirs, agendas Google), ce que Molinova lui envoie.
  const memberOf = (c) => c.member || (members.some((m) => m.key === c.key && m.key !== "family") ? c.key : "");
  const followsOf = (c) => c.follows || [memberOf(c), "family"].filter(Boolean);
  const toggle = (cls, c, on, label, note = "", k = "") => `<label class="tgc-send"><button class="toggle ${cls} ${on ? "on" : ""}" data-id="${c.chatId}" ${k ? `data-k="${k}"` : ""} aria-label="${h(label)}"></button><span>${h(label)}${note ? `<span class="muted" style="display:block;font-size:12px">${h(note)}</span>` : ""}</span></label>`;
  const contactsList = st.contacts.length
    ? st.contacts.map((c) => {
      const me = memberOf(c), follows = followsOf(c), sends = c.sends || {};
      return `<div class="tgct" data-id="${c.chatId}">
        <div class="row" style="align-items:center;gap:10px"><b style="font-size:16px">${h(c.name)}</b><span class="small muted">${t("telegram.rel.linked")}</span><button class="btn sm ghost tgc-del" data-id="${c.chatId}" data-name="${h(c.name)}" style="margin-left:auto">${t("common.remove")}</button></div>
        <div class="tgct-grid">
          <div class="mono">${t("telegram.rel.is")}</div>
          <div><select class="tgc-member" data-id="${c.chatId}" style="width:auto;height:34px"><option value="">${t("telegram.rel.notMember")}</option>${members.filter((m) => m.key !== "family").map((m) => `<option value="${h(m.key)}" ${m.key === me ? "selected" : ""}>${h(m.name)}</option>`).join("")}</select></div>
          <div class="mono">${t("telegram.rel.follows")}</div>
          <div class="tgc-checks">${members.map((m) => `<label><input type="checkbox" class="tgc-follow" data-id="${c.chatId}" value="${h(m.key)}" ${follows.includes(m.key) ? "checked" : ""}>${h(m.name)}</label>`).join("")}</div>
          ${calendars.length ? `<div class="mono">${t("telegram.rel.calendars")}</div><div class="tgc-checks">${calendars.map((x) => `<label><input type="checkbox" class="tgc-cal" data-id="${c.chatId}" value="${h(x.id)}" ${(c.calendars || []).includes(x.id) ? "checked" : ""}>${h(x.name)}</label>`).join("")}</div>` : ""}
        </div>
        <div class="tgct-sends">
          ${toggle("tgc-agent", c, c.agent !== false, t("telegram.contact.agent"), t("telegram.contact.agentNote"))}
          ${toggle("tgc-flag", c, !!c.drive, t("telegram.contact.drive"), t("telegram.contact.driveNote"), "drive")}
          ${c.drive ? toggle("tgc-flag", c, !!c.driveSensitive, t("telegram.contact.driveSensitive"), t("telegram.contact.driveSensitiveNote"), "driveSensitive") : ""}
          ${toggle("tgc-send", c, !!sends.morning, t("telegram.rel.sendMorning"), t("telegram.rel.sendMorningNote", { time: st.schedule.morning }), "morning")}
          ${toggle("tgc-send", c, !!sends.reminders, t("telegram.rel.sendReminders"), t("telegram.rel.sendRemindersNote"), "reminders")}
          ${toggle("tgc-send", c, !!sends.live, t("telegram.rel.sendLive"), t("telegram.rel.sendLiveNote"), "live")}
          ${toggle("tgc-week", c, !!c.weekDigest, t("telegram.contact.week"), t("telegram.rel.sendWeekNote", { time: st.schedule.weekly }))}
        </div>
      </div>`;
    }).join("")
    : `<div class="small muted">${t("telegram.contacts.empty")}</div>`;
  const relHow = `<ul class="tghow">${["invite", "talk", "follow", "sends", "you"].map((k) => `<li>${t("telegram.rel.how." + k)}</li>`).join("")}</ul>`;
  const inviteBlock = invite
    ? `<div style="margin-top:12px">${pairBlock(st.botName, invite, t("telegram.invite.scan", { name: h(invite.name) }))}</div>`
    : `<div class="row" style="align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap"><select id="tginvite-who" style="width:auto">${spouse ? `<option value="spouse">${h(spouse.name)}</option>` : ""}<option value="other" ${spouse ? "" : "selected"}>${t("telegram.invite.other")}</option></select><input type="text" id="tginvite-name" placeholder="${t("telegram.invite.placeholder")}" style="width:180px;${spouse ? "display:none" : ""}"><button class="btn sm" id="tginvite" ${st.running ? "" : "disabled"}>${t("telegram.btn.invite")}</button></div>`;

  const s = st.schedule;
  const timeInput = (id, v) => `<input type="time" id="tg-${id}" value="${h(v)}" style="height:36px;padding:0 10px;border:1px solid var(--g200);border-radius:8px;background:#fff">`;
  const numInput = (id, v, min, max) => `<input type="number" id="tg-${id}" min="${min}" max="${max}" value="${v}" style="width:80px;height:36px">`;
  const sendBtn = (kind, label) => `<button class="btn sm tgsend" data-kind="${kind}" ${st.owner && st.running ? "" : "disabled"}>${label}</button>`;
  const model = `<span class="mono" style="text-transform:none;letter-spacing:0">google/gemini-3.1-flash-lite</span>`;
  const statusCard = `<div class="card"><div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="grow"><div class="mono">${t("common.status")}</div><div style="font-size:17px;font-weight:600">${state}</div><div class="small muted">${stateNote}</div></div>
      <div><div class="mono">${t("telegram.digest.label")}</div><div style="font-size:17px;font-weight:600">${ago(st.lastDigest)}</div><div class="small muted">${t("telegram.digest.times", { morning: h(s.morning), weekly: h(s.weekly) })}</div></div>
    </div></div>`;
  const tokenBlock = `<div class="card col" style="gap:4px"><h3>${t("telegram.card.bot")}</h3>${tokenCard}</div>`;
  return head("", t("telegram.head.kicker"), t("telegram.head.title"), t("telegram.head.lead"), right) +
    hero +
    (st.tokenSet ? "" : tokenBlock) +
    `<div class="card col" style="gap:10px"><h3>${t("telegram.card.contacts")}</h3>${relHow}${contactsList}${inviteBlock}</div>
    <div class="row" style="flex-wrap:wrap">
      <div class="card col" style="gap:4px;flex:1 1 440px;min-width:0"><h3>${t("telegram.auto.title")}</h3><div class="small muted" style="margin-bottom:6px">${t("telegram.auto.note")}</div>
        <div class="tasks">
          ${tgRow(t("telegram.auto.morning"), timeInput("morning", s.morning), t("telegram.auto.morningNote"))}
          ${tgRow(t("telegram.auto.weekly"), timeInput("weekly", s.weekly), t("telegram.auto.weeklyNote"))}
          ${tgRow(t("telegram.auto.reminders"), t("telegram.auto.remindersControl", { toggle: `<button class="toggle ${s.reminders ? "on" : ""}" id="tg-reminders" aria-label="${t("telegram.auto.reminders")}"></button>`, input: numInput("everyMinutes", s.everyMinutes, 5, 720) }), t("telegram.auto.remindersNote"))}
          ${tgRow(t("telegram.auto.quiet"), t("telegram.auto.quietControl", { from: timeInput("quietFrom", s.quietFrom), to: timeInput("quietTo", s.quietTo) }), t("telegram.auto.quietNote"))}
          ${tgRow(t("telegram.auto.replyAfter"), t("telegram.auto.replyAfterControl", { input: numInput("replyAfterDays", s.replyAfterDays, 1, 30) }), t("telegram.auto.replyAfterNote"))}
        </div></div>
      <div class="card col" style="flex:1 1 300px;min-width:0;gap:8px"><h3>${t("telegram.try.title")}</h3><div class="small muted">${t("telegram.try.note")}</div>
        ${sendBtn("day", t("telegram.try.day"))}
        ${sendBtn("week", t("telegram.try.week"))}
        ${sendBtn("reminders", t("telegram.try.reminders"))}
        ${sendBtn("help", t("telegram.try.help"))}
        <div class="small muted" style="margin-top:6px">${t("telegram.try.cost", { model })}</div>
      </div>
    </div>
    ${statusCard}
    ${st.tokenSet ? tokenBlock : ""}`;
}
