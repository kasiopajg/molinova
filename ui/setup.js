/* Premier lancement : l'assistant (« lanceur »), en plein écran (body.setup-mode) tant que l'installation n'est pas
   complète. Six étapes dans l'adresse (#setup/<étape>) : bienvenue, clé IA, client Google, Gmail, toi, toujours prêt,
   puis un panneau de fin (#setup/done). L'étape Google est un guide en sous-étapes (#setup/google/<parcours>/<n>). L'état vient de GET /api/setup/state ; chaque route de l'assistant renvoie
   le nouvel état, gardé dans SETUP (déclaré dans app.js, qui s'en sert pour rediriger vers #setup).
   Textes : ui/lang/<langue>/setup.js (clés setup.*). Rien n'est gardé dans le navigateur, sauf la langue. */

/** Les étapes, dans l'ordre ; `flag` = la case de state.steps qui la coche, `required` = « Suivant » attend qu'elle le soit. */
const SETUP_STEPS = [
  { key: "welcome", flag: "terms", required: true },
  { key: "ai", flag: "gateway", required: true },
  { key: "google", flag: "google", required: true },
  { key: "gmail", flag: "account", required: true },
  { key: "you", flag: "context" },
  { key: "always", flag: "finished" },
];
/** Ce que l'assistant garde entre deux rendus : la connexion Google en attente, le résultat de « Terminer »,
    « reconnecter les boîtes » après un changement de client Google, le parcours Google choisi (perso, admin, member),
    les pages publiques de Molinova (GET /api/setup/pages-online), la réserve sur la dernière boîte connectée et ses options,
    la dernière adresse affichée (pour remonter en haut de page quand elle change). */
const SW = { wait: null, finish: null, reconnect: false, gpath: null, pages: null, gmailNote: null, gmailOpts: null, lastHash: "" };
const stepLabel = (k) => ({ welcome: t("setup.rail.welcome"), ai: t("setup.rail.ai"), google: t("setup.rail.google"), gmail: t("setup.rail.gmail"), you: t("setup.rail.you"), always: t("setup.rail.always") })[k] || k;
const extLink = (url, label) => `<a href="${h(url)}" target="_blank" rel="noopener">${h(label)}</a>`;

/** La dernière étape atteignable : rien au-delà de la première étape obligatoire pas encore faite. */
function setupMaxIndex(st) {
  const i = SETUP_STEPS.findIndex((s) => s.required && !st.steps[s.flag]);
  return i < 0 ? SETUP_STEPS.length - 1 : i;
}
/** Où reprendre : bienvenue sur une installation vierge, sinon la première étape pas encore cochée. */
function setupFirstStep(st) {
  const s = st.steps;
  if (!s.terms || (!s.gateway && !s.google && !s.account && !s.context && !s.finished)) return "welcome";
  return SETUP_STEPS.find((x) => x.flag && !s[x.flag])?.key || "welcome";
}
const setupGo = (key) => { location.hash = "#setup/" + key; };

// ---------- la vue
views.setup = async (rest = []) => {
  SETUP = await api("/setup/state");
  let key = rest[0];
  if (key === "done" && SETUP.steps.finished) return setupDone();
  const idx = SETUP_STEPS.findIndex((s) => s.key === key);
  if (idx < 0) key = setupFirstStep(SETUP);
  else if (idx > setupMaxIndex(SETUP)) key = SETUP_STEPS[setupMaxIndex(SETUP)].key;
  if (key !== rest[0]) { history.replaceState(null, "", "#setup/" + key); }
  // Nouvelle adresse (étape ou sous-étape) : on repart du haut ; un nouveau rendu de la même adresse garde la position.
  if (location.hash !== SW.lastHash) { SW.lastHash = location.hash; setTimeout(() => window.scrollTo(0, 0)); }
  if (key === "google") return setupGoogle(key === rest[0] ? rest.slice(1) : []);
  const render = { welcome: setupWelcome, ai: setupAi, gmail: setupGmail, you: setupYou, always: setupAlways }[key];
  return render();
};

/** Le cadre commun : barre (déplaçable dans l'app), rail des étapes, carte, boutons Retour / Suivant.
    `back` remplace l'adresse du bouton Retour (sous-étapes Google), `pre` s'affiche au-dessus du titre. */
function setupShell(key, { title, lead, body, next = "", hideBack = false, back, pre = "" }) {
  const i = SETUP_STEPS.findIndex((s) => s.key === key);
  const max = setupMaxIndex(SETUP);
  const rail = SETUP_STEPS.map((s, j) => {
    const done = s.flag && SETUP.steps[s.flag];
    const inner = `<span class="n">${done ? "✓" : String(j + 1).padStart(2, "0")}</span><span class="l">${h(stepLabel(s.key))}</span>`;
    const cls = [j === i ? "on" : "", done ? "done" : ""].join(" ");
    return `<li class="${cls}">${j <= max ? `<a href="#setup/${s.key}">${inner}</a>` : `<span class="off">${inner}</span>`}</li>`;
  }).join("");
  const backHref = back !== undefined ? back : i > 0 ? "#setup/" + SETUP_STEPS[i - 1].key : null;
  return `<div class="setup-drag" aria-hidden="true"></div><div class="setup">
    <div class="setup-bar"><div class="wordmark">Molinova<span class="stop">.</span></div><span class="mono">${h(t("setup.bar.kicker"))}</span>${SETUP.complete ? `<a class="btn sm ghost" href="#settings" style="margin-left:auto">${h(t("setup.bar.leave"))}</a>` : ""}</div>
    <ol class="setup-rail">${rail}</ol>
    <section class="card setup-card">
      <div class="kicker"><b>${String(i + 1).padStart(2, "0")}</b>${h(stepLabel(key))}</div>
      ${pre}
      <h1>${h(title)}<span class="stop">.</span></h1>
      ${lead ? `<p class="lead">${lead}</p>` : ""}
      ${body}
    </section>
    <div class="setup-foot">${backHref && !hideBack ? `<a class="btn" href="${backHref}">${h(t("common.back"))}</a>` : ""}<span class="grow"></span>${next}</div>
  </div>`;
}
/** Le bouton « Suivant » : désactivé tant qu'une étape obligatoire n'est pas faite. */
function setupNext(key) {
  const i = SETUP_STEPS.findIndex((s) => s.key === key);
  const s = SETUP_STEPS[i];
  const ok = !s.required || SETUP.steps[s.flag];
  setTimeout(() => $("#snext")?.addEventListener("click", () => setupGo(SETUP_STEPS[i + 1].key)));
  return `<button class="btn ink" id="snext" ${ok ? "" : "disabled"}>${h(t("setup.next"))}</button>`;
}
/** Message d'erreur ou de réussite sous un formulaire. */
function setupMsg(id, text, ok = false) {
  const el = $("#" + id); if (!el) return;
  el.className = ok ? "setup-ok" : "setup-err";
  el.textContent = text;
  el.hidden = !text;
}

