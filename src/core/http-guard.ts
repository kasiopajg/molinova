import crypto from "node:crypto";

/**
 * Le serveur local n'écoute que 127.0.0.1, mais d'autres que l'interface peuvent quand même lui parler :
 * un autre compte du Mac ou une autre app (curl suffit), une page web ouverte dans le navigateur (requête « simple »
 * sans preflight, balise <img>), un domaine rebindé (DNS rebinding). On n'accepte donc que :
 * - un en-tête Host qui nomme ce serveur (127.0.0.1 ou localhost, bon port) : un domaine rebindé est refusé ;
 * - pour /api/ : la clé de session (cookie posé par /?molinova_key=…, ou en-tête X-Molinova-Key pour le processus principal),
 *   et, si le navigateur le dit (Sec-Fetch-Site), une requête venue de l'interface elle-même ;
 * - pour toute écriture, un corps JSON déclaré (une page tierce ne peut l'envoyer sans preflight, que ce serveur ne satisfait pas)
 *   et, si le navigateur en donne une, une origine égale à celle de l'interface.
 * Les fichiers de l'interface (code public) restent servis sans clé ; index.html montre alors une page « verrouillée ».
 */
export interface RequestInfo {
  method: string;
  path: string;
  host?: string;
  origin?: string;
  contentType?: string;
  /** En-tête Sec-Fetch-Site (absent hors navigateur). */
  fetchSite?: string;
  cookie?: string;
  /** En-tête X-Molinova-Key. */
  keyHeader?: string;
}
export type GuardReason = "host" | "site" | "session" | "origin" | "content-type";
export type GuardResult = { ok: true } | { ok: false; reason: GuardReason };

/** Paramètre d'URL qui échange la clé contre le cookie de session. */
export const KEY_PARAM = "molinova_key";

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** Un cookie par port : les cookies ne distinguent pas les ports, deux serveurs Molinova ne doivent pas s'écraser. */
export function cookieName(port: number): string {
  return `molinova_${port}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Comparaison en temps constant : la durée de la réponse ne dit rien de la clé. */
export function sameKey(given: string | undefined, key: string): boolean {
  if (!given || !key) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

export function hasSession(r: Pick<RequestInfo, "cookie" | "keyHeader">, port: number, key: string): boolean {
  return sameKey(readCookie(r.cookie, cookieName(port)), key) || sameKey(r.keyHeader, key);
}

export function checkRequest(r: RequestInfo, port: number, key: string): GuardResult {
  const hosts = allowedHosts(port);
  if (!r.host || !hosts.includes(r.host.toLowerCase())) return { ok: false, reason: "host" };
  if (!r.path.startsWith("/api/")) return { ok: true };
  // same-origin : l'interface ; none : le processus principal ou une adresse tapée. Un autre site, même sur 127.0.0.1:autre port, est refusé.
  if (r.fetchSite && r.fetchSite !== "same-origin" && r.fetchSite !== "none") return { ok: false, reason: "site" };
  if (!hasSession(r, port, key)) return { ok: false, reason: "session" };
  const method = r.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true };
  if (r.origin && !hosts.some((h) => r.origin!.toLowerCase() === `http://${h}`)) return { ok: false, reason: "origin" };
  if (!/^application\/json\b/i.test(r.contentType ?? "")) return { ok: false, reason: "content-type" };
  return { ok: true };
}

/** En-tête Set-Cookie de la session : invisible du JavaScript, jamais envoyé par un autre site. */
export function sessionCookie(port: number, key: string, persistent: boolean): string {
  return `${cookieName(port)}=${key}; Path=/; HttpOnly; SameSite=Strict${persistent ? "; Max-Age=31536000" : ""}`;
}
