/* Documents : parcourir les dossiers lus de Drive, filtrer par fiche (type, domaine, personne, signaux), voir le détail.
   À gauche la recherche, l'arborescence et les filtres ; à droite la liste. Chaque colonne défile de son côté.
   Lecture seule : rien n'est jamais écrit dans Drive. Textes : ui/lang/<langue>/docs.js (clés docs.*). */

const DOC = { acc: null, accounts: [], folder: null, open: new Set(), f: { type: null, context: null, person: null, flag: null }, q: "", sort: "modified", rows: [], total: 0, facets: null, tree: {} };
const DOC_FLAGS = ["expiring", "expired", "action", "sensitive", "unclassified", "corrected"];
const DOC_FMT = { pdf: "PDF", google: "GDOC", office: "DOC", text: "TXT", image: "IMG" };

views.docs = async () => {
  let accs;
  try { accs = await api("/docs/accounts"); } catch (e) { return `<div class="empty">${h(e.message)}</div>`; }
  DOC.accounts = accs;
  if (!accs.length) {
    return head("", t("docs.kicker"), t("docs.title"), t("docs.lead")) +
      `<div class="card col" style="gap:8px"><h3>${h(t("docs.none.title"))}</h3><div class="small muted">${h(t("docs.none.text"))}</div><div><a class="btn ink" href="#channel/drive">${h(t("docs.none.cta"))}</a></div></div>`;
  }
  if (!accs.some((a) => a.id === DOC.acc)) { DOC.acc = accs[0].id; DOC.folder = null; DOC.open.clear(); DOC.tree = {}; }
  $("#main").classList.add("mailmode");
  setTimeout(docsInit);
  return `<div class="docwrap"><aside class="docside" id="docside"></aside><section class="doclist" id="doclist"><div class="small muted" style="padding:24px">${h(t("docs.loading"))}</div></section></div>`;
};

async function docsInit() {
  docsSide();
  await docsTree();
  await docsLoad();
}

const docAcc = () => DOC.accounts.find((a) => a.id === DOC.acc);
const docQuery = (extra = {}) => {
  const p = new URLSearchParams();
  if (DOC.folder) p.set("folder", DOC.folder.path);
  for (const [k, v] of Object.entries(DOC.f)) if (v) p.set(k, v);
  if (DOC.q) p.set("q", DOC.q);
  p.set("sort", DOC.sort);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
};

// ---------- colonne de gauche : compte, recherche, dossiers, filtres
function docsSide() {
  const el = $("#docside"); if (!el) return;
  const a = docAcc();
  el.innerHTML = `
    ${DOC.accounts.length > 1 ? `<select id="docacc" style="height:34px">${DOC.accounts.map((x) => `<option value="${x.id}" ${x.id === DOC.acc ? "selected" : ""}>${h(x.email)}</option>`).join("")}</select>` : `<div class="small muted">${h(a.email)}</div>`}
    <form id="docqf"><input type="search" id="docq" placeholder="${h(t("docs.search.ph"))}" value="${h(DOC.q)}"></form>
    <div class="mono docsec">${h(t("docs.folders"))}</div>
    <div id="doctree" class="doctree"></div>
    <div id="docfacets"></div>
    <div class="small muted" style="margin-top:8px">${h(t("docs.cardsCount", { n: fmt(a.classified), total: fmt(a.inScope) }))}${a.pending ? ` · <a href="#channel/drive">${h(tn("docs.pending", a.pending))}</a>` : ""}</div>`;
  $("#docacc")?.addEventListener("change", (e) => { DOC.acc = Number(e.target.value); DOC.folder = null; DOC.open.clear(); DOC.tree = {}; docsInit(); });
  let timer;
  $("#docq").addEventListener("input", (e) => { DOC.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(docsLoad, 250); });
  $("#docqf").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); DOC.q = $("#docq").value.trim(); docsLoad(); });
  el.addEventListener("click", docsSideClick);
}