// ---------- 01 Bienvenue
/**
 * Les conditions d'utilisation : une case à cocher, obligatoire pour passer à la suite (POST /api/setup/terms garde la
 * version et le moment). Une installation déjà complète qui n'a pas accepté la version en cours revient ici une fois,
 * puis retourne à l'accueil.
 */
function setupTerms() {
  const ok = !!SETUP.steps.terms;
  setTimeout(() => $("#sterms")?.addEventListener("change", async (e) => {
    if (!e.target.checked) return;
    e.target.disabled = true;
    try {
      SETUP = await api("/setup/terms", { method: "POST", body: { accept: true } });
      if (SETUP.complete) location.hash = "#home"; else route();
    } catch (err) { toast(err.message); e.target.checked = false; e.target.disabled = false; }
  }));
  return `<div class="card setup-terms ${ok ? "done" : ""}">
    <label><input type="checkbox" id="sterms" ${ok ? "checked disabled" : ""}><span>${h(t("setup.terms.text"))}</span></label>
    <div class="small">${SETUP.termsUrl ? extLink(SETUP.termsUrl, t("setup.terms.read")) : ""}${ok ? ` · <span class="muted">${h(t("setup.terms.accepted"))}</span>` : ""}</div>
  </div>`;
}
function setupWelcome() {
  setTimeout(() => {
    $("#slang")?.addEventListener("change", async (e) => {
      const lang = e.target.value;
      if (lang === I18N.lang) return;
      e.target.disabled = true;
      try {
        // Des boîtes déjà connectées : changer de langue renomme des libellés Gmail, on montre le plan avant (comme dans Règles).
        if (SETUP.steps.account) {
          const plan = await api("/language/plan", { method: "POST", body: { language: lang } });
          const renames = [...(plan.categories || []), ...(plan.specials || [])].map((x) => `${x.label.from} → ${x.label.to}`);
          if (renames.length && !confirm(tn("rules.locale.confirm", renames.length, { list: renames.join("\n") }))) { e.target.value = I18N.lang; e.target.disabled = false; return; }
        }
        await api("/language", { method: "POST", body: { language: lang } });
        try { localStorage.setItem("ea.lang", lang); } catch {}
        location.reload();
      } catch (err) { toast(err.message); e.target.value = I18N.lang; e.target.disabled = false; }
    });
  });
  const col = (title, items) => `<div class="card col" style="gap:8px"><div class="mono">${h(title)}</div><ul>${items.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>`;
  const body = `
    <div class="setup-cols">
      ${col(t("setup.welcome.does.title"), [t("setup.welcome.does.mail"), t("setup.welcome.does.agenda"), t("setup.welcome.does.tasks"), t("setup.welcome.does.optional")])}
      ${col(t("setup.welcome.local.title"), [t("setup.welcome.local.db"), (SETUP.appMode ? t("setup.welcome.local.secrets") : t("setup.welcome.local.secretsDev")), t("setup.welcome.local.whatsapp"), t("setup.welcome.local.noCloud")])}
      ${col(t("setup.welcome.ai.title"), [t("setup.welcome.ai.what"), t("setup.welcome.ai.gateway"), t("setup.welcome.ai.zdr")])}
    </div>
    ${setupPermissions()}
    ${setupTerms()}
    <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:16px">
      <label class="field" style="width:220px"><span class="mono">${h(t("setup.welcome.lang"))}</span><select id="slang">${["fr", "en", "es"].map((k) => `<option value="${k}" ${I18N.lang === k ? "selected" : ""}>${h(t("lang." + k))}</option>`).join("")}</select></label>
      <div class="small muted grow" style="padding-bottom:10px">${h(t("setup.welcome.needs"))}</div>
    </div>`;
  return setupShell("welcome", { title: t("setup.welcome.title"), lead: h(t("setup.welcome.lead")), body, next: setupNext("welcome") });
}

/**
 * Ce que macOS (et Google) vont demander pendant et après l'installation : ce qu'on voit, pourquoi Molinova en a besoin,
 * ce qu'il en fait et ce qu'il ne fera jamais. Les lignes propres à l'app Mac n'apparaissent que dans l'app.
 */
