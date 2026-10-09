/* Molinova — interface locale. Vanilla JS, routage par #hash, API JSON sur le même serveur. */
const $ = (sel, el = document) => el.querySelector(sel);
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => fmtPct(x);
const fmt = (n) => Number(n ?? 0).toLocaleString(I18N.locale);

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  // Clé de session perdue (serveur relancé avec une autre clé) : la page « verrouillée » dit comment rouvrir Molinova.
  if (res.status === 401) { location.reload(); return new Promise(() => {}); }
  const data = await res.json();
  // e.code : la clé d'erreur du serveur (ex. « gmail.missingMailScope »), pour adapter la réponse de l'interface.
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, code: data.code });
  return data;
}
let toastTimer;
/** Message bref. S'il contient un lien, il reste affiché, cliquable, jusqu'à fermeture. */
function toast(msg) {
  const el = $("#toast");
  const url = /https?:\/\/\S+/.exec(msg)?.[0];
  if (url) {
    el.innerHTML = `${h(msg.replace(url, ""))} <a href="${h(url)}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">${h(t("app.openLink"))}</a> <button style="margin-left:12px;background:none;border:0;color:#fff;cursor:pointer;font-size:16px" aria-label="${h(t("app.close"))}">×</button>`;
    el.style.pointerEvents = "auto";
    el.querySelector("button").onclick = () => { el.classList.remove("show"); el.style.pointerEvents = "none"; };
    el.classList.add("show");
    clearTimeout(toastTimer);
    return;
  }
  el.textContent = msg;
  el.style.pointerEvents = "none";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

let TAX = { prefix: "AI", categories: [] };
/* Format des dates choisi dans Règles : les contrôles natifs du navigateur suivent la langue de Safari, pas l'app.
   On saisit donc dans des champs texte, au format voulu, européen par défaut. Les libellés suivent la langue. */
let DATE_FMT = "eu";
const DT = {
  eu: { get date() { return t("dt.eu"); }, get time() { return t("dt.time"); }, sep: "/", order: ["d", "m", "y"] },
  us: { get date() { return t("dt.us"); }, get time() { return t("dt.time"); }, sep: "/", order: ["m", "d", "y"] },
  iso: { get date() { return t("dt.iso"); }, get time() { return t("dt.time"); }, sep: "-", order: ["y", "m", "d"] },
};
const pad2 = (n) => String(n).padStart(2, "0");
/** ISO local (« 2026-12-20T08:45 » ou « 2026-12-20 ») → texte au format choisi. */
function dtFmt(iso, withTime) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const f = DT[DATE_FMT] || DT.eu, parts = { y: m[1], m: m[2], d: m[3] };
  const date = f.order.map((k) => parts[k]).join(f.sep);
  return withTime ? `${date} ${m[4] ?? "00"}:${m[5] ?? "00"}` : date;
}
/** Texte saisi → ISO local, ou null si illisible. Accepte aussi l'ISO tel quel et une année sur deux chiffres. */
function dtParse(text, withTime) {
  const s = String(text || "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2})[:h](\d{2})?)?$/.exec(s);
  let y, mo, d, hh, mi;
  if (m) { [y, mo, d, hh, mi] = [m[1], m[2], m[3], m[4], m[5]]; }
  else {
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ ,]+(\d{1,2})[:h](\d{2})?)?$/.exec(s);
    if (!m) return null;
    const f = DT[DATE_FMT] || DT.eu;
    const [a, b] = [m[1], m[2]];
    [d, mo] = f.order[0] === "m" ? [b, a] : [a, b];
    y = m[3].length === 2 ? "20" + m[3] : m[3]; hh = m[4]; mi = m[5];
  }
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return null;
  const date = `${y}-${pad2(mo)}-${pad2(d)}`;
  return withTime ? `${date}T${pad2(hh ?? 0)}:${pad2(mi ?? 0)}` : date;
}
/** Un champ date (ou date et heure) en texte, avec son format en aide. */
function dtField(id, iso, withTime, style = "") {
  const f = DT[DATE_FMT] || DT.eu;
  const format = `${f.date}${withTime ? " " + f.time : ""}`;
  return `<input type="text" class="dtin" id="${id}" value="${h(dtFmt(iso, withTime))}" placeholder="${h(format)}" title="${h(t("dt.format", { format }))}" style="${style}" autocomplete="off" spellcheck="false">`;
}
/** Lit un champ date ; surligne en rouge s'il est illisible et renvoie null. */
function dtRead(id, withTime) {
  const el = $("#" + id); if (!el) return null;
  const v = dtParse(el.value, withTime);
  el.classList.toggle("bad", !!el.value.trim() && !v);
  return v;
}
api("/config/settings").then((s) => { DATE_FMT = s.dateFormat || "eu"; }).catch(() => {});
const catName = (k) => { const c = TAX.categories.find((x) => x.key === k); if (!c) return k ?? "—"; const p = c.parent && TAX.categories.find((x) => x.key === c.parent); return p ? `${p.name} › ${c.name}` : c.name; };
function chip(k) {
  const c = TAX.categories.find((x) => x.key === k);
  if (!c) return `<span class="chip">${h(k ?? t("common.toReview"))}</span>`;
  return `<span class="chip" style="background:${c.color.background};color:${c.color.text}" title="${h(catName(k))}">${h(c.name)}</span>`;
}
/** Les catégories dans l'ordre d'affichage : chaque parent suivi de ses sous-catégories. */
function orderedCats(tax) {
  const out = [];
  for (const c of tax.categories) if (!c.parent) out.push(c, ...tax.categories.filter((k) => k.parent === c.key));
  for (const c of tax.categories) if (!out.includes(c)) out.push(c);
  return out;
}
function pctBar(p, strong) {
  return `<div class="pct ${strong ? "strong" : ""}"><div class="bar"><i style="width:${Math.round((p ?? 0) * 100)}%"></i></div><span>${pct(p)}</span></div>`;
}
/** En-tête de page. `num` : ancien numéro de chapitre, plus affiché (les pages ne forment plus une suite). */
function head(num, kicker, title, lead, right = "") {
  return `<header class="page"><div><div class="kicker">${h(kicker)}</div><h1>${h(title)}<span class="stop">.</span></h1><p class="lead">${h(lead)}</p></div>${right}</header>`;
}
/** Les signaux d'un élément, sous forme de clés (important, reply, followUp, awaitReply, toPay, event, spam). */
function flagKeysOf(r) {
  const f = r.flags_json ? JSON.parse(r.flags_json) : r.flags || {};
  return [f.important && "important", f.reply && "reply", f.followUp && "followUp", f.awaitReply && !f.followUp && "awaitReply", f.toPay && "toPay", f.event && "event", f.spam && "spam"].filter(Boolean);
}
/** Les mêmes signaux, traduits pour l'affichage. */
function flagsOf(r) { return flagKeysOf(r).map((k) => t("flags." + k)); }
function dot(r) {
  let unread = false;
  try { unread = (JSON.parse(r.labels_json || "[]")).includes("UNREAD"); } catch {}
  return `<span class="dot ${unread ? "unread" : ""}" title="${h(unread ? t("common.unread") : t("common.read"))}"></span>`;
}
/** Score de priorité qui compte aujourd'hui : celui du serveur (plafonné par l'âge de l'email), sinon celui de Jev. */
const prioScore = (r) => r?.prio ?? answersOf(r)?.priority?.score;
// Un fichier lâché hors de la zone de réponse n'ouvre rien (la fenêtre partirait sur file://).
document.addEventListener("dragover", (e) => { if (!e.target.closest?.(".compose")) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (!e.target.closest?.(".compose")) e.preventDefault(); });

// ---------- filtre par date (Actions, Boîte) : 24 h, 7 jours, 30 jours, ou une période choisie au calendrier
/** Valeurs : "" (toutes), "1d", "7d", "30d", ou "AAAA-MM-JJ..AAAA-MM-JJ" ; le serveur les lit en « date:… ». */
const DATE_PRESETS = ["", "1d", "7d", "30d"];
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dateRangeLabel(v) {
  const [a, b] = v.split("..").map((x) => new Date(`${x}T12:00`));
  const f = (d) => fmtDate(d, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return a.getTime() === b.getTime() ? f(a) : `${f(a)} – ${f(b)}`;
}
function dateFilterHtml(value) {
  const custom = !!value && !DATE_PRESETS.includes(value);
  return `<span class="mono flabel">${h(t("date.label"))}</span>${DATE_PRESETS.map((v) => `<button type="button" class="fchip ${value === v ? "on" : ""}" data-date="${v}">${h(t(v ? "date." + v : "date.any"))}</button>`).join("")}<span class="datepick"><button type="button" class="fchip ${custom ? "on" : ""}" data-date-custom>${h(custom ? dateRangeLabel(value) : t("date.custom"))} ▾</button></span>`;
}
/** Branche les pastilles et le calendrier (deux champs date natifs : le calendrier s'ouvre au clic) ; `onChange(valeur)`. */
function bindDateFilter(root, value, onChange) {
  if (!root) return;
  root.querySelectorAll("[data-date]").forEach((b) => (b.onclick = () => onChange(b.dataset.date)));
  const btn = root.querySelector("[data-date-custom]");
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".datemenu").forEach((m) => m.remove());
    const [from, to] = value && !DATE_PRESETS.includes(value) ? value.split("..") : [ymdLocal(new Date(Date.now() - 30 * 86_400_000)), ymdLocal(new Date())];
    const menu = document.createElement("div");
    menu.className = "datemenu";
    menu.innerHTML = `<label class="field"><span class="mono">${h(t("date.from"))}</span><input type="date" id="dfrom" value="${from}" max="${ymdLocal(new Date())}"></label>
      <label class="field"><span class="mono">${h(t("date.to"))}</span><input type="date" id="dto" value="${to}" max="${ymdLocal(new Date())}"></label>
      <div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn sm ghost" id="dcancel">${h(t("common.cancel"))}</button><button type="button" class="btn sm ink" id="dapply">${h(t("date.apply"))}</button></div>`;
    btn.parentElement.appendChild(menu);
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    // Le calendrier du système s'ouvre dès qu'on touche un champ.
    menu.querySelectorAll("input[type=date]").forEach((inp) => inp.addEventListener("click", () => { try { inp.showPicker(); } catch {} }));
    const close = () => { menu.remove(); document.removeEventListener("click", close); };
    menu.querySelector("#dcancel").onclick = close;
    menu.querySelector("#dapply").onclick = () => {
      const a = menu.querySelector("#dfrom").value, b = menu.querySelector("#dto").value;
      if (!a || !b) return;
      close();
      onChange(a <= b ? `${a}..${b}` : `${b}..${a}`);
    };
    setTimeout(() => document.addEventListener("click", close));
    try { menu.querySelector("#dfrom").showPicker(); } catch {}
  };
}

/** Libellé d'importance d'une ligne : « Obsolète » si sa portée est passée, sinon le niveau du score. */
const prioLabel = (r) => (r?.obsolete ? t("prio.obsolete") : PRIO(prioScore(r)));
const PRIO = (s) => (s == null ? "" : s >= 2.5 ? t("prio.urgent") : s >= 1.5 ? t("prio.high") : s >= 0.5 ? t("prio.normal") : t("prio.low"));
function closeDrawer() { document.querySelectorAll(".drawer, .drawer-bg, .dlg").forEach((e) => e.remove()); }