async function docsFolders(parent) {
  if (!DOC.tree[parent]) DOC.tree[parent] = (await api(`/docs/${DOC.acc}/folders?parent=${encodeURIComponent(parent)}`)).folders;
  return DOC.tree[parent];
}
async function docsTree() {
  const el = $("#doctree"); if (!el) return;
  const a = docAcc();
  const row = (f, depth) => {
    const on = DOC.folder?.id === f.id;
    const caret = f.nSub ? `<button class="btn link dcaret" data-id="${h(f.id)}">${DOC.open.has(f.id) ? "▾" : "▸"}</button>` : `<span class="dcaret-none"></span>`;
    return `<div class="dfold ${on ? "on" : ""}" data-id="${h(f.id)}" data-path="${h(f.path || "")}" data-name="${h(f.name)}" style="padding-left:${depth * 14}px">${caret}<span class="dname" title="${h(f.path || f.name)}">${h(f.name)}</span><span class="dn">${fmt(f.nScope)}</span></div>`;
  };
  const load = async (parent, depth) => {
    let html = "";
    for (const f of await docsFolders(parent)) {
      html += row(f, depth);
      if (f.nSub && DOC.open.has(f.id)) html += await load(f.id, depth + 1);
    }
    return html;
  };
  try {
    const all = `<div class="dfold ${DOC.folder ? "" : "on"}" data-all="1"><span class="dcaret-none"></span><span class="dname"><b>${h(t("docs.all"))}</b></span><span class="dn">${fmt(a.inScope)}</span></div>`;
    el.innerHTML = all + (a.rootId ? await load(a.rootId, 0) : "");
  } catch (e) { el.innerHTML = `<div class="small" style="color:var(--signal)">${h(e.message)}</div>`; }
}

function docsFacets() {
  const el = $("#docfacets"); const fc = DOC.facets; if (!el || !fc) return;
  const item = (group, key, name, n, indent = false) => `<a href="#" class="dfacet ${DOC.f[group] === key ? "on" : ""} ${indent ? "sub" : ""}" data-g="${group}" data-k="${h(key)}"><span>${h(name)}</span><span class="dn">${fmt(n)}</span></a>`;
  const sec = (title, body) => (body ? `<div class="mono docsec">${h(title)}</div>${body}` : "");
  const ctx = fc.contexts.filter((c) => !c.parent).map((c) => item("context", c.key, c.name, c.n) + fc.contexts.filter((k) => k.parent === c.key).map((k) => item("context", k.key, k.name, k.n, true)).join("")).join("");
  el.innerHTML =
    sec(t("docs.f.flags"), DOC_FLAGS.filter((k) => fc.flags[k] > 0 || DOC.f.flag === k).map((k) => item("flag", k, t("docs.flag." + k), fc.flags[k])).join("")) +
    sec(t("docs.f.type"), fc.types.map((x) => item("type", x.key, x.name, x.n)).join("")) +
    sec(t("docs.f.context"), ctx) +
    sec(t("docs.f.person"), fc.people.map((x) => item("person", x.key, x.name, x.n)).join(""));
}

async function docsSideClick(e) {
  const caret = e.target.closest(".dcaret");
  if (caret) { e.preventDefault(); const id = caret.dataset.id; DOC.open.has(id) ? DOC.open.delete(id) : DOC.open.add(id); docsTree(); return; }
  const fold = e.target.closest(".dfold");
  if (fold) {
    DOC.folder = fold.dataset.all ? null : { id: fold.dataset.id, path: fold.dataset.path, name: fold.dataset.name };
    // Choisir un dossier le déplie : on voit tout de suite ce qu'il contient.
    if (DOC.folder) DOC.open.add(DOC.folder.id);
    docsTree(); docsLoad(); return;
  }
  const fa = e.target.closest(".dfacet");
  if (fa) { e.preventDefault(); const g = fa.dataset.g, k = fa.dataset.k; DOC.f[g] = DOC.f[g] === k ? null : k; docsLoad(); }
}