function setupPermissions() {
  const keys = SETUP.appMode ? ["gatekeeper", "keychain", "google", "login", "notify", "whatsapp"] : ["google", "whatsapp"];
  const rows = keys.map((k) => `<div class="perm"><div class="perm-what">${h(t(`setup.perm.${k}.what`))}</div>
    <div class="small"><b>${h(t("setup.perm.why"))}</b> ${h(t(`setup.perm.${k}.why`))}</div>
    <div class="small"><b>${h(t("setup.perm.you"))}</b> ${h(t(`setup.perm.${k}.you`))}</div></div>`).join("");
  return `<section class="col perms" style="gap:8px"><div class="mono">${h(t("setup.perm.title"))}</div>
    <div class="small muted">${h(t("setup.perm.lead"))}</div><div class="permgrid">${rows}</div></section>`;
}

// ---------- 02 Clé IA (Vercel AI Gateway)
function setupAi() {
  const done = SETUP.steps.gateway;
  setTimeout(() => {
    const save = async () => {
      const input = $("#skey"), b = $("#skeysave");
      const key = input.value.trim();
      if (!key) { setupMsg("skeymsg", t("setup.ai.empty")); return; }
      b.disabled = true; b.textContent = t("setup.ai.testing"); setupMsg("skeymsg", "");
      try {
        await api("/setup/gateway-key", { method: "POST", body: { key } });
        // La clé ne reste pas dans la page : le champ est vidé avant le nouveau rendu.
        input.value = "";
        toast(t("setup.ai.saved"));
        route();
      } catch (e) { setupMsg("skeymsg", e.message); b.disabled = false; b.textContent = t("setup.ai.save"); }
    };
    $("#skeysave")?.addEventListener("click", save);
    $("#skey")?.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  });
  const body = `
    <ol class="setup-guide">
      <li><div><b>${h(t("setup.ai.g1.title"))}</b><div class="small muted">${t("setup.ai.g1.text", { link: extLink("https://vercel.com/ai-gateway", "vercel.com/ai-gateway") })}</div></div></li>
      <li><div><b>${h(t("setup.ai.g2.title"))}</b><div class="small muted">${t("setup.ai.g2.text", { link: extLink("https://vercel.com/dashboard", "vercel.com/dashboard") })}</div></div></li>
      <li><div><b>${h(t("setup.ai.g3.title"))}</b><div class="small muted">${h(SETUP.appMode ? t("setup.ai.g3.text") : t("setup.ai.g3.textDev"))}</div></div></li>
    </ol>
    <div class="card small" style="color:var(--g800)"><b>${h(t("setup.ai.zdr.title"))}</b> ${h(t("setup.ai.zdr.text"))}</div>
    ${done ? `<div class="setup-ok">✓ ${h(t("setup.ai.done"))}</div>` : ""}
    <div class="row" style="align-items:flex-end;gap:10px">
      <label class="field grow"><span class="mono">${h(done ? t("setup.ai.replace") : t("setup.ai.label"))}</span><input type="password" id="skey" autocomplete="off" spellcheck="false" placeholder="${h(t("setup.ai.placeholder"))}"></label>
      <button class="btn ${done ? "" : "ink"}" id="skeysave">${h(t("setup.ai.save"))}</button>
    </div>
    <div id="skeymsg" hidden></div>`;
  return setupShell("ai", { title: t("setup.ai.title"), lead: h(t("setup.ai.lead")), body, next: setupNext("ai") });
}

// ---------- 03 Client Google : un guide pas à pas, une page de la console Google par écran
/* Référence unique : docs/google-setup.md (étapes, libellés, URL, erreurs). Adresses :
   #setup/google                    avant de commencer + choix du parcours
   #setup/google/perso/<n>          adresse @gmail.com (ou Workspace sans droits d'administrateur) : 9 étapes
   #setup/google/workspace/<n>      Workspace administrateur, audience Interne : 6 étapes (1, 2, 3, 4, 8, 9 du document)
   Textes : setup.google.intro.*, setup.google.step.* (cadre) et setup.google.s.<étape>.<partie> ; une partie suffixée
   « Ws » remplace la partie de base dans le parcours Workspace. Dans les textes, **gras** et {lien} (HTML posé après
   l'échappement) ; une ligne = un élément de liste. */
const GCONSOLE = "https://console.cloud.google.com";
/** La page Google de chaque étape ; l'étape « file » se fait dans Molinova (dépôt du JSON). */
const GSTEPS = {
  project: GCONSOLE + "/projectcreate",
  gmailapi: GCONSOLE + "/apis/library/gmail.googleapis.com",
  calapi: GCONSOLE + "/apis/library/calendar-json.googleapis.com",
  consent: GCONSOLE + "/auth/overview",
  branding: GCONSOLE + "/auth/branding",
  scopes: GCONSOLE + "/auth/scopes",
  publish: GCONSOLE + "/auth/audience",
  client: GCONSOLE + "/auth/clients",
  file: "",
};
const GPATHS = {
  perso: ["project", "gmailapi", "calapi", "consent", "branding", "scopes", "publish", "client", "file"],
  workspace: ["project", "gmailapi", "calapi", "consent", "client", "file"],
};
/** Les droits à déclarer dans « Accès aux données », dans l'ordre du document (une ligne d'explication chacun). */
const GSCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/drive.readonly",
];