// ---------- avant tout lancement en masse : ce que l'IA va coûter (GET/POST /api/estimate/*, core/estimate.ts)
const fmtTokens = (n) => new Intl.NumberFormat(I18N.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
/** Ferme la fenêtre de coût ouverte (résout sa promesse) ; null quand il n'y en a pas. */
let closeCostDialog = null;
/**
 * La fenêtre « Avant de lancer l'IA » : combien d'éléments, combien de tokens, combien de dollars (probable et au plus),
 * d'où vient le chiffre, et le crédit restant. Rien ne part sans un clic sur le bouton. Résout true pour lancer.
 * `r` : réponse d'une route /api/estimate (estimate, rate, credits) ; `what` : la phrase qui dit ce qui sera lu.
 * `sample` : un curseur « classer x % » pour tester sur une partie avant de tout lancer ; `sampleHint` dit lesquels
 * (les plus récents…). Résout false (annulé) ou { max } : le nombre d'éléments choisi, à passer au lancement.
 */
function confirmAiCost(r, { title, what, cta, sample = false, sampleHint = "" }) {
  const e = r.estimate, rate = r.rate;
  // Rien à faire passer par l'IA : pas besoin de demander.
  if (!e.n) { toast(t("cost.none")); return Promise.resolve({ max: 0 }); }
  // Par défaut, un essai d'environ 200 éléments sur un gros volume : on regarde le résultat avant de payer le reste.
  const pct0 = !sample || e.n <= 300 ? 100 : Math.max(1, Math.min(100, Math.round((200 / e.n) * 100)));
  const scaled = (pct) => { const n = Math.max(1, Math.round((e.n * pct) / 100)), k = n / e.n; return { n, tokens: Math.round((e.inputTokens + e.outputTokens) * k), cost: e.cost == null ? null : e.cost * k, maxCost: e.maxCost == null ? null : e.maxCost * k }; };
  const s0 = scaled(pct0);
  const over = (x) => !!(r.credits && x.maxCost != null && x.maxCost > r.credits.balance);
  const basis = rate.basis === "measured"
    ? t("cost.basis.measured", { n: fmt(rate.sample), share: fmtPct(rate.jevShare) })
    : t("cost.basis.default");
  const lines = [
    basis,
    e.maxCost != null && e.cost != null && e.maxCost > e.cost * 1.05 ? `<span id="cmax">${h(t("cost.max", { max: fmtUsd(s0.maxCost) }))}</span>` : "",
    e.partial ? t("cost.partial") : "",
    r.credits ? t("cost.credits", { balance: fmtUsd(r.credits.balance, 2) }) : "",
  ].filter(Boolean);
  closeDrawer();
  // Une seule fenêtre de coût à la fois : la précédente (double clic, double branchement) se ferme comme « Annuler ».
  closeCostDialog?.(false);
  document.querySelectorAll(".costdlg, .drawer-bg").forEach((x) => x.remove());
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><div class="dlg costdlg" role="dialog" aria-modal="true">
    <div><div class="kicker">${h(t("cost.kicker"))}</div><h2 style="margin-top:6px">${h(title)}<span class="stop">.</span></h2></div>
    <p class="gp">${h(what)}</p>
    <div class="costbig"><div><div class="mono">${h(t("cost.items"))}</div><div class="costnum" id="cn">${fmt(s0.n)}</div></div>
      <div><div class="mono">${h(t("cost.tokens"))}</div><div class="costnum" id="ctok">≈ ${h(fmtTokens(s0.tokens))}</div></div>
      <div><div class="mono">${h(t("cost.cost"))}</div><div class="costnum" id="ccost">${s0.cost == null ? h(t("cost.unknown")) : "≈ " + h(fmtUsd(s0.cost))}</div></div></div>
    ${sample ? `<div class="costslide"><div class="row" style="align-items:baseline;gap:10px"><span class="mono">${h(t("cost.sample.label"))}</span><b id="cpct" class="costpct">${pct0} %</b><span class="small muted" id="cpctn"></span></div>
      <input type="range" id="crange" min="1" max="100" step="1" value="${pct0}" aria-label="${h(t("cost.sample.label"))}">
      <div class="row costpresets">${[5, 10, 25, 50, 100].map((p) => `<button class="btn sm ghost" data-pct="${p}">${p} %</button>`).join("")}</div>
      <div class="small muted">${h(sampleHint || t("cost.sample.hint"))}</div></div>` : ""}
    <ul class="small gl">${lines.map((l) => `<li>${l.startsWith("<span") ? l : h(l)}</li>`).join("")}<li>${h(t("cost.model", { model: rate.jevModel }))}</li></ul>
    <div class="gwarn" id="cover" ${over(s0) ? "" : "hidden"}><b>${h(t("cost.over", { balance: r.credits ? fmtUsd(r.credits.balance, 2) : "" }))}</b></div>
    <div class="foot"><span class="spacer"></span><button class="btn ghost" id="ccancel">${h(t("common.cancel"))}</button><button class="btn signal" id="cgo">${h(cta || t("cost.go"))}</button></div>
  </div>`);
  // Tout est cherché dans cette fenêtre-ci, jamais dans la page : les clics vont toujours à la fenêtre affichée.
  const dlg = document.body.lastElementChild, bg = dlg.previousElementSibling;
  const q = (sel) => dlg.querySelector(sel);
  let cur = s0, pct = pct0;
  const show = (p) => {
    pct = p; cur = scaled(p);
    q("#cpct").textContent = `${p} %`;
    q("#cpctn").textContent = p < 100 ? t("cost.sample.of", { n: fmt(cur.n), total: fmt(e.n) }) : t("cost.sample.all", { total: fmt(e.n) });
    q("#cn").textContent = fmt(cur.n);
    q("#ctok").textContent = `≈ ${fmtTokens(cur.tokens)}`;
    q("#ccost").textContent = cur.cost == null ? t("cost.unknown") : `≈ ${fmtUsd(cur.cost)}`;
    if (q("#cmax")) q("#cmax").textContent = t("cost.max", { max: fmtUsd(cur.maxCost) });
    q("#cover").hidden = !over(cur);
    q("#crange").style.setProperty("--p", `${p}%`);
    dlg.querySelectorAll(".costpresets [data-pct]").forEach((b) => b.classList.toggle("on", Number(b.dataset.pct) === p));
  };
  if (sample) {
    show(pct0);
    q("#crange").addEventListener("input", (ev) => show(Number(ev.target.value)));
    dlg.querySelectorAll(".costpresets [data-pct]").forEach((b) => b.addEventListener("click", () => { q("#crange").value = b.dataset.pct; show(Number(b.dataset.pct)); }));
  }
  return new Promise((resolve) => {
    const done = (v) => { if (closeCostDialog === done) closeCostDialog = null; dlg.remove(); bg?.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    closeCostDialog = done;
    const onKey = (ev) => { if (ev.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    q("#ccancel").onclick = () => done(false);
    bg.onclick = () => done(false);
    q("#cgo").onclick = () => done({ max: pct >= 100 ? null : cur.n });
    q("#cgo").focus();
  });
}
/**
 * Le calcul peut prendre une minute (compter tous les emails d'une grosse boîte) : une fenêtre d'attente reste ouverte
 * pendant ce temps, avec Annuler, puis laisse la place à la fenêtre du coût.
 */
async function estimateThen(path, opts, dialog) {
  // Un calcul ou une fenêtre de coût déjà ouverts : on ne superpose pas une seconde fenêtre.
  if (document.querySelector(".costdlg")) return false;
  closeDrawer();
  const ctl = new AbortController();
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><div class="dlg costdlg costwait" role="dialog" aria-modal="true" aria-busy="true">
    <div><div class="kicker">${h(t("cost.kicker"))}</div><h2 style="margin-top:6px">${h(t("cost.computing"))}</h2></div>
    <div class="row" style="align-items:center;gap:12px"><span class="spin" aria-hidden="true"></span><span class="gp">${h(t("cost.computingHint"))}</span></div>
    <div class="foot"><span class="spacer"></span><button class="btn ghost" id="cwcancel">${h(t("common.cancel"))}</button></div>
  </div>`);
  const clear = () => document.querySelectorAll(".costwait, .drawer-bg").forEach((x) => x.remove());
  $("#cwcancel").onclick = () => ctl.abort();
  let r;
  try { r = await api(path, { ...opts, signal: ctl.signal }); }
  catch (e) { clear(); if (e.name !== "AbortError") toast(e.message); return false; }
  clear();
  return confirmAiCost(r, typeof dialog === "function" ? dialog(r) : dialog);
}
async function openDrawer(id) {
  closeDrawer();
  const r = await api(`/items/${id}`);
  const a = answersOf(r);
  const labels = (() => { try { return JSON.parse(r.labels_json || "[]"); } catch { return []; } })();
  const applied = (() => { try { return JSON.parse(r.applied_labels_json || "[]"); } catch { return []; } })();
  const probs = a?.category?.probabilities ? Object.entries(a.category.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 4) : [];
  const gmailUrl = `https://mail.google.com/mail/u/${encodeURIComponent(r.account_email)}/#all/${r.thread_id || r.external_id}`;
  const sig = a ? [[t("drawer.sig.replyExpected"), a.reply_expected?.probability], [t("drawer.sig.awaitsReply"), a.awaits_reply?.probability], [t("drawer.sig.attention"), a.attention?.probability], [t("drawer.sig.toPay"), a.to_pay?.probability], [t("drawer.sig.spam"), a.spam?.probability]].filter(([, p]) => p != null) : [];
  const html = `<div class="drawer-bg"></div><aside class="drawer">
    <div class="row" style="align-items:center"><div class="mono">${labels.includes("UNREAD") ? `<span class="dot unread"></span> ${h(t("common.unread"))}` : `<span class="dot"></span> ${h(t("common.read"))}`} · ${fmtDateTime(r.date)}</div><button class="btn sm" id="dclose" style="margin-left:auto">${h(t("common.close"))}</button></div>
    <div><div style="font-size:20px;font-weight:700;line-height:1.2">${h(r.subject)}</div><div class="small muted" style="margin-top:4px"><b style="color:var(--ink)">${h(r.from_name || "")}</b> <span style="font-family:var(--mono)">${h(r.from_address)}</span> → ${h(r.account_email)}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${r.needs_review ? `<span class="chip">${h(t("common.toReview"))}</span>` : chip(r.category)}${a?.priority ? `<span class="pill ${!r.obsolete && prioScore(r) >= 1.5 ? "strong" : ""}">${h(t("app.priority", { level: prioLabel(r) }))}</span>` : ""}${flagKeysOf(r).map((x) => `<span class="pill ${x === "important" ? "strong" : ""}">${h(t("flags." + x))}</span>`).join("")}<span class="small muted" style="margin-left:auto">${h(t("drawer.decidedBy", { who: r.decided_by ? t("decidedBy." + r.decided_by) : "—" }))} · ${h(r.applied_at ? t("drawer.applied") : t("drawer.preview"))}</span></div>
    <div class="body">${h(r.body_excerpt || t("common.noText"))}</div>
    ${probs.length ? `<div><div class="mono" style="margin-bottom:6px">${h(t("drawer.probs"))}</div>${probs.map(([k, p]) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">${chip(k)}<div class="bar" style="flex-grow:1;height:4px"><i style="width:${Math.round(p * 100)}%"></i></div><span class="num muted" style="width:44px">${pct(p)}</span></div>`).join("")}</div>` : ""}
    ${sig.length ? `<div><div class="mono" style="margin-bottom:6px">${h(t("drawer.signals"))}</div>${sig.map(([n, p]) => p == null ? "" : `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:150px;font-size:14px">${h(n)}</span><div class="bar" style="flex-grow:1;height:4px"><i style="width:${Math.round(p * 100)}%"></i></div><span class="num muted" style="width:44px">${pct(p)}</span></div>`).join("")}</div>` : ""}
    <div class="row" style="align-items:center;gap:10px"><label class="field" style="flex-grow:1"><span class="mono">${h(t("drawer.fixCategory"))}</span><select id="dcat"><option value="">—</option>${TAX.categories.map((c) => `<option value="${c.key}" ${c.key === r.category ? "selected" : ""}>${h(c.name)}</option>`).join("")}</select></label><label style="display:flex;align-items:center;gap:8px;font-size:13px;white-space:nowrap;padding-top:22px"><input type="checkbox" id="drule" style="width:16px;height:16px;accent-color:#1B1C1F">${h(t("drawer.domainRule"))}</label></div>
    <div class="row" style="gap:10px"><a class="btn ink" href="${gmailUrl}" target="_blank" rel="noopener">${h(t("drawer.openGmail"))}</a>${applied.length ? `<span class="small muted" style="align-self:center">${h(t("drawer.labels", { list: applied.join(", ") }))}</span>` : ""}</div>
    <div class="small muted" style="font-family:var(--mono)">${r.latency_ms ? h(t("app.stats", { ms: r.latency_ms, tokens: r.input_tokens })) : ""}</div>
  </aside>`;
  document.body.insertAdjacentHTML("beforeend", html);
  $("#dclose").onclick = closeDrawer;
  $(".drawer-bg").onclick = closeDrawer;
  $("#dcat").onchange = async (e) => {
    if (!e.target.value || e.target.value === r.category) return;
    try { await api(`/items/${r.id}/category`, { method: "POST", body: { category: e.target.value, makeRule: $("#drule").checked, apply: !!r.applied_at } }); toast(t("drawer.toast.saved", { name: catName(e.target.value) })); closeDrawer(); route(); } catch (err) { toast(err.message); }
  };
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

function answersOf(r) {
  try { return r.answers_json ? JSON.parse(r.answers_json) : r.answers || null; } catch { return null; }
}

// ---------- séparateurs redimensionnables (largeur mémorisée dans le navigateur)
function setupResizer(handle, cssVar, min, max, storeKey, sign = 1) {
  if (!handle) return;
  try { const saved = localStorage.getItem(storeKey); if (saved) document.documentElement.style.setProperty(cssVar, saved + "px"); } catch {}
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || min;
    handle.classList.add("active");
    document.body.classList.add("resizing");
    const move = (ev) => { const w = Math.min(max, Math.max(min, startW + sign * (ev.clientX - startX))); document.documentElement.style.setProperty(cssVar, w + "px"); };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); handle.classList.remove("active"); document.body.classList.remove("resizing"); try { localStorage.setItem(storeKey, parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar))); } catch {} };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  handle.addEventListener("dblclick", () => { document.documentElement.style.removeProperty(cssVar); try { localStorage.removeItem(storeKey); } catch {} });
}
setupResizer($("#rs-nav"), "--nav-w", 160, 420, "ea.navW");
if ($("#rs-nav")) $("#rs-nav").title = t("app.resize");

// ---------- animation de passage : un réseau qui naît de rien et grandit avec les emails traités
const ANIM = { net: null, t: 0, raf: null, progress: 0, phase: "", frozen: false, last: 0, count: 0, total: 0, live: null };
/** Taille finale du réseau selon le nombre d'emails en jeu : 30 nœuds pour une centaine, 200 pour dix mille. */
function netSizeFor(total) {
  const n = total ? Math.round(30 + 34 * Math.log10(Math.max(1, total / 100))) : 60;
  return { nodes: Math.max(20, Math.min(200, n)), reach: 0.30 + Math.min(0.14, (total || 0) / 40000), perNode: total > 3000 ? 4 : total > 500 ? 3 : 2 };
}
function buildNet(total) {
  const size = netSizeFor(total);
  const nodes = [];
  for (let i = 0; i < size.nodes; i++) nodes.push({ a: Math.random() * Math.PI * 2, r: 0.40 + Math.pow(Math.random(), 0.9) * 0.58, s: 1 + Math.random() * 1.6, glow: 0, born: -1 });
  // Le réseau pousse du centre vers l'extérieur : les nœuds apparaissent dans l'ordre de leur rayon.
  nodes.sort((p, q) => p.r - q.r);
  const xy = (n) => [Math.cos(n.a) * n.r, Math.sin(n.a) * n.r];
  const edges = [];
  nodes.forEach((n, i) => {
    const [x, y] = xy(n);
    nodes.map((m, j) => ({ j, d: Math.hypot(xy(m)[0] - x, xy(m)[1] - y) })).filter((c) => c.j !== i && c.d < size.reach).sort((p, q) => p.d - q.d).slice(0, size.perNode)
      .forEach((c) => { if (!edges.some((e) => (e.a === i && e.b === c.j) || (e.a === c.j && e.b === i))) edges.push({ a: i, b: c.j, heat: 0, born: -1 }); });
  });
  const dust = [];
  for (let i = 0; i < 40; i++) dust.push({ a: Math.random() * Math.PI * 2, r: 0.42 + Math.random() * 0.7, v: 0.02 + Math.random() * 0.03, s: 0.5 + Math.random() * 1, ph: Math.random() * 6 });
  return { nodes, edges, pulses: [], spawn: 0, total, dust, visible: 0 };
}
function drawScan(once = false) {
  const cv = $("#scan");
  if (!cv) { ANIM.raf = null; return; }
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const size = Math.max(120, cv.clientWidth || 300);
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
  if (!ANIM.net || ANIM.net.total !== ANIM.total) ANIM.net = buildNet(ANIM.total);
  const N = ANIM.net;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = size, cx = W / 2, cy = W / 2, R = W / 2, k = size / 300;
  const now = performance.now();
  const dt = once || !ANIM.last ? 16 : Math.min(50, now - ANIM.last);
  ANIM.last = now;
  const ds = once ? 0 : dt / 1000;
  ANIM.t += ds;
  const t = ANIM.t;
  const spin = t * 0.04;
  ctx.fillStyle = "#1B1C1F"; ctx.fillRect(0, 0, W, W);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
  halo.addColorStop(0, "rgba(216,219,223,0.07)"); halo.addColorStop(1, "rgba(216,219,223,0)");
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, W);
  // Progression lissée : la valeur affichée rattrape la mesure, sans jamais la dépasser.
  const indeterminate = ANIM.progress === null;
  const target = indeterminate ? 0 : Math.max(0, Math.min(1, ANIM.progress));
  if (!once) {
    ANIM.shown = ANIM.shown ?? target;
    ANIM.shown += (target - ANIM.shown) * Math.min(1, dt / 400);
    if (ANIM.shown > target) ANIM.shown = target;
    ANIM.shownCount = ANIM.shownCount ?? (ANIM.count || 0);
    ANIM.shownCount += ((ANIM.count || 0) - ANIM.shownCount) * Math.min(1, dt / 400);
  } else { ANIM.shown = target; ANIM.shownCount = ANIM.count || 0; }
  const pr = Math.max(0, Math.min(1, ANIM.shown));
  // Naissance du réseau : le nombre de nœuds visibles suit la progression (au moins 3 dès le départ).
  // En direct (veille) : le réseau est entier et respire, sans fin.
  const wanted = ANIM.live ? N.nodes.length : indeterminate ? Math.min(N.nodes.length, 3 + Math.floor((ANIM.count || 0) / 8)) : Math.max(3, Math.round(N.nodes.length * pr));
  while (N.visible < wanted && N.visible < N.nodes.length) { N.nodes[N.visible].born = t; N.visible++; }
  const isOn = (i) => i < N.visible;
  for (const e of N.edges) if (e.born < 0 && isOn(e.a) && isOn(e.b)) e.born = t;
  const P = (n) => [cx + Math.cos(n.a + spin) * R * n.r, cy + Math.sin(n.a + spin) * R * n.r];
  const grow = (born) => (born < 0 ? 0 : Math.min(1, (t - born) / 0.6));
  // Poussières discrètes.
  for (const d of N.dust) {
    d.r += d.v * ds; d.a += 0.1 * ds; if (d.r > 1.15) { d.r = 0.42; d.a = Math.random() * Math.PI * 2; }
    const fade = Math.max(0, 1 - (d.r - 0.42) / 0.73), tw = 0.6 + 0.4 * Math.sin(t * 2 + d.ph);
    ctx.fillStyle = `rgba(251,251,252,${(0.06 + 0.25 * fade * tw).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(d.a + spin) * R * d.r, cy + Math.sin(d.a + spin) * R * d.r, d.s * k, 0, Math.PI * 2); ctx.fill();
  }
  // Impulsions : sur les liaisons nées ; elles chauffent les liaisons (les traces), qui refroidissent lentement.
  const live = N.edges.filter((e) => e.born >= 0);
  if (!once && live.length) {
    N.spawn += dt;
    const every = Math.max(70, 260 - live.length);
    while (N.spawn > every) { N.spawn -= every; const e = live[Math.floor(Math.random() * live.length)]; N.pulses.push({ from: e.a, to: e.b, k: 0, v: 0.0011 + Math.random() * 0.001, hops: 0, red: Math.random() < 0.07 }); }
    for (const p of N.pulses) {
      p.k += p.v * dt;
      const e = N.edges.find((x) => (x.a === p.from && x.b === p.to) || (x.a === p.to && x.b === p.from));
      if (e) e.heat = Math.min(1, e.heat + 0.02 * dt / 16);
      if (p.k >= 1) {
        N.nodes[p.to].glow = 1;
        const nexts = live.filter((x) => (x.a === p.to || x.b === p.to) && x.a !== p.from && x.b !== p.from);
        if (nexts.length && p.hops < 3) { const x = nexts[Math.floor(Math.random() * nexts.length)]; p.from = p.to; p.to = x.a === p.to ? x.b : x.a; p.k = 0; p.hops++; } else p.dead = true;
      }
    }
    N.pulses = N.pulses.filter((p) => !p.dead).slice(-80);
    for (const n of N.nodes) n.glow = Math.max(0, n.glow - dt / 900);
    for (const e of N.edges) e.heat = Math.max(0, e.heat - dt / 9000); // les traces durent plusieurs secondes
  }
  ctx.lineCap = "round";
  for (const e of live) {
    const g = grow(e.born);
    const [x1, y1] = P(N.nodes[e.a]), [x2, y2] = P(N.nodes[e.b]);
    const xm = x1 + (x2 - x1) * g, ym = y1 + (y2 - y1) * g;
    ctx.strokeStyle = `rgba(216,219,223,${(0.10 + 0.45 * e.heat).toFixed(2)})`; ctx.lineWidth = (0.6 + 1.0 * e.heat) * k;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xm, ym); ctx.stroke();
  }
  for (const p of N.pulses) {
    const [x1, y1] = P(N.nodes[p.from]), [x2, y2] = P(N.nodes[p.to]);
    const x = x1 + (x2 - x1) * p.k, y = y1 + (y2 - y1) * p.k, kt = Math.max(0, p.k - 0.25);
    const col = p.red ? "255,59,48" : "251,251,252";
    const g = ctx.createLinearGradient(x1 + (x2 - x1) * kt, y1 + (y2 - y1) * kt, x, y);
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.9)`);
    ctx.strokeStyle = g; ctx.lineWidth = 1.6 * k; ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * kt, y1 + (y2 - y1) * kt); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = `rgba(${col},0.95)`; ctx.beginPath(); ctx.arc(x, y, 1.8 * k, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < N.visible; i++) {
    const n = N.nodes[i];
    const g = grow(n.born), [x, y] = P(n);
    const s = (n.s + n.glow * 1.5) * k * (0.2 + 0.8 * g);
    const birth = g < 1 ? (1 - g) : 0; // éclat de naissance
    if (n.glow > 0.05 || birth) { ctx.fillStyle = `rgba(251,251,252,${(0.18 * Math.max(n.glow, birth)).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, (n.s + 6) * k * (0.5 + 0.5 * g), 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = `rgba(251,251,252,${(0.5 + 0.5 * Math.max(n.glow, birth)).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  // Pupille et progression.
  ctx.fillStyle = "#1B1C1F"; ctx.beginPath(); ctx.arc(cx, cy, R * 0.355, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(166,171,178,0.6)"; ctx.lineWidth = 0.8 * k; ctx.beginPath(); ctx.arc(cx, cy, R * 0.36, 0, Math.PI * 2); ctx.stroke();
  const rp = R * 0.29;
  ctx.strokeStyle = "rgba(111,116,124,0.35)"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI * 2); ctx.stroke();
  // En direct : l'anneau se remplit du dernier passage au prochain, puis repart à zéro.
  const lv = ANIM.live;
  const liveArc = lv && lv.from && lv.to && lv.to > lv.from ? Math.max(0.01, Math.min(1, (Date.now() - lv.from) / (lv.to - lv.from))) : null;
  const arc = lv ? liveArc ?? 0.2 : indeterminate ? 0.2 : pr;
  if (arc > 0) {
    const a0 = (lv ? liveArc == null : indeterminate) && !once ? t * 2.4 : -Math.PI / 2;
    ctx.strokeStyle = "#FF3B30"; ctx.lineWidth = 2.4 * k; ctx.beginPath(); ctx.arc(cx, cy, rp, a0, a0 + arc * Math.PI * 2); ctx.stroke();
    const ea = a0 + arc * Math.PI * 2;
    ctx.fillStyle = "#FF3B30"; ctx.beginPath(); ctx.arc(cx + Math.cos(ea) * rp, cy + Math.sin(ea) * rp, 2.8 * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = !lv && pr >= 0.995 && !indeterminate ? "#FF3B30" : "#FBFBFC"; ctx.font = `700 ${Math.round(26 * k)}px Outfit, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(lv ? fmt(lv.count) : indeterminate ? fmt(Math.round(ANIM.shownCount || 0)) : fmtPct(pr), cx, cy - 1);
  if (lv) { ctx.fillStyle = "#A6ABB2"; ctx.font = `500 ${Math.round(9 * k)}px "IBM Plex Mono", monospace`; ctx.fillText(lv.unit, cx, cy + 20 * k); }
  if (once) { ANIM.raf = null; return; }
  if (!lv && ANIM.freezeWhenFull && (indeterminate || ANIM.shown >= target - 0.004) && N.visible >= wanted) { ANIM.raf = null; return; }
  ANIM.raf = requestAnimationFrame(() => drawScan(false));
}
function ensureScan(progress, phase, frozen = false, count = 0, total = 0) {
  ANIM.live = null;
  ANIM.total = total || 0;
  // Passage terminé : le flux continue jusqu'à ce que l'anneau atteigne 100 %, puis l'image se fige.
  if (frozen) { ANIM.freezeWhenFull = true; frozen = false; } else ANIM.freezeWhenFull = false;
  ANIM.progress = progress; ANIM.phase = phase; ANIM.frozen = frozen; ANIM.count = count;
  if (frozen) { if (ANIM.raf) { cancelAnimationFrame(ANIM.raf); ANIM.raf = null; } ANIM.last = 0; drawScan(true); return; }
  if (!ANIM.raf) { ANIM.last = 0; ANIM.raf = requestAnimationFrame(() => drawScan(false)); }
}
/**
 * Animation « en direct » : quand rien ne se rattrape, le réseau vit au rythme de la veille. Taille : ce qui a été
 * classé sur 7 jours ; au centre, ce qui a été lu aujourd'hui ; l'anneau va du dernier passage Gmail au prochain.
 */
function liveScan(live) {
  const g = live.channels.gmail.accounts.filter((a) => a.watching && a.nextPassAt);
  const next = g.length ? g.reduce((x, a) => (a.nextPassAt < x.nextPassAt ? a : x)) : null;
  ANIM.total = live.read.week || 0;
  ANIM.freezeWhenFull = false; ANIM.frozen = false; ANIM.progress = 1;
  ANIM.live = { count: live.read.today.gmail + live.read.today.whatsapp, unit: t("scan.live.unit"), from: next ? next.nextPassAt - (next.every || 300) * 1000 : null, to: next?.nextPassAt ?? null };
  if (!ANIM.raf) { ANIM.last = 0; ANIM.raf = requestAnimationFrame(() => drawScan(false)); }
}

// ---------- navigation (les libellés viennent du dictionnaire : t("nav." + clé) au rendu)
const PAGES = ["home", "actions", "mail", "agenda", "docs"];
/** Les canaux, dans l'ordre du menu : Telegram d'abord, c'est par lui qu'on pilote Molinova depuis son téléphone. */
const CHANNELS = ["telegram", "gmail", "drive", "whatsapp"];
/** Le groupe Réglages : chaque entrée est une page à part entière, l'entrée parente mène aux connexions. */
const SETTINGS_PAGES = ["settings", "usage", "context", "rules", "taxonomy", "questions"];
const isSettingsPage = (p) => SETTINGS_PAGES.includes(p);
/** Anciennes adresses (favoris, liens d'avant l'Accueil) → nouvelles. */
const ALIASES = { dashboard: "home", review: "classify", sources: "channels" };
function aliasOf(hash) {
  const [page, ...rest] = hash.split("/");
  if (page === "sources" && (rest[0] === "whatsapp" || rest[0] === "telegram")) return ["channel", ...rest].join("/");
  return ALIASES[page] ? [ALIASES[page], ...rest].join("/") : null;
}
let badges = {};
/** Ce qui vient de WhatsApp : sous-entrée « À caler · WhatsApp » sous Agenda (dans Actions, tout est déjà dans la file commune). */
let WA = { accountId: null, actions: 0, toCal: 0 };
/** L'état en direct des canaux (GET /api/home), relu toutes les 30 s : voyants du menu, Accueil. */
let LIVE = null;

/** Voyant d'un canal : allumé, coupé, en erreur, ou à brancher. */
function ledOf(state) { return state === "on" || state === "partial" ? "on" : state === "error" ? "err" : state === "pair" ? "warn" : "off"; }
/** L'état court d'un canal, sous son nom dans le menu. */
function channelLine(ch) {
  const c = LIVE?.channels;
  if (!c) return "";
  if (ch === "telegram") return t("chan.tg.state." + c.telegram.state);
  if (ch === "whatsapp") return c.whatsapp.state === "on" ? ago(c.whatsapp.lastIngestAt) : t("chan.wa.state." + c.whatsapp.state);
  if (ch === "drive") return c.drive.state === "on" ? tn("chan.drive.state.on", c.drive.docs) : t("chan.drive.state." + c.drive.state);
  const g = c.gmail;
  if (g.state === "on" || g.state === "partial") {
    const last = Math.max(0, ...g.accounts.map((a) => a.lastPassAt || 0));
    return t(g.state === "on" ? "chan.gmail.state.on" : "chan.gmail.state.partial", { ago: last ? ago(new Date(last).toISOString()) : t("time.now") });
  }
  return t("chan.gmail.state." + g.state);
}
function renderNav() {
  const [cur0, sub] = location.hash.slice(1).split("/");
  const cur = ALIASES[cur0] || cur0;
  const page = cur || "home";
  const subs = { agenda: WA.accountId ? [["whatsapp", t("nav.agenda.whatsapp"), WA.toCal]] : [], mail: [["inbox", t("mail.box.inbox")], ["sent", t("mail.box.sent")], ["drafts", t("mail.box.drafts")]] };
  // Boîte : le dossier ouvert est en surbrillance dans le sous-menu (#mail tout court = Reçus, comme un lien de filtre).
  const subOn = (k, sk) => k === page && (k === "mail" ? (["sent", "drafts"].includes(sub) ? sub : "inbox") === sk : sub === sk);
  const inSettings = isSettingsPage(page);
  const main = PAGES.map((k) => `<a href="#${k}" class="${k === page && sub !== "whatsapp" && k !== "mail" ? "on" : ""}"><span>${h(t("nav." + k))}</span>${badges[k] ? `<span class="badge">${badges[k]}</span>` : ""}</a>` +
    (subs[k] || []).map(([sk, sl, n]) => `<a href="#${k}/${sk}" class="sub ${subOn(k, sk) ? "on" : ""}"><span>└ ${h(sl)}</span>${n ? `<span class="badge">${n}</span>` : ""}</a>`).join("")).join("");
  const chans = CHANNELS.filter((ch) => ch !== "whatsapp" || LIVE?.channels?.whatsapp?.state !== "unsupported").map((ch) => {
    const st = LIVE?.channels?.[ch]?.state;
    const on = page === "channel" && sub === ch;
    const line = channelLine(ch);
    const classify = ch === "gmail" && (badges.classify || page === "classify")
      ? `<a href="#classify" class="sub ${page === "classify" ? "on" : ""}"><span>└ ${h(t("nav.classify"))}</span>${badges.classify ? `<span class="badge">${badges.classify}</span>` : ""}</a>` : "";
    return `<a href="#channel/${ch}" class="chan ${on ? "on" : ""}"><span class="led ${st ? ledOf(st) : "off"}"></span><span class="cname">${h(t("chan." + ch))}</span><span class="cstate">${h(line)}</span></a>${classify}`;
  }).join("");
  const settings = `<a href="#settings" class="grp ${inSettings ? "on open" : ""}"><span>${h(t("nav.settings"))}</span><span class="caret">${inSettings ? "▾" : "▸"}</span></a>` +
    (inSettings ? `<div class="submenu">${SETTINGS_PAGES.map((sk) => `<a href="#${sk}" class="sub ${sk === page ? "on" : ""}"><span>${h(t("nav.settings." + sk))}</span></a>`).join("")}</div>` : "");
  $("#nav").innerHTML = main +
    `<div class="navsec">${h(t("nav.channels"))}</div>${chans}<a href="#channels" class="chan add ${page === "channels" ? "on" : ""}"><span class="cname">${h(t("nav.addChannel"))}</span></a>` +
    `<div class="navgap"></div>${settings}`;
}
async function refreshWa() {
  try { WA = await api("/whatsapp/counts"); } catch { WA = { accountId: null, actions: 0, toCal: 0 }; }
  renderNav();
}
/** Relit l'état en direct ; les voyants et les badges suivent, l'Accueil se redessine s'il est affiché. */
async function refreshLive() {
  try { LIVE = await api("/home"); } catch { return; }
  badges.actions = LIVE.counts.actions || "";
  badges.classify = LIVE.counts.review || "";
  renderNav();
  if (currentPage() === "home" && typeof homeLive === "function") homeLive();
}
const currentPage = () => { const p = (location.hash.slice(1) || "home").split("/")[0]; return ALIASES[p] || p; };
/**
 * Le serveur lit WhatsApp tout seul (« Fréquence de lecture ») ; la page suit sans rechargement : toutes les 30 s
 * quand l'onglet est visible, et dès qu'il le redevient. La liste affichée n'est relue que si une lecture a changé
 * quelque chose, jamais sous un volet ouvert ni pendant une sélection.
 */
let waSeenAt = null;
async function followWa() {
  if (document.hidden) return;
  refreshLive();
  const before = WA;
  await refreshWa();
  const at = WA.lastIngestAt ?? null;
  if (at === waSeenAt) return;
  waSeenAt = at;
  if (WA.actions === before.actions && WA.toCal === before.toCal) return;
  if (document.querySelector(".drawer, .dlg") || (typeof ACT !== "undefined" && ACT.selected?.size)) return;
  const page = currentPage();
  if (page === "actions") MAIL.reload?.();
  else if (page === "agenda" && typeof loadWeek === "function") loadWeek();
}
setInterval(followWa, 30_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) followWa(); });
/** Le pied du menu : la section Canaux montre déjà ce qui est branché ; il ne reste que la promesse « tout est local ». */
function renderFoot() {
  $("#foot").innerHTML = `<div class="mono" style="letter-spacing:.06em">${h(t("nav.local"))}</div>`;
  refreshLive();
}

const views = {};
/** État du premier lancement (GET /api/setup/state), lu avant le premier rendu ; setup.js le tient à jour. */
let SETUP = null;
/** Chaque rendu porte un numéro : une page lente (Gmail, Actions) ne recouvre pas celle demandée après elle. */
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const hash = location.hash.slice(1) || "home";
  const moved = aliasOf(hash);
  if (moved) { location.replace("#" + moved); return; }
  const [page, ...rest] = hash.split("/");
  // Installation pas encore complète : l'assistant d'abord, quelle que soit l'adresse demandée.
  if (SETUP && !SETUP.complete && page !== "setup") { location.replace("#setup"); return; }
  document.body.classList.toggle("setup-mode", page === "setup");
  document.title = t("app.title");
  renderNav();
  const main = $("#main");
  main.classList.remove("mailmode");
  closeDrawer();
  let html;
  try { html = await (views[page] || views.home)(rest); }
  catch (e) { html = `<div class="empty">${t("app.error", { message: h(e.message) })}</div>`; }
  if (seq === routeSeq) { main.innerHTML = html; showUpdateBanner(); }
}
window.addEventListener("hashchange", route);

// ---------- nouvelle version publiée sur GitHub (app seulement) : un bandeau en haut de chaque écran
// « Plus tard » le masque trois jours pour cette version ; la notification macOS et le menu de la barre restent.
window.MOLINOVA_UPDATE = null;
const UPDATE_LATER_MS = 3 * 86_400_000;
function updateDismissed(version) {
  try { const d = JSON.parse(localStorage.getItem("ea.updateLater") || "null"); return !!d && d.version === version && Date.now() - d.at < UPDATE_LATER_MS; } catch { return false; }
}
function showUpdateBanner() {
  document.getElementById("updbar")?.remove();
  const u = window.MOLINOVA_UPDATE;
  if (!u || updateDismissed(u.version) || document.body.classList.contains("setup-mode")) return;
  $("#main").insertAdjacentHTML("afterbegin", `<div class="card updbar" id="updbar"><span><b>${h(t("update.banner", { version: u.version }))}</b> ${h(t("update.why"))}</span><span class="spacer"></span><a class="btn sm ink" href="${h(u.url)}" target="_blank" rel="noopener">${h(t("update.download"))}</a><button class="btn sm ghost" id="updlater">${h(t("update.later"))}</button></div>`);
  $("#updlater").onclick = () => { try { localStorage.setItem("ea.updateLater", JSON.stringify({ version: u.version, at: Date.now() })); } catch {} showUpdateBanner(); };
}
if (window.molinova?.getUpdate) {
  window.molinova.getUpdate().then((u) => { window.MOLINOVA_UPDATE = u; showUpdateBanner(); }).catch(() => {});
  window.molinova.onUpdate((u) => { window.MOLINOVA_UPDATE = u; showUpdateBanner(); });
}

// ---------- Canaux : chaque canal a sa page, avec son état en direct et ses réglages
views.channel = async (rest = []) => {
  if (rest[0] === "telegram") return viewTelegram();
  if (rest[0] === "whatsapp") return viewWhatsApp();
  if (rest[0] === "gmail") return viewGmail();
  if (rest[0] === "drive") return viewDrive(rest[1]);
  location.replace("#channels");
  return "";
};

// ---------- Canaux › Gmail › À classer : les emails dont le libellé est incertain (ex-« À revoir »)
const REV = { domain: "", cat: "", last: null };
views.classify = async (rest = []) => {
  if (rest[0]) { const tgt = decodeURIComponent(rest[0]); if (tgt.startsWith("domain:")) { REV.domain = tgt.slice(7); REV.cat = ""; } else if (tgt.startsWith("cat:")) { REV.cat = tgt.slice(4); REV.domain = ""; } history.replaceState(null, "", "#classify"); }
  const [items, tax] = await Promise.all([api("/items?review=1&limit=2000"), api("/config/taxonomy")]);
  TAX = tax;
  badges.classify = items.length || "";
  renderNav();
  const topOf = (r) => { const a = answersOf(r); return a?.category?.choice ?? r.category ?? ""; };
  const domOf = (r) => (r.from_address || "").split("@")[1] || "";
  // Compteurs pour les filtres.
  const byDomain = new Map(), byCat = new Map();
  for (const r of items) { byDomain.set(domOf(r), (byDomain.get(domOf(r)) || 0) + 1); byCat.set(topOf(r), (byCat.get(topOf(r)) || 0) + 1); }
  const shown = items.filter((r) => (!REV.domain || domOf(r) === REV.domain) && (!REV.cat || topOf(r) === REV.cat));
  const cards = shown.map((r) => {
    const a = answersOf(r);
    const probs = a?.category?.probabilities ? Object.entries(a.category.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3) : [];
    const prio = prioScore(r), att = a?.attention?.probability;
    const pl = r.obsolete ? t("prio.obsolete") : PRIO(prio);
    const signals = [pl && `<span class="pill ${prio >= 1.5 ? "strong" : ""}">${h(t("app.priority", { level: pl }))}</span>`, att != null && `<span class="pill ${att >= 0.8 ? "strong" : ""}">${h(t("review.attention", { pct: pct(att) }))}</span>`].filter(Boolean).join(" ");
    return `<div class="card review-item" data-id="${r.id}">
      <div class="body"><div>${dot(r)} <b>${h(r.from_name || r.from_address)}</b> <span class="small muted" style="font-family:var(--mono)">${h(r.from_address)}</span></div><div style="font-weight:500;cursor:pointer" class="open" title="${h(t("review.open"))}">${h(r.subject)}</div><div class="snippet">${h(r.body_excerpt?.slice(0, 200))}</div><div>${signals}</div></div>
      <div class="probs"><div class="mono">${h(t("review.probs"))}</div>${probs.map(([k, p]) => `<div style="display:flex;align-items:center;gap:8px">${chip(k)}<span class="num muted" style="margin-left:auto">${pct(p)}</span></div>`).join("") || `<div class="muted small">—</div>`}</div>
      <div class="acts">${probs.slice(0, 2).map(([k]) => `<button class="btn sm ${probs[0][0] === k ? "ink" : ""}" data-cat="${k}">${h(catName(k))}</button>`).join("")}
        <select class="other" style="width:150px;height:36px"><option value="">${h(t("review.otherCat"))}</option>${TAX.categories.map((c) => `<option value="${c.key}">${h(c.name)}</option>`).join("")}</select></div>
    </div>`;
  }).join("");
  const domOptions = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `<option value="${h(d)}" ${REV.domain === d ? "selected" : ""}>${h(d)} (${n})</option>`).join("");
  const catChips = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const c = TAX.categories.find((x) => x.key === k); return `<button class="fchip ${REV.cat === k ? "on" : ""}" data-rcat="${h(k)}" style="${c ? `--cb:${c.color.background};--ct:${c.color.text}` : ""}">${h(c ? c.name : k || "?")} <span class="muted">${n}</span></button>`; }).join("");
  setTimeout(() => {
    const refresh = () => route();
    $("#rdom")?.addEventListener("change", (e) => { REV.domain = e.target.value; refresh(); });
    document.querySelectorAll("[data-rcat]").forEach((b) => b.addEventListener("click", () => { REV.cat = REV.cat === b.dataset.rcat ? "" : b.dataset.rcat; refresh(); }));
    $("#rclear")?.addEventListener("click", () => { REV.domain = ""; REV.cat = ""; refresh(); });
    $("#rerun")?.addEventListener("click", async () => {
      const b = $("#rerun"); b.disabled = true; b.textContent = tn("review.rerunning", items.length);
      const banner = $("#rbanner"); banner.style.display = "block"; banner.innerHTML = `<div class="mono">${h(t("review.rerun.title"))}</div><div>${h(tn("review.rerun.body", items.length, { s: Math.ceil(items.length / 16) }))}</div>`;
      try { const st = await api("/review/rerun", { method: "POST", body: {} }); REV.last = st; refresh(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = t("review.rerun"); }
    });
    const remaining = () => [...document.querySelectorAll(".review-item")].map((el) => Number(el.dataset.id));
    const syncCounts = () => { const n = remaining().length; const b = $("#raccept"); if (b) { b.textContent = tn("review.acceptN", n); b.disabled = !n; } const mv = $("#rmove"); if (mv) { mv.textContent = `${tn("review.moveN", n)} ▾`; mv.disabled = !n; } const c = $("#rshown"); if (c) c.innerHTML = tn("review.shown", n); badges.classify = items.length - (shown.length - n) || ""; renderNav(); };
    // « Classer ces N en… » : toute la liste affichée dans une autre catégorie (même chemin que Valider : un appel Gmail par paquet).
    $("#rmove")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const mv = $("#rmove");
      catMenu(mv.parentElement, { current: REV.cat, onPick: async (cat) => {
        const ids = remaining();
        const makeRule = $("#rule").checked;
        const params = { name: catName(cat) };
        if (!confirm(makeRule ? tn("review.confirm.moveRule", ids.length, params) : tn("review.confirm.move", ids.length, params))) return;
        mv.disabled = true; mv.textContent = tn("review.moving", ids.length);
        $("#raccept").disabled = true;
        const banner = $("#rbanner"); banner.style.display = "block"; banner.innerHTML = `<div class="mono">${h(t("review.accept.title"))}</div><div>${h(t("review.accept.body"))}</div>`;
        try { const r = await api("/review/accept", { method: "POST", body: { ids, makeRule, category: cat } }); toast(`${tn("review.toast.moved", r.n, { name: catName(cat) })}${r.rules ? ` · ${tn("review.toast.rules", r.rules)}` : ""}`); REV.last = null; REV.cat = ""; refresh(); }
        catch (err) { toast(err.message); banner.style.display = "none"; syncCounts(); }
      } });
    });
    $("#raccept")?.addEventListener("click", async () => {
      const ids = remaining();
      const makeRule = $("#rule").checked;
      if (!confirm(makeRule ? tn("review.confirm.acceptRule", ids.length) : tn("review.confirm.accept", ids.length))) return;
      // On dit tout de suite que ça travaille : sans signe, un clic qui attend Gmail ressemble à un clic perdu.
      const b = $("#raccept"); b.disabled = true; b.textContent = tn("review.accepting", ids.length);
      const banner = $("#rbanner"); banner.style.display = "block"; banner.innerHTML = `<div class="mono">${h(t("review.accept.title"))}</div><div>${h(t("review.accept.body"))}</div>`;
      try { const r = await api("/review/accept", { method: "POST", body: { ids, makeRule } }); toast(`${tn("review.toast.accepted", r.n)}${r.rules ? ` · ${tn("review.toast.rules", r.rules)}` : ""}`); REV.last = null; refresh(); }
      catch (e) { toast(e.message); banner.style.display = "none"; syncCounts(); }
    });
    document.querySelectorAll(".review-item").forEach((el) => {
      const id = el.dataset.id;
      const send = async (cat) => {
        const makeRule = $("#rule").checked;
        // Grisé pendant l'appel : le clic est pris, et un second clic ne part pas.
        const controls = el.querySelectorAll("button, select");
        controls.forEach((x) => { x.disabled = true; }); el.style.opacity = ".5";
        try { await api(`/items/${id}/category`, { method: "POST", body: { category: cat, makeRule } }); el.remove(); syncCounts(); toast(`${catName(cat)}${makeRule ? " · " + t("review.toast.ruleAdded") : ""}`); }
        catch (e) { toast(e.message); controls.forEach((x) => { x.disabled = false; }); el.style.opacity = ""; }
      };
      el.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => send(b.dataset.cat)));
      el.querySelector(".other").addEventListener("change", (e) => e.target.value && send(e.target.value));
      el.querySelector(".open").addEventListener("click", () => openDrawer(id));
    });
  });
  const lastBits = REV.last ? [tn("review.result.resolved", REV.last.resolved), tn("review.result.still", REV.last.still), REV.last.errors ? tn("review.result.errors", REV.last.errors) : "", tn("review.result.calls", REV.last.jevCalls)].filter(Boolean).join(" · ") : "";
  const last = REV.last ? `<div class="card" id="rbanner" style="border-color:var(--ink);background:#fff"><div class="mono">${h(t("review.result.title"))}</div><div>${lastBits}</div><div class="small muted">${h(t("review.result.note"))}</div></div>` : `<div class="card" id="rbanner" style="display:none;border-color:var(--ink);background:#fff"></div>`;
  return head("", t("review.head.kicker", { n: items.length }), t("review.head.title"), t("review.head.lead"),
    `<div class="col" style="align-items:flex-end;gap:10px"><button class="btn ink" id="rerun" ${items.length ? "" : "disabled"}>${h(tn("review.rerunN", items.length))}</button><label style="display:flex;align-items:center;gap:10px;font-size:14px"><input type="checkbox" id="rule" style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("review.domainRule"))}</label></div>`) +
    `<div class="small muted" style="margin:-8px 0 0">${t("review.notWork")}</div>` +
    last +
    (items.length ? `<div class="card col" style="gap:10px">
      <div class="row" style="align-items:center;gap:12px;flex-wrap:wrap"><span class="mono">${h(t("review.filter"))}</span>
        <select id="rdom" style="width:auto;height:36px"><option value="">${h(t("review.allDomains"))}</option>${domOptions}</select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="small muted">${h(t("review.proposal"))}</span>${catChips}</div>
        ${REV.domain || REV.cat ? `<button class="btn link" id="rclear">${h(t("review.clearFilters"))}</button>` : ""}</div>
      <div class="row" style="align-items:center;gap:12px"><div class="grow"><span id="rshown">${tn("review.shown", shown.length)}</span>${REV.domain ? ` · ${h(REV.domain)}` : ""}${REV.cat ? ` · ${h(t("review.proposedAs", { name: catName(REV.cat) }))}` : ""}</div><span class="acatpick"><button class="btn" id="rmove" ${shown.length ? "" : "disabled"}>${h(tn("review.moveN", shown.length))} ▾</button></span><button class="btn signal" id="raccept" ${shown.length ? "" : "disabled"}>${h(tn("review.acceptN", shown.length))}</button></div>
    </div>` : "") +
    (cards ? `<div class="col">${cards}</div>` : `<div class="empty">${h(t("review.empty"))}</div>`);
};

