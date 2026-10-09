import type { Db } from "../db.js";
import { cachedProposal, isPast, markPast, STATE_PAST } from "./proposals.js";

/**
 * Les messages à durée de vie courte : un code ou un lien à usage unique (« ton code Facebook est 1234 », « vérifie
 * ton nouvel appareil », « confirme ton adresse »), ou une alerte de connexion (« nouvelle connexion », « mot de
 * passe modifié »). Ils ne demandent une action que dans les minutes qui suivent leur arrivée ; après, ils sortent
 * seuls de la file Actions (état « dépassé », jamais supprimés).
 *
 * Jev le dit pour chaque nouvel email (question `ephemeral`, drapeau `ephemeral`). Pour l'existant, et en filet de
 * sécurité, une détection par mots-clés en trois langues, volontairement étroite : une confirmation de commande ou
 * une demande de justificatifs (KYC) n'est pas éphémère.
 */
export type Ephemeral = "code" | "signin";
/** Fenêtre pendant laquelle ils restent dans Actions : 30 minutes, codes comme alertes. */
export const EPHEMERAL_MINUTES = 30;

const CODE = [
  /\b(verification|security|login|log-in|sign[- ]?in|one[- ]time|confirmation|access|authentication|2fa)\s+code\b/i,
  /\bcode\s+(de\s+)?(v[ée]rification|confirmation|connexion|s[ée]curit[ée]|validation|acc[eè]s)\b/i,
  /\bc[oó]digo\s+(de\s+)?(verificaci[oó]n|seguridad|acceso|confirmaci[oó]n|inicio de sesi[oó]n)\b/i,
  // « 123456 is your Facebook code », « Ton code Facebook est 1234 » : la valeur du code doit être là.
  /\b\d{4,8}\s+(is|est|es)\s+(your|votre|ton|tu)\s+(\S+\s+){0,3}(code|c[oó]digo)\b/i,
  /\b(your|votre|ton|tu)\s+(\S+\s+){0,2}(code|c[oó]digo)(\s+\S+){0,2}\s+(is|est|es)\s*:?\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,10}\b/i,
  /\b(otp|one-time password|mot de passe a usage unique|passcode)\b/i,
  // « here's your PIN 445882 », « voici ton code », « your PIN is » : un PIN est un code.
  /\b(here'?s|here is|voici|aqui (esta|tienes))\s+(your|votre|ton|tu)\s+(\S+\s+){0,2}(pin|code|codigo)\b/i,
  /\b(your|votre|ton|tu)\s+pin\b/i,
  /\bverify\s+(your\s+)?(new\s+)?(device|e-?mail|email address|account|login|sign-?in|identity)\b/i,
  /\bconfirm\s+(your\s+)?(e-?mail|email address|sign[- ]?up|account|login|sign[- ]?in|identity)\b/i,
  /\bconfirme[rz]?\s+(votre|ton|ta)\s+(adresse|e-?mail|inscription|connexion|identit[ée]|compte)\b/i,
  // « Vérifiez votre compte », « vérifie ton adresse », « verifica tu cuenta » (le texte est sans accents à ce stade).
  /\bverifie[rz]?\s+(votre|ton|ta)\s+(nouvel\s+)?(compte|adresse|e-?mail|identite|appareil|connexion)\b/i,
  /\bverifica\s+(tu\s+)?(nuevo\s+)?(cuenta|correo|direccion|identidad|dispositivo)\b/i,
  /\bconfirma\s+(tu\s+)?(correo|direcci[oó]n|cuenta|registro)\b/i,
  /\b(e-?mail|email address)\s+verification\b/i,
  /\bv[ée]rification\s+(de\s+(votre|ton|l')\s*)?(adresse\s+)?e-?mail\b/i,
  /\b(magic link|sign-?in link|login link|lien de connexion|enlace de (acceso|inicio de sesi[oó]n))\b/i,
  // Lien de réinitialisation du mot de passe : valable quelques minutes, comme un code.
  /\b(reset|change)\s+your\s+password\b|\bpassword\s+reset\s+(link|request|code)\b|\blink to reset\b/i,
  /\breinitialise[rz]?\s+(votre|ton)\s+mot de passe\b|\brestablece[r]?\s+(tu\s+)?contrasena\b/i,
];
const SIGNIN = [
  /\b(security alert|alerte de s[ée]curit[ée]|alerta de seguridad)\b/i,
  /\bnew\s+(sign-?in|login|device sign-?in)\b|\bnouvelle\s+connexion\b|\bnuev[oa]\s+(inicio de sesi[oó]n|acceso)\b/i,
  /\bpassword\s+(was\s+|has been\s+)?(\w+\s+)?(changed|reset|updated)\b|\bmot de passe\s+(a été\s+)?(modifi[ée]|r[ée]initialis[ée]|chang[ée])\b|\bcontrase[nñ]a\s+(ha sido\s+)?(cambiada|restablecida)\b/i,
  /\b(suspicious|unusual)\s+(activity|sign-?in|login)\b|\bactivit[ée]\s+(suspecte|inhabituelle)\b|\bactividad\s+(sospechosa|inusual)\b/i,
  /\b(sign-?in|login)\s+(attempt|alert)\b|\btentative de connexion\b|\bintento de inicio de sesi[oó]n\b/i,
  /\bcreate a new password\b/i,
];

/** Pour les tests et le diagnostic d'un faux positif : quel motif a reconnu quoi. */
export const EPHEMERAL_PATTERNS = { code: CODE, signin: SIGNIN };
/** Sans accents : `\b` de JavaScript ne voit pas « é » comme une lettre (« sécurité » ne finirait jamais un mot). */
const plain = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Le texte lu, sans les adresses web : un lien de suivi (« …&otp=… ») ne dit rien du message. */
const prose = (x: string) => plain(x).replace(/\b(https?:\/\/|www\.)\S+/gi, " ");
/** La détection par mots-clés : sur l'objet d'abord, puis le début du corps. null : pas éphémère. */
export function ephemeralByText(subject: string | null, body?: string | null): Ephemeral | null {
  const s = plain(subject ?? "");
  if (SIGNIN.some((r) => r.test(s))) return "signin";
  if (CODE.some((r) => r.test(s))) return "code";
  // Tout l'extrait gardé (1 500 caractères) : la phrase utile arrive souvent après un en-tête (« Vous y êtes presque »).
  const b = prose((body ?? "").slice(0, 2000));
  if (SIGNIN.some((r) => r.test(b))) return "signin";
  if (CODE.some((r) => r.test(b))) return "code";
  return null;
}

/** Le genre retenu : la réponse de Jev si elle en donne un, sinon les mots-clés. */
export function ephemeralKind(flags: { ephemeral?: unknown }, subject: string | null, body?: string | null): Ephemeral | null {
  if (flags.ephemeral === "code" || flags.ephemeral === "signin") return flags.ephemeral;
  return ephemeralByText(subject, body);
}

const ymdLocal = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const ageMinutes = (dateIso: string, now = new Date()): number => (now.getTime() - Date.parse(dateIso)) / 60_000;

export interface SweepResult { codes: number; signins: number; past: number }
/**
 * Le nettoyage de la file Actions, sans IA : les messages éphémères dont la fenêtre est passée, et les événements ou
 * tâches dont la date est passée, passent en « dépassé » (état 3). Rien n'est supprimé, ni dans Molinova ni dans Gmail ;
 * le filtre « Dépassé » de la Boîte les montre. Rapide (une requête, quelques centaines de lignes) : appelé chaque minute.
 */
export function sweepQueue(db: Db, now = new Date(), minutes = EPHEMERAL_MINUTES): SweepResult {
  const res: SweepResult = { codes: 0, signins: 0, past: 0 };
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
  // Emails reçus (pas WhatsApp, pas mes envois) encore ouverts et plus vieux que la fenêtre. `i.date` est en ISO.
  const rows = db.prepare(`SELECT d.item_id id, i.subject, i.body_excerpt body, d.flags_json flags FROM decisions d JOIN items i ON i.id = d.item_id
    JOIN accounts a ON a.id = i.account_id WHERE d.action_state = 0 AND a.source = 'gmail' AND COALESCE(i.is_outgoing, 0) = 0 AND i.date < ?`).all(cutoff) as Array<{ id: number; subject: string | null; body: string | null; flags: string | null }>;
  const upd = db.prepare("UPDATE decisions SET action_state = ?, flags_json = ? WHERE item_id = ? AND action_state = 0");
  db.transaction(() => {
    for (const r of rows) {
      let flags: Record<string, unknown> = {};
      try { flags = r.flags ? JSON.parse(r.flags) : {}; } catch { /* drapeaux abîmés : on lit quand même l'objet */ }
      const kind = ephemeralKind(flags, r.subject, r.body);
      if (!kind) continue;
      // Le genre reste noté : l'interface et Telegram le savent sans refaire la détection.
      upd.run(STATE_PAST, JSON.stringify({ ...flags, ephemeral: kind }), r.id);
      kind === "code" ? res.codes++ : res.signins++;
    }
  })();
  // Événements et tâches proposés dont la date est passée (jusqu'ici, vérifié seulement au classement).
  const proposals = db.prepare(`SELECT d.item_id id, i.date FROM decisions d JOIN items i ON i.id = d.item_id WHERE d.action_state = 0
    AND (COALESCE(json_extract(d.flags_json, '$.event'), 0) = 1 OR COALESCE(json_extract(d.flags_json, '$.task'), 0) = 1)`).all() as Array<{ id: number; date: string }>;
  const today = ymdLocal(now);
  for (const p of proposals) {
    const prop = cachedProposal(db, p.id);
    if (!prop) continue;
    // Rien de daté n'a été trouvé (« pour le match de demain, polo bleu ») : valable le jour du message, obsolète ensuite.
    const undated = prop.kind !== "invitation" && (prop as { found?: boolean }).found === false;
    if (undated ? ymdLocal(new Date(p.date)) < today : isPast(prop, now)) { markPast(db, p.id); res.past++; }
  }
  return res;
}

export interface SigninAlert { id: number; from: string; subject: string; date: string }
/** Les alertes de connexion encore fraîches (dans la fenêtre) : Telegram les envoie tout de suite, jamais après. */
export function freshSigninAlerts(db: Db, now = new Date(), minutes = EPHEMERAL_MINUTES): SigninAlert[] {
  const since = new Date(now.getTime() - minutes * 60_000).toISOString();
  const rows = db.prepare(`SELECT i.id, COALESCE(i.from_name, i.from_address) "from", i.subject, i.body_excerpt body, i.date, d.flags_json flags FROM decisions d JOIN items i ON i.id = d.item_id
    JOIN accounts a ON a.id = i.account_id WHERE d.action_state = 0 AND a.source = 'gmail' AND COALESCE(i.is_outgoing, 0) = 0 AND i.date >= ?`).all(since) as Array<{ id: number; from: string; subject: string | null; body: string | null; date: string; flags: string | null }>;
  return rows.filter((r) => { let f: Record<string, unknown> = {}; try { f = r.flags ? JSON.parse(r.flags) : {}; } catch { /* idem */ } return ephemeralKind(f, r.subject, r.body) === "signin"; })
    .map((r) => ({ id: r.id, from: r.from, subject: r.subject ?? "", date: r.date }));
}
