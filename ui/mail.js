/* Vue « Boîte » : liste au centre, lecture à droite, actions Répondre / Transférer / Archiver, rédaction IA.
   Le volet de lecture (renderRead, mailAction, openCompose, openEvent) sert aussi à la page Actions (actions.js).
   Textes : ui/lang/<langue>/mail.js. */

/** Filtre courant = état + actions + catégorie, cumulés dans une chaîne "a+b+c". */
function buildFilter(f) { return [f.state && f.state !== "all" ? f.state : "", ...(f.actions || []), f.cat ? "cat:" + f.cat : "", f.domain ? "domain:" + f.domain : "", f.date ? "date:" + f.date : ""].filter(Boolean).join("+") || "all"; }
function parseFilter(str) { const f = { state: "all", actions: [], cat: "", domain: "", date: "" }; for (const tok of (str || "all").split("+")) { if (tok.startsWith("cat:")) f.cat = tok.slice(4); else if (tok.startsWith("domain:")) f.domain = tok.slice(7); else if (tok.startsWith("date:")) f.date = tok.slice(5); else if (["reply", "followUp", "important", "toPay", "event", "task"].includes(tok)) f.actions.push(tok); else if (tok && tok !== "all") f.state = tok; } return f; }
const MAIL = { mode: "mail", box: "inbox", sort: (() => { try { return localStorage.getItem("ea.sort") || "date"; } catch { return "date"; } })(), filter: "all", account: "", q: "", rows: [], total: 0, selected: null, full: null, compose: null, accounts: [] };
const MAIL_STATES = ["all", "unread", "review", "noise", "done", "past", "filed"];
/** Dossiers de la Boîte (sous-menu de gauche) : Reçus, Envoyés, Brouillons. */
const MAIL_BOXES = ["inbox", "sent", "drafts"];
/** Le filtre envoyé au serveur : celui des pastilles, limité au dossier (reçus ou envoyés). Les actions groupées le reprennent. */
function boxFilter() { return [MAIL.box === "sent" ? "sent" : "received", MAIL.filter].filter(Boolean).join("+"); }
const MAIL_ACTIONS = ["reply", "followUp", "important", "toPay", "event", "task"];

/** Date d'une ligne : l'heure si c'est aujourd'hui, sinon jour et mois (et l'année si elle diffère), dans la locale de la langue. */
function fmtMailDate(d) {
  const when = new Date(d), now = new Date();
  if (when.toDateString() === now.toDateString()) return fmtTime(when);
  if (when.getFullYear() === now.getFullYear()) return fmtDate(when, { day: "2-digit", month: "short" });
  return fmtDate(when, { day: "2-digit", month: "short", year: "2-digit" });
}
function stage(r) {
  if (r.decided_by === "user") return [t("mail.stage.corrected"), "strong"];
  if (r.needs_review) return [t("common.toReview"), ""];
  if (r.applied_at) return [t("mail.stage.labeled"), ""];
  return [t("mail.stage.preview"), ""];
}
/** Les signaux bruts d'un email (clés, pas libellés) : pour décider sans dépendre de la langue de flagsOf(). */
function rawFlags(r) { try { return r.flags_json ? JSON.parse(r.flags_json) : r.flags || {}; } catch { return {}; } }

async function loadMailList() {
  // Depuis le volet de la page Actions, c'est sa liste qui se recharge.
  if (MAIL.mode === "actions") return MAIL.reload?.();
  // Brouillons : lus chez Gmail à chaque ouverture (ils changent sans cesse) ; la recherche filtre sur place.
  if (MAIL.box === "drafts") {
    const r = await api("/drafts" + (MAIL.account ? `?account=${encodeURIComponent(MAIL.account)}` : ""));
    const q = MAIL.q.trim().toLowerCase();
    MAIL.rows = r.rows.filter((d) => !q || `${d.to} ${d.subject} ${d.snippet}`.toLowerCase().includes(q)).map((d) => ({ id: `d:${d.accountId}:${d.messageId}`, draft: d, subject: d.subject, date: d.date }));
    MAIL.total = MAIL.rows.length;
    if (r.errors.length) toast(r.errors.join(" · "));
    renderMailList();
    return;
  }
  const p = new URLSearchParams({ filter: boxFilter(), limit: "120", sort: MAIL.sort });
  if (MAIL.account) p.set("account", MAIL.account);
  if (MAIL.q) p.set("q", MAIL.q);
  const r = await api("/mail?" + p.toString());
  MAIL.rows = r.rows;
  MAIL.total = r.total;
  renderMailList();
}

/** Le groupe d'un email dans la file Actions : un seul, le plus urgent. Même règle que le serveur. */
function groupOf(r) {
  const f = rawFlags(r);
  return f.important ? "important" : f.reply ? "reply" : f.followUp ? "followUp" : f.toPay ? "toPay" : f.event ? "event" : f.task ? "task" : "read";
}
function renderMailList() {
  const list = $("#maillist");
  if (!list) return;
  const strongFlag = t("flags.important");
  list.innerHTML = MAIL.rows.map((r) => {
    if (r.draft) {
      const d = r.draft;
      return `<div class="mrow ${MAIL.selected === r.id ? "sel" : ""}" data-id="${h(r.id)}">
        <div class="mdot"></div>
        <div class="mmain"><div class="mtop"><span class="mfrom">${h(d.to ? `→ ${d.to}` : t("mail.draft.noTo"))}</span><span class="mdate">${d.date ? fmtMailDate(d.date) : ""}</span></div>
          <div class="msub">${d.hasAttachments ? `<span title="${t("mail.attachment")}">⌘</span> ` : ""}${h(d.subject || t("common.noSubject"))}</div>
          <div class="mmeta"><span class="pill">${t("mail.draft.pill")}</span><span class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(d.snippet)}</span></div></div>
      </div>`;
    }
    const f = flagsOf(r);
    const sel = MAIL.selected === r.id ? "sel" : "";
    return `<div class="mrow ${sel}" data-id="${r.id}">
      <div class="mdot">${dot(r)}</div>
      <div class="mmain"><div class="mtop"><span class="mfrom">${h(whoLabel(r))}</span><span class="mdate">${fmtMailDate(r.date)}</span></div>
        <div class="msub">${r.has_attachments ? `<span title="${t("mail.attachment")}">⌘</span> ` : ""}${h(r.subject || t("common.noSubject"))}</div>
        <div class="mmeta">${r.needs_review ? `<span class="chip">${t("common.toReview")}</span>` : chip(r.category)}${r.action_state === 1 ? `<span class="pill strong">${t("mail.pill.out")}</span>` : r.action_state === 2 ? `<span class="pill">${t("mail.pill.ignored")}</span>` : f.map((x) => `<span class="pill ${x === strongFlag ? "strong" : ""}">${x}</span>`).join("")}</div></div>
    </div>`;
  }).join("") || `<div class="empty" style="margin:16px">${t("mail.empty.filter")}</div>`;
  $("#mailcount").textContent = t("mail.count", { shown: fmtNum(MAIL.rows.length), total: fmtNum(MAIL.total) });
  renderBulkBar();
  list.querySelectorAll(".mrow").forEach((el) => el.addEventListener("click", () => (el.dataset.id.startsWith("d:") ? selectDraft(el.dataset.id) : selectMail(Number(el.dataset.id)))));
}