// ---------- colonne de droite : la liste
async function docsLoad(more = false) {
  const el = $("#doclist"); if (!el) return;
  const offset = more ? DOC.rows.length : 0;
  const q = docQuery({ offset: String(offset) });
  let r;
  try { r = await api(`/docs/${DOC.acc}/list?${q}`); } catch (e) { el.innerHTML = `<div class="small" style="color:var(--signal);padding:24px">${h(e.message)}</div>`; return; }
  if (docQuery({ offset: String(offset) }) !== q) return;
  DOC.rows = more ? [...DOC.rows, ...r.rows] : r.rows;
  DOC.total = r.total; DOC.facets = r.facets;
  docsFacets();
  docsList(more);
}

function docChips(d) {
  const chip = (x, cls = "") => (x ? `<span class="pill ${cls}" style="font-size:11.5px;padding:1px 8px">${h(x)}</span>` : "");
  return `${chip(d.typeName, "strong")}${chip(d.contextName)}${d.peopleNames.map((n) => chip(n)).join("")}${d.expiry ? chip(driveExpiry(d), d.valid === 0 || d.expiry < todayYmd() ? "warn" : "") : ""}${d.sensitive ? chip(t("drive.hit.sensitive")) : ""}${d.classified ? "" : `<span class="small muted">${h(t("drive.hit.noCard"))}</span>`}`;
}
function docsList(keepScroll) {
  const el = $("#doclist"); if (!el) return;
  const scroll = keepScroll ? el.scrollTop : 0;
  const active = [
    DOC.folder ? [t("docs.active.folder", { name: DOC.folder.name }), "folder"] : null,
    ...Object.entries(DOC.f).filter(([, v]) => v).map(([g, v]) => [docFacetName(g, v), g]),
    DOC.q ? [`« ${DOC.q} »`, "q"] : null,
  ].filter(Boolean);
  const title = DOC.folder ? DOC.folder.name : t("docs.all");
  el.innerHTML = `<div class="dochead">
      <div><div class="kicker">${h(t("docs.kicker"))}</div><h2 style="margin:4px 0 0">${h(title)}<span class="stop">.</span></h2>${DOC.folder?.path ? `<div class="small muted">${h(DOC.folder.path)}</div>` : ""}</div>
      <div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
        <span class="small" style="color:var(--g800)">${h(tn("docs.count", DOC.total))}</span>
        ${active.map(([label, g]) => `<button class="btn sm ghost dclear" data-g="${g}" title="${h(t("docs.clear"))}">${h(label)} ×</button>`).join("")}
        <span class="grow"></span>
        <select id="docsort" style="height:32px;width:auto">${["modified", "name", "expiry"].map((k) => `<option value="${k}" ${DOC.sort === k ? "selected" : ""}>${h(t("docs.sort." + k))}</option>`).join("")}</select>
      </div></div>
    ${DOC.rows.length ? `<div class="docrows">${DOC.rows.map((d, i) => `<a href="#" class="docrow" data-i="${i}">
        <span class="dfmt">${h(DOC_FMT[d.format] || "·")}</span>
        <span class="dmain"><span class="dtitle">${h(d.title || d.name)}</span>
          <span class="small muted">${d.title ? h(d.name) + " · " : ""}${h(d.path || "")}${d.modifiedAt ? " · " + h(fmtDate(new Date(d.modifiedAt), { day: "numeric", month: "short", year: "numeric" })) : ""}</span>
          <span class="row" style="gap:4px;flex-wrap:wrap;align-items:center">${docChips(d)}</span></span>
      </a>`).join("")}</div>` : `<div class="small muted" style="padding:24px 28px">${h(t("docs.empty"))}</div>`}
    ${DOC.rows.length < DOC.total ? `<div style="padding:12px 28px 28px"><button class="btn sm" id="docmore">${h(t("docs.more", { n: fmt(DOC.total - DOC.rows.length) }))}</button></div>` : ""}`;
  el.scrollTop = scroll;
  $("#docsort").addEventListener("change", (e) => { DOC.sort = e.target.value; docsLoad(); });
  $("#docmore")?.addEventListener("click", () => docsLoad(true));
  el.querySelectorAll(".dclear").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.g;
    if (g === "folder") { DOC.folder = null; docsTree(); }
    else if (g === "q") { DOC.q = ""; if ($("#docq")) $("#docq").value = ""; }
    else DOC.f[g] = null;
    docsLoad();
  }));
  el.querySelectorAll(".docrow").forEach((r) => r.addEventListener("click", (e) => { e.preventDefault(); docOpen(DOC.rows[Number(r.dataset.i)]); }));
}
function docFacetName(g, v) {
  if (g === "flag") return t("docs.flag." + v);
  const list = DOC.facets?.[g === "type" ? "types" : g === "context" ? "contexts" : "people"] || [];
  return list.find((x) => x.key === v)?.name ?? v;
}