/** Un texte échappé, avec **gras** et des {liens} HTML posés après l'échappement. */
const richText = (s, html = {}) => h(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\{(\w+)\}/g, (m, k) => (k in html ? html[k] : m));
/** Un texte du dictionnaire sur plusieurs lignes, en liste (ul ou ol). */
const richList = (s, html = {}, tag = "ul") => `<${tag} class="gl">${String(s).split("\n").filter((x) => x.trim()).map((x) => `<li>${richText(x, html)}</li>`).join("")}</${tag}>`;
/** Une section titrée du guide (« Ce que tu fais », « Pourquoi »…). */
const gsec = (title, inner) => `<section class="gsec"><div class="mono">${h(title)}</div>${inner}</section>`;
/** Un bouton « Copier » : la valeur est dans data-copy, le lien se fait dans bindCopy(). */
const copyBtn = (value) => `<button type="button" class="btn sm gcopy" data-copy="${h(value)}">${h(t("setup.google.copy"))}</button>`;
function bindCopy() {
  document.querySelectorAll(".gcopy").forEach((b) => b.addEventListener("click", async () => {
    const value = b.dataset.copy || "";
    try { await navigator.clipboard.writeText(value); }
    catch {
      // Presse-papiers refusé (contexte non sécurisé) : l'ancienne méthode, par une zone de texte temporaire.
      const ta = Object.assign(document.createElement("textarea"), { value });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    b.textContent = t("setup.google.copied"); b.classList.add("ok");
    setTimeout(() => { b.textContent = t("setup.google.copy"); b.classList.remove("ok"); }, 1800);
  }));
}

function setupGoogle(sub = []) {
  const [p, nStr] = sub;
  if (!p) return setupGoogleIntro();
  const n = Number(nStr);
  if (!GPATHS[p] || !Number.isInteger(n) || n < 1 || n > GPATHS[p].length) {
    history.replaceState(null, "", "#setup/google");
    return setupGoogleIntro();
  }
  return setupGoogleStep(p, n);
}

/** Avant de commencer : pourquoi ta propre app, les messages qui font peur, ce que Molinova ne fera jamais, le parcours. */
function setupGoogleIntro() {
  const done = SETUP.steps.google;
  const choice = SW.gpath || "perso";
  setTimeout(() => {
    document.querySelectorAll('input[name="gpath"]').forEach((r) => r.addEventListener("change", () => {
      SW.gpath = r.value;
      $("#gmember").hidden = r.value !== "member";
    }));
    $("#gstart")?.addEventListener("click", () => {
      const v = $('input[name="gpath"]:checked')?.value || "perso";
      SW.gpath = v;
      location.hash = `#setup/google/${v === "admin" ? "workspace" : "perso"}/1`;
    });
  });
  const opt = (v) => `<label class="setup-check"><input type="radio" name="gpath" value="${v}" ${choice === v ? "checked" : ""}><span><b>${h(t(`setup.google.intro.path.${v}`))}</b><span class="small muted" style="display:block">${h(t(`setup.google.intro.path.${v}Text`))}</span></span></label>`;
  const body = `
    <div class="gcols">
      ${gsec(t("setup.google.intro.why.title"), richList(t("setup.google.intro.why.text")))}
      ${gsec(t("setup.google.intro.never.title"), richList(t("setup.google.intro.never.text")))}
    </div>
    <div class="gcalm"><div class="mono">${h(t("setup.google.intro.scary.title"))}</div>${richList(t("setup.google.intro.scary.text"))}</div>
    <section class="gsec"><div class="mono">${h(t("setup.google.intro.path.title"))}</div>
      <p class="gq">${h(t("setup.google.intro.path.question"))}</p>
      <div class="col" style="gap:12px">${opt("perso")}${opt("admin")}${opt("member")}</div>
      <div class="card small" id="gmember" ${choice === "member" ? "" : "hidden"} style="color:var(--g800)">${richText(t("setup.google.intro.path.memberNote"))}</div>
    </section>
    ${done ? `<div class="setup-ok">✓ ${h(t("setup.google.done"))}</div>` : ""}`;
  const next = `<button class="btn ${done ? "" : "ink"}" id="gstart">${h(t("setup.google.intro.start"))}</button>${done ? setupNext("google") : ""}`;
  return setupShell("google", { title: t("setup.google.title"), lead: h(t("setup.google.lead")), body, next });
}

/** Une sous-étape : Ce que tu fais · Pourquoi · Ce que tu vas voir · Rassure-toi · Ouvrir la page Google · Ça bloque ? */
async function setupGoogleStep(p, n) {
  const path = GPATHS[p], id = path[n - 1], url = GSTEPS[id], total = path.length;
  const ws = p === "workspace";
  // Les renvois d'une étape à l'autre suivent la numérotation du parcours affiché.
  const num = (x) => path.indexOf(x) + 1;
  // {consent} : un numéro dans le texte ; {client}, {branding}, {publish} : un lien « étape n » (posé après l'échappement).
  const params = { consent: num("consent") };
  const part = (name) => {
    const k = ws && tl(`setup.google.s.${id}.${name}Ws`) !== undefined ? `${name}Ws` : name;
    return tl(`setup.google.s.${id}.${k}`) === undefined ? "" : t(`setup.google.s.${id}.${k}`, params);
  };
  const stepLink = (x) => `<a href="#setup/google/${p}/${num(x)}">${h(t("setup.google.step.goTo", { n: num(x) }))}</a>`;
  const html = { client: stepLink("client"), branding: stepLink("branding"), publish: stepLink("publish") };

  let extra = "";
  if (id === "branding") extra = await gBranding();
  if (id === "scopes") extra = `<div class="gcopybox">${GSCOPES.map((s, i) => `<div class="gscope"><code>${h(s)}</code><span class="small muted">${h(t(`setup.google.scope.${i + 1}`))}</span></div>`).join("")}
      <div class="gopen">${copyBtn(GSCOPES.join("\n"))}<span class="small muted">${h(t("setup.google.s.scopes.copyHint"))}</span></div></div>`;
  if (id === "publish") extra = `<div class="gstatusrow"><span class="small">${h(t("setup.google.s.publish.statusLabel"))}</span><span class="gstatus">● ${h(t("setup.google.s.publish.status"))}</span></div>`;
  if (id === "client") extra = `<div class="gwarn gbig"><div>${richText(t("setup.google.s.client.warn"))}</div></div>`;

  setTimeout(() => {
    bindCopy();
    if (id === "file") bindGoogleFile();
  });

  // Étape 5 sans les pages de Molinova en ligne : le texte rassurant parle des pages de ton propre site.
  const reassure = part(id === "branding" && !SW.pages?.online ? "reassureOwn" : "reassure");
  const dont = id === "publish" ? `<div class="gdont"><div class="mono">${h(t("setup.google.s.publish.dontTitle"))}</div>${richList(t("setup.google.s.publish.dont"))}</div>` : "";
  const done = SETUP.steps.google;
  const fileZone = id === "file" ? `
    ${done ? `<div class="setup-ok">✓ ${h(t("setup.google.done"))}</div>` : ""}
    <label class="setup-drop" id="sgdrop"><input type="file" id="sgfile" accept=".json,application/json" hidden><b>${h(done ? t("setup.google.dropAgain") : t("setup.google.drop"))}</b><span class="small muted">${h(t("setup.google.dropHint"))}</span></label>
    <div id="sgmsg" hidden></div>
    <details class="card"><summary style="cursor:pointer;font-weight:600">${h(t("setup.google.paste"))}</summary>
      <div class="field-row gpaste" style="margin-top:12px">
        <label class="field"><span class="mono">${h(t("setup.google.clientId"))}</span><input type="text" id="sgid" autocomplete="off" spellcheck="false" placeholder="….apps.googleusercontent.com"></label>
        <label class="field"><span class="mono">${h(t("setup.google.clientSecret"))}</span><input type="password" id="sgsecret" autocomplete="off" spellcheck="false"></label>
        <button class="btn" id="sgpaste">${h(t("common.save"))}</button>
      </div></details>` : "";

  const pathNote = `${h(ws ? t("setup.google.step.pathWorkspace") : t("setup.google.step.pathPerso"))} · <a href="#setup/google">${h(t("setup.google.step.change"))}</a>`;
  const pre = `<div class="gprog">
      <div class="gprog-top"><span class="mono" style="color:var(--ink)">${h(t("setup.google.step.counter", { n, total }))}</span><span class="small muted">${pathNote}</span></div>
      <div class="gbar" aria-hidden="true">${path.map((_, j) => `<i class="${j < n - 1 ? "on" : j === n - 1 ? "cur" : ""}"></i>`).join("")}</div>
    </div>`;
  const member = !ws && n === 1 && SW.gpath === "member" ? `<div class="card small" style="color:var(--g800)">${richText(t("setup.google.intro.path.memberNote"))}</div>` : "";
  const langNote = n === 1 ? `<div class="small muted">${h(t("setup.google.step.consoleLang"))}</div>` : "";
  const body = `
    ${member}
    ${gsec(t("setup.google.step.do"), richList(part("do"), html, "ol"))}
    ${extra}
    ${fileZone}
    ${url ? `<div class="gopen"><a class="btn ink" href="${h(url)}" target="_blank" rel="noopener">${h(t("setup.google.step.open"))} ↗</a><span class="small muted">${h(t("setup.google.step.openHint"))}</span></div>` : ""}
    <div class="gcols">
      ${gsec(t("setup.google.step.why"), `<p class="gp">${richText(part("why"), html)}</p>`)}
      ${gsec(t("setup.google.step.see"), richList(part("see"), html) + langNote)}
    </div>
    ${reassure || dont ? `<div class="gcalm">${reassure ? `<div class="mono">${h(t("setup.google.step.reassure"))}</div>${richList(reassure, html)}` : ""}${dont}</div>` : ""}
    <details class="gstuck"><summary>${h(t("setup.google.step.stuck"))}</summary>${richList(part("stuck"), html)}</details>`;
  const back = n === 1 ? "#setup/google" : `#setup/google/${p}/${n - 1}`;
  const next = id === "file" ? setupNext("google") : `<a class="btn ink" href="#setup/google/${p}/${n + 1}">${h(t("setup.google.step.next"))}</a>`;
  return setupShell("google", { title: part("title"), body, next, back, pre });
}

/** Étape 5 : les trois liens et le domaine, avec les pages publiques de Molinova quand elles sont en ligne. */
async function gBranding() {
  if (!SW.pages) SW.pages = await api("/setup/pages-online").catch(() => ({ online: false }));
  const pg = SW.pages;
  const label = (k) => t(`setup.google.s.branding.field.${k}`);
  if (pg.online) {
    const row = (k, value) => `<div class="gcopyrow"><div class="col" style="gap:2px;min-width:0"><span class="small">${richText(label(k))}</span><code>${h(value)}</code></div>${copyBtn(value)}</div>`;
    return `<div class="gcopybox"><div class="small muted">${h(t("setup.google.s.branding.online"))}</div>
      ${row("home", pg.home)}${row("privacy", pg.privacy)}${row("terms", pg.terms)}${row("domain", pg.domain)}</div>`;
  }
  const row = (k) => `<div class="gcopyrow"><div class="col" style="gap:2px;min-width:0"><span class="small">${richText(label(k))}</span><span class="small muted">${h(t(`setup.google.s.branding.own.${k}`))}</span></div></div>`;
  return `<div class="gcopybox"><div class="small" style="color:var(--g800)">${richText(t("setup.google.s.branding.offline"))}</div>
    ${row("home")}${row("privacy")}${row("terms")}${row("domain")}</div>`;
}

/** Étape 9 : dépôt du JSON, choix du fichier ou copier-coller ; 409 = des boîtes tenaient l'ancien client. */
function bindGoogleFile() {
  const send = async (body) => {
    setupMsg("sgmsg", "");
    try {
      await api("/setup/google-client", { method: "POST", body });
      toast(t("setup.google.saved"));
      route();
    } catch (e) {
      // 409 : des boîtes sont connectées avec l'ancien client, leurs jetons ne serviront plus. Confirmer, puis les reconnecter.
      if (e.status !== 409 || body.replace) { setupMsg("sgmsg", e.message); return; }
      if (!confirm(e.message)) return;
      try {
        await api("/setup/google-client", { method: "POST", body: { ...body, replace: true } });
        toast(t("setup.google.saved"));
        SW.reconnect = true;
        setupGo("gmail");
      } catch (e2) { setupMsg("sgmsg", e2.message); }
    }
  };
  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let json;
      try { json = JSON.parse(String(reader.result)); } catch { setupMsg("sgmsg", t("setup.google.badFile")); return; }
      send({ json });
    };
    reader.onerror = () => setupMsg("sgmsg", t("setup.google.badFile"));
    reader.readAsText(file);
  };
  const drop = $("#sgdrop");
  if (drop) {
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer?.files?.[0]); });
  }
  $("#sgfile")?.addEventListener("change", (e) => { readFile(e.target.files?.[0]); e.target.value = ""; });
  $("#sgpaste")?.addEventListener("click", () => {
    const clientId = $("#sgid").value.trim(), clientSecret = $("#sgsecret").value.trim();
    if (!clientId || !clientSecret) { setupMsg("sgmsg", t("setup.google.pasteEmpty")); return; }
    $("#sgsecret").value = "";
    send({ clientId, clientSecret });
  });
}