// ---------- 03 Actions : voir mail.js (file de travail)

// ---------- 04 Taxonomie
views.taxonomy = async () => {
  const [tax, palette, ctx, o] = await Promise.all([api("/config/taxonomy"), api("/palette"), api("/config/context"), api("/overview")]);
  TAX = tax;
  const saved = JSON.stringify(tax);
  const counts = Object.fromEntries(o.byCategory.map((r) => [r.category, r.n]));
  const children = (ctx.family?.children ?? []).map((c) => ({ key: c.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), name: c.name }));
  const slug = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const byKey = (k) => tax.categories.find((c) => c.key === k);
  const kidsOf = (k) => tax.categories.filter((c) => c.parent === k);
  const pathOf = (c) => { const p = c.parent && byKey(c.parent); return `${tax.prefix}/${p ? p.name + "/" : ""}${c.name}`; };
  const pickerFor = (c) => `<select class="pal" data-k="${c.key}">${palette.map((p) => `<option value="${p.background}|${p.text}" ${p.background === c.color.background && p.text === c.color.text ? "selected" : ""} style="background:${p.background};color:${p.text}">${p.name}</option>`).join("")}${palette.some((p) => p.background === c.color.background && p.text === c.color.text) ? "" : `<option value="${c.color.background}|${c.color.text}" selected>${h(t("taxonomy.custom"))}</option>`}</select>`;
  const childOptions = (sel) => `<option value="">${h(t("taxonomy.childNone"))}</option>${children.map((k) => `<option value="${k.key}" ${sel === k.key ? "selected" : ""}>${h(k.name)}</option>`).join("")}`;
  const childPicker = (c) => children.length ? `<select class="kid" data-k="${c.key}" title="${h(t("taxonomy.childHint"))}">${childOptions(c.child)}</select>` : "";
  const row = (c) => {
    const p = c.parent && byKey(c.parent);
    return `<div class="trow" draggable="true" data-k="${c.key}" data-depth="${p ? 1 : 0}" tabindex="0">
      <span class="handle" title="${h(t("taxonomy.dragHint"))}">⠿</span>
      <div class="lbl"><div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="chip ${p ? "sub" : ""}" style="background:${c.color.background};color:${c.color.text}">${h(c.name)}</span><span class="path">${h(pathOf(c))}</span></div></div>
      <div class="col" style="gap:6px"><input type="text" class="crit" data-k="${c.key}" value="${h(c.criteria)}" placeholder="${h(t("taxonomy.criteriaPh"))}">${p ? childPicker(c) : ""}</div>
      <span class="cnt">${counts[c.key] ? fmt(counts[c.key]) : "<span class=muted>0</span>"}</span>
      <span class="attc"><input type="checkbox" class="att" data-k="${c.key}" ${c.attention !== false ? "checked" : ""} title="${h(p ? t("taxonomy.attInherited", { name: p.name }) : t("taxonomy.attQueue"))}"></span>
      <span class="acts">${pickerFor(c)}${p ? "" : `<button class="btn sm ghost addsub" data-k="${c.key}" title="${h(t("taxonomy.addSub"))}">${h(t("taxonomy.addSubBtn"))}</button>`}<button class="btn sm ghost del" data-k="${c.key}">${h(t("common.remove"))}</button></span>
    </div>`;
  };
  const render = () => {
    const tree = $("#tree");
    tree.querySelectorAll(".trow, .addsub-form").forEach((e) => e.remove());
    tree.insertAdjacentHTML("beforeend", orderedCats(tax).map(row).join(""));
    const dirty = JSON.stringify(tax) !== saved;
    $("#dirty").hidden = !dirty;
    $("#save").disabled = !dirty;
  };
  const move = (key, target, zone) => {
    // zone : « into » → devient sous-catégorie de target ; « before » / « after » → même niveau que target, à côté.
    const c = byKey(key), tg = byKey(target);
    if (!c || !tg || c === tg) return;
    if (zone === "into") {
      if (tg.parent || kidsOf(c.key).length) return;
      c.parent = tg.key;
      c.color = { ...tg.color };
      c.attention = tg.attention !== false;
    } else {
      if (tg.parent && kidsOf(c.key).length) return;
      c.parent = tg.parent;
      if (tg.parent && !c.color) c.color = { ...byKey(tg.parent).color };
    }
    const list = orderedCats(tax).filter((x) => x !== c && x.parent !== c.key);
    const block = [c, ...kidsOf(c.key)];
    let i = list.indexOf(tg);
    if (zone === "into" || zone === "after") { i += 1; while (list[i] && list[i].parent === tg.key) i++; }
    list.splice(i, 0, ...block);
    tax.categories = list;
    render();
  };
  setTimeout(() => {
    const tree = $("#tree");
    render();
    tree.addEventListener("input", (e) => {
      const el = e.target, c = byKey(el.dataset.k);
      if (!c) return;
      if (el.classList.contains("crit")) c.criteria = el.value;
      else if (el.classList.contains("att")) c.attention = el.checked;
      else if (el.classList.contains("pal")) { const [background, text] = el.value.split("|"); c.color = { background, text }; el.closest(".trow").querySelector(".chip").style.cssText = `background:${background};color:${text}`; }
      else if (el.classList.contains("kid")) { if (el.value) c.child = el.value; else delete c.child; }
      $("#dirty").hidden = JSON.stringify(tax) === saved; $("#save").disabled = $("#dirty").hidden;
    });
    tree.addEventListener("click", (e) => {
      const del = e.target.closest(".del"), add = e.target.closest(".addsub");
      if (del) {
        const c = byKey(del.dataset.k);
        for (const k of kidsOf(c.key)) delete k.parent;
        tax.categories = tax.categories.filter((x) => x !== c);
        render();
      }
      if (add) {
        const parent = byKey(add.dataset.k), r = add.closest(".trow");
        let anchor = r; while (anchor.nextElementSibling && anchor.nextElementSibling.dataset.depth === "1") anchor = anchor.nextElementSibling;
        const form = document.createElement("div"); form.className = "addsub-form";
        form.innerHTML = `<span class="mono">${h(t("taxonomy.under", { name: parent.name }))}</span><input type="text" class="nm" placeholder="${h(t("taxonomy.namePh"))}"><input type="text" class="cr" placeholder="${h(t("taxonomy.criteriaPh"))}">${children.length ? `<select class="kd">${childOptions("")}</select>` : ""}<button class="btn sm ink ok">${h(t("common.add"))}</button><button class="btn sm ghost no">${h(t("common.cancel"))}</button>`;
        anchor.after(form);
        const nm = form.querySelector(".nm"); nm.focus();
        const done = () => {
          const name = nm.value.trim(), criteria = form.querySelector(".cr").value.trim(), child = form.querySelector(".kd")?.value || undefined;
          if (!name || !criteria) return toast(t("taxonomy.toast.required"));
          let key = slug(parent.key + "_" + name); while (byKey(key)) key += "_2";
          const c = { key, name, criteria, color: { ...parent.color }, attention: parent.attention !== false, parent: parent.key };
          if (child) c.child = child;
          const i = tax.categories.indexOf(parent);
          const last = Math.max(i, ...kidsOf(parent.key).map((k) => tax.categories.indexOf(k)));
          tax.categories.splice(last + 1, 0, c);
          render();
        };
        form.querySelector(".ok").onclick = done;
        form.querySelector(".no").onclick = () => form.remove();
        form.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); done(); } if (ev.key === "Escape") form.remove(); });
      }
    });
    // Glisser-déposer : une ligne se dépose sur une autre (elle devient sa sous-catégorie) ou entre deux lignes.
    let drag = null;
    const clear = () => tree.querySelectorAll(".over-before,.over-after,.over-into").forEach((x) => x.classList.remove("over-before", "over-after", "over-into"));
    const zoneOf = (ev, r) => { const b = r.getBoundingClientRect(); const y = (ev.clientY - b.top) / b.height; return y < 0.28 ? "before" : y > 0.72 ? "after" : "into"; };
    tree.addEventListener("dragstart", (ev) => { const r = ev.target.closest(".trow"); if (!r) return; drag = r.dataset.k; r.classList.add("dragging"); ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", drag); } catch {} });
    tree.addEventListener("dragend", () => { drag = null; clear(); tree.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging")); });
    tree.addEventListener("dragover", (ev) => {
      const r = ev.target.closest(".trow"); if (!r || !drag || r.dataset.k === drag) return;
      const c = byKey(drag), tg = byKey(r.dataset.k);
      if (tg.parent === c.key) return;
      ev.preventDefault(); clear();
      let z = zoneOf(ev, r);
      if (z === "into" && (tg.parent || kidsOf(c.key).length)) z = "after";
      if (z !== "into" && tg.parent && kidsOf(c.key).length) return;
      r.classList.add("over-" + z);
    });
    tree.addEventListener("drop", (ev) => {
      const r = ev.target.closest(".trow"); if (!r || !drag) return;
      ev.preventDefault();
      const z = r.classList.contains("over-into") ? "into" : r.classList.contains("over-before") ? "before" : r.classList.contains("over-after") ? "after" : null;
      clear();
      if (z) move(drag, r.dataset.k, z);
    });
    $("#reset").addEventListener("click", () => { Object.assign(tax, JSON.parse(saved)); render(); });
    $("#add").addEventListener("click", () => {
      const name = $("#nname").value.trim(), criteria = $("#ncrit").value.trim();
      if (!name || !criteria) return toast(t("taxonomy.toast.required"));
      let key = slug(name); while (byKey(key)) key += "_2";
      const used = new Set(tax.categories.map((c) => c.color.background + c.color.text));
      const free = palette.find((p) => !used.has(p.background + p.text)) ?? palette[0];
      tax.categories.push({ key, name, criteria, color: { background: free.background, text: free.text }, attention: true });
      $("#nname").value = ""; $("#ncrit").value = "";
      render();
    });
    $("#save").addEventListener("click", async () => {
      let plan;
      try { plan = await api("/config/taxonomy/plan", { method: "POST", body: tax }); } catch (e) { return toast(e.message); }
      const asks = plan.changes.filter((ch) => ch.modes.length && ch.count > 0);
      const infos = plan.changes.filter((ch) => !(ch.modes.length && ch.count > 0) && (ch.kind !== "added"));
      if (!asks.length && !infos.some((ch) => ch.kind === "moved" && ch.count > 0)) return commit({});
      openReclassDialog(asks, infos, commit);
    });
    const commit = async (reclass) => {
      try {
        const r = await api("/config/taxonomy", { method: "PUT", body: { taxonomy: tax, reclass } });
        const bits = [t("taxonomy.toast.saved")];
        if (r.renamed.length) bits.push(tn("taxonomy.toast.renamed", r.renamed.length));
        if (r.reclassifying) bits.push(tn("taxonomy.toast.reclass", r.reclassifying));
        if (r.warnings.length) bits.push(r.warnings.join(" · "));
        toast(bits.join(" · "));
        route();
      } catch (e) { toast(e.message); }
    };
  });
  function openReclassDialog(asks, infos, commit) {
    closeDrawer();
    const kindLabel = { gained: (ch) => `+ ${ch.children.join(", ")}`, removed: () => t("taxonomy.kind.removed"), moved: (ch) => t("taxonomy.kind.moved", { from: ch.from, to: ch.to }) };
    const total = asks.reduce((n, ch) => n + ch.count, 0);
    const html = `<div class="drawer-bg"></div><div class="dlg" role="dialog" aria-modal="true">
      <div><div class="kicker">${h(t("taxonomy.dlg.kicker"))}</div><h2 style="margin-top:6px">${h(total ? tn("taxonomy.dlg.title", total) : t("taxonomy.dlg.renames"))}<span class="stop">.</span></h2></div>
      <table><thead><tr><th>${h(t("taxonomy.dlg.change"))}</th><th class="r" style="width:70px">${h(t("taxonomy.dlg.emails"))}</th><th style="width:46%">${h(t("taxonomy.dlg.what"))}</th></tr></thead><tbody>
      ${asks.map((ch, i) => `<tr><td>${chip(ch.key)}<div class="small muted" style="margin-top:4px">${h(kindLabel[ch.kind](ch))}</div></td><td class="r num">${fmt(ch.count)}</td><td><div class="choice">${ch.modes.map((m, j) => `<label><input type="radio" name="m${i}" value="${m}" ${j === 0 ? "checked" : ""}><span>${j === 0 ? "<b>" + h(t("taxonomy.mode." + m)) + "</b>" : h(t("taxonomy.mode." + m))} <span class="muted">· ${h(t("taxonomy.mode." + m + ".hint"))}</span></span></label>`).join("")}</div></td></tr>`).join("")}
      ${infos.map((ch) => `<tr><td>${ch.kind === "removed" ? `<span class="chip">${h(ch.name)}</span>` : chip(ch.key)}<div class="small muted" style="margin-top:4px">${h(kindLabel[ch.kind](ch))}</div></td><td class="r num">${fmt(ch.count)}</td><td class="muted small">${h(ch.kind === "moved" ? t("taxonomy.dlg.follow") : t("taxonomy.dlg.nothing"))}</td></tr>`).join("")}
      </tbody></table>
      <p class="small muted">${h(t("taxonomy.dlg.note"))}</p>
      <div class="foot"><span class="small" id="dsum"></span><span class="spacer"></span><button class="btn ghost" id="dcancel">${h(t("common.cancel"))}</button><button class="btn" id="dkeep">${h(t("taxonomy.dlg.keep"))}</button><button class="btn signal" id="dgo">${h(total ? t("taxonomy.dlg.saveReclass") : t("taxonomy.dlg.save"))}</button></div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    const dlg = $(".dlg"), close = () => document.querySelectorAll(".dlg, .drawer-bg").forEach((e) => e.remove());
    const modes = () => Object.fromEntries(asks.map((ch, i) => [ch.key, dlg.querySelector(`input[name=m${i}]:checked`).value]));
    // Reclasser par Jev : chaque email repasse par l'IA. Le coût suit les choix, d'après le taux mesuré sur Gmail.
    let rate = null;
    const costOf = (n) => {
      if (!rate || !n) return "";
      const share = 1, j = rate.rate.jev, x = rate.rate.extract, xs = rate.rate.extractShare;
      const tok = Math.round(n * (share * (j.inputTokens + j.outputTokens) + xs * (x.inputTokens + x.outputTokens)));
      const usd = j.cost == null ? null : n * (share * j.cost + xs * (x.cost ?? 0));
      return ` · ${h(t("cost.reclass", { tokens: fmtTokens(tok), cost: usd == null ? t("cost.unknown") : fmtUsd(usd) }))}`;
    };
    const sum = () => { const m = modes(); const jev = asks.filter((ch) => m[ch.key] === "jev").reduce((n, ch) => n + ch.count, 0); const noai = asks.filter((ch) => m[ch.key] === "child").reduce((n, ch) => n + ch.count, 0); $("#dsum").innerHTML = `${jev ? tn("taxonomy.dlg.calls", jev) + costOf(jev) : h(t("taxonomy.dlg.noCalls"))}${noai ? ` · ${h(tn("taxonomy.dlg.noAi", noai))}` : ""}`; };
    dlg.addEventListener("change", sum); sum();
    api("/estimate/rate?source=gmail").then((r) => { rate = r; if ($("#dsum")) sum(); }).catch(() => {});
    $("#dcancel").onclick = close; $(".drawer-bg").onclick = close;
    $("#dkeep").onclick = () => { const m = {}; for (const ch of asks) m[ch.key] = ch.kind === "removed" ? "review" : "keep"; close(); commit(m); };
    $("#dgo").onclick = () => { const m = modes(); close(); commit(m); };
    $("#dgo").focus();
  }
  return head("04", t("taxonomy.head.kicker"), t("taxonomy.head.title"), t("taxonomy.head.lead"),
    `<button class="btn signal" id="save" disabled>${h(t("common.save"))}</button>`) +
    `<div class="dirty" id="dirty" hidden><span class="mono" style="color:var(--signal)">${h(t("taxonomy.dirty"))}</span><span class="small muted">${h(t("taxonomy.dirtyHint"))}</span><button class="btn sm ghost" id="reset" style="margin-left:auto">${h(t("taxonomy.discard"))}</button></div>
    <div class="tree" id="tree"><div class="thead"><span></span><span>${h(t("taxonomy.col.label"))}</span><span>${h(t("taxonomy.col.criteria"))}</span><span style="text-align:right">${h(t("taxonomy.col.emails"))}</span><span style="text-align:center">${h(t("taxonomy.col.attention"))}</span><span>${h(t("taxonomy.col.color"))}</span></div></div>
    <div class="card row" style="align-items:end"><div class="grow"><h3>${h(t("taxonomy.add.title"))}</h3><div class="small muted">${h(t("taxonomy.add.hint"))}</div></div>
      <label class="field" style="width:180px"><span class="mono">${h(t("taxonomy.add.name"))}</span><input type="text" id="nname" placeholder="${h(t("taxonomy.add.namePh"))}"></label><label class="field" style="width:360px"><span class="mono">${h(t("taxonomy.add.criteria"))}</span><input type="text" id="ncrit" placeholder="${h(t("taxonomy.add.criteriaPh"))}"></label><button class="btn ink" id="add">${h(t("common.add"))}</button></div>
    <p class="small muted">${h(t("taxonomy.note"))}</p>`;
};

// ---------- 05 Questions Jev
views.questions = async () => {
  const [q, s, items, tax] = await Promise.all([api("/questions"), api("/config/settings"), api("/items?limit=30"), api("/config/taxonomy")]);
  TAX = tax;
  const sl = s.specialLabels || {};
  const special = (name) => `${TAX.prefix}/${name ?? ""}`;
  const th = s.thresholds;
  const actions = {
    category: t("questions.action.category", { prefix: TAX.prefix, t: th.categoryConfidence, review: sl.review ?? "" }),
    reply_expected: t("questions.action.label", { t: th.replyExpected, label: special(sl.reply) }),
    awaits_reply: t("questions.action.awaits", { t: th.replyExpected, days: s.followUpDays ?? 5 }),
    priority: t("questions.action.priority", { t: th.urgentScore }),
    spam: t("questions.action.label", { t: th.spam, label: special(sl.suspect) }),
    to_pay: t("questions.action.label", { t: th.toPay, label: special(sl.toPay) }),
    attention: t("questions.action.label", { t: th.attention ?? 0.8, label: special(sl.important) }),
    child: t("questions.action.child"),
    ephemeral: t("questions.action.ephemeral", { t: th.ephemeral ?? 0.7, minutes: 30 }),
    time_bound: t("questions.action.timeBound", { urgent: 3, days: 14 }),
  };
  const rows = Object.entries(q).map(([k, v]) => {
    const crit = v.type === "choice" ? Object.keys(v.criteria).join(" · ") : v.type === "score" ? v.criteria.map((c) => c.split(":")[0]).join(" · ") : t("questions.critYes", { text: v.criteria?.true ?? "" });
    return `<div style="display:grid;grid-template-columns:170px minmax(0,1fr) 250px;gap:18px;padding:14px 0;border-bottom:1px solid var(--g100)"><div><div style="font-family:var(--mono);font-size:14px">${h(k)}</div><div class="mono">${h(v.type === "choice" ? t("questions.type.choice") : v.type === "score" ? t("questions.type.score") : t("questions.type.bool"))}</div></div>
      <div><div style="font-weight:600">${h(v.instructions)}</div><div class="small muted">${h(crit)}</div></div><div class="small" style="color:var(--g800)">${h(actions[k] ?? "")}</div></div>`;
  }).join("");
  setTimeout(() => {
    setupResizer($("#rs-aside"), "--aside-w", 260, 600, "ea.asideW", -1);
    $("#test").addEventListener("click", async () => {
      const id = $("#item").value;
      if (!id) return;
      $("#res").innerHTML = `<div class="muted small">${h(t("questions.thinking"))}</div>`;
      try {
        const r = await api("/questions/test", { method: "POST", body: { itemId: Number(id) } });
        $("#res").innerHTML = Object.entries(r.answers).map(([k, a]) => {
          const val = a.type === "choice" ? catName(a.choice) : a.type === "score" ? a.score.toFixed(2) : a.probability >= 0.5 ? t("questions.yes") : t("questions.no");
          const p = a.type === "boolean" ? a.probability : a.type === "choice" ? a.probabilities?.[a.choice] : (r.confidence[k] ?? 0);
          return `<div><div style="display:flex;font-size:14px"><span style="font-family:var(--mono);color:var(--g600)">${h(k)}</span><span style="margin-left:auto;font-weight:600">${h(val)}</span></div><div class="bar" style="height:4px"><i style="width:${Math.round((p ?? 0) * 100)}%"></i></div></div>`;
        }).join("") + `<div class="mono" style="letter-spacing:.04em">${h(t("app.stats", { ms: r.latencyMs, tokens: r.inputTokens }))}</div>`;
      } catch (e) { $("#res").innerHTML = `<div class="muted small">${h(e.message)}</div>`; }
    });
  });
  return head("05", t("questions.head.kicker"), tn("questions.head.title", Object.keys(q).length), t("questions.head.lead")) +
    `<div class="row"><div class="grow"><div style="display:grid;grid-template-columns:170px minmax(0,1fr) 250px;gap:18px;padding:10px 0;border-bottom:1px solid var(--g200)" class="mono"><span>${h(t("questions.col.question"))}</span><span>${h(t("questions.col.instruction"))}</span><span>${h(t("questions.col.action"))}</span></div>${rows}</div>
    <div class="resizer" id="rs-aside" title="${h(t("app.resizeHint"))}"></div><aside class="card col" style="width:var(--aside-w);flex-shrink:0"><div class="mono">${h(t("questions.test"))}</div><select id="item">${items.map((i) => `<option value="${i.id}">${h((i.from_name || i.from_address).slice(0, 22))} — ${h(i.subject.slice(0, 40))}</option>`).join("")}</select><button class="btn ink" id="test">${h(t("questions.ask"))}</button><div id="res" class="col" style="gap:10px"></div></aside></div>`;
};

// ---------- 06 Contexte
views.context = async () => {
  const ctx = await api("/config/context");
  const kid = (c = {}) => `<div class="kid" style="display:grid;grid-template-columns:140px 1fr 1fr 44px;gap:10px"><input type="text" class="kn" value="${h(c.name ?? "")}" placeholder="${h(t("context.kid.name"))}"><input type="text" class="ks" value="${h(c.school ?? "")}" placeholder="${h(t("context.kid.school"))}"><input type="text" class="ka" value="${h((c.activities ?? []).join(", "))}" placeholder="${h(t("context.kid.activities"))}"><button class="btn sm rm" style="width:44px;padding:0">×</button></div>`;
  const person = (p = {}) => `<div class="person" style="display:grid;grid-template-columns:180px 160px 1fr 1fr 44px;gap:10px"><input type="text" class="pn" value="${h(p.name ?? "")}" placeholder="${h(t("context.person.name"))}"><input type="text" class="pr" list="relations" value="${h(p.relation ?? "")}" placeholder="${h(t("context.person.relation"))}"><input type="text" class="pe" value="${h((p.emails ?? []).join(", "))}" placeholder="${h(t("context.person.emails"))}"><input type="text" class="pf" value="${h(p.effect ?? "")}" placeholder="${h(t("context.person.effect"))}"><button class="btn sm rm" style="width:44px;padding:0">×</button></div>`;
  setTimeout(() => {
    const bind = () => document.querySelectorAll(".rm").forEach((b) => (b.onclick = () => b.parentElement.remove()));
    bind();
    $("#addkid").onclick = () => { $("#kids").insertAdjacentHTML("beforeend", kid()); bind(); };
    $("#addperson").onclick = () => { $("#people").insertAdjacentHTML("beforeend", person()); bind(); };
    $("#save").onclick = async () => {
      const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
      const body = {
        owner: { name: $("#oname").value, emails: split($("#oemails").value), languages: ctx.owner.languages ?? [] },
        family: { children: [...document.querySelectorAll(".kid")].map((k) => ({ name: k.querySelector(".kn").value, school: k.querySelector(".ks").value, activities: split(k.querySelector(".ka").value) })).filter((k) => k.name), schoolDomains: split($("#sdom").value), activityDomains: split($("#adom").value) },
        keyPeople: [...document.querySelectorAll(".person")].map((p) => ({ name: p.querySelector(".pn").value, relation: p.querySelector(".pr").value, emails: split(p.querySelector(".pe").value), effect: p.querySelector(".pf").value })).filter((p) => p.name),
        projects: split($("#projects").value), instructions: $("#instr").value,
      };
      try { await api("/config/context", { method: "PUT", body }); toast(t("context.toast.saved")); } catch (e) { toast(e.message); }
    };
  });
  return head("06", t("context.head.kicker"), t("context.head.title"), t("context.head.lead"), `<button class="btn signal" id="save">${h(t("common.save"))}</button>`) +
    `<div class="col" style="gap:24px">
      <section class="col"><h2>${h(t("context.you"))}</h2><div class="field-row" style="grid-template-columns:240px 1fr"><label class="field"><span class="mono">${h(t("context.name"))}</span><input type="text" id="oname" value="${h(ctx.owner.name)}"></label><label class="field"><span class="mono">${h(t("context.emails"))}</span><input type="text" id="oemails" value="${h(ctx.owner.emails.join(", "))}"></label></div></section>
      <section class="col"><div class="row" style="align-items:baseline"><h2>${h(t("context.family"))}</h2><button class="btn link" id="addkid" style="margin-left:auto">${h(t("context.addKid"))}</button></div><div class="mono" style="display:grid;grid-template-columns:140px 1fr 1fr 44px;gap:10px"><span>${h(t("context.col.kid"))}</span><span>${h(t("context.col.school"))}</span><span>${h(t("context.col.activities"))}</span><span></span></div><div id="kids" class="col" style="gap:8px">${ctx.family.children.map(kid).join("")}</div>
        <div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field"><span class="mono">${h(t("context.schoolDomains"))}</span><input type="text" id="sdom" value="${h(ctx.family.schoolDomains.join(", "))}" placeholder="${h(t("context.schoolDomainsPh"))}"></label><label class="field"><span class="mono">${h(t("context.clubDomains"))}</span><input type="text" id="adom" value="${h(ctx.family.activityDomains.join(", "))}"></label></div></section>
      <section class="col"><div class="row" style="align-items:baseline"><h2>${h(t("context.keyPeople"))}</h2><button class="btn link" id="addperson" style="margin-left:auto">${h(t("common.add"))}</button></div><div id="people" class="col" style="gap:8px">${ctx.keyPeople.map(person).join("")}</div><div class="small muted">${h(t("context.keyPeopleHint"))}</div><datalist id="relations">${t("context.person.relations").split(",").map((r) => `<option value="${h(r.trim())}">`).join("")}</datalist></section>
      <section class="col"><h2>${h(t("context.projects"))}</h2><input type="text" id="projects" value="${h(ctx.projects.join(", "))}"></section>
      <section class="col"><h2>${h(t("context.instructions"))}</h2><textarea id="instr" rows="3">${h(ctx.instructions)}</textarea><div class="small muted">${h(t("context.instructionsHint"))}</div></section>
    </div>`;
};

// ---------- 07 Règles
views.rules = async () => {
  const [r, s] = await Promise.all([api("/config/rules"), api("/config/settings")]);
  const o = await api("/overview"); TAX = o.taxonomy;
  const cond = (w) => [
    w.fromDomain && t("rules.cond.domain", { v: w.fromDomain }),
    w.fromAddress && t("rules.cond.address", { v: w.fromAddress }),
    w.subjectContains && t("rules.cond.subject", { list: w.subjectContains.map((x) => t("rules.cond.quoted", { v: x })).join(` ${t("rules.cond.or")} `) }),
    w.hasListUnsubscribe !== undefined && (w.hasListUnsubscribe ? t("rules.cond.unsub") : t("rules.cond.noUnsub")),
  ].filter(Boolean).join(` ${t("rules.cond.and")} `);
  const origin = (x) => (x.origin === "user" ? t("rules.origin.user") : x.origin === "learned" ? t("rules.origin.learned") : t("rules.origin.system"));
  const rows = r.rules.map((x) => `<tr><td><code>${h(cond(x.when))}</code>${x.stop ? ` <span class="pill">${h(t("rules.noJev"))}</span>` : ""}</td><td>${chip(x.category)}</td><td class="muted">${h(origin(x))}</td><td class="r"><button class="btn sm del" data-id="${x.id}">${h(t("common.remove"))}</button></td></tr>`).join("");
  setTimeout(() => {
    document.querySelectorAll(".del").forEach((b) => b.addEventListener("click", async () => { try { await api(`/rules/${encodeURIComponent(b.dataset.id)}`, { method: "DELETE" }); toast(t("rules.toast.removed")); route(); } catch (e) { toast(e.message); } }));
    $("#addrule").addEventListener("click", async () => {
      const type = $("#rtype").value, val = $("#rval").value.trim(), category = $("#rcat").value;
      if (!val) return toast(t("rules.toast.valueRequired"));
      const when = type === "domain" ? { fromDomain: val } : type === "address" ? { fromAddress: val } : { subjectContains: val.split(",").map((x) => x.trim()) };
      r.rules.push({ id: `user-${Date.now()}`, when, category, origin: "user", stop: $("#rstop").checked });
      try { await api("/config/rules", { method: "PUT", body: r }); toast(t("rules.toast.added")); route(); } catch (e) { toast(e.message); }
    });
    $("#savet").addEventListener("click", async () => {
      s.thresholds = { ...s.thresholds, categoryConfidence: Number($("#t1").value), replyExpected: Number($("#t2").value), spam: Number($("#t3").value), toPay: Number($("#t4").value), urgentScore: Number($("#t5").value) };
      s.concurrency = Number($("#conc").value);
      try { await api("/config/settings", { method: "PUT", body: s }); toast(t("rules.toast.thresholds")); } catch (e) { toast(e.message); }
    });
    // Nettoyage : combien d'emails de la file sortiraient, dès qu'une date est choisie (avant d'enregistrer).
    const cleanCount = async () => {
      const v = $("#cleandate").value, out = $("#cleancount");
      if (!v) { out.textContent = ""; return; }
      const prev = ymdLocal(new Date(new Date(`${v}T12:00`).getTime() - 86_400_000));
      // La file sans le réglage (« nocutoff ») : ses emails d'avant la date, même si une date enregistrée les cache déjà.
      try { const r = await api(`/mail?filter=${encodeURIComponent(`queue+nocutoff+date:1990-01-01..${prev}`)}&limit=1`); out.textContent = tn("rules.clean.count", r.total); } catch { out.textContent = ""; }
    };
    $("#cleandate").addEventListener("change", cleanCount); $("#cleandate").addEventListener("click", (e) => { try { e.target.showPicker(); } catch {} }); cleanCount();
    const saveClean = async (v) => {
      s.ignoreBefore = v || null;
      try { await api("/config/settings", { method: "PUT", body: s }); toast(v ? t("rules.clean.toast.set", { date: fmtDate(new Date(`${v}T12:00`), { day: "2-digit", month: "2-digit", year: "numeric" }) }) : t("rules.clean.toast.cleared")); route(); } catch (e) { toast(e.message); }
    };
    $("#saveclean").addEventListener("click", () => saveClean($("#cleandate").value));
    $("#cleanclear")?.addEventListener("click", () => saveClean(""));
    $("#savefmt").addEventListener("click", async () => {
      const lang = $("#lang").value; s.dateFormat = $("#datefmt").value;
      try {
        if (lang !== (s.language || "fr")) {
          // Changer de langue renomme les libellés spéciaux dans Gmail : on montre le plan avant.
          const plan = await api("/language/plan", { method: "POST", body: { language: lang } });
          const renames = [...(plan.categories || []), ...(plan.specials || [])].map((x) => `${x.label.from} → ${x.label.to}`);
          if (renames.length && !confirm(tn("rules.locale.confirm", renames.length, { list: renames.join("\n") }))) return;
          s.language = lang;
          await api("/config/settings", { method: "PUT", body: { ...s, language: lang } }); // le serveur applique les renommages lui-même
          try { localStorage.setItem("ea.lang", lang); } catch {}
          location.reload(); return;
        }
        await api("/config/settings", { method: "PUT", body: s }); DATE_FMT = s.dateFormat; toast(t("rules.locale.toast.dates", { format: DT[DATE_FMT].date }));
      } catch (e) { toast(e.message); }
    });
  });
  setTimeout(() => {
    $("#reset")?.addEventListener("click", async () => {
      const word = prompt(t("rules.reset.prompt", { prefix: TAX.prefix }));
      if (word !== "RESET") return;
      const body = { confirm: "RESET", keepMemory: $("#keepmem").checked, forgetTasks: $("#rtasks").checked, forgetMemberRules: $("#rmrules").checked, forgetCalendarMap: $("#rcalmap").checked };
      const b = $("#reset"); b.disabled = true; b.textContent = t("rules.reset.running");
      try { const r = await api("/reset", { method: "POST", body }); const labels = Object.values(r.labels).flat().length; toast(`${t("rules.reset.toast", { labels: fmt(labels), emails: fmt(r.cleared.items - r.cleared.whatsapp), wa: fmt(r.cleared.whatsapp) })}${r.cleared.tasks ? ` · ${t("rules.reset.toastTasks", { n: fmt(r.cleared.tasks) })}` : ""}`); refreshWa(); route(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = t("rules.reset.button"); }
    });
  });
  const steps = [["01", "rules"], ["02", "memory"], ["03", "jev"], ["04", "you"]];
  return head("07", t("rules.head.kicker"), t("rules.head.title"), t("rules.head.lead")) +
    `<div class="steps">${steps.map(([n, key], i) => `<div class="step ${i === 3 ? "dark" : ""}"><div class="kicker"><b>${n}</b></div><div style="font-weight:600">${h(t("rules.step." + key))}</div><div class="small ${i === 3 ? "" : "muted"}">${h(t("rules.step." + key + ".desc"))}</div></div>`).join("")}</div>
    <table><thead><tr><th>${h(t("rules.col.condition"))}</th><th>${h(t("common.label"))}</th><th>${h(t("rules.col.origin"))}</th><th></th></tr></thead><tbody>${rows}<tr><td class="muted">${h(t("rules.rest"))}</td><td>${h(t("rules.jevDecides"))}</td><td class="muted">${h(t("rules.origin.system"))}</td><td></td></tr></tbody></table>
    <div class="card row" style="align-items:end"><div class="grow"><h3>${h(t("rules.new"))}</h3></div><label class="field" style="width:170px"><span class="mono">${h(t("rules.type"))}</span><select id="rtype">${["domain", "address", "subject"].map((k) => `<option value="${k}">${h(t("rules.type." + k))}</option>`).join("")}</select></label><label class="field" style="width:260px"><span class="mono">${h(t("rules.value"))}</span><input type="text" id="rval" placeholder="${h(t("rules.valuePh"))}"></label><label class="field" style="width:200px"><span class="mono">${h(t("common.label"))}</span><select id="rcat">${TAX.categories.map((c) => `<option value="${c.key}">${h(c.name)}</option>`).join("")}</select></label><label style="display:flex;align-items:center;gap:8px;font-size:13px;white-space:nowrap;height:44px"><input type="checkbox" id="rstop" style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("rules.withoutJev"))}</label><button class="btn ink" id="addrule">${h(t("common.add"))}</button></div>
    <p class="small muted">${h(t("rules.note"))}</p>
    <div class="card col"><div class="row" style="align-items:baseline"><h3>${h(t("rules.thresholds"))}</h3><button class="btn sm" id="savet" style="margin-left:auto">${h(t("common.save"))}</button></div>
      <div class="field-row" style="grid-template-columns:repeat(6,1fr)"><label class="field"><span class="mono">${h(t("rules.th.category"))}</span><input type="number" step="0.05" min="0" max="1" id="t1" value="${s.thresholds.categoryConfidence}"></label><label class="field"><span class="mono">${h(t("rules.th.reply"))}</span><input type="number" step="0.05" min="0" max="1" id="t2" value="${s.thresholds.replyExpected}"></label><label class="field"><span class="mono">${h(t("rules.th.spam"))}</span><input type="number" step="0.05" min="0" max="1" id="t3" value="${s.thresholds.spam}"></label><label class="field"><span class="mono">${h(t("rules.th.toPay"))}</span><input type="number" step="0.05" min="0" max="1" id="t4" value="${s.thresholds.toPay}"></label><label class="field"><span class="mono">${h(t("rules.th.urgent"))}</span><input type="number" step="0.1" min="0" max="3" id="t5" value="${s.thresholds.urgentScore}"></label><label class="field"><span class="mono">${h(t("rules.th.concurrency"))}</span><input type="number" min="1" max="64" id="conc" value="${s.concurrency}"></label></div>
      <div class="small muted">${h(t("rules.th.hint"))}</div></div>
    <div class="card col"><div class="row" style="align-items:baseline"><h3>${h(t("rules.clean.title"))}</h3><button class="btn sm" id="saveclean" style="margin-left:auto">${h(t("common.save"))}</button></div>
      <div class="row" style="gap:14px;align-items:end;flex-wrap:wrap"><label class="field" style="width:220px"><span class="mono">${h(t("rules.clean.before"))}</span><input type="date" id="cleandate" value="${h(s.ignoreBefore || "")}" max="${ymdLocal(new Date())}"></label>${s.ignoreBefore ? `<button class="btn sm ghost" id="cleanclear">${h(t("rules.clean.clear"))}</button>` : ""}<span class="small" id="cleancount" style="padding-bottom:10px"></span></div>
      <div class="small muted">${h(t("rules.clean.hint"))}</div></div>
    <div class="card col"><div class="row" style="align-items:baseline"><h3>${h(t("rules.locale.title"))}</h3><button class="btn sm" id="savefmt" style="margin-left:auto">${h(t("common.save"))}</button></div>
      <div class="field-row" style="grid-template-columns:200px 260px 1fr;align-items:center"><label class="field"><span class="mono">${h(t("rules.locale.lang"))}</span><select id="lang">${["fr", "en", "es"].map((k) => `<option value="${k}" ${(s.language || "fr") === k ? "selected" : ""}>${h(t("lang." + k))}</option>`).join("")}</select></label><label class="field"><span class="mono">${h(t("rules.locale.dateFmt"))}</span><select id="datefmt">${["eu", "iso", "us"].map((k) => `<option value="${k}" ${(s.dateFormat || "eu") === k ? "selected" : ""}>${h(t("rules.dateFmt." + k))}</option>`).join("")}</select></label><div class="small muted">${h(t("rules.locale.hint"))}</div></div></div>
    <div class="card col" style="border-color:var(--g200)"><div class="row" style="align-items:baseline"><h3>${h(t("rules.reset.title"))}</h3></div>
      <div class="small" style="color:var(--g800)">${t("rules.reset.goes", { prefix: h(TAX.prefix) })}</div>
      <div class="small" style="color:var(--g800)">${t("rules.reset.stays")}</div>
      <div class="row" style="align-items:center;gap:14px;flex-wrap:wrap"><button class="btn" id="reset" style="border-color:var(--signal);color:var(--signal)">${h(t("rules.reset.button"))}</button>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" id="keepmem" checked style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("rules.reset.keepMemory"))}</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" id="rtasks" style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("rules.reset.forgetTasks"))}</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" id="rmrules" style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("rules.reset.forgetMemberRules"))}</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" id="rcalmap" style="width:18px;height:18px;accent-color:#1B1C1F">${h(t("rules.reset.forgetCalMap"))}</label></div></div>`;
};

// ---------- Canaux : ce que Molinova écoute, et ce qui viendra
views.channels = async () => {
  await refreshLive();
  const c = LIVE?.channels;
  const card = (name, what, state, href, cta) => {
    const led = state ? `<span class="led ${ledOf(state)}"></span>` : "";
    return `<a class="card col chcard" href="${href}"><div class="row" style="align-items:center;gap:8px">${led}<h3>${h(name)}</h3></div><div class="small" style="color:var(--g800)">${h(what)}</div><div class="small muted">${h(state ? channelLine(href.split("/")[1]) : "")}</div><div style="margin-top:auto"><span class="btn sm ${state === "setup" ? "ink" : ""}">${h(cta(state))}</span></div></a>`;
  };
  const open = (st) => (st === "setup" ? t("channels.connect") : t("channels.open"));
  const soon = (name, what) => `<div class="card col chcard soon"><h3>${h(name)}</h3><div class="small" style="color:var(--g800)">${h(what)}</div><div style="margin-top:auto"><span class="pill">${h(t("sources.soon"))}</span></div></div>`;
  return head("", t("channels.head.kicker"), t("channels.head.title"), t("channels.head.lead")) +
    `<div class="chgrid">
      ${card("Telegram", t("sources.tg.what"), c?.telegram.state, "#channel/telegram", open)}
      ${card("Gmail", t("channels.gmail.what"), c?.gmail.state, "#channel/gmail", open)}
      ${card("Google Drive", t("sources.drive.what"), c?.drive.state, "#channel/drive", open)}
      ${c?.whatsapp.state === "unsupported" ? "" : card("WhatsApp", t("sources.wa.what"), c?.whatsapp.state, "#channel/whatsapp", open)}
    </div>
    <h2 style="margin-top:8px">${h(t("channels.soon"))}</h2>
    <div class="chgrid">
      ${soon("Outlook · IMAP", t("sources.outlook.what"))}
    </div>`;
};

renderFoot();
api("/mail?filter=event&limit=1").then((r) => { badges.agenda = r.total || ""; renderNav(); }).catch(() => {});
refreshWa().then(() => { waSeenAt = WA.lastIngestAt ?? null; });
// mail.js et setup.js (chargés après) fournissent views.mail et views.setup : on attend la fin du chargement,
// puis l'état de l'installation, avant le premier rendu (un serveur muet ne bloque pas l'app : pas d'assistant).
window.addEventListener("load", async () => {
  try { SETUP = await api("/setup/state"); } catch { SETUP = null; }
  route();
});