// ---------- le détail d'une fiche, dans un volet
async function docOpen(row) {
  closeDrawer();
  document.body.insertAdjacentHTML("beforeend", `<div class="drawer-bg"></div><aside class="drawer docdrawer"><div class="small muted">${h(t("docs.loading"))}</div></aside>`);
  $(".drawer-bg").onclick = closeDrawer;
  let d;
  try { d = await api(`/docs/${row.accountId}/doc/${encodeURIComponent(row.id)}`); } catch (e) { $(".docdrawer").innerHTML = `<div class="small" style="color:var(--signal)">${h(e.message)}</div>`; return; }
  const pct = (p) => (p != null ? ` <span class="muted">${fmtPct(p)}</span>` : "");
  const yes = (b) => (b ? t("docs.d.yes") : t("docs.d.no"));
  const lines = [
    [t("docs.d.type"), d.typeName ? h(d.typeName) + pct(d.typeP) : "—"],
    [t("docs.d.context"), d.contextName ? h(d.contextName) + pct(d.contextP) + (d.context2Name ? ` <span class="muted">· ${h(d.context2Name)}</span>` : "") : "—"],
    [t("docs.d.people"), d.peopleNames.length ? h(d.peopleNames.join(", ")) : "—"],
    [t("docs.d.party"), d.party ? h(d.party) : "—"],
    [t("docs.d.expiry"), d.expiry ? h(driveExpiry(d)) : "—"],
    [t("docs.d.valid"), d.valid == null ? "—" : yes(d.valid)],
    [t("docs.d.sensitive"), yes(d.sensitive)],
    [t("docs.d.action"), yes(d.action)],
    [t("docs.d.importance"), d.importance != null ? `${Math.round(d.importance * 10) / 10} / 3` : "—"],
    [t("docs.d.read"), h(d.method ? t("docs.method." + d.method) : t("docs.method.none")) + (d.error ? ` <span style="color:var(--signal)" title="${h(d.error)}">ⓘ</span>` : "")],
    [t("docs.d.classified"), d.classifiedAt ? h(fmtDate(new Date(d.classifiedAt.replace(" ", "T") + "Z"), { day: "numeric", month: "short", year: "numeric" })) + (d.by === "user" ? ` · ${h(t("drive.hit.corrected"))}` : "") : "—"],
  ];
  const render = (editing) => {
    $(".docdrawer").innerHTML = `
      <div class="row" style="align-items:flex-start;gap:12px"><div class="grow"><div class="kicker">${h(DOC_FMT[d.format] || "")} · ${h(d.path || "")}</div><h2 style="margin:6px 0 0">${h(d.title || d.name)}</h2>${d.title ? `<div class="small muted">${h(d.name)}</div>` : ""}</div><button class="btn link" id="docclose">✕</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn sm ink" href="${docUrl(d, "file")}" download="${h(d.name)}">${h(t("docs.d.download"))}</a>${d.link ? `<a class="btn sm" href="${h(d.link)}" target="_blank" rel="noopener">${h(t("docs.d.open"))} ↗</a>` : ""}<button class="btn sm" id="docfix">${h(t("drive.hit.fix"))}</button></div>
      ${editing ? `<div id="docfixbox">${driveFixForm(d)}</div>` : ""}
      <div id="docpreview" class="docpreview"><div class="small muted">${h(t("docs.preview.loading"))}</div></div>
      <table class="doctable">${lines.map(([k, v]) => `<tr><th>${h(k)}</th><td>${v}</td></tr>`).join("")}</table>
      ${d.excerpt ? `<details class="docexcerpt"><summary class="mono">${h(t("docs.d.excerpt"))}</summary><pre>${h(d.excerpt)}</pre></details>` : d.sensitive ? `<div class="small muted">${h(t("docs.d.noExcerptSensitive"))}</div>` : ""}`;
    $("#docclose").onclick = closeDrawer;
    docPreview(d);
    $("#docfix").onclick = async () => { if (!DRV.tax) { try { DRV.tax = await api("/drive/taxonomy"); } catch (e) { return toast(e.message); } } render(!editing); };
    $("#docfixbox form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { people: fd.getAll("people") };
      if (fd.get("type")) body.type = fd.get("type");
      if (fd.get("context")) body.context = fd.get("context");
      try { await api(`/drive/${d.accountId}/docs/${encodeURIComponent(d.id)}/card`, { method: "PUT", body }); toast(t("drive.toast.fixed")); closeDrawer(); docsLoad(); }
      catch (err) { toast(err.message); }
    });
    $("#docfixbox [data-cancel]")?.addEventListener("click", () => render(false));
  };
  render(false);
}