// ---------- 04 Gmail
/* Avant « Connecter » : les trois écrans de Google, dans l'ordre. Après : les avertissements du serveur (droits
   demandés mais pas accordés) gardés dans SW.gmailNote, avec « Reconnecter » aux mêmes options (SW.gmailOpts). */
async function setupGmail() {
  const accs = (await api("/accounts")).filter((a) => a.source === "gmail");
  const connect = async (opts) => {
    const b = $("#sgconnect");
    if (!b) return;
    b.disabled = true; b.textContent = t("setup.gmail.waiting");
    const again = $("#sgagain"); if (again) again.disabled = true;
    $("#sgwait").hidden = false; setupMsg("sgmailmsg", "");
    const ctl = new AbortController();
    SW.wait = ctl;
    try {
      const a = await api("/accounts/add", { method: "POST", body: opts, signal: ctl.signal });
      SW.wait = null; SW.reconnect = false; SW.gmailOpts = opts;
      const missing = Array.isArray(a.missingScopes) ? a.missingScopes : [];
      const warnings = Array.isArray(a.warnings) ? a.warnings : [];
      SW.gmailNote = missing.length || warnings.length ? { email: a.email, missing, warnings } : null;
      toast(t("sources.toast.connected", { email: a.email }));
      renderFoot();
      route();
    } catch (e) {
      SW.wait = null;
      if (!$("#sgconnect")) return; // la page a changé entre-temps
      $("#sgwait").hidden = true;
      b.disabled = false; b.textContent = accs.length ? t("setup.gmail.another") : t("setup.gmail.connect");
      if (again) again.disabled = false;
      setupMsg("sgmailmsg", e.name === "AbortError" ? t("setup.gmail.cancelled") : e.message);
    }
  };
  setTimeout(() => {
    $("#sgconnect")?.addEventListener("click", () => connect({ drafts: $("#sgdrafts").checked, calendar: $("#sgcal").checked }));
    $("#sgagain")?.addEventListener("click", () => connect(SW.gmailOpts || { drafts: true, calendar: true }));
    // Annuler ferme aussi le serveur local de la connexion côté Molinova (sinon il attend toujours le navigateur).
    $("#sgcancel")?.addEventListener("click", () => { SW.wait?.abort(); api("/accounts/add/cancel", { method: "POST" }).catch(() => {}); });
  });
  const opt = (id, title, text) => `<label class="setup-check"><input type="checkbox" id="${id}" checked><span><b>${h(title)}</b><span class="small muted" style="display:block">${h(text)}</span></span></label>`;
  const list = accs.length ? `<div class="col" style="gap:0">${accs.map((a) => `<div class="row" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--g100)"><span class="setup-ok">✓</span><b>${h(a.email)}</b></div>`).join("")}</div>` : "";
  const nt = SW.gmailNote;
  const scopeName = (s) => ({ drafts: t("setup.gmail.drafts"), calendar: t("setup.gmail.calendar") })[s] || s;
  const note = nt ? `<div class="gwarn gnote"><div>${h(t("setup.gmail.partial", { email: nt.email }))}</div>
      ${richList(nt.warnings.length ? nt.warnings.join("\n") : t("setup.gmail.missing", { list: nt.missing.map(scopeName).join(", ") }))}
      <div><button class="btn sm ink" id="sgagain">${h(t("setup.gmail.reconnectBtn"))}</button></div></div>` : "";
  const guideLink = `<a href="#setup/google/perso/${GPATHS.perso.indexOf("publish") + 1}">${h(t("setup.google.s.publish.title"))}</a>`;
  const body = `
    ${SW.reconnect ? `<div class="setup-err">${h(t("setup.gmail.reconnect"))}</div>` : ""}
    ${note}
    ${list}
    <div class="col" style="gap:10px">
      ${opt("sgdrafts", t("setup.gmail.drafts"), t("setup.gmail.draftsText"))}
      ${opt("sgcal", t("setup.gmail.calendar"), t("setup.gmail.calendarText"))}
    </div>
    <div class="small muted">${h(t("sources.gmail.access"))}</div>
    ${gsec(t("setup.gmail.preview.title"), `<ol class="setup-guide">${["1", "2", "3"].map((k) => `<li><div>${richText(t(`setup.gmail.preview.${k}`))}</div></li>`).join("")}</ol>`)}
    <div class="gcalm"><div class="mono">${h(t("setup.gmail.safe.title"))}</div><p class="gp">${richText(t("setup.gmail.safe.text"))}</p></div>
    <div class="row" style="align-items:center;gap:12px"><button class="btn ${accs.length ? "" : "ink"}" id="sgconnect">${h(accs.length ? t("setup.gmail.another") : t("setup.gmail.connect"))}</button></div>
    <div class="card small" id="sgwait" hidden style="color:var(--g800)"><b>${h(t("setup.gmail.waitTitle"))}</b> ${h(t("setup.gmail.waitText"))} <button class="btn link" id="sgcancel">${h(t("common.cancel"))}</button></div>
    <div id="sgmailmsg" hidden></div>
    <details class="gstuck"><summary>${h(t("setup.google.step.stuck"))}</summary>${richList(t("setup.gmail.stuck"), { guide: guideLink })}</details>`;
  // Retour : la dernière sous-étape Google du parcours choisi (le dépôt du fichier), pas l'écran d'accueil du guide.
  const gp = SW.gpath === "admin" ? "workspace" : "perso";
  return setupShell("gmail", { title: t("setup.gmail.title"), lead: h(t("setup.gmail.lead")), body, next: setupNext("gmail"), back: `#setup/google/${gp}/${GPATHS[gp].length}` });
}