/** Menu de catégories en pastilles colorées, à la place d'un <select> qui ne sait pas afficher les couleurs. */
function catPicker(host, { value = "", allLabel = null, placeholder = null, onPick }) {
  if (!host) return;
  const ph = placeholder ?? t("common.all");
  const render = () => {
    const c = TAX.categories.find((x) => x.key === host.dataset.value);
    host.innerHTML = `<button type="button" class="fchip catbtn ${c ? "" : ""}" style="${c ? `background:${c.color.background};color:${c.color.text};border-color:${c.color.background};font-weight:600` : ""}">${c ? h(c.name) : h(ph)} <span class="muted" style="font-size:11px">▾</span></button>`;
    host.querySelector(".catbtn").onclick = (e) => { e.stopPropagation(); openMenu(); };
  };
  const openMenu = () => {
    document.querySelectorAll(".catmenu").forEach((m) => m.remove());
    const menu = document.createElement("div");
    menu.className = "catmenu";
    menu.innerHTML = (allLabel ? `<button type="button" class="fchip" data-k="">${h(allLabel)}</button>` : "") + TAX.categories.map((c) => `<button type="button" class="fchip" data-k="${c.key}" style="background:${c.color.background};color:${c.color.text};border-color:${c.color.background};font-weight:600">${h(c.name)}</button>`).join("");
    host.appendChild(menu);
    menu.querySelectorAll("[data-k]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); host.dataset.value = b.dataset.k; menu.remove(); render(); onPick(b.dataset.k); }));
    const close = (e) => { if (!host.contains(e.target)) { menu.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close));
  };
  host.dataset.value = value;
  render();
}

/** Actions sur tous les emails du filtre courant, après confirmation. */
function renderBulkBar() {
  const bar = $("#bulkbar");
  if (!bar) return;
  const label = MAIL.filter === "all" && !MAIL.q ? (MAIL.box === "sent" ? t("mail.bulk.scope.sent") : t("mail.bulk.scope.inbox")) : t("mail.bulk.scope.filter");
  const pf = parseFilter(MAIL.filter);
  const desc = [pf.state !== "all" && MAIL_STATES.includes(pf.state) && t("mail.desc." + pf.state), ...pf.actions.map((a) => t("mail.desc." + a)), pf.cat && catName(pf.cat), pf.domain && `@${pf.domain}`, pf.date && (DATE_PRESETS.includes(pf.date) ? t("date." + pf.date) : dateRangeLabel(pf.date)), MAIL.q && t("mail.desc.query", { q: MAIL.q })].filter(Boolean).join(" · ");
  if ($("#mailcount") && desc) $("#mailcount").textContent += ` · ${desc}`;
  // Pas d'actions groupées sur les brouillons : ils se modifient et s'envoient dans Gmail.
  if (!MAIL.total || MAIL.box === "drafts") { bar.innerHTML = ""; return; }
  bar.innerHTML = `<div class="bulk">
    <div class="bulkhead"><span class="mono">${t("mail.bulk.title")}</span><span class="small">${tn("mail.bulk.on", MAIL.total, { scope: label })}</span></div>
    <div class="bulkacts">
      <button class="btn sm" data-bulk="archive" title="${t("mail.bulk.archive.hint")}">${t("mail.btn.archive")}</button>
      <button class="btn sm" data-bulk="read" title="${t("mail.bulk.markRead.hint")}">${t("mail.bulk.markRead")}</button>
      <button class="btn sm" data-bulk="quiet" title="${t("mail.bulk.ignore.hint")}">${t("mail.btn.ignore")}</button>
      <button class="btn sm" data-bulk="rejev" title="${t("common.rejevHint")}">${t("common.rejev")}</button>
      <span class="bulksep"></span>
      <span class="small muted">${t("mail.bulk.reclass")}</span><div class="catpick" id="bulkcatpick" data-value=""><button class="fchip catbtn" type="button">${t("mail.bulk.choose")}</button></div>
    </div></div>`;
  const run = async (action, category) => {
    const p = new URLSearchParams({ filter: boxFilter() }); if (MAIL.account) p.set("account", MAIL.account); if (MAIL.q) p.set("q", MAIL.q);
    const ids = await api("/mail/ids?" + p.toString());
    // Relancer Jev : la fenêtre du coût sert de confirmation.
    if (action === "rejev") return rejev(ids);
    const what = action === "category" ? t("mail.confirm.category", { name: catName(category) }) : t("mail.confirm." + action);
    if (!confirm(tn("mail.confirm.bulk", ids.length, { what }))) return;
    try { const r = await api("/mail/bulk", { method: "POST", body: { ids, action, category } }); toast(tn("mail.toast.processed", r.n)); MAIL.selected = null; await loadMailList(); $("#mailread").innerHTML = `<div class="empty" style="margin:24px">${tn("mail.bulk.done", r.n)}</div>`; } catch (e) { toast(e.message); }
  };
  bar.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => run(b.dataset.bulk)));
  catPicker($("#bulkcatpick"), { placeholder: t("mail.bulk.choose"), onPick: (key) => key && run("category", key) });
}

/** Un brouillon dans le volet de lecture : destinataires, objet, texte ; il se modifie et s'envoie dans Gmail. */
async function selectDraft(key) {
  const row = MAIL.rows.find((r) => r.id === key);
  if (!row) return;
  MAIL.selected = key;
  document.querySelectorAll(".mrow").forEach((el) => el.classList.toggle("sel", el.dataset.id === key));
  const pane = $("#mailread"), d = row.draft;
  pane.innerHTML = `<div class="muted small" style="padding:40px">${t("mail.read.loading")}</div>`;
  let full = null;
  try { full = await api(`/drafts/${d.accountId}/${encodeURIComponent(d.messageId)}`); } catch (e) { toast(e.message); }
  if (MAIL.selected !== key) return;
  const gmail = `https://mail.google.com/mail/u/${encodeURIComponent(d.accountEmail)}/#drafts?compose=${encodeURIComponent(d.messageId)}`;
  pane.innerHTML = `<div class="mread-actions row" style="gap:8px;padding:12px 16px;border-bottom:1px solid var(--g100)"><a class="btn ink" href="${h(gmail)}" target="_blank" rel="noopener">${t("mail.draft.openGmail")}</a><span class="small muted" style="align-self:center">${t("mail.draft.hint")}</span></div>
    <div class="rhead" style="padding:16px">
      <div class="rsubject">${h(d.subject || t("common.noSubject"))}</div>
      <div class="rmeta">${t("mail.read.to", { to: h(d.to || t("mail.draft.noTo")) })}${d.cc ? ` · Cc : ${h(d.cc)}` : ""}<br><span class="muted">${d.date ? h(fmtDate(new Date(d.date), { dateStyle: "full", timeStyle: "short" })) : ""}</span></div>
      ${full?.attachments?.length ? `<div class="atts" style="padding:8px 0 0">${full.attachments.map((x) => `<span class="att">${h(x.name)}</span>`).join("")}</div>` : ""}
    </div>
    <div style="padding:0 16px 16px">${full ? msgFrame(full.html, full.text) : `<div class="body">${h(d.snippet)}</div>`}</div>`;
}