const docUrl = (d, what) => `/api/docs/${d.accountId}/doc/${encodeURIComponent(d.id)}/${what}`;
/** L'aperçu : les pages rendues sur le Mac (PDF, images, fichiers Google), un Word en HTML sans script, ou un mot pour dire pourquoi pas. */
async function docPreview(d) {
  const el = $("#docpreview"); if (!el) return;
  let info;
  try { info = await api(`/docs/${d.accountId}/doc/${encodeURIComponent(d.id)}/preview`); }
  catch (e) { if ($("#docpreview")) $("#docpreview").innerHTML = `<div class="small" style="color:var(--signal)">${h(t("docs.preview.failed", { error: e.message }))}</div>`; return; }
  if (!$("#docpreview")) return;
  if (info.kind === "pages") {
    let page = 1;
    const show = () => {
      $("#docpreview").innerHTML = `${info.pages > 1 ? `<div class="row" style="align-items:center;gap:8px"><button class="btn sm ghost" id="dpprev" ${page <= 1 ? "disabled" : ""}>‹</button><span class="small">${h(t("docs.preview.page", { n: page, total: info.pages }))}</span><button class="btn sm ghost" id="dpnext" ${page >= info.pages ? "disabled" : ""}>›</button></div>` : ""}
        <img class="docpage" src="${docUrl(d, `page/${page}`)}" alt="${h(t("docs.preview.page", { n: page, total: info.pages }))}">`;
      $("#dpprev")?.addEventListener("click", () => { page--; show(); });
      $("#dpnext")?.addEventListener("click", () => { page++; show(); });
    };
    show();
  } else if (info.kind === "html" || info.kind === "text") {
    // Le HTML vient du serveur déjà nettoyé ; le cadre « sandbox » sans permission n'exécute de toute façon aucun script.
    try {
      const r = await api(`/docs/${d.accountId}/doc/${encodeURIComponent(d.id)}/html`);
      if (!$("#docpreview")) return;
      $("#docpreview").innerHTML = `<iframe class="docframe" sandbox title="${h(d.name)}"></iframe>`;
      $("#docpreview iframe").srcdoc = r.html;
    } catch (e) { if ($("#docpreview")) $("#docpreview").innerHTML = `<div class="small" style="color:var(--signal)">${h(t("docs.preview.failed", { error: e.message }))}</div>`; }
  } else {
    el.innerHTML = `<div class="small muted">${h(t("docs.preview.none." + info.reason))}</div>`;
  }
}
