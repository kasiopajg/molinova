import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { google, type gmail_v1 } from "googleapis";
import { CodeChallengeMethod, type Credentials, type OAuth2Client } from "google-auth-library";
import open from "open";
import { PATHS } from "../config.js";
import { t, type Key } from "../i18n/index.js";
import { getSecret, secretSource, type SecretSource } from "../secrets.js";
import { domainOf, excerpt, htmlToText, parseAddress, splitAddresses } from "../core/text.js";
import type { Connector, Item, ListPage } from "./types.js";

/** Lire et poser des libellés. Ce droit Google permet aussi l'envoi ; le code n'envoie que sur un clic explicite (réponse, transfert, relance). Jamais de suppression définitive. */
export const SCOPES_BASE = ["https://www.googleapis.com/auth/gmail.modify"];
/** Option brouillons : créer des brouillons. Ce droit Google couvre aussi l'envoi, utilisé seulement sur un clic explicite. */
export const SCOPE_DRAFTS = "https://www.googleapis.com/auth/gmail.compose";
/** Option agenda : créer des événements dans Google Agenda. */
export const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.events";
/** Page Agenda : voir la liste des agendas (les siens et ceux partagés) et créer l'agenda « Famille ». */
export const SCOPE_CALENDAR_LIST = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const SCOPE_CALENDAR_CREATE = "https://www.googleapis.com/auth/calendar.app.created";
export const SCOPES_CALENDAR = [SCOPE_CALENDAR, SCOPE_CALENDAR_LIST, SCOPE_CALENDAR_CREATE];
/** Option Documents : lire les noms, dossiers et contenus de Google Drive. Lecture seule : rien n'est écrit, déplacé ni supprimé. */
export const SCOPE_DRIVE_READ = "https://www.googleapis.com/auth/drive.readonly";

interface OAuthClientFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

/** Ancien emplacement du client OAuth, avant les secrets : lu en second, jamais écrit. */
const legacyClientFile = () => path.join(PATHS.credentials, "google-oauth.json");

/** Le client OAuth : la paire GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET d'abord, le fichier historique ensuite. */
function loadClientSecrets(): { clientId: string; clientSecret: string } {
  const clientId = getSecret("GOOGLE_CLIENT_ID"), clientSecret = getSecret("GOOGLE_CLIENT_SECRET");
  if (clientId && clientSecret) return { clientId, clientSecret };
  const file = legacyClientFile();
  if (!fs.existsSync(file)) throw new Error(t("gmail.credentialsMissing"));
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OAuthClientFile;
  const c = parsed.installed ?? parsed.web;
  if (!c) throw new Error(t("gmail.credentialsFormat", { file }));
  return { clientId: c.client_id, clientSecret: c.client_secret };
}
/** L'identifiant du client OAuth en service (secret ou fichier historique), null s'il n'y en a pas. */
export function currentGoogleClientId(): string | null {
  try { return loadClientSecrets().clientId || null; } catch { return null; }
}
/** D'où vient le client OAuth : un secret (trousseau, .env.local, environnement), le fichier historique, ou rien. */
export function googleClientSource(): SecretSource | "file" | null {
  if (getSecret("GOOGLE_CLIENT_ID") && getSecret("GOOGLE_CLIENT_SECRET")) return secretSource("GOOGLE_CLIENT_ID");
  return fs.existsSync(legacyClientFile()) ? "file" : null;
}

const setupError = (key: Key): Error => Object.assign(new Error(t(key)), { code: key, status: 400 });
/**
 * Le client OAuth collé dans l'assistant : le JSON téléchargé depuis Google Cloud Console (objet ou texte,
 * éventuellement sous `json`), ou { clientId, clientSecret }. Un client « Application Web » est refusé :
 * la connexion passe par un serveur local à port libre, seul un client « Application de bureau » l'accepte.
 */
export function parseGoogleClient(raw: unknown): { clientId: string; clientSecret: string } {
  let v = raw;
  if (v && typeof v === "object" && "json" in v) v = (v as { json: unknown }).json;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { throw setupError("setup.googleFormat"); } }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw setupError("setup.googleFormat");
  const o = v as OAuthClientFile & { clientId?: unknown; clientSecret?: unknown };
  let id: unknown, secret: unknown;
  if (o.installed && typeof o.installed === "object") { id = o.installed.client_id; secret = o.installed.client_secret; }
  else if (o.web) throw setupError("setup.googleWeb");
  else { id = o.clientId; secret = o.clientSecret; }
  // Caractère de contrôle (retour à la ligne collé avec le secret) : refusé ici plutôt qu'à l'écriture de .env.local.
  if (typeof id !== "string" || typeof secret !== "string" || !id.trim() || !secret.trim() || /[\x00-\x1f\x7f]/.test(secret.trim())) throw setupError("setup.googleFormat");
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id.trim())) throw setupError("setup.googleClientId");
  return { clientId: id.trim(), clientSecret: secret.trim() };
}