async function selectMail(id) {
  // J / K sur l'onglet Brouillons : la ligne est un brouillon, pas un email de la base.
  if (typeof id === "string" && id.startsWith("d:")) return selectDraft(id);
  MAIL.selected = id;
  MAIL.compose = null;
  document.querySelectorAll(".mrow").forEach((el) => el.classList.toggle("sel", Number(el.dataset.id) === id));
  const pane = $("#mailread");
  pane.innerHTML = `<div class="muted small" style="padding:40px">${t("mail.read.loading")}</div>`;
  try {
    const row0 = await api(`/items/${id}`);
    // Un autre email a été choisi pendant la lecture : c'est lui qui s'affiche, pas celui-ci.
    if (MAIL.selected !== id) return;
    // Une fenêtre WhatsApp n'a pas de « message complet » à aller chercher : tout est déjà là.
    if (row0.source === "whatsapp") { MAIL.full = null; renderWhatsAppRead(row0); return; }
    const [row, full] = await Promise.all([Promise.resolve(row0), api(`/items/${id}/full`)]);
    if (MAIL.selected !== id) return;
    MAIL.full = full;
    const r = MAIL.rows.find((x) => x.id === id);
    if (r) { r.labels_json = JSON.stringify(full.labels); renderMailList(); }
    renderRead(row, full);
    // Le fil arrive ensuite, sans bloquer la lecture du message.
    api(`/items/${id}/thread`).then((thread) => { if (MAIL.selected === id && thread.length > 1) renderThread(row, full, thread); }).catch(() => {});
  } catch (e) {
    if (MAIL.selected === id) pane.innerHTML = `<div class="empty" style="margin:24px">${h(e.message)}</div>`;
  }
}

/** Emails dont l'utilisateur a demandé les images distantes (pixels de suivi compris) : pour cette session seulement. */
const SHOW_IMAGES = new Set();
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".showimg");
  if (!b || MAIL.selected == null) return;
  e.preventDefault();
  SHOW_IMAGES.add(MAIL.selected);
  selectMail(MAIL.selected);
});

/**
 * Corps d'un message : un cadre isolé (sans scripts) dont la hauteur suit le contenu,
 * avec une poignée en bas pour l'ajuster à la main.
 */
function msgFrame(html, text) {
  if (!html) return `<div class="body">${h(text || t("common.noText"))}</div>`;
  // Par défaut, aucune image distante : elles servent souvent à savoir quand et où l'email a été ouvert.
  const allow = SHOW_IMAGES.has(MAIL.selected);
  const remote = /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(https?:)?\/\//i.test(html);
  // Rien de distant par défaut (feuilles de style et polices comprises : elles aussi trahissent l'ouverture), jamais de cadre ;
  // à la demande, images, styles et polices en https seulement (jamais le serveur local, en http).
  const remoteSrc = allow ? " https:" : "";
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'${remoteSrc}; img-src data: cid:${remoteSrc}; font-src data:${remoteSrc}">`;
  const doc = `<!doctype html><meta charset="utf-8">${csp}<base target="_blank"><style>html,body{margin:0} body{font-family:Outfit,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#1b1c1f;padding:8px 24px 12px} img{max-width:100%;height:auto} a{color:#ff3b30} blockquote{border-left:2px solid #d8dbdf;margin:8px 0;padding-left:10px;color:#6f747c} table{max-width:100%}</style>` + html;
  return `<div class="framewrap"><iframe class="mailframe" sandbox="allow-same-origin allow-popups" referrerpolicy="no-referrer" onload="fitFrame(this)" srcdoc="${h(doc)}"></iframe><div class="hresizer" title="${t("mail.read.resizeHeight")}"></div></div>${!allow && remote ? `<a href="#" class="showimg small muted">${t("mail.read.showImages")}</a>` : ""}`;
}
/** Ajuste la hauteur du cadre à son contenu (puis suit les images qui se chargent). */
function fitFrame(fr) {
  const doc = fr.contentDocument;
  if (!doc) return;
  const fit = () => { if (fr.dataset.manual) return; fr.style.height = Math.max(120, doc.documentElement.scrollHeight + 4) + "px"; };
  fit();
  try { new ResizeObserver(fit).observe(doc.body); } catch {}
  doc.querySelectorAll("img").forEach((im) => im.addEventListener("load", fit));
  const grip = fr.parentElement.querySelector(".hresizer");
  if (grip && !grip.dataset.bound) {
    grip.dataset.bound = "1";
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const y0 = e.clientY, h0 = fr.offsetHeight;
      document.body.classList.add("resizing-v");
      const move = (ev) => { fr.dataset.manual = "1"; fr.style.height = Math.max(120, h0 + ev.clientY - y0) + "px"; };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.classList.remove("resizing-v"); };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    });
    grip.addEventListener("dblclick", () => { delete fr.dataset.manual; fit(); });
  }
}
/** Remplace le corps par le fil complet : anciens messages repliés, le dernier ouvert. */
function renderThread(row, full, thread) {
  const host = $("#threadhost");
  if (!host) return;
  const last = thread[thread.length - 1];
  host.innerHTML = `<div class="thread"><div class="mono" style="padding:0 24px 8px">${tn("mail.thread.count", thread.length)}</div>${thread.map((m, i) => {
    const open = m.id === last.id || m.id === full.id;
    const who = m.fromMe ? `<span class="pill strong">${t("common.you")}</span> ${h(m.from)}` : `<b>${h(m.from)}</b>`;
    const atts = m.attachments.length ? `<div class="atts" style="padding:8px 0 0">${m.attachments.map((x) => `<a class="att" href="/api/items/${row.id}/attachments/${encodeURIComponent(x.id)}?msg=${encodeURIComponent(m.id)}&name=${encodeURIComponent(x.name)}&mime=${encodeURIComponent(x.mimeType)}" download="${h(x.name)}">${h(x.name)}</a>`).join("")}</div>` : "";
    return `<details class="tmsg" ${open ? "open" : ""}><summary><span class="tfrom">${who}</span><span class="tdate">${h(m.date)}</span>${open ? "" : `<span class="tsnip">${h((m.text || "").replace(/\s+/g, " ").slice(0, 90))}</span>`}</summary><div class="tbody">${msgFrame(m.html, m.text)}${atts}</div></details>`;
  }).join("")}</div>`;
}

