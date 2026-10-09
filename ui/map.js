/* Tableau de bord — « De quoi parlent les emails » : carte (réseau d3-force sur canvas) ou liste, par catégorie ou par domaine.
   Données : GET /api/map, agrégées en SQL, sans appel à Jev. Chaque nœud et chaque ligne mènent à la Boîte filtrée. */

const MAP = {
  view: ls("ea.map.view", "map"), lens: ls("ea.map.lens", "category"), period: ls("ea.map.period", "365d"), account: ls("ea.map.account", ""),
  focusCat: null, hover: null, pinned: null, sim: null, nodes: [], links: [], w: 0, h: 0, t: null, zoom: null, data: null, accounts: [],
};
function ls(k, def) { try { return localStorage.getItem(k) || def; } catch { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const mapCat = (k) => TAX.categories.find((c) => c.key === k);
const mapBg = (k) => mapCat(k)?.color.background ?? "#e9ebee";
const mapFg = (k) => mapCat(k)?.color.text ?? "#3c3f45";
const mapHref = (kind, key, extra = "") => `#mail/${kind}:${encodeURIComponent(key)}${extra}`;

/** Le HTML de la section ; les données arrivent ensuite (mapInit). */
function mapSection(o) {
  MAP.accounts = o.accounts;
  const periods = ["30d", "90d", "365d", "all"];
  return `<section class="mapsec">
    <div class="row" style="align-items:baseline;flex-wrap:wrap;gap:8px"><h2>${t("map.title")}</h2><span class="small muted" style="margin-left:auto"><span class="legend" style="background:var(--signal)"></span> ${t("map.legend.important")}</span></div>
    <div class="mapctl">
      <div class="ctl"><span class="mono">${t("map.view")}</span><div class="seg" id="mapview-seg"><button data-v="map" class="${MAP.view === "map" ? "on" : ""}">${t("map.view.map")}</button><button data-v="list" class="${MAP.view === "list" ? "on" : ""}">${t("map.view.list")}</button></div></div>
      <div class="ctl"><span class="mono">${t("map.group")}</span><div class="seg" id="maplens-seg"><button data-l="category" class="${MAP.lens === "category" ? "on" : ""}">${t("map.group.category")}</button><button data-l="domain" class="${MAP.lens === "domain" ? "on" : ""}">${t("map.group.domain")}</button></div></div>
      <div class="ctl"><span class="mono">${t("common.mailbox")}</span><select id="mapacc"><option value="">${t("common.all")}</option>${o.accounts.map((a) => `<option value="${a.id}" ${String(a.id) === MAP.account ? "selected" : ""}>${h(a.email)}</option>`).join("")}</select></div>
      <div class="ctl"><span class="mono">${t("common.period")}</span><select id="mapperiod">${periods.map((k) => `<option value="${k}" ${k === MAP.period ? "selected" : ""}>${t("period." + k)}</option>`).join("")}</select></div>
    </div>
    <div id="mapview" class="mapwrap" ${MAP.view === "map" ? "" : "hidden"}>
      <div class="mapcol">
        <div class="mapbox" id="mapbox"><canvas id="mapcv"></canvas>
          <div class="mapnote"><span class="mono" id="mapcount">${t("common.loading")}</span><div class="zoomctl"><span class="lvl" id="zoomlvl">${fmtPct(1)}</span><button id="zin" title="${t("map.zoom.in")}" aria-label="${t("map.zoom.in")}">+</button><button id="zout" title="${t("map.zoom.out")}" aria-label="${t("map.zoom.out")}">−</button><button id="zreset" title="${t("map.zoom.reset")}" aria-label="${t("map.zoom.reset")}" style="font-size:11px;font-family:var(--mono)">1:1</button></div></div>
          <div class="maptip" id="maptip"></div></div>
        <div class="maplegend" id="maplegend"></div>
      </div>
      <aside class="card mapdetail" id="mapdetail"></aside>
    </div>
    <div id="maplist" ${MAP.view === "list" ? "" : "hidden"} style="overflow-x:auto"></div>
    <div class="small muted" id="mapfoot"></div>
  </section>`;
}

/** Branche les commandes, charge les données, dessine. Appelé après insertion du HTML. */
function mapInit() {
  const on = (sel, ev, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
  on("#mapview-seg button", "click", (e) => { MAP.view = e.currentTarget.dataset.v; lsSet("ea.map.view", MAP.view); document.querySelectorAll("#mapview-seg button").forEach((b) => b.classList.toggle("on", b === e.currentTarget)); $("#mapview").hidden = MAP.view !== "map"; $("#maplist").hidden = MAP.view !== "list"; if (MAP.view === "map") { mapSize(); mapStart(); } mapRenderList(); });
  on("#maplens-seg button", "click", (e) => { MAP.lens = e.currentTarget.dataset.l; lsSet("ea.map.lens", MAP.lens); document.querySelectorAll("#maplens-seg button").forEach((b) => b.classList.toggle("on", b === e.currentTarget)); mapLoad(); });
  $("#mapacc")?.addEventListener("change", (e) => { MAP.account = e.target.value; lsSet("ea.map.account", MAP.account); mapLoad(); });
  $("#mapperiod")?.addEventListener("change", (e) => { MAP.period = e.target.value; lsSet("ea.map.period", MAP.period); mapLoad(); });
  mapWire();
  mapLoad();
}
async function mapLoad() {
  const p = new URLSearchParams({ lens: MAP.lens, period: MAP.period }); if (MAP.account) p.set("account", MAP.account);
  try { MAP.data = await api("/map?" + p.toString()); } catch (e) { const c = $("#mapcount"); if (c) c.textContent = t("app.error", { message: e.message }); return; }
  if (!$("#mapbox")) return; // la page a changé entre-temps
  mapRenderList();
  if (MAP.view === "map") { mapSize(); mapStart(); }
}

// ---------- agrégats
/** Par domaine : volume, répartition par catégorie, importants, à revoir. */
function mapDomains() {
  const m = new Map();
  for (const r of MAP.data.rows) {
    const d = m.get(r.domain) || { domain: r.domain, n: 0, by: {}, important: 0, review: 0 };
    d.n += r.n; d.important += r.important || 0; d.review += r.review || 0;
    if (r.category) d.by[r.category] = (d.by[r.category] || 0) + r.n;
    m.set(r.domain, d);
  }
  for (const d of m.values()) d.top = Object.keys(d.by).sort((a, b) => d.by[b] - d.by[a])[0] || null;
  return [...m.values()].sort((a, b) => b.n - a.n);
}
function mapCats() {
  return TAX.categories.map((c) => { let n = 0, important = 0, review = 0, doms = 0; for (const r of MAP.data.rows) if (r.category === c.key) { n += r.n; important += r.important || 0; doms++; } return { c, n, important, review, doms }; }).sort((a, b) => b.n - a.n);
}

// ---------- graphe
function mapGraph() {
  const nodes = [], links = [];
  const doms = mapDomains();
  if (MAP.lens === "category") {
    for (const { c, n, important } of mapCats()) nodes.push({ id: "c:" + c.key, kind: "hub", label: c.name, cat: c.key, n, important });
    // Un nœud « autres » regroupe la longue traîne au-delà des 70 domaines les plus actifs, pour garder la carte lisible.
    const top = doms.filter((d) => d.top).slice(0, 70), rest = doms.filter((d) => d.top).slice(70);
    for (const d of top) { nodes.push({ id: "d:" + d.domain, kind: "leaf", label: d.domain, cat: d.top, n: d.n, important: d.important, review: d.review, by: d.by }); for (const [k, v] of Object.entries(d.by)) links.push({ source: "d:" + d.domain, target: "c:" + k, n: v, share: v / d.n, cat: k }); }
    if (rest.length) {
      const o = { id: "d:*", kind: "leaf", label: tn("map.otherDomains", rest.length), other: true, n: 0, important: 0, review: 0, by: {} };
      for (const d of rest) { o.n += d.n; o.important += d.important; o.review += d.review; for (const [k, v] of Object.entries(d.by)) o.by[k] = (o.by[k] || 0) + v; }
      o.cat = Object.keys(o.by).sort((a, b) => o.by[b] - o.by[a])[0]; nodes.push(o);
      for (const [k, v] of Object.entries(o.by)) links.push({ source: "d:*", target: "c:" + k, n: v, share: v / o.n, cat: k });
    }
  } else {
    const shown = new Set(MAP.data.senders.map((s) => s.domain));
    for (const d of doms) if (shown.has(d.domain) && d.top) nodes.push({ id: "d:" + d.domain, kind: "hub", label: d.domain, cat: d.top, n: d.n, important: d.important, review: d.review, by: d.by });
    const bySender = new Map();
    for (const s of MAP.data.senders) { if (!s.category) continue; const x = bySender.get(s.from_address) || { addr: s.from_address, domain: s.domain, n: 0, important: 0, by: {} }; x.n += s.n; x.important += s.important || 0; x.by[s.category] = (x.by[s.category] || 0) + s.n; bySender.set(s.from_address, x); }
    for (const x of bySender.values()) {
      if (!nodes.some((n) => n.id === "d:" + x.domain)) continue;
      const cat = Object.keys(x.by).sort((a, b) => x.by[b] - x.by[a])[0];
      nodes.push({ id: "s:" + x.addr, kind: "leaf", label: x.addr.split("@")[0], full: x.addr, cat, n: x.n, important: x.important, dom: x.domain, by: x.by });
      links.push({ source: "s:" + x.addr, target: "d:" + x.domain, n: x.n, share: 1, cat });
    }
  }
  return { nodes, links };
}
const mapR = (n, kind) => (kind === "hub" ? 9 + Math.sqrt(n) * 0.95 : 3 + Math.sqrt(n) * 0.8);
function mapStart() {
  if (!MAP.data || !$("#mapcv")) return;
  const { nodes, links } = mapGraph();
  const keys = TAX.categories.map((c) => c.key);
  const anchor = (cat) => { const i = Math.max(0, keys.indexOf(cat)), a = (i / Math.max(1, keys.length)) * Math.PI * 2 - Math.PI / 2; return [MAP.w / 2 + Math.cos(a) * MAP.w * 0.36, MAP.h / 2 + Math.sin(a) * MAP.h * 0.34]; };
  // Positions de départ déterministes : la carte revient toujours dans la même disposition.
  let seed = MAP.lens === "category" ? 7 : 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (const n of nodes) { n.r = mapR(n.n, n.kind); const [ax, ay] = anchor(n.cat); n.x = ax + (rnd() - 0.5) * 120; n.y = ay + (rnd() - 0.5) * 120; }
  MAP.nodes = nodes; MAP.links = links; MAP.hover = null; MAP.pinned = null;
  // Seuils d'étiquettes relatifs au volume réel : les noms apparaissent pour les nœuds qui pèsent, quelle que soit la taille de la boîte.
  const hubMax = Math.max(1, ...nodes.filter((n) => n.kind === "hub").map((n) => n.n)), leafMax = Math.max(1, ...nodes.filter((n) => n.kind === "leaf").map((n) => n.n));
  MAP.hubMin = Math.max(2, hubMax / 8); MAP.leafMin = Math.max(2, leafMax / 4);
  if (MAP.zoom) d3.select("#mapcv").call(MAP.zoom.transform, d3.zoomIdentity);
  if (MAP.sim) MAP.sim.stop();
  const cat = MAP.lens === "category";
  MAP.sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => cat ? 30 + 90 * (1 - l.share) : 6 + l.target.r + l.source.r).strength((l) => cat ? 0.25 + 0.6 * l.share : 1))
    .force("charge", d3.forceManyBody().strength((d) => d.kind === "hub" ? (cat ? -520 : -60) : cat ? -22 : -6).distanceMax(cat ? 600 : 160))
    .force("collide", d3.forceCollide().radius((d) => d.r + (cat ? 3 : 2)).iterations(2))
    .force("x", d3.forceX((d) => anchor(d.cat)[0]).strength((d) => d.kind === "hub" ? (cat ? 0.12 : 0.16) : cat ? 0.02 : 0.05))
    .force("y", d3.forceY((d) => anchor(d.cat)[1]).strength((d) => d.kind === "hub" ? (cat ? 0.12 : 0.16) : cat ? 0.02 : 0.05))
    .force("center", d3.forceCenter(MAP.w / 2, MAP.h / 2).strength(cat ? 0.05 : 0.1))
    .alpha(1).alphaDecay(0.028).on("tick", () => { for (const n of nodes) { n.x = Math.max(n.r + 8, Math.min(MAP.w - n.r - 8, n.x)); n.y = Math.max(n.r + 34, Math.min(MAP.h - n.r - 10, n.y)); } mapDraw(); });
  const D = MAP.data;
  const hubs = nodes.filter((n) => n.kind === "hub").length;
  $("#mapcount").textContent = cat ? t("map.count.category", { cats: fmt(TAX.categories.length), domains: fmt(D.domains), emails: fmt(D.total) }) : t("map.count.domain", { top: fmt(Math.min(D.topDomains, hubs)), domains: fmt(D.domains), senders: fmt(nodes.length - hubs) });
  mapLegend(); mapDetail(null);
  $("#mapfoot").textContent = t("map.foot.map");
}
function mapSize() {
  const box = $("#mapbox"), cv = $("#mapcv");
  if (!box || !cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  MAP.w = box.clientWidth; MAP.h = box.clientHeight;
  cv.width = Math.round(MAP.w * dpr); cv.height = Math.round(MAP.h * dpr);
  cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}
function mapVisible(n) { if (!MAP.focusCat) return true; return n.cat === MAP.focusCat || (n.by && n.by[MAP.focusCat]); }
function mapDraw() {
  const cv = $("#mapcv");
  if (!cv) { if (MAP.sim) MAP.sim.stop(); return; } // page quittée
  const ctx = cv.getContext("2d"), t = MAP.t || d3.zoomIdentity;
  ctx.clearRect(0, 0, MAP.w, MAP.h);
  ctx.save(); ctx.translate(t.x, t.y); ctx.scale(t.k, t.k);
  const act = MAP.pinned || MAP.hover;
  const near = new Set(); if (act) { near.add(act.id); for (const l of MAP.links) { if (l.source.id === act.id) near.add(l.target.id); if (l.target.id === act.id) near.add(l.source.id); } }
  ctx.lineCap = "round";
  for (const l of MAP.links) {
    const on = !act || (l.source.id === act.id || l.target.id === act.id);
    const dim = !(mapVisible(l.source) && mapVisible(l.target)) || (act && !on);
    ctx.strokeStyle = mapFg(l.cat); ctx.globalAlpha = dim ? 0.04 : on && act ? 0.55 : 0.16 + 0.18 * l.share;
    ctx.lineWidth = Math.max(0.6, Math.min(7, Math.sqrt(l.n) * 0.5)); ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const hubCat = MAP.lens === "category";
  for (const n of MAP.nodes) {
    const dim = !mapVisible(n) || (act && !near.has(n.id));
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.other ? "#d8dbdf" : n.kind === "hub" && hubCat ? mapFg(n.cat) : mapBg(n.cat); ctx.fill();
    ctx.lineWidth = n.kind === "hub" ? 1.5 : 1; ctx.strokeStyle = n.other ? "#6f747c" : mapFg(n.cat); ctx.stroke();
    // Le signal : un arc rouge proportionnel à la part d'emails importants.
    if (n.important && n.n) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5, -Math.PI / 2, -Math.PI / 2 + (n.important / n.n) * Math.PI * 2); ctx.strokeStyle = "#ff3b30"; ctx.lineWidth = 2.2; ctx.stroke(); }
    if (act && n.id === act.id) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2); ctx.strokeStyle = "#1b1c1f"; ctx.lineWidth = 1; ctx.stroke(); }
  }
  ctx.globalAlpha = 1; ctx.textBaseline = "middle";
  const z = t.k * t.k; // plus on zoome, plus on lit de noms
  for (const n of MAP.nodes) {
    const dim = !mapVisible(n) || (act && !near.has(n.id));
    const isHubCat = n.kind === "hub" && hubCat;
    const show = isHubCat || (n.kind === "hub" && n.n >= (MAP.hubMin || 20) / z) || n.n >= (MAP.leafMin || 40) / z || (act && near.has(n.id));
    if (!show || dim) continue;
    ctx.font = `${isHubCat ? 700 : n.kind === "hub" ? 600 : 400} ${isHubCat ? 13 : 11.5}px Outfit, sans-serif`;
    if (isHubCat && ctx.measureText(n.label).width <= n.r * 2 - 8) { ctx.fillStyle = "#fbfbfc"; ctx.textAlign = "center"; ctx.fillText(n.label, n.x, n.y); }
    else if (isHubCat) { ctx.textAlign = "center"; const ty = n.y + n.r + 10; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.strokeText(n.label, n.x, ty); ctx.fillStyle = "#1b1c1f"; ctx.fillText(n.label, n.x, ty); }
    else { ctx.textAlign = "left"; const tx = n.x + n.r + 5; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.strokeText(n.label, tx, n.y); ctx.fillStyle = n.kind === "hub" ? "#1b1c1f" : "#3c3f45"; ctx.fillText(n.label, tx, n.y); }
  }
  ctx.restore();
}
function mapNodeAt(sx, sy) { const t = MAP.t || d3.zoomIdentity, [x, y] = t.invert([sx, sy]), tol = Math.max(4, 9 / t.k); let best = null, bd = 1e9; for (const n of MAP.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < Math.max(n.r + 4, tol) && d < bd) { best = n; bd = d; } } return best; }
function mapWire() {
  const cv = $("#mapcv"), tip = $("#maptip");
  if (!cv) return;
  cv.addEventListener("mousemove", (e) => {
    const r = cv.getBoundingClientRect(), n = mapNodeAt(e.clientX - r.left, e.clientY - r.top);
    if (n !== MAP.hover) { MAP.hover = n; mapDraw(); if (!MAP.pinned) mapDetail(n); }
    if (n) { tip.innerHTML = `<b>${h(n.full || n.label)}</b><br><span class="mono">${tn("map.tip.emails", n.n)}${n.important ? ` · <span style="color:#ff3b30">${tn("map.tip.important", n.important)}</span>` : ""}</span>`; tip.classList.add("show"); tip.style.left = Math.min(e.clientX - r.left + 14, MAP.w - 270) + "px"; tip.style.top = Math.min(e.clientY - r.top + 14, MAP.h - 70) + "px"; cv.style.cursor = "pointer"; }
    else { tip.classList.remove("show"); cv.style.cursor = "grab"; }
  });
  cv.addEventListener("mouseleave", () => { MAP.hover = null; tip.classList.remove("show"); mapDraw(); if (!MAP.pinned) mapDetail(null); });
  cv.addEventListener("click", (e) => { const r = cv.getBoundingClientRect(), n = mapNodeAt(e.clientX - r.left, e.clientY - r.top); MAP.pinned = n && MAP.pinned !== n ? n : null; mapDetail(MAP.pinned || n); mapDraw(); });
  const sel = d3.select(cv), lvl = $("#zoomlvl");
  MAP.zoom = d3.zoom().scaleExtent([0.5, 5]).on("zoom", (e) => { MAP.t = e.transform; lvl.textContent = fmtPct(MAP.t.k); mapDraw(); });
  sel.call(MAP.zoom).on("dblclick.zoom", null);
  $("#zin").onclick = () => sel.transition().duration(200).call(MAP.zoom.scaleBy, 1.4);
  $("#zout").onclick = () => sel.transition().duration(200).call(MAP.zoom.scaleBy, 1 / 1.4);
  $("#zreset").onclick = () => sel.transition().duration(250).call(MAP.zoom.transform, d3.zoomIdentity);
  // Un seul écouteur pour toute la session, pas un de plus à chaque affichage de la carte.
  if (!MAP.resizeBound) {
    MAP.resizeBound = true;
    window.addEventListener("resize", () => { if (!$("#mapcv") || MAP.view !== "map") return; mapSize(); if (MAP.sim) MAP.sim.force("center", d3.forceCenter(MAP.w / 2, MAP.h / 2).strength(0.05)).alpha(0.3).restart(); });
  }
}
function mapLegend() {
  const el = $("#maplegend"); if (!el) return;
  el.innerHTML = TAX.categories.map((c) => `<button data-cat="${c.key}" class="${MAP.focusCat && MAP.focusCat !== c.key ? "off" : ""}" style="background:${c.color.background};color:${c.color.text}">${h(c.name)}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => b.onclick = () => { MAP.focusCat = MAP.focusCat === b.dataset.cat ? null : b.dataset.cat; mapLegend(); mapDraw(); });
}
function mixRows(by, total) {
  return `<div class="mix">${Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<div class="mixrow"><span class="chip" style="background:${mapBg(k)};color:${mapFg(k)};font-size:12px;overflow:hidden;text-overflow:ellipsis">${h(catName(k))}</span><div class="bar"><i style="width:${Math.round(v / total * 100)}%;background:${mapFg(k)}"></i></div><span class="num">${fmt(v)}</span></div>`).join("")}</div>`;
}
function mapDetail(n) {
  const el = $("#mapdetail"); if (!el) return;
  if (!n) {
    const topImp = mapDomains().filter((d) => d.important).sort((a, b) => b.important - a.important).slice(0, 4);
    el.innerHTML = `<div class="mono">${t("map.detail.reading")}</div><div class="who">${MAP.lens === "category" ? t("map.detail.whoCategory") : t("map.detail.whoDomain")}</div><div class="small muted">${MAP.lens === "category" ? t("map.detail.explainCategory") : t("map.detail.explainDomain")}</div>
      ${topImp.length ? `<hr><div class="mono">${t("map.detail.mostImportant")}</div>${topImp.map((d) => `<a href="${mapHref("domain", d.domain, "+important")}" style="display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--ink);text-decoration:none"><span style="overflow:hidden;text-overflow:ellipsis">${h(d.domain)}</span><span class="num" style="color:var(--signal)">${fmt(d.important)}</span></a>`).join("")}` : ""}
      <hr><div class="small muted">${t("map.detail.arcNote")}</div>`;
    return;
  }
  const isCat = n.id.startsWith("c:"), isSender = n.id.startsWith("s:"), domain = isSender ? n.dom : n.other ? null : n.label;
  const href = isCat ? mapHref("cat", n.cat) : domain ? mapHref("domain", domain) : "#mail";
  const topDoms = isCat ? mapDomains().filter((d) => d.by[n.cat]).sort((a, b) => b.by[n.cat] - a.by[n.cat]).slice(0, 5) : [];
  el.innerHTML = `<div class="mono">${isCat ? t("common.category") : isSender ? t("map.detail.sender") : t("map.detail.domain")}</div><div class="who">${h(n.full || n.label)}</div>
    <div style="display:flex;align-items:baseline;gap:8px"><span class="big">${fmt(n.n)}</span><span class="small muted">${t("map.detail.emails")}</span><a href="${isCat ? mapHref("cat", n.cat, "+important") : domain ? mapHref("domain", domain, "+important") : "#mail/important"}" class="num" style="margin-left:auto;text-decoration:none;color:${n.important ? "var(--signal)" : "var(--g400)"}">${n.important ? t("map.detail.importantShort", { n: fmt(n.important) }) : "—"}</a></div>
    ${isCat ? `<div class="mono">${t("map.detail.topDomains")}</div><div class="mix">${topDoms.map((d) => `<a href="${mapHref("domain", d.domain)}" class="mixrow" style="grid-template-columns:1fr 60px 40px;color:var(--ink);text-decoration:none"><span style="overflow:hidden;text-overflow:ellipsis">${h(d.domain)}</span><div class="bar"><i style="width:${Math.round(d.by[n.cat] / n.n * 100)}%;background:${mapFg(n.cat)}"></i></div><span class="num">${fmt(d.by[n.cat])}</span></a>`).join("")}</div>` : n.by && Object.keys(n.by).length > 1 ? `<div class="mono">${t("map.detail.splitInto")}</div>${mixRows(n.by, n.n)}` : `<div>${chip(n.cat)}</div>`}
    ${n.review ? `<a href="#classify/${domain ? "domain:" + encodeURIComponent(domain) : "cat:" + n.cat}" class="small" style="color:var(--ink)">${domain ? t("map.detail.reviewInDomain", { n: fmt(n.review) }) : t("map.detail.review", { n: fmt(n.review) })}</a>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><a class="btn sm ink" href="${href}">${isSender ? t("map.detail.seeDomain") : t("map.detail.seeInbox")}</a>${domain && !isCat ? `<span class="small muted" style="align-self:center">${t("map.detail.ruleHint")}</span>` : ""}</div>`;
}

// ---------- vue liste : mêmes chiffres que la carte, en tableau, chaque ligne cliquable
function mapRenderList() {
  const el = $("#maplist"); if (!el || !MAP.data) return;
  const bar = (n, imp, max) => `<td><div class="bar" style="position:relative"><i style="width:${(n / max * 100).toFixed(1)}%"></i><span style="position:absolute;left:0;top:0;height:100%;width:${(imp / max * 100).toFixed(1)}%;background:var(--signal)"></span></div></td>`;
  const nums = (kind, key, imp, rev) => `<td class="r num"><a href="${mapHref(kind, key, "+important")}" title="${t("map.list.openImportant")}" style="color:${imp ? "var(--signal)" : "var(--g400)"}">${imp ? fmt(imp) : "—"}</a></td><td class="r num"><a href="#classify/${kind}:${encodeURIComponent(key)}" title="${t("map.list.openReview")}" style="color:${rev ? "var(--ink)" : "var(--g400)"}">${rev ? fmt(rev) : "—"}</a></td>`;
  let head, rows, foot;
  if (MAP.lens === "category") {
    const cats = mapCats();
    // « À revoir » par catégorie : la proposition de Jev n'est pas encore tranchée, on compte par domaine au prorata.
    const doms = mapDomains();
    for (const x of cats) x.review = doms.reduce((s, d) => s + (d.by[x.c.key] && d.n ? Math.round(d.review * d.by[x.c.key] / d.n) : 0), 0);
    const max = Math.max(1, cats[0]?.n || 0);
    head = `<th style="width:170px">${t("common.category")}</th><th style="width:34%">${t("map.list.emails")}</th><th class="r">${t("map.list.count")}</th><th>${t("map.list.domains")}</th><th class="r">${t("map.list.important")}</th><th class="r">${t("common.toReview")}</th>`;
    rows = cats.map(({ c, n, important, review, doms }) => `<tr class="clickable" data-href="${mapHref("cat", c.key)}" title="${t("map.list.openInbox")}"><td><a href="${mapHref("cat", c.key)}">${chip(c.key)}</a></td>${bar(n, important, max)}<td class="r num">${fmt(n)}</td><td class="small muted">${tn("map.list.domainCount", doms)}</td>${nums("cat", c.key, important, review)}</tr>`).join("");
    foot = t("map.list.footCategory", { cats: fmt(TAX.categories.length), emails: fmt(MAP.data.total) });
  } else {
    const top = mapDomains().slice(0, 20), max = Math.max(1, top[0]?.n || 0);
    head = `<th style="width:220px">${t("map.list.domain")}</th><th style="width:30%">${t("map.list.emails")}</th><th class="r">${t("map.list.count")}</th><th style="min-width:210px">${t("map.list.topCategory")}</th><th class="r">${t("map.list.important")}</th><th class="r">${t("common.toReview")}</th>`;
    rows = top.map((d) => { const share = d.top ? d.by[d.top] / d.n : 0; return `<tr class="clickable" data-href="${mapHref("domain", d.domain)}" title="${t("map.list.openInbox")}"><td style="font-family:var(--mono);font-size:13px;white-space:nowrap"><a href="${mapHref("domain", d.domain)}">${h(d.domain)}</a></td>${bar(d.n, d.important, max)}<td class="r num">${fmt(d.n)}</td><td style="white-space:nowrap">${d.top ? chip(d.top) : `<span class="chip">${t("map.list.unclassified")}</span>`} <span class="small muted">${d.top ? fmtPct(share) : ""}${d.top && share < 0.7 ? ` · ${t("map.list.mixed")}` : ""}</span></td>${nums("domain", d.domain, d.important, d.review)}</tr>`; }).join("");
    foot = t("map.list.footDomain", { top: fmt(top.length), domains: fmt(MAP.data.domains) });
  }
  el.innerHTML = `<table class="maplist"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted small">${t("map.list.empty")}</td></tr>`}</tbody></table><div class="small muted" style="padding:8px 10px">${foot}</div>`;
  el.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("a")) return; location.hash = tr.dataset.href; }));
  if (MAP.view === "list") $("#mapfoot").textContent = t("map.foot.list");
}