/** Ce que Google a réellement accordé : l'écran de consentement a une case par droit, chacune peut rester décochée. */
export interface GrantedScopes { granted: string[]; missingMail: boolean; missing: Array<"drafts" | "calendar" | "drive"> }
/**
 * Compare les droits demandés à ceux accordés (`tokens.scope`, séparés par des espaces). Sans `scope` (anciennes
 * versions de la bibliothèque, ou réponse de Google qui ne le renvoie pas), on retombe sur les droits demandés :
 * c'était le comportement d'avant, et un droit manquant se verra au premier appel refusé.
 */
export function analyseGrantedScopes(requested: string[], grantedScope?: string | null): GrantedScopes {
  const granted = typeof grantedScope === "string" && grantedScope.trim() ? [...new Set(grantedScope.trim().split(/\s+/))] : [...requested];
  const has = (s: string) => granted.includes(s);
  const missing: GrantedScopes["missing"] = [];
  if (requested.includes(SCOPE_DRAFTS) && !has(SCOPE_DRAFTS)) missing.push("drafts");
  if (SCOPES_CALENDAR.some((s) => requested.includes(s) && !has(s))) missing.push("calendar");
  if (requested.includes(SCOPE_DRIVE_READ) && !has(SCOPE_DRIVE_READ)) missing.push("drive");
  return { granted, missingMail: SCOPES_BASE.some((s) => !has(s)), missing };
}

/** Les erreurs OAuth de Google qui ont une explication et une solution dans le guide (docs/google-setup.md). */
const OAUTH_ERRORS: Record<string, Key> = {
  access_denied: "gmail.errAccessDenied",
  redirect_uri_mismatch: "gmail.errRedirectUri",
  admin_policy_enforced: "gmail.errAdminPolicy",
  org_internal: "gmail.errOrgInternal",
  invalid_client: "gmail.errInvalidClient",
  invalid_grant: "gmail.errInvalidGrant",
};
/**
 * Le code d'erreur OAuth d'une réponse de Google : `?error=` du retour local, `response.data.error` d'un échange de
 * jeton (gaxios), ou le message lui-même (« invalid_grant »). null si ce n'est pas une erreur OAuth reconnue.
 */