function renderRead(row, full) {
  const a = answersOf(row);
  const probs = a?.category?.probabilities ? Object.entries(a.category.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 4) : [];
  const sig = a ? [[t("mail.signal.replyExpected"), a.reply_expected?.probability], [t("mail.signal.awaitsReply"), a.awaits_reply?.probability], [t("mail.signal.attention"), a.attention?.probability], [t("mail.signal.toPay"), a.to_pay?.probability], [t("mail.signal.spam"), a.spam?.probability]].filter(([, p]) => p != null) : [];
  const [st, stc] = stage(row);
  const unread = full.labels.includes("UNREAD");
  const inInbox = full.labels.includes("INBOX");
  const gmailUrl = `https://mail.google.com/mail/u/${encodeURIComponent(row.account_email)}/#all/${full.threadId || full.id}`;
  const bodyHtml = msgFrame(full.html, full.text);
  const atts = full.attachments.length
    ? `<div class="atts">${full.attachments.map((x) => `<a class="att" href="/api/items/${row.id}/attachments/${encodeURIComponent(x.id)}?name=${encodeURIComponent(x.name)}&mime=${encodeURIComponent(x.mimeType)}" download="${h(x.name)}">${h(x.name)} <span class="muted">${fmtUnit(x.size / 1024, "kilobyte", { maximumFractionDigits: 0 })}</span></a>`).join("")}</div>`
    : "";
  const strongFlag = t("flags.important");
  const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  const decidedBy = ["jev", "rule", "memory"].includes(row.decided_by) ? row.decided_by : "user";
  $("#mailread").innerHTML = `
    <div class="rtool">
      ${rawFlags(row).followUp ? `<button class="btn sm ink" data-act="followUp" title="R">${t("mail.btn.followUp")}</button><button class="btn sm" data-act="reply">${t("mail.btn.reply")}</button>` : `<button class="btn sm ink" data-act="reply" title="R">${t("mail.btn.reply")}</button>`}
      <button class="btn sm" data-act="replyAll">${t("mail.btn.replyAll")}</button>
      <button class="btn sm" data-act="forward" title="F">${t("mail.btn.forward")}</button>
      <button class="btn sm" data-act="event" title="A">${t("mail.btn.event")}</button>
      <span style="flex-grow:1"></span>
      ${MAIL.mode === "actions" ? `<button class="btn sm" data-act="quiet" title="${t("mail.btn.ignore.hint")}">${t("mail.btn.ignore")}</button>` : ""}
      ${inInbox ? `<button class="btn sm" data-act="archive" title="E">${t("mail.btn.archive")}</button>` : `<span class="small muted">${t("mail.read.archived")}</span>`}
      <button class="btn sm" data-act="unread">${unread ? t("mail.btn.markRead") : t("mail.btn.markUnread")}</button>
      <a class="btn sm" href="${gmailUrl}" target="_blank" rel="noopener">Gmail</a>
    </div>
    <div class="rhead">
      <div class="rsubject">${h(full.subject || t("common.noSubject"))}</div>
      <div class="rmeta"><b>${h(full.from)}</b><br><span class="muted">${t("mail.read.to", { to: h(full.to) })}${full.cc ? ` · ${t("mail.read.cc", { cc: h(full.cc) })}` : ""}</span><br><span class="muted">${h(full.date)}</span></div>
      <div class="rchips">${row.needs_review ? `<span class="chip">${t("common.toReview")}</span>` : chip(row.category)}${a?.priority ? `<span class="pill ${!row.obsolete && prioScore(row) >= 1.5 ? "strong" : ""}">${t("mail.pill.priority", { p: prioLabel(row) })}</span>` : ""}${flagsOf(row).map((x) => `<span class="pill ${x === strongFlag ? "strong" : ""}">${x}</span>`).join("")}<span class="pill ${stc}" title="${t("mail.stage.hint")}">${st}</span>${row.action_state === 1 ? `<span class="pill strong">${row.thread_note === "replied" ? t("mail.pill.outReplied") : t("mail.pill.outQueue")}</span>` : row.action_state === 2 ? `<span class="pill">${t("mail.pill.ignored")}</span>` : row.action_state === 3 ? `<span class="pill">${t("mail.pill.past")}</span>` : ""}${rawFlags(row).ephemeral ? `<span class="pill" title="${h(t("actions.eph.hint"))}">${h(rawFlags(row).ephemeral === "code" ? t("mail.pill.ephCode") : t("mail.pill.ephSignin"))}</span>` : ""}${row.thread_note === "followUp" && row.thread_last_at ? `<span class="pill strong">${t("mail.pill.noReplyFor", { n: fmtNum(daysSince(row.thread_last_at)) })}</span>` : row.thread_note === "awaiting" && row.thread_last_at ? `<span class="pill">${t("mail.pill.awaiting", { n: fmtNum(daysSince(row.thread_last_at)) })}</span>` : row.thread_note === "answered" ? `<span class="pill">${t("mail.pill.answered")}</span>` : ""}
        <div class="catpick" id="rcatpick" style="margin-left:auto"></div></div>
    </div>
    <div id="composebox"></div>
    <div id="threadhost">${bodyHtml}${atts}</div>
    <details class="ranalysis"><summary class="mono">${t("mail.analysis.title", { by: t("mail.analysis.by." + decidedBy) })}${row.latency_ms ? ` · ${fmtNum(row.latency_ms)} ms` : ""}</summary>
      <div class="row" style="gap:28px;padding-top:12px"><div class="grow">${probs.map(([k, p]) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">${chip(k)}<div class="bar" style="flex-grow:1;height:4px"><i style="width:${Math.round(p * 100)}%"></i></div><span class="num muted" style="width:44px">${pct(p)}</span></div>`).join("") || `<span class="muted small">${t("mail.analysis.noCall")}</span>`}</div>
      <div class="grow">${sig.map(([n, p]) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:140px;font-size:14px">${n}</span><div class="bar" style="flex-grow:1;height:4px"><i style="width:${Math.round(p * 100)}%"></i></div><span class="num muted" style="width:44px">${pct(p)}</span></div>`).join("")}</div></div>
    </details>`;
  $("#mailread").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => mailAction(b.dataset.act, row, full)));
  catPicker($("#rcatpick"), { value: "", placeholder: t("mail.read.fixCategory"), onPick: async (key) => {
    if (!key || key === row.category) return;
    try { await api(`/items/${row.id}/category`, { method: "POST", body: { category: key, apply: !!row.applied_at } }); toast(t("mail.toast.categorySaved", { name: catName(key) })); await loadMailList(); selectMail(row.id); } catch (err) { toast(err.message); }
  } });
}

async function mailAction(act, row, full) {
  if (act === "event") return openEvent(row);
  if (act === "followUp") { openCompose("reply", row, full); $("#cinstr").value = t("mail.compose.followUpInstr"); MAIL.compose.mode = "followUp"; $("#composebox .mono").textContent = t("mail.btn.followUp"); return; }
  if (act === "quiet") {
    try {
      await api(`/actions/${row.id}/state`, { method: "POST", body: { state: 2 } });
      toast(t("mail.toast.ignored"));
      const i = MAIL.rows.findIndex((x) => x.id === row.id);
      if (i >= 0) { MAIL.rows.splice(i, 1); MAIL.total--; }
      const n = MAIL.rows[Math.min(Math.max(i, 0), MAIL.rows.length - 1)];
      if (MAIL.mode === "actions") MAIL.reload?.(); else renderMailList();
      if (n) selectMail(n.id); else $("#mailread").innerHTML = `<div class="empty" style="margin:24px">${t("mail.empty.queueDone")}</div>`;
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === "archive") {
    try { await api(`/items/${row.id}/archive`, { method: "POST" }); toast(t("mail.toast.archived")); await loadMailList(); nextMail(); } catch (e) { toast(e.message); }
    return;
  }
  if (act === "unread") {
    const unread = full.labels.includes("UNREAD");
    try { await api(`/items/${row.id}/read`, { method: "POST", body: { read: unread } }); full.labels = unread ? full.labels.filter((l) => l !== "UNREAD") : [...full.labels, "UNREAD"]; const r = MAIL.rows.find((x) => x.id === row.id); if (r) r.labels_json = JSON.stringify(full.labels); renderMailList(); renderRead(row, full); } catch (e) { toast(e.message); }
    return;
  }
  openCompose(act, row, full);
}

/** Événement : l'IA propose, tu corriges, tu crées. */
async function openEvent(row) {
  const box = $("#composebox");
  box.innerHTML = `<div class="compose"><div class="mono">${t("mail.event.title")}</div><div class="muted small">${t("mail.event.extracting")}</div></div>`;
  let ev;
  try { ev = await api(`/items/${row.id}/event/extract`, { method: "POST", body: {} }); } catch (e) { box.innerHTML = ""; return toast(e.message); }
  const dt = (s) => (s || "").slice(0, 16);
  // Même carte que « À caler » sur la page Agenda : pour qui, qui accompagne, et dans quel(s) agenda(s).
  const members = ev.members || [];
  const forSel = new Set(ev.suggested || []);
  const chk = (group, m, checked, extra = "") => `<label class="agchk"><input type="checkbox" name="${group}" value="${h(m.key)}" ${checked ? "checked" : ""}>${h(m.name)}${extra}</label>`;
  const pct = (k) => ev.probs && ev.probs[k] != null && ev.probs[k] > 0.005 ? ` <span class="mono" style="letter-spacing:0">${fmtPct(ev.probs[k])}</span>` : "";
  // Un événement déjà dans l'agenda dont parle l'email : « Mettre à jour » en premier, la création reste possible.
  const upd = ev.update, same = upd && !upd.changed.length;
  const updParams = upd ? { title: `<a href="${h(upd.link || "#")}" target="_blank" rel="noopener"><b>${h(upd.title)}</b></a>`, when: h(fmtDraftWhen(upd)) } : null;
  const updBox = upd ? `<div class="tocal-upd"><div class="small"><span class="pill strong">${same ? t("agenda.update.samePill") : t("agenda.update.pill")}</span> ${same ? t("agenda.update.sameText", updParams) : t("agenda.update.text", updParams)}</div>${upd.change ? `<div class="small">${h(upd.change)}</div>` : ""}</div>` : "";
  box.innerHTML = `<div class="compose">
    <div class="row" style="align-items:baseline"><div class="mono">${t("mail.event.title")}${ev.found ? "" : " · " + t("mail.event.notFound")}</div><span style="flex-grow:1"></span>${ev.uncertain?.length ? `<span class="small muted">${t("mail.event.uncertain", { list: h(ev.uncertain.join(", ")) })}</span>` : ""}</div>
    ${updBox}
    <label class="field"><span class="mono">${t("mail.event.field.title")}</span><input type="text" id="etitle" value="${h(ev.title)}"></label>
    <div class="field-row" style="grid-template-columns:1fr 1fr auto"><label class="field"><span class="mono">${t("mail.event.field.start")}</span>${dtField("estart", ev.allDay ? dt(ev.start).slice(0, 10) : dt(ev.start), !ev.allDay)}</label><label class="field"><span class="mono">${t("mail.event.field.end")}</span>${dtField("eend", ev.allDay ? dt(ev.end).slice(0, 10) : dt(ev.end), !ev.allDay)}</label><label style="display:flex;align-items:center;gap:8px;font-size:13px;white-space:nowrap;height:40px"><input type="checkbox" id="eallday" ${ev.allDay ? "checked" : ""} style="width:16px;height:16px;accent-color:#1B1C1F">${t("mail.event.field.allDay")}</label></div>
    <div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field"><span class="mono">${t("mail.event.field.location")}</span><input type="text" id="eloc" value="${h(ev.location || "")}"></label><label class="field"><span class="mono">${t("mail.event.field.attendees")}</span><input type="text" id="eatt" value="${h((ev.attendees || []).join(", "))}"></label></div>
    <label class="field"><span class="mono">${t("mail.event.field.description")}</span><textarea id="edesc" rows="3">${h(ev.description || "")}</textarea></label>
    ${ev.canFamily ? `<div class="agrow"><span class="mono agl">${t("mail.event.field.for")}</span>${members.map((m) => chk("efor", m, forSel.has(m.key), pct(m.key))).join("")}</div>
    <div class="agrow"><span class="mono agl">${t("mail.event.field.present")}</span>${members.filter((m) => m.kind === "adult").map((m) => chk("epresent", m, false)).join("")}<span class="small muted">${t("mail.event.field.presentHint")}</span></div>
    <div class="agrow"><span class="mono agl"></span><label class="agchk" id="ealways-l" hidden><input type="checkbox" id="ealways" ${ev.rule ? "checked disabled" : ""}>${t("mail.event.always", { domain: h(ev.domain || "") })}</label></div>` : ""}
    <div class="agrow"><span class="mono agl">${t("mail.event.where")}</span>
      ${ev.canFamily ? `<label class="agchk"><input type="checkbox" id="edest-family" checked>${t("mail.event.destFamily")} <span class="small muted">${t("mail.event.destFamilyHint")}</span></label>` : ""}
      ${ev.canPrimary ? `<label class="agchk"><input type="checkbox" id="edest-primary">${t("mail.event.destPrimary")}</label>` : ""}
    </div>
    <div class="row" style="align-items:center;gap:10px">
      ${upd && !same && ev.canFamily ? `<button class="btn signal" id="eupdate">${t("agenda.update.apply")}</button>` : ""}
      ${ev.canCreate ? `<button class="btn ${upd ? "" : "signal"}" id="ecreate">${upd ? (same ? t("agenda.update.createAnyway") : t("agenda.update.createInstead")) : t("mail.event.create")}</button>` : ""}
      <a class="btn ${ev.canCreate ? "" : "ink"}" id="eopen" href="${h(ev.templateUrl)}" target="_blank" rel="noopener">${t("mail.event.openGoogle")}</a>
      <span style="flex-grow:1"></span><button class="btn link" id="ecancel">${t("common.cancel")}</button></div>
    <div class="small muted">${ev.canCreate ? t("mail.event.createNote") : t("mail.event.noCreateNote")} ${t("mail.event.timezone", { tz: h(ev.timezone) })}</div>
  </div>`;
  const keys = (group) => [...box.querySelectorAll(`input[name=${group}]:checked`)].map((i) => i.value);
  const memberLabel = (k) => members.find((m) => m.key === k)?.name ?? k;
  const syncAlways = () => { const l = $("#ealways-l"); if (!l) return; const f = keys("efor"); const one = f.length === 1 && f[0] !== "family" ? f[0] : null; l.hidden = !one; if (one) $("#ealways-name").textContent = memberLabel(one); };
  box.querySelectorAll("input[name=efor]").forEach((i) => i.addEventListener("change", syncAlways));
  syncAlways();
  const read = () => {
    const allDay = $("#eallday").checked;
    const start = dtRead("estart", !allDay) || "", end = dtRead("eend", !allDay) || start;
    return { title: $("#etitle").value, start, end, allDay, timezone: ev.timezone, location: $("#eloc").value, description: $("#edesc").value, attendees: $("#eatt").value.split(",").map((x) => x.trim()).filter(Boolean) };
  };
  $("#eallday").onchange = (e) => { const allDay = e.target.checked; ["estart", "eend"].forEach((id) => { const i = $("#" + id); const v = dtParse(i.value, !allDay) || dtParse(i.value, allDay); if (v) i.value = dtFmt(allDay ? v.slice(0, 10) : v.length === 10 ? v + "T09:00" : v, !allDay); i.placeholder = DT[DATE_FMT].date + (allDay ? "" : " " + DT[DATE_FMT].time); }); };
  // Le lien prérempli suit les corrections du formulaire.
  const refreshLink = () => { const e = read(); const fmt = (s) => (e.allDay ? s.slice(0, 10).replace(/-/g, "") : s.replace(/[-:]/g, "").slice(0, 15)); const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${fmt(e.start)}/${fmt(e.end)}`, ctz: e.timezone }); if (e.location) p.set("location", e.location); if (e.description) p.set("details", e.description); if (e.attendees.length) p.set("add", e.attendees.join(",")); $("#eopen").href = "https://calendar.google.com/calendar/render?" + p.toString(); };
  box.querySelectorAll("input, textarea").forEach((i) => i.addEventListener("input", refreshLink));
  $("#ecancel").onclick = () => { box.innerHTML = ""; };
  $("#eupdate")?.addEventListener("click", async () => {
    $("#eupdate").disabled = true;
    try {
      await api(`/agenda/tocal/${row.id}/update`, { method: "POST", body: { draft: read() } });
      toast(t("agenda.toast.updated"));
      box.innerHTML = `<div class="compose"><div>${t("agenda.toast.updated")}${upd.link ? ` · <a href="${h(upd.link)}" target="_blank" rel="noopener">${h(upd.title)}</a>` : ""}</div></div>`;
      await loadMailList(); MAIL.reload?.(); refreshWa?.();
    } catch (e) { toast(e.message); $("#eupdate").disabled = false; }
  });
  $("#ecreate")?.addEventListener("click", async () => {
    $("#ecreate").disabled = true;
    try {
      const dest = { family: !!$("#edest-family")?.checked, primary: !!$("#edest-primary")?.checked };
      if (!dest.family && !dest.primary) { $("#ecreate").disabled = false; return toast(t("mail.event.toast.pickCalendar")); }
      const body = { ...read(), forKeys: keys("efor"), present: keys("epresent"), always: !!$("#ealways")?.checked && !$("#ealways")?.disabled, dest };
      const r = await api(`/items/${row.id}/event/create`, { method: "POST", body });
      toast(t("mail.event.toast.created"));
      const where = [r.links?.family && `<a href="${h(r.links.family)}" target="_blank" rel="noopener">${t("mail.event.linkFamily")}</a>`, r.links?.primary && `<a href="${h(r.links.primary)}" target="_blank" rel="noopener">${t("mail.event.linkPrimary")}</a>`].filter(Boolean).join(t("mail.event.join"));
      box.innerHTML = `<div class="compose"><div>${t("mail.event.createdIn", { where })}</div></div>`;
      await loadMailList(); MAIL.reload?.(); refreshWa?.();
    }
    catch (e) {
      // L'erreur reste affichée dans le formulaire, avec son lien cliquable.
      const url = /https?:\/\/\S+/.exec(e.message)?.[0];
      let err = $("#eerr"); if (!err) { err = document.createElement("div"); err.id = "eerr"; err.className = "small"; err.style.color = "var(--signal)"; $("#ecreate").closest(".compose").appendChild(err); }
      err.innerHTML = h(url ? e.message.replace(url, "") : e.message) + (url ? ` <a href="${h(url)}" target="_blank" rel="noopener">${t("mail.event.openActivation")}</a>` : "");
      $("#ecreate").disabled = false;
    }
  });
}

function parseAddr(s) { const m = /<([^>]+)>/.exec(s || ""); return (m ? m[1] : s || "").trim(); }
/** Qui afficher sur une ligne : l'expéditeur, ou « → destinataire » pour un email envoyé par toi. */
function whoLabel(r) {
  if (!r.is_outgoing) return r.from_name || r.from_address;
  let to = []; try { to = JSON.parse(r.to_json || "[]"); } catch {}
  return to.length ? `→ ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ""}` : t("mail.who.sent");
}
function openCompose(mode, row, full) {
  const me = (row.account_email || "").toLowerCase();
  const replyTo = full.replyTo || full.from;
  // Relancer un email que tu as envoyé : la relance part vers ses destinataires, pas vers toi.
  let to = mode === "forward" ? "" : row.is_outgoing ? (full.to || "").split(",").map(parseAddr).filter(Boolean).join(", ") : parseAddr(replyTo);
  let cc = "";
  if (mode === "replyAll") {
    const others = [full.to, full.cc].filter(Boolean).join(",").split(",").map(parseAddr).filter((x) => x && x.toLowerCase() !== me && x.toLowerCase() !== to.toLowerCase());
    cc = [...new Set(others)].join(", ");
  }
  const subject = (mode === "forward" ? "Fwd: " : "Re: ") + (full.subject || "").replace(/^\s*((re|fwd?|tr)\s*:\s*)+/i, "");
  MAIL.compose = { mode, to, cc, subject, files: [] };
  $("#composebox").innerHTML = `<div class="compose">
    <div class="mono">${t("mail.btn." + mode)}</div>
    <div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field"><span class="mono">${t("mail.compose.to")}</span><input type="text" id="cto" value="${h(to)}" placeholder="${t("mail.compose.toPlaceholder")}"></label><label class="field"><span class="mono">${t("mail.compose.cc")}</span><input type="text" id="ccc" value="${h(cc)}"></label></div>
    <label class="field"><span class="mono">${t("mail.compose.subject")}</span><input type="text" id="csub" value="${h(subject)}"></label>
    <div class="field-row" style="grid-template-columns:1fr auto"><input type="text" id="cinstr" placeholder="${t("mail.compose.instrPlaceholder")}"><button class="btn" id="cai">${t("mail.compose.ai")}</button></div>
    <textarea id="ctext" rows="9" placeholder="${t("mail.compose.textPlaceholder")}"></textarea>
    <div class="row cfiles" style="align-items:center;gap:8px;flex-wrap:wrap"><label class="btn sm" for="cfiles" title="${t("mail.compose.attachHint")}">${t("mail.compose.attachBtn")}</label><input type="file" id="cfiles" multiple hidden><span id="cfilelist" class="row" style="gap:6px;flex-wrap:wrap;align-items:center"></span></div>
    <div class="row" style="align-items:center;gap:10px">
      <button class="btn signal" id="csend">${t("mail.compose.send")}</button><button class="btn" id="cdraft">${t("mail.compose.draft")}</button>
      ${mode === "forward" && full.attachments.length ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="catt" checked style="width:16px;height:16px;accent-color:#1B1C1F">${tn("mail.compose.attach", full.attachments.length)}</label>` : ""}
      <span style="flex-grow:1"></span><button class="btn link" id="ccancel">${t("common.cancel")}</button></div>
    <div class="small muted" id="cnote">${t("mail.compose.note")}</div>
  </div>`;
  $("#ctext").focus();
  $("#ccancel").onclick = () => { $("#composebox").innerHTML = ""; MAIL.compose = null; };
  // Fichiers joints depuis le Mac : bouton ou glisser-déposer sur la zone de réponse ; 25 Mo au total (limite de Gmail).
  const MAX_ATTACH = 25 * 1024 * 1024;
  const sizeLabel = (b) => (b >= 1048576 ? fmtUnit(b / 1048576, "megabyte", { maximumFractionDigits: 1 }) : fmtUnit(Math.max(1, b / 1024), "kilobyte", { maximumFractionDigits: 0 }));
  const renderFiles = () => {
    const files = MAIL.compose?.files || [];
    const total = files.reduce((s, f) => s + f.size, 0), over = total > MAX_ATTACH;
    $("#cfilelist").innerHTML = files.map((f, k) => `<span class="chip" style="display:inline-flex;gap:6px;align-items:center">${h(f.name)} <span class="muted">${h(sizeLabel(f.size))}</span><button type="button" class="btn link" data-rmfile="${k}" aria-label="${t("mail.compose.removeFile")}" style="padding:0 2px">×</button></span>`).join("")
      + (files.length > 1 || over ? `<span class="small ${over ? "" : "muted"}" style="${over ? "color:var(--signal);font-weight:600" : ""}">${h(over ? t("mail.compose.tooBig", { size: sizeLabel(total) }) : t("mail.compose.total", { size: sizeLabel(total) }))}</span>` : "");
    $("#cfilelist").querySelectorAll("[data-rmfile]").forEach((b) => (b.onclick = () => { MAIL.compose.files.splice(Number(b.dataset.rmfile), 1); renderFiles(); }));
    $("#csend").disabled = $("#cdraft").disabled = over;
  };
  const addFiles = (list) => { if (!MAIL.compose) return; MAIL.compose.files.push(...[...list]); renderFiles(); };
  $("#cfiles").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  const box = $("#composebox .compose");
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dropping"); });
  box.addEventListener("dragleave", () => box.classList.remove("dropping"));
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("dropping"); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  const fileB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  $("#cai").onclick = async () => {
    $("#cai").disabled = true; $("#cai").textContent = t("mail.compose.aiBusy");
    try {
      const r = await api(`/items/${row.id}/compose`, { method: "POST", body: { mode: MAIL.compose?.mode || mode, instructions: $("#cinstr").value } });
      $("#ctext").value = r.text;
      $("#cnote").textContent = t("mail.compose.aiNote", { model: r.model, tokens: fmtNum(r.inputTokens + r.outputTokens) });
    } catch (e) { toast(e.message); }
    $("#cai").disabled = false; $("#cai").textContent = t("mail.compose.ai");
  };
  const send = (asDraft) => async () => {
    const btn = asDraft ? $("#cdraft") : $("#csend");
    const label = btn.textContent;
    btn.disabled = true;
    const picked = MAIL.compose?.files || [];
    if (picked.length) btn.textContent = t("mail.compose.uploading");
    try {
      const files = await Promise.all(picked.map(async (f) => ({ name: f.name, mime: f.type || "application/octet-stream", data: await fileB64(f) })));
      await api(`/items/${row.id}/send`, { method: "POST", body: { mode, to: $("#cto").value, cc: $("#ccc").value, subject: $("#csub").value, text: $("#ctext").value, asDraft, withAttachments: $("#catt")?.checked ?? false, files } });
      toast(asDraft ? t("mail.toast.draftSaved") : t("mail.toast.sent"));
      $("#composebox").innerHTML = ""; MAIL.compose = null;
      await loadMailList();
      if (!asDraft) { if (MAIL.mode === "actions") { const n = MAIL.rows[0]; if (n) selectMail(n.id); else $("#mailread").innerHTML = `<div class="empty" style="margin:24px">${t("mail.empty.queue")}</div>`; } else selectMail(row.id); }
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = label; }
  };
  $("#csend").onclick = send(false);
  $("#cdraft").onclick = send(true);
}

function nextMail(delta = 1) {
  if (!MAIL.rows.length) return;
  const i = MAIL.rows.findIndex((r) => r.id === MAIL.selected);
  const n = MAIL.rows[Math.min(MAIL.rows.length - 1, Math.max(0, (i === -1 ? -1 : i) + delta))];
  if (n && n.id !== MAIL.selected) { selectMail(n.id); document.querySelector(`.mrow[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" }); }
}

// Raccourcis clavier : les touches restent les mêmes dans toutes les langues (voir mail.empty.pick).
function mailKeys(e) {
  if (!location.hash.startsWith("#mail") && !location.hash.startsWith("#actions")) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return;
  if (e.key === "j") nextMail(1);
  else if (e.key === "k") nextMail(-1);
  else if (e.key === "r" && MAIL.full) $("#mailread [data-act=reply]")?.click();
  else if (e.key === "f" && MAIL.full) $("#mailread [data-act=forward]")?.click();
  else if (e.key === "e" && MAIL.full) $("#mailread [data-act=archive]")?.click();
  else if (e.key === "n" && MAIL.full) $("#mailread [data-act=quiet]")?.click();
  else if (e.key === "a" && MAIL.selected != null) ($("#mailread [data-act=event]") || $("#mailread [data-act=agenda]"))?.click();
  else if (/^[1-9]$/.test(e.key) && MAIL.full) { const c = TAX.categories[Number(e.key) - 1]; const row = MAIL.rows.find((r) => r.id === MAIL.selected); if (c && row && c.key !== row.category) api(`/items/${row.id}/category`, { method: "POST", body: { category: c.key, apply: !!row.applied_at } }).then(() => { toast(t("mail.toast.categorySaved", { name: c.name })); loadMailList().then(() => selectMail(row.id)); }).catch((err) => toast(err.message)); }
}
document.addEventListener("keydown", mailKeys);

async function mailView(rest = []) {
  // En quittant Actions : plus de rechargement de la file Actions par-dessus la Boîte.
  MAIL.reload = null;
  if (MAIL.mode !== "mail") { MAIL.mode = "mail"; MAIL.filter = "all"; MAIL.selected = null; }
  // #mail → Reçus ; #mail/sent, #mail/drafts → ce dossier ; #mail/<filtre> (liens des autres pages) → ce filtre dans Reçus.
  const box = MAIL_BOXES.includes(rest[0]) ? rest[0] : "inbox";
  if (box !== MAIL.box || !rest[0]) { MAIL.box = box; MAIL.filter = "all"; MAIL.selected = null; }
  if (rest[0] && !MAIL_BOXES.includes(rest[0])) { MAIL.filter = decodeURIComponent(rest[0]); MAIL.selected = null; }
  const o = await api("/overview");
  TAX = o.taxonomy;
  MAIL.accounts = o.accounts;
  renderNav();
  // Deux rangées lisibles : l'état de l'email, puis l'action attendue ; les catégories dans un menu.
  const stateFilters = MAIL_STATES.map((k) => [k, t("mail.filter." + k)]);
  const actionFilters = MAIL_ACTIONS.map((k) => [k, t("mail.filter." + k)]);
  const sortOptions = ["date", "important", "unread", "priority"].map((k) => [k, t("mail.sort." + k)]);
  setTimeout(async () => {
    $("#main").classList.add("mailmode");
    setupResizer($("#rs-list"), "--list-w", 280, 800, "ea.listW");
    const syncChips = () => {
      const f = parseFilter(MAIL.filter);
      document.querySelectorAll("#mfilters [data-f]").forEach((x) => x.classList.toggle("on", x.dataset.f === f.state || f.actions.includes(x.dataset.f)));
      catPicker($("#mcatpick"), { value: f.cat, allLabel: t("common.all"), placeholder: t("common.all"), onPick: (k) => { const g = parseFilter(MAIL.filter); g.cat = k; MAIL.filter = buildFilter(g); syncChips(); loadMailList(); } });
      // Date : se cumule avec le reste ; les actions en lot (archiver, relancer Jev…) portent alors sur cette période.
      const md = $("#mdate");
      if (md) { md.innerHTML = dateFilterHtml(f.date); bindDateFilter(md, f.date, (v) => { const g = parseFilter(MAIL.filter); g.date = v; MAIL.filter = buildFilter(g); syncChips(); loadMailList(); }); }
      // Domaine expéditeur : arrive depuis la carte ou la liste par domaine du tableau de bord ; une croix le retire.
      const dg = $("#mdomain");
      if (dg) { dg.hidden = !f.domain; dg.innerHTML = f.domain ? `<span class="mono flabel">${t("mail.filter.domain")}</span><button class="fchip on" data-domain="${h(f.domain)}" title="${t("mail.filter.removeHint")}">@${h(f.domain)} ×</button>` : ""; dg.querySelector("[data-domain]")?.addEventListener("click", () => { const g = parseFilter(MAIL.filter); g.domain = ""; MAIL.filter = buildFilter(g); syncChips(); loadMailList(); }); }
    };
    document.querySelectorAll("#mfilters [data-f]").forEach((b) => b.addEventListener("click", () => {
      const f = parseFilter(MAIL.filter);
      const k = b.dataset.f;
      if (MAIL_ACTIONS.includes(k)) f.actions = f.actions.includes(k) ? f.actions.filter((x) => x !== k) : [...f.actions, k];
      else f.state = k;
      MAIL.filter = buildFilter(f); syncChips(); loadMailList();
    }));
    syncChips();
    $("#macc").addEventListener("change", (e) => { MAIL.account = e.target.value; loadMailList(); });
    $("#msort").addEventListener("change", (e) => { MAIL.sort = e.target.value; try { localStorage.setItem("ea.sort", MAIL.sort); } catch {} loadMailList(); });
    let timer; $("#mq").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { MAIL.q = e.target.value; loadMailList(); }, 250); });
    await loadMailList();
    if (MAIL.selected && MAIL.rows.some((r) => r.id === MAIL.selected)) selectMail(MAIL.selected);
  });
  return `<div class="mailwrap">
    <div class="mlist">
      <div class="mhead"><div style="font-size:18px;font-weight:700;letter-spacing:-.01em">${t("mail.box." + MAIL.box)}<span class="stop">.</span></div>
        <div class="row" style="align-items:center;gap:8px"><select id="macc" style="height:36px"><option value="">${t("mail.accounts.all")}</option>${o.accounts.map((a) => `<option value="${a.id}" ${String(a.id) === MAIL.account ? "selected" : ""}>${h(a.email)}</option>`).join("")}</select></div>
        <div class="row" style="gap:8px;align-items:center"><input type="text" id="mq" placeholder="${t("mail.search.placeholder")}" value="${h(MAIL.q)}" style="height:36px">
        <select id="msort" title="${t("mail.sort.hint")}" style="height:36px;width:auto;flex-shrink:0">${sortOptions.map(([k, l]) => `<option value="${k}" ${MAIL.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div id="mfilters" class="mfilters-groups" ${MAIL.box === "drafts" ? "hidden" : ""}>
          <div class="fgroup"><span class="mono flabel">${t("common.status")}</span>${stateFilters.map(([k, l]) => `<button class="fchip ${MAIL.filter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
          <div class="fgroup"><span class="mono flabel">${t("mail.filter.action")}</span>${actionFilters.map(([k, l]) => `<button class="fchip ${MAIL.filter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
          <div class="fgroup"><span class="mono flabel">${t("common.category")}</span><div class="catpick" id="mcatpick"></div></div>
          <div class="fgroup" id="mdate"></div>
          <div class="fgroup" id="mdomain" hidden></div>
        </div>
        <div class="small muted" id="mailcount"></div>
        <div id="bulkbar"></div>
      </div>
      <div id="maillist" class="mrows"></div>
    </div>
    <div class="resizer" id="rs-list" title="${t("mail.read.resizeList")}"></div>
    <div id="mailread" class="mread"><div class="empty" style="margin:24px">${t("mail.empty.pick")}</div></div>
  </div>`;
}
views.mail = (rest) => mailView(rest);

/** Le volet de lecture d'une fenêtre WhatsApp : les messages, l'auteur et l'heure de chacun, puis les gestes possibles. */
function renderWhatsAppRead(row) {
  const a = answersOf(row);
  const f = rawFlags(row);
  const lines = String(row.body_excerpt || "").split("\n");
  // Une ligne « JJ/MM HH:MM · Auteur : texte » ouvre un message ; les autres lignes continuent le précédent.
  const msgs = [];
  for (const l of lines) {
    const m = /^(\d{2}\/\d{2} \d{2}:\d{2}) · (.+?) : ([\s\S]*)$/.exec(l);
    if (m) msgs.push({ when: m[1], from: m[2], text: m[3] });
    else if (msgs.length) msgs[msgs.length - 1].text += "\n" + l;
    else msgs.push({ when: "", from: "", text: l });
  }
  const meName = (typeof AG !== "undefined" && AG.week?.members?.[0]?.name) || null;
  const bubble = (m) => `<div class="wab ${meName && m.from === meName ? "me" : ""}"><div class="small muted"><b style="color:var(--ink)">${h(m.from)}</b> · ${h(m.when)}</div><div>${h(m.text)}</div></div>`;
  const toCal = f.event || f.task;
  $("#mailread").innerHTML = `
    <div class="rtool">
      ${toCal && row.action_state === 0 ? `<button class="btn sm ink" data-act="agenda" title="A">${f.event ? t("mail.wa.schedule") : t("mail.wa.makeTask")}</button>` : ""}
      ${row.action_state === 0 ? `<button class="btn sm ghost" data-act="quiet" title="${t("mail.wa.ignore.hint")}">${t("mail.btn.ignore")}</button>` : ""}
      <span style="flex-grow:1"></span>
    </div>
    <div class="rhead">
      <div class="rsubject">${h(row.from_name)}</div>
      <div class="rmeta"><span class="srcchip"><span class="dotwa" style="margin:0"></span>${t("mail.wa.group")}</span> <span class="muted">${tn("mail.wa.messages", msgs.length)} · ${fmtDateTime(row.date, { dateStyle: "medium", timeStyle: "short" })}</span></div>
      <div class="rchips">${chip(row.category)}${a?.priority ? `<span class="pill ${!row.obsolete && prioScore(row) >= 1.5 ? "strong" : ""}">${t("mail.pill.priority", { p: prioLabel(row) })}</span>` : ""}${f.event ? `<span class="pill strong">${t("flags.event")}</span>` : ""}${f.task ? `<span class="pill strong">${t("flags.task")}</span>` : ""}${row.action_state === 1 ? `<span class="pill strong">${t("mail.pill.outQueue")}</span>` : row.action_state === 2 ? `<span class="pill">${t("mail.pill.ignored")}</span>` : row.action_state === 3 ? `<span class="pill">${t("mail.pill.past")}</span>` : ""}</div>
    </div>
    <div class="wathread">${msgs.map(bubble).join("")}</div>
    <div class="ranalysis small muted">${t("mail.wa.note")}${a?.event ? " " + t("mail.wa.probs", { event: pct(a.event.probability), task: pct(a.task?.probability) }) : ""}</div>`;
  $("#mailread [data-act=agenda]")?.addEventListener("click", () => { AG.focusId = row.id; closeDrawer(); location.hash = "#agenda"; });
  $("#mailread [data-act=quiet]")?.addEventListener("click", async () => { try { await api(`/actions/${row.id}/state`, { method: "POST", body: { state: 2 } }); toast(t("mail.toast.ignored")); closeDrawer(); MAIL.reload?.(); refreshWa?.(); } catch (e) { toast(e.message); } });
}