// ---------- 05 Toi
async function setupYou() {
  const accs = (await api("/accounts").catch(() => [])).filter((a) => a.source === "gmail");
  // Sans context.json, le serveur renvoie l'exemple : on ne préremplit qu'avec un contexte réellement enregistré.
  const ctx = SETUP.steps.context ? await api("/config/context").catch(() => null) : null;
  const name = ctx?.owner?.name ?? "";
  const emails = ctx?.owner?.emails?.length ? ctx.owner.emails : accs.map((a) => a.email);
  let tz = ctx?.owner?.timezone || "";
  try { tz = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch {}
  // « Passer » sans contexte enregistré : un contexte minimal plutôt que l'exemple (Alex Martin) — nom tiré de l'adresse
  // Gmail, adresses et fuseau laissés au serveur (boîtes connectées, fuseau du système).
  const guessName = () => (accs[0]?.email.split("@")[0] || "").split(/[._+-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  setTimeout(() => {
    $("#syskip")?.addEventListener("click", async () => {
      const b = $("#syskip");
      if (SETUP.steps.context) { setupGo("always"); return; }
      b.disabled = true; setupMsg("syoumsg", "");
      const body = { name: $("#syname").value.trim() || guessName() || "Molinova", emails: [], timezone: "", language: I18N.lang };
      try { await api("/setup/context", { method: "POST", body }); setupGo("always"); }
      catch (e) { setupMsg("syoumsg", e.message); b.disabled = false; }
    });
    $("#syousave")?.addEventListener("click", async () => {
      const b = $("#syousave");
      b.disabled = true; setupMsg("syoumsg", "");
      const body = { name: $("#syname").value.trim(), emails: $("#syemails").value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean), timezone: $("#sytz").value.trim(), language: I18N.lang };
      try { await api("/setup/context", { method: "POST", body }); setupGo("always"); }
      catch (e) { setupMsg("syoumsg", e.message); b.disabled = false; }
    });
  });
  const body = `
    <div class="field-row" style="grid-template-columns:240px 1fr">
      <label class="field"><span class="mono">${h(t("setup.you.name"))}</span><input type="text" id="syname" value="${h(name)}" autocomplete="name"></label>
      <label class="field"><span class="mono">${h(t("setup.you.emails"))}</span><input type="text" id="syemails" value="${h(emails.join(", "))}" spellcheck="false"></label>
    </div>
    <div class="small muted">${h(t("setup.you.emailsHint"))}</div>
    <div class="field-row" style="grid-template-columns:240px 1fr">
      <label class="field"><span class="mono">${h(t("setup.you.timezone"))}</span><input type="text" id="sytz" value="${h(tz)}" list="sytzlist" spellcheck="false" autocomplete="off"></label>
      <div class="small muted" style="padding-bottom:10px">${h(t("setup.you.timezoneHint"))}</div>
    </div>
    <datalist id="sytzlist">${zones.map((z) => `<option value="${h(z)}">`).join("")}</datalist>
    <div class="small muted">${t("setup.you.later", { link: `<a href="#context">${h(t("setup.you.laterLink"))}</a>` })}</div>
    <div id="syoumsg" hidden></div>`;
  const next = `<button class="btn ghost" id="syskip">${h(t("setup.skip"))}</button><button class="btn ink" id="syousave">${h(t("setup.you.save"))}</button>`;
  return setupShell("you", { title: t("setup.you.title"), lead: h(t("setup.you.lead")), body, next });
}

// ---------- 06 Toujours prêt
/** Les réglages de l'app macOS (app.json), en interrupteurs ; partagé avec Réglages › Connexions. */
const APP_SETTING_KEYS = ["openAtLogin", "preventSleep", "closeToTray"];
function appSettingRows(s, keys = APP_SETTING_KEYS) {
  const label = { openAtLogin: t("setup.app.openAtLogin"), preventSleep: t("setup.app.preventSleep"), closeToTray: t("setup.app.closeToTray") };
  const desc = { openAtLogin: t("setup.app.openAtLoginText"), preventSleep: t("setup.app.preventSleepText"), closeToTray: t("setup.app.closeToTrayText") };
  return `<div class="tasks">${keys.map((k) => `<div class="task" style="grid-template-columns:44px 1fr"><button class="toggle apptoggle ${s[k] ? "on" : ""}" data-k="${k}" aria-pressed="${s[k] ? "true" : "false"}" aria-label="${h(label[k])}"></button><span><b>${h(label[k])}</b><span class="small muted" style="display:block">${h(desc[k])}</span></span></div>`).join("")}</div>`;
}
/** Chaque interrupteur enregistre à part (PUT partiel) ; l'app applique aussitôt. */
function bindAppSettings() {
  document.querySelectorAll(".apptoggle").forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.k, on = !b.classList.contains("on");
    b.disabled = true;
    try {
      const s = await api("/app/settings", { method: "PUT", body: { [k]: on } });
      b.classList.toggle("on", !!s[k]); b.setAttribute("aria-pressed", s[k] ? "true" : "false");
      toast(t("setup.app.saved"));
    } catch (e) { toast(e.message); }
    b.disabled = false;
  }));
}
async function setupAlways() {
  const isApp = !!window.molinova?.isApp;
  const app = isApp ? await api("/app/settings").catch(() => null) : null;
  setTimeout(() => {
    bindAppSettings();
    $("#sfinish")?.addEventListener("click", async () => {
      const b = $("#sfinish"); b.disabled = true; setupMsg("salwmsg", "");
      const v = $("#swatch").value;
      try {
        const r = await api("/setup/finish", { method: "POST", body: { watchEvery: v ? Number(v) : null } });
        SETUP = r.state; SW.finish = r;
        setupGo("done");
      } catch (e) { setupMsg("salwmsg", e.message); b.disabled = false; }
    });
  });
  const every = [["", t("setup.always.watchOff")], ["300", t("setup.always.watch5")], ["900", t("setup.always.watch15")], ["1800", t("setup.always.watch30")]];
  const body = `
    ${app ? `<section class="col" style="gap:6px"><h3>${h(t("setup.always.appTitle"))}</h3>${appSettingRows(app, ["openAtLogin", "preventSleep"])}<div class="small muted">${h(t("setup.always.macosNote"))}</div></section>` : ""}
    <section class="col" style="gap:8px"><h3>${h(t("setup.always.watchTitle"))}</h3>
      <div class="row" style="align-items:center;gap:14px;flex-wrap:wrap"><select id="swatch" style="width:220px">${every.map(([v, l]) => `<option value="${v}" ${v === "300" ? "selected" : ""}>${h(l)}</option>`).join("")}</select><span class="small muted grow">${h(t("setup.always.watchText"))}</span></div>
    </section>
    <div id="salwmsg" hidden></div>`;
  const next = `<button class="btn ink" id="sfinish">${h(t("setup.always.finish"))}</button>`;
  return setupShell("always", { title: t("setup.always.title"), lead: h(isApp ? t("setup.always.leadApp") : t("setup.always.lead")), body, next });
}