export function oauthErrorCode(err: unknown): string | null {
  if (typeof err === "string") return Object.hasOwn(OAUTH_ERRORS, err.trim()) ? err.trim() : null;
  const data = (err as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;
  if (typeof data === "string" && Object.hasOwn(OAUTH_ERRORS, data)) return data;
  const msg = err instanceof Error ? err.message : "";
  return Object.keys(OAUTH_ERRORS).find((c) => new RegExp(`\\b${c}\\b`).test(msg)) ?? null;
}
/**
 * Erreur traduite, avec la solution, pour un code OAuth reconnu ; null sinon (l'appelant garde l'erreur d'origine).
 * Les messages gardent le code brut (« invalid_grant ») : isAuthError (jobs.ts) le reconnaît dans le texte.
 */
export function googleAuthError(err: unknown): (Error & { code: Key; status: number }) | null {
  const c = oauthErrorCode(err);
  return c ? Object.assign(new Error(t(OAUTH_ERRORS[c])), { code: OAUTH_ERRORS[c], status: 400 }) : null;
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function tokenFile(email: string): string {
  return path.join(PATHS.tokens, `${email.replace(/[^a-z0-9@._-]/gi, "_")}.json`);
}

/** Une connexion Google en attente du navigateur : une seule à la fois, fermée par une nouvelle, l'annulation ou le délai. */
let pendingAuth: { cancel(reason: Error): void } | undefined;
const AUTH_TIMEOUT_MS = 5 * 60_000;

/** Annule la connexion en attente (bouton Annuler de l'interface) ; false s'il n'y en avait pas. */
export function cancelPendingAuthorization(): boolean {
  if (!pendingAuth) return false;
  pendingAuth.cancel(new Error(t("gmail.authCancelled")));
  return true;
}

/**
 * Connexion d'un nouveau compte : ouvre le navigateur, récupère le code sur un
 * serveur local éphémère, enregistre le refresh token dans tokens/.
 * Le serveur local se ferme après 5 min, à l'annulation, ou quand une nouvelle connexion commence.
 */
export async function authorizeNewAccount(opts: { drafts?: boolean; calendar?: boolean; drive?: boolean; expectEmail?: string } = {}): Promise<{ email: string; client: OAuth2Client; scopes: string[]; missing: GrantedScopes["missing"] }> {
  const { clientId, clientSecret } = loadClientSecrets();
  const scopes = [...SCOPES_BASE, ...(opts.drafts ? [SCOPE_DRAFTS] : []), ...(opts.calendar ? SCOPES_CALENDAR : []), ...(opts.drive ? [SCOPE_DRIVE_READ] : [])];
  cancelPendingAuthorization();
  // PKCE et state : seul ce navigateur, revenu de cette demande, peut remettre un code (pas un autre programme du Mac
  // qui viserait le port d'écoute), et un code intercepté ne vaut rien sans le vérificateur gardé ici.
  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = await new google.auth.OAuth2(clientId).generateCodeVerifierAsync();

  // Le redirect_uri reste propre à cet appel : Google exige le même à l'échange du code.
  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = "";
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const c = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      // Autre requête du navigateur (favicon…), ou réponse qui ne vient pas de cette demande : ignorée, on attend toujours Google.
      if ((!c && !err) || url.searchParams.get("state") !== state) { res.writeHead(404).end(); return; }
      // Refus renvoyé par Google (?error=access_denied…) : expliqué avec sa solution, dans l'onglet comme dans Molinova.
      const failure = err ? googleAuthError(err) ?? new Error(err) : null;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      // Le paramètre vient de l'adresse : échappé avant d'entrer dans la page.
      res.end(c ? t("gmail.oauthDone") : t("gmail.oauthFail", { error: escapeHtml(failure?.message ?? t("gmail.noCode")) }));
      finish();
      c ? resolve({ code: c, redirectUri }) : reject(failure ?? new Error(t("gmail.authDenied")));
    });
    const me = { cancel: (reason: Error) => { finish(); reject(reason); } };
    const timer = setTimeout(() => me.cancel(new Error(t("gmail.authTimeout"))), AUTH_TIMEOUT_MS);
    function finish() {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (pendingAuth === me) pendingAuth = undefined;
    }
    pendingAuth = me;
    server.on("error", (e) => me.cancel(e));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}`;
      const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      // Ajout d'un droit à une boîte déjà connectée (Drive) : Google propose directement ce compte.
      const authUrl = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: scopes, state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256, ...(opts.expectEmail ? { login_hint: opts.expectEmail } : {}) });
      console.log(t("gmail.openingBrowser"));
      void open(authUrl);
    });
  });

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  let tokens: Credentials;
  try { ({ tokens } = await client.getToken({ code, codeVerifier })); }
  catch (e) { throw googleAuthError(e) ?? e; }
  // Une case décochée sur l'écran de Google = un droit absent : on enregistre ce qui a été accordé, pas ce qui a été demandé.
  const grant = analyseGrantedScopes(scopes, tokens.scope);
  // Sans Gmail, rien à garder : aucun jeton écrit (une boîte déjà connectée garde l'ancien). Pas de révocation non plus :
  // elle retirerait aussi l'accès de cette boîte si elle était déjà connectée avec ce client.
  if (grant.missingMail) throw Object.assign(new Error(t("gmail.missingMailScope")), { code: "gmail.missingMailScope" satisfies Key, status: 400 });
  client.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress!;
  // Droit ajouté à une boîte précise : un autre compte choisi dans Google n'écrase rien et ne s'ajoute pas en douce.
  if (opts.expectEmail && email.toLowerCase() !== opts.expectEmail.toLowerCase()) throw Object.assign(new Error(t("gmail.wrongAccount", { expected: opts.expectEmail, got: email })), { code: "gmail.wrongAccount" satisfies Key, status: 400 });
  fs.writeFileSync(tokenFile(email), JSON.stringify({ ...tokens, scopes: grant.granted }, null, 2), { mode: 0o600 });
  return { email, client, scopes: grant.granted, missing: grant.missing };
}

/** Un jeton OAuth est enregistré pour ce compte. */
export function hasToken(email: string): boolean {
  return fs.existsSync(tokenFile(email));
}

export function scopesForAccount(email: string): string[] {
  const file = tokenFile(email);
  if (!fs.existsSync(file)) return [];
  const t = JSON.parse(fs.readFileSync(file, "utf8")) as { scopes?: string[]; scope?: string };
  return t.scopes ?? (t.scope ? t.scope.split(" ") : []);
}

export function clientForAccount(email: string): OAuth2Client {
  const { clientId, clientSecret } = loadClientSecrets();
  const file = tokenFile(email);
  if (!fs.existsSync(file)) throw new Error(t("gmail.noToken", { email }));
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials(JSON.parse(fs.readFileSync(file, "utf8")));
  client.on("tokens", (t) => {
    // Google renouvelle l'access token ; on garde le refresh token existant.
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...current, ...t, refresh_token: t.refresh_token ?? current.refresh_token }, null, 2), { mode: 0o600 });
  });
  return client;
}

/**
 * Gmail limite le « coût » des appels par utilisateur et par seconde (250 unités/s,
 * messages.get = 5 unités). On lisse à ~25 lectures/s et on réessaie en cas de
 * dépassement, avec une attente qui double à chaque tentative.
 */
/** État du débit, lu par l'interface : quand Google freine, on le dit. */
export const gmailStatus = { throttledUntil: 0, quotaHits: 0 };
const MAX_PER_SECOND = 4;
const MAX_IN_FLIGHT = 6;
let stamps: number[] = [];
let inFlight = 0;
const waiters: Array<() => void> = [];
export class StoppedError extends Error { constructor() { super(t("gmail.stopped")); } }
/** Gmail ne garde l'historique qu'environ une semaine : un point de départ trop ancien doit être remplacé. */
export class HistoryExpiredError extends Error { constructor() { super(t("job.historyReset")); } }
const httpCode = (err: unknown): number => { const e = err as { code?: number | string; status?: number }; return Number(e.code ?? e.status); };
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new StoppedError());
    const id = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(id); reject(new StoppedError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Un appel Gmail sous le débit autorisé (4 par seconde, 6 à la fois), partagé par tout le serveur.
 * `priority` : un clic de l'utilisateur passe devant les passages de fond (rattrapage, veille) qui attendent leur tour.
 */
async function throttled<T>(fn: () => Promise<T>, signal?: AbortSignal, priority = false): Promise<T> {
  while (inFlight >= MAX_IN_FLIGHT) { if (signal?.aborted) throw new StoppedError(); await new Promise<void>((r) => (priority ? waiters.unshift(r) : waiters.push(r))); }
  inFlight++;
  try {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new StoppedError();
      const now = Date.now();
      stamps = stamps.filter((t) => now - t < 1000);
      if (stamps.length >= MAX_PER_SECOND) {
        await sleep(1000 - (now - stamps[0]) + 5, signal);
        continue;
      }
      stamps.push(Date.now());
      try {
        return await fn();
      } catch (err) {
        const e = err as { code?: number | string; status?: number; message?: string };
        const code = Number(e.code ?? e.status);
        const rateLimited = code === 429 || (code === 403 && /quota|rate/i.test(e.message ?? ""));
        // Les « Backend Error » de Gmail (500, 502, 503, 504) sont passagères : quelques nouveaux essais, courts.
        const transient = code === 500 || code === 502 || code === 503 || code === 504;
        if (transient && attempt < 4) { await sleep(1000 * 2 ** attempt, signal); continue; }
        // Accès refusé par Google (application restée en mode Test, mot de passe changé, client supprimé) : message avec la cause et la solution.
        if (!rateLimited || attempt >= 8) throw (["invalid_grant", "invalid_client"].includes(oauthErrorCode(err) ?? "") ? googleAuthError(err) : null) ?? err;
        // Le quota « par minute » ne se libère qu'au bout de la minute : on attend jusqu'à 30 s.
        const wait = Math.min(30_000, 2000 * 2 ** attempt);
        gmailStatus.quotaHits++;
        gmailStatus.throttledUntil = Math.max(gmailStatus.throttledUntil, Date.now() + wait);
        process.stdout.write(`\r${t("gmail.quotaWait", { seconds: Math.round(wait / 1000) })}`);
        await sleep(wait, signal);
      }
    }
  } finally {
    inFlight--;
    waiters.shift()?.();
  }
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Le corps d'une partie, dans son jeu de caractères (iso-8859-1, windows-1252…) ; UTF-8 par défaut ou si inconnu. */
export function decodeBody(data?: string | null, contentType?: string): string {
  if (!data) return "";
  const buf = Buffer.from(data, "base64url");
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8" && charset !== "us-ascii") {
    try { return new TextDecoder(charset).decode(buf); } catch { /* jeu inconnu : UTF-8 */ }
  }
  return buf.toString("utf8");
}
const partType = (p: gmail_v1.Schema$MessagePart): string => p.headers?.find((h) => h.name?.toLowerCase() === "content-type")?.value ?? "";

/** Prend la première partie text/plain, sinon text/html converti. */
function extractText(part: gmail_v1.Schema$MessagePart | undefined): { text: string; hasAttachments: boolean } {
  if (!part) return { text: "", hasAttachments: false };
  let plain = "";
  let html = "";
  let hasAttachments = false;
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.filename && p.body?.attachmentId) hasAttachments = true;
    if (p.mimeType === "text/plain" && !plain) plain = decodeBody(p.body?.data, partType(p));
    else if (p.mimeType === "text/html" && !html) html = decodeBody(p.body?.data, partType(p));
    p.parts?.forEach(walk);
  };
  walk(part);
  return { text: plain || htmlToText(html), hasAttachments };
}

export interface FullMessage {
  id: string;
  threadId?: string;
  messageId: string;
  references: string;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  subject: string;
  date: string;
  text: string;
  html: string;
  attachments: Array<{ id: string; name: string; mimeType: string; size: number }>;
  labels: string[];
  /** Partie text/calendar en clair (invitation), si l'email en porte une. */
  calendar?: string;
  /** Sinon, l'identifiant de la pièce jointe .ics à aller chercher. */
  calendarAttachmentId?: string;
}

export interface OutgoingMessage {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /** Pièces jointes : celles d'un email transféré, et les fichiers joints depuis le Mac. */
  attachments?: Array<{ name: string; mimeType: string; data: Buffer }>;
}

/** Limite de Gmail pour les pièces jointes d'un envoi (25 Mo au total). */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
/** Au-delà, l'envoi passe par l'adresse d'upload de Gmail (jusqu'à 35 Mo) plutôt que dans le corps JSON. */
const UPLOAD_ABOVE = 4 * 1024 * 1024;

/** Base64 en lignes de 76 caractères, comme le veut le format des emails. */
const b64Lines = (b: Buffer) => b.toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");

/** Construit le message MIME (texte simple, UTF-8, pièces jointes en base64), prêt à envoyer tel quel. */
export function buildMime(m: OutgoingMessage): string {
  const encWord = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s);
  const headers = [
    `To: ${m.to}`,
    m.cc ? `Cc: ${m.cc}` : "",
    `Subject: ${encWord(m.subject)}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : "",
    m.references ? `References: ${m.references}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);
  let mime: string;
  if (m.attachments?.length) {
    const boundary = "ea_" + Date.now().toString(36);
    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(m.body, "utf8").toString("base64"),
      ...m.attachments.flatMap((a) => {
        // Nom accentué (« reçu banque.pdf ») : encodé pour tous les clients (RFC 2047 et 2231), jamais de guillemet ni de saut de ligne.
        const name = a.name.replace(/["\r\n\\]/g, "_") || "fichier";
        const type = /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : "application/octet-stream";
        return [
          `--${boundary}`,
          `Content-Type: ${type}; name="${encWord(name)}"`,
          `Content-Disposition: attachment; filename="${encWord(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Content-Transfer-Encoding: base64",
          "",
          b64Lines(a.data),
        ];
      }),
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    mime = [...headers, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", Buffer.from(m.body, "utf8").toString("base64")].join("\r\n");
  }
  return mime;
}

export class GmailConnector implements Connector {
  readonly source = "gmail" as const;
  private gmail: gmail_v1.Gmail;
  private labelCache = new Map<string, string>();

  constructor(
    private readonly accountId: number,
    private readonly email: string,
    private readonly ownerEmails: string[],
    private readonly bodyExcerptChars: number,
  ) {
    this.gmail = google.gmail({ version: "v1", auth: clientForAccount(email) });
  }

  async list(opts: { pageToken?: string; pageSize?: number; query?: string; skip?: (externalId: string) => boolean; signal?: AbortSignal }): Promise<ListPage & { skipped: number; estimate?: number }> {
    const res = await throttled(() => this.gmail.users.messages.list({
      userId: "me",
      maxResults: opts.pageSize ?? 50,
      pageToken: opts.pageToken,
      q: opts.query,
      includeSpamTrash: false,
    }), opts.signal);
    const all = (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    // Les emails déjà connus ne sont pas relus : la liste coûte 5 unités, chaque lecture 20.
    const ids = opts.skip ? all.filter((id) => !opts.skip!(id)) : all;
    const items = await Promise.all(ids.map((id) => this.fetch(id, opts.signal)));
    return { items: items.filter((x): x is Item => x !== undefined), nextPageToken: res.data.nextPageToken ?? undefined, skipped: all.length - ids.length, estimate: res.data.resultSizeEstimate ?? undefined };
  }

  /** Tous les identifiants d'une requête, par pages de 500 : 5 unités par page, donc un comptage exact et bon marché. */
  async listIds(query: string, opts: { max?: number; signal?: AbortSignal; onPage?: (n: number) => void } = {}): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await throttled(() => this.gmail.users.messages.list({ userId: "me", maxResults: 500, pageToken, q: query || undefined, includeSpamTrash: false }), opts.signal);
      for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
      opts.onPage?.(ids.length);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < (opts.max ?? 50000));
    return ids;
  }

  /** Métadonnées seules (inventaire) : pas de corps, appel léger. */
  async listMetadata(opts: { pageToken?: string; pageSize?: number; query?: string }): Promise<{ rows: Array<{ id: string; from: string; subject: string; date: string; listUnsubscribe: boolean }>; nextPageToken?: string }> {
    const res = await throttled(() => this.gmail.users.messages.list({ userId: "me", maxResults: opts.pageSize ?? 100, pageToken: opts.pageToken, q: opts.query }));
    const ids = (res.data.messages ?? []).map((m) => m.id!);
    const rows = await Promise.all(
      ids.map(async (id) => {
        const m = await throttled(() => this.gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"] }));
        return { id, from: header(m.data, "From"), subject: header(m.data, "Subject"), date: header(m.data, "Date"), listUnsubscribe: header(m.data, "List-Unsubscribe") !== "" };
      }),
    );
    return { rows, nextPageToken: res.data.nextPageToken ?? undefined };
  }

  /** Un message ; undefined s'il a disparu entre-temps (brouillon remplacé, spam purgé, suppression). */
  async fetch(id: string, signal?: AbortSignal): Promise<Item | undefined> {
    let res;
    try { res = await throttled(() => this.gmail.users.messages.get({ userId: "me", id, format: "full" }), signal); }
    catch (err) { if (httpCode(err) === 404) return undefined; throw err; }
    const msg = res.data;
    if (!msg.payload) return undefined;
    const from = parseAddress(header(msg, "From"));
    const { text, hasAttachments } = extractText(msg.payload);
    const dateMs = Number(msg.internalDate ?? 0);
    return {
      externalId: id,
      threadId: msg.threadId ?? undefined,
      accountId: this.accountId,
      source: "gmail",
      fromName: from.name,
      fromAddress: from.address,
      to: splitAddresses(header(msg, "To")).map((s) => parseAddress(s).address).filter(Boolean),
      subject: header(msg, "Subject"),
      date: new Date(dateMs || Date.parse(header(msg, "Date")) || Date.now()),
      bodyExcerpt: excerpt(text || msg.snippet || "", this.bodyExcerptChars),
      hasAttachments,
      hasListUnsubscribe: header(msg, "List-Unsubscribe") !== "",
      isOutgoing: this.ownerEmails.includes(from.address) || (msg.labelIds ?? []).includes("SENT"),
      labels: msg.labelIds ?? [],
    };
  }

  private async loadLabels(): Promise<void> {
    if (this.labelCache.size > 0) return;
    const res = await throttled(() => this.gmail.users.labels.list({ userId: "me" }));
    for (const l of res.data.labels ?? []) if (l.name && l.id) this.labelCache.set(l.name, l.id);
  }
  /** Gmail ne distingue pas « AI/Ecole » de « AI/ecole » : on cherche le libellé existant sans tenir compte de la casse. */
  private labelId(name: string): string | undefined {
    const exact = this.labelCache.get(name);
    if (exact) return exact;
    const low = name.toLowerCase();
    for (const [n, id] of this.labelCache) if (n.toLowerCase() === low) return id;
    return undefined;
  }

  async ensureLabels(labels: Array<{ name: string; color?: { background: string; text: string } }>): Promise<Map<string, string>> {
    await this.loadLabels();
    const out = new Map<string, string>();
    for (const l of labels) {
      // Gmail crée les parents implicitement, mais on les crée explicitement pour qu'ils apparaissent proprement.
      const parent = l.name.includes("/") ? l.name.slice(0, l.name.lastIndexOf("/")) : undefined;
      if (parent && !this.labelId(parent)) await this.createLabel(parent);
      if (!this.labelId(l.name)) await this.createLabel(l.name, l.color);
      out.set(l.name, this.labelId(l.name)!);
    }
    return out;
  }

  /**
   * Renomme un libellé : Gmail déplace tous ses messages d'un coup, sans les toucher un par un.
   * Ne fait rien si l'ancien nom n'existe pas ; échoue si le nouveau existe déjà.
   */
  async renameLabel(from: string, to: string): Promise<boolean> {
    this.labelCache.clear();
    await this.loadLabels();
    const id = this.labelId(from);
    if (!id || from === to) return false;
    const existing = this.labelId(to);
    if (existing && existing !== id) throw new Error(t("gmail.labelExists", { name: to }));
    const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : undefined;
    if (parent && !this.labelId(parent)) await this.createLabel(parent);
    await throttled(() => this.gmail.users.labels.patch({ userId: "me", id, requestBody: { name: to } }));
    this.labelCache.delete(from);
    this.labelCache.set(to, id);
    return true;
  }

  /** Supprime tous les libellés de l'agent (préfixe AI/) : Gmail les retire de tous les messages. Les emails restent intacts. */
  async deleteAgentLabels(prefix: string): Promise<string[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    const mine = (res.data.labels ?? []).filter((l) => l.type === "user" && l.name && (l.name === prefix || l.name.startsWith(prefix + "/")));
    // Les enfants d'abord, le parent ensuite.
    mine.sort((a, b) => (b.name!.split("/").length - a.name!.split("/").length));
    const deleted: string[] = [];
    for (const l of mine) {
      await throttled(() => this.gmail.users.labels.delete({ userId: "me", id: l.id! }));
      deleted.push(l.name!);
    }
    this.labelCache.clear();
    return deleted;
  }

  private async createLabel(name: string, color?: { background: string; text: string }): Promise<void> {
    const res = await throttled(() => this.gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        color: color ? { backgroundColor: color.background, textColor: color.text } : undefined,
      },
    }));
    this.labelCache.set(name, res.data.id!);
  }

  /** `priority` : appel déclenché par un clic, il passe devant les passages de fond. */
  async applyLabels(externalId: string, add: string[], remove: string[], priority = false): Promise<void> {
    await this.loadLabels();
    const modify = () => {
      const toId = (n: string) => this.labelId(n) ?? n;
      return throttled(() => this.gmail.users.messages.modify({ userId: "me", id: externalId, requestBody: { addLabelIds: add.map(toId), removeLabelIds: remove.map(toId) } }), undefined, priority);
    };
    try { await modify(); }
    catch (err) {
      // Un libellé supprimé ou renommé dans Gmail pendant que l'app tourne : on relit la liste et on réessaie une fois.
      if (httpCode(err) !== 400 && httpCode(err) !== 404) throw err;
      this.labelCache.clear();
      await this.loadLabels();
      await modify();
    }
  }

  /**
   * Les mêmes libellés sur beaucoup d'emails, en un appel Gmail par tranche de 1 000 (validation par paquets).
   * Toujours prioritaire : c'est un clic, il passe devant les passages de fond. Un libellé à retirer qui n'existe pas est ignoré.
   */
  async batchModify(externalIds: string[], add: string[], remove: string[]): Promise<void> {
    await this.loadLabels();
    const addIds = add.map((n) => this.labelId(n) ?? n);
    const removeIds = remove.map((n) => this.labelId(n)).filter((x): x is string => !!x);
    for (let i = 0; i < externalIds.length; i += 1000) {
      const ids = externalIds.slice(i, i + 1000);
      await throttled(() => this.gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds: addIds, removeLabelIds: removeIds } }), undefined, true);
    }
  }

  /** Point de départ pour le suivi incrémental (users.history). */
  async currentHistoryId(): Promise<string> {
    const p = await throttled(() => this.gmail.users.getProfile({ userId: "me" }));
    return String(p.data.historyId);
  }

  /** Nouveaux messages depuis historyId. Renvoie aussi le nouvel historyId. */
  async newMessagesSince(historyId: string): Promise<{ ids: string[]; historyId: string }> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latest = historyId;
    do {
      let res;
      try { res = await throttled(() => this.gmail.users.history.list({ userId: "me", startHistoryId: historyId, historyTypes: ["messageAdded"], pageToken })); }
      catch (err) { if (httpCode(err) === 404) throw new HistoryExpiredError(); throw err; }
      for (const h of res.data.history ?? []) {
        for (const a of h.messagesAdded ?? []) if (a.message?.id) ids.add(a.message.id);
        if (h.id) latest = String(h.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (res.data.historyId) latest = String(res.data.historyId);
    } while (pageToken);
    return { ids: [...ids], historyId: latest };
  }

  /** Nombre total de messages dans la boîte (pour la progression). */
  async messagesTotal(): Promise<number> {
    const p = await throttled(() => this.gmail.users.getProfile({ userId: "me" }));
    return Number(p.data.messagesTotal ?? 0);
  }

  /** Le message complet, à la demande : texte, HTML, pièces jointes, en-têtes utiles pour répondre. */
  /**
   * Les brouillons de la boîte, les plus récents d'abord : en-têtes et extrait, lus chez Gmail à chaque ouverture de
   * l'onglet (ils changent sans cesse, Molinova ne les garde pas). Prioritaire : c'est un clic.
   */
  async listDrafts(max = 50): Promise<Array<{ id: string; messageId: string; threadId: string; to: string; cc: string; subject: string; date: string; snippet: string; hasAttachments: boolean }>> {
    const res = await throttled(() => this.gmail.users.drafts.list({ userId: "me", maxResults: max }), undefined, true);
    const out = await Promise.all((res.data.drafts ?? []).map(async (d) => {
      const g = await throttled(() => this.gmail.users.drafts.get({ userId: "me", id: d.id!, format: "metadata" }), undefined, true);
      const m = g.data.message ?? {};
      return {
        id: d.id!, messageId: m.id ?? "", threadId: m.threadId ?? "",
        to: header(m, "To"), cc: header(m, "Cc"), subject: header(m, "Subject"),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "",
        snippet: m.snippet ?? "",
        hasAttachments: (m.payload?.parts ?? []).some((p) => !!p.filename),
      };
    }));
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getFull(id: string): Promise<FullMessage> {
    const res = await throttled(() => this.gmail.users.messages.get({ userId: "me", id, format: "full" }));
    const msg = res.data;
    let text = "";
    let html = "";
    let calendar: string | undefined;
    let calendarAttachmentId: string | undefined;
    const attachments: FullMessage["attachments"] = [];
    const walk = (p: gmail_v1.Schema$MessagePart) => {
      if (p.filename && p.body?.attachmentId) attachments.push({ id: p.body.attachmentId, name: p.filename, mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0 });
      const isCal = (p.mimeType ?? "").startsWith("text/calendar") || (p.mimeType ?? "") === "application/ics" || /\.ics$/i.test(p.filename ?? "");
      if (isCal) { if (p.body?.data && !calendar) calendar = decodeBody(p.body.data, partType(p)); else if (p.body?.attachmentId && !calendarAttachmentId) calendarAttachmentId = p.body.attachmentId; }
      if (p.mimeType === "text/plain" && !text) text = decodeBody(p.body?.data, partType(p));
      else if (p.mimeType === "text/html" && !html) html = decodeBody(p.body?.data, partType(p));
      p.parts?.forEach(walk);
    };
    if (msg.payload) walk(msg.payload);
    return {
      id,
      calendar,
      calendarAttachmentId,
      threadId: msg.threadId ?? undefined,
      messageId: header(msg, "Message-ID"),
      references: header(msg, "References"),
      from: header(msg, "From"),
      to: header(msg, "To"),
      cc: header(msg, "Cc"),
      replyTo: header(msg, "Reply-To"),
      subject: header(msg, "Subject"),
      date: header(msg, "Date"),
      text,
      html,
      attachments,
      labels: msg.labelIds ?? [],
    };
  }

  /** Tous les messages d'un fil, du plus ancien au plus récent (envoyés compris). */
  async getThread(threadId: string): Promise<FullMessage[]> {
    const res = await throttled(() => this.gmail.users.threads.get({ userId: "me", id: threadId, format: "full" }));
    const out: FullMessage[] = [];
    for (const msg of res.data.messages ?? []) {
      let text = "";
      let html = "";
      const attachments: FullMessage["attachments"] = [];
      const walk = (p: gmail_v1.Schema$MessagePart) => {
        if (p.filename && p.body?.attachmentId) attachments.push({ id: p.body.attachmentId, name: p.filename, mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0 });
        if (p.mimeType === "text/plain" && !text) text = decodeBody(p.body?.data, partType(p));
        else if (p.mimeType === "text/html" && !html) html = decodeBody(p.body?.data, partType(p));
        p.parts?.forEach(walk);
      };
      if (msg.payload) walk(msg.payload);
      out.push({
        id: msg.id!, threadId, messageId: header(msg, "Message-ID"), references: header(msg, "References"), from: header(msg, "From"), to: header(msg, "To"), cc: header(msg, "Cc"),
        replyTo: header(msg, "Reply-To"), subject: header(msg, "Subject"), date: header(msg, "Date"), text, html, attachments, labels: msg.labelIds ?? [],
      });
    }
    return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  /** Qui a écrit en dernier dans le fil, et quand. Appel léger : ni corps ni en-têtes. */
  async threadState(threadId: string): Promise<{ lastFromMe: boolean; lastAt: Date; count: number }> {
    const res = await throttled(() => this.gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" }));
    const msgs = (res.data.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
    const last = msgs.reduce((a, b) => (Number(a.internalDate ?? 0) >= Number(b.internalDate ?? 0) ? a : b), msgs[0]);
    return { lastFromMe: (last?.labelIds ?? []).includes("SENT"), lastAt: new Date(Number(last?.internalDate ?? Date.now())), count: msgs.length };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const res = await throttled(() => this.gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId }));
    return Buffer.from(res.data.data ?? "", "base64url");
  }

  /** Envoie un email (réponse, transfert ou nouveau). Ne part que sur un clic explicite de l'utilisateur. */
  async send(m: OutgoingMessage): Promise<string> {
    const mime = buildMime(m);
    // Gros message (pièces jointes) : par l'upload de Gmail ; sinon dans le corps, comme toujours.
    const res = mime.length > UPLOAD_ABOVE
      ? await this.gmail.users.messages.send({ userId: "me", requestBody: { threadId: m.threadId }, media: { mimeType: "message/rfc822", body: mime } })
      : await this.gmail.users.messages.send({ userId: "me", requestBody: { raw: Buffer.from(mime).toString("base64url"), threadId: m.threadId } });
    return res.data.id!;
  }
  async saveDraft(m: OutgoingMessage): Promise<string> {
    const mime = buildMime(m);
    const res = mime.length > UPLOAD_ABOVE
      ? await this.gmail.users.drafts.create({ userId: "me", requestBody: { message: { threadId: m.threadId } }, media: { mimeType: "message/rfc822", body: mime } })
      : await this.gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: Buffer.from(mime).toString("base64url"), threadId: m.threadId } } });
    return res.data.id!;
  }

  /** Archiver = retirer de la boîte de réception. Rien n'est supprimé. */
  async archive(id: string): Promise<void> {
    await this.applyLabels(id, [], ["INBOX"]);
  }
  async markRead(id: string, read: boolean): Promise<void> {
    await this.applyLabels(id, read ? [] : ["UNREAD"], read ? ["UNREAD"] : []);
  }
  /** Le fil d'un message, en un appel léger. */
  async threadOf(id: string): Promise<string | undefined> {
    try { return (await throttled(() => this.gmail.users.messages.get({ userId: "me", id, format: "minimal" }))).data.threadId ?? undefined; }
    catch (err) { if (httpCode(err) === 404) return undefined; throw err; }
  }
  /** Libellés actuels d'un message (lu, boîte de réception…), en un appel léger. */
  async labelsOf(id: string): Promise<string[]> {
    const res = await throttled(() => this.gmail.users.messages.get({ userId: "me", id, format: "minimal" }));
    return res.data.labelIds ?? [];
  }

  /** Extraits des derniers emails envoyés, pour apprendre le style de rédaction. */
  async recentSentExcerpts(n: number): Promise<Array<{ id: string; text: string }>> {
    const res = await throttled(() => this.gmail.users.messages.list({ userId: "me", maxResults: n, q: "in:sent -filename:ics" }));
    const out: Array<{ id: string; text: string }> = [];
    for (const m of res.data.messages ?? []) {
      const full = await this.getFull(m.id!);
      const body = excerpt(full.text || htmlToText(full.html), 1200);
      if (body.length > 80) out.push({ id: m.id!, text: `Objet : ${full.subject}\n${body}` });
    }
    return out;
  }

  async createDraft(to: string, subject: string, body: string, threadId?: string): Promise<string> {
    const raw = Buffer.from(
      [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "MIME-Version: 1.0", "", body].join("\r\n"),
    ).toString("base64url");
    const res = await this.gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId } } });
    return res.data.id!;
  }

  get address(): string {
    return this.email;
  }
  static domain(item: Item): string {
    return domainOf(item.fromAddress);
  }
}