// ---------- la fin
async function setupDone() {
  const wa = await api("/whatsapp/status").catch(() => null);
  const r = SW.finish;
  // Après un rechargement, le résultat de « Terminer » est perdu : l'état de l'app dit si une surveillance tourne.
  const watching = r ? r.watching?.length || 0 : (await api("/app/status").catch(() => null))?.watching ?? 1;
  setTimeout(() => $("#sopen")?.addEventListener("click", () => { SW.finish = null; location.hash = "#mail"; renderFoot(); }));
  const card = (name, text, href, label) => `<div class="card col" style="gap:8px"><h3>${h(name)}</h3><div class="small" style="color:var(--g800)">${h(text)}</div><div style="margin-top:auto"><a class="btn sm" href="${href}">${h(label)}</a></div></div>`;
  const watch = r?.watching?.length ? `<div class="setup-ok">✓ ${h(tn("setup.done.watching", r.watching.length, { list: r.watching.join(", ") }))}</div>` : "";
  const errors = r?.errors?.length ? `<div class="setup-err">${r.errors.map(h).join("<br>")}</div>` : "";
  return `<div class="setup-drag" aria-hidden="true"></div><div class="setup">
    <div class="setup-bar"><div class="wordmark">Molinova<span class="stop">.</span></div><span class="mono">${h(t("setup.bar.kicker"))}</span></div>
    <section class="card setup-card">
      <div class="kicker"><b>✓</b>${h(t("setup.done.kicker"))}</div>
      <h1>${h(t("setup.done.title"))}<span class="stop">.</span></h1>
      <p class="lead">${h(watching ? t("setup.done.lead") : t("setup.done.leadNoWatch"))}</p>
      ${watch}${errors}
      <div class="mono">${h(t("setup.done.later"))}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
        ${wa && wa.supported !== false ? card("WhatsApp", t("sources.wa.what"), "#channel/whatsapp", t("sources.connect")) : ""}
        ${card("Telegram", t("sources.tg.what"), "#channel/telegram", t("sources.connect"))}
      </div>
    </section>
    <div class="setup-foot"><span class="grow"></span><button class="btn ink" id="sopen">${h(t("setup.done.open"))}</button></div>
  </div>`;
}

/* Un fichier lâché à côté de la zone de dépôt ne doit pas remplacer la page (l'app ouvrirait le fichier). */
document.addEventListener("dragover", (e) => { if (document.body.classList.contains("setup-mode")) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (document.body.classList.contains("setup-mode")) e.preventDefault(); });
