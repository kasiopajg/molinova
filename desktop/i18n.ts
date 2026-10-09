// Textes du processus principal (menu de la barre, menus natifs, notifications, page d'attente) en fr / en / es.
// La langue suit le réglage de Molinova (HOME/config/settings.json), sinon celle du système.
import fs from "node:fs";
import path from "node:path";

const en = {
  starting: "Starting Molinova…",
  startFailed: "Molinova could not start its local server.",
  seeLogs: "Details in {file}",
  watching: { one: "Watching {n} Gmail account", other: "Watching {n} Gmail accounts" },
  notWatching: "Gmail is not being watched",
  actions: { zero: "No action waiting", one: "{n} action waiting", other: "{n} actions waiting" },
  setupPending: "Setup not finished",
  waLast: "WhatsApp read {when}",
  waNever: "WhatsApp: not read yet",
  waError: "WhatsApp: {error}",
  tgRunning: "Telegram bot running",
  tgStopped: "Telegram bot stopped",
  reconnect: "Reconnect {email}",
  updateAvailable: "Update available: v{version} → open release page",
  updateTitle: "Molinova {version} is available",
  updateBody: "Click to download the new version.",
  serverStopped: "Server stopped after repeated crashes",
  serverStarting: "Server starting…",
  open: "Open Molinova",
  keepAwake: "Keep awake while plugged in",
  restartServer: "Restart server",
  quit: "Quit Molinova",
  settings: "Settings…",
  view: "View",
  crashTitle: "Molinova stopped working",
  crashBody: "The local server crashed several times. Use “Restart server” in the menu bar.",
  tokenTitle: "Gmail needs you",
  tokenBody: "Reconnect {email} in Molinova to keep sorting its emails.",
  justNow: "just now",
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} h ago",
  daysAgo: "{n} d ago",
  missingBinding: "The SQLite binary for Electron is missing. Run “pnpm native:electron”, then start again.",
  secretsTitle: "Molinova cannot save your keys",
  secretsUnavailable: "Keychain access refused: keys are not saved",
  secretsUnreadable: "Saved keys cannot be read (secrets.bin)",
  secretsNotSaved: "{name} could not be saved in the Keychain: it will be lost when Molinova restarts.",
  secretsRetryDetail: "Molinova stores your keys encrypted with the macOS Keychain (item “Molinova Safe Storage”). Retry and choose “Always Allow” when macOS asks. If nothing is asked, quit and reopen Molinova.",
  secretsResetDetail: "{file} can no longer be decrypted (the Keychain key changed). Resetting renames it to secrets.bin.bad; you will then enter the AI key, the Google client and the Telegram token again.",
  secretsReset: "Reset saved keys",
  retry: "Retry",
  cancel: "Cancel",
};
type Dict = typeof en;

const fr: Dict = {
  starting: "Démarrage de Molinova…",
  startFailed: "Molinova n'a pas pu démarrer son serveur local.",
  seeLogs: "Détails dans {file}",
  watching: { one: "{n} compte Gmail surveillé", other: "{n} comptes Gmail surveillés" },
  notWatching: "Gmail n'est pas surveillé",
  actions: { zero: "Aucune action en attente", one: "{n} action en attente", other: "{n} actions en attente" },
  setupPending: "Installation à terminer",
  waLast: "WhatsApp lu {when}",
  waNever: "WhatsApp : pas encore lu",
  waError: "WhatsApp : {error}",
  tgRunning: "Bot Telegram actif",
  tgStopped: "Bot Telegram arrêté",
  reconnect: "Reconnecter {email}",
  updateAvailable: "Mise à jour disponible : v{version} → ouvrir la page",
  updateTitle: "Molinova {version} est disponible",
  updateBody: "Cliquez pour télécharger la nouvelle version.",
  serverStopped: "Serveur arrêté après plusieurs pannes",
  serverStarting: "Démarrage du serveur…",
  open: "Ouvrir Molinova",
  keepAwake: "Rester éveillé sur secteur",
  restartServer: "Redémarrer le serveur",
  quit: "Quitter Molinova",
  settings: "Réglages…",
  view: "Présentation",
  crashTitle: "Molinova s'est arrêté",
  crashBody: "Le serveur local a planté plusieurs fois. Utilisez « Redémarrer le serveur » dans la barre des menus.",
  tokenTitle: "Gmail a besoin de vous",
  tokenBody: "Reconnectez {email} dans Molinova pour continuer à trier ses e-mails.",
  justNow: "à l'instant",
  minutesAgo: "il y a {n} min",
  hoursAgo: "il y a {n} h",
  daysAgo: "il y a {n} j",
  missingBinding: "Le binaire SQLite pour Electron manque. Lancez « pnpm native:electron », puis relancez.",
  secretsTitle: "Molinova ne peut pas enregistrer vos clés",
  secretsUnavailable: "Accès au trousseau refusé : les clés ne sont pas enregistrées",
  secretsUnreadable: "Clés enregistrées illisibles (secrets.bin)",
  secretsNotSaved: "{name} n'a pas pu être rangé dans le trousseau : il sera perdu au redémarrage de Molinova.",
  secretsRetryDetail: "Molinova chiffre vos clés avec le trousseau macOS (élément « Molinova Safe Storage »). Réessayez et choisissez « Toujours autoriser » quand macOS le demande. Sans demande, quittez puis rouvrez Molinova.",
  secretsResetDetail: "{file} ne se déchiffre plus (la clé du trousseau a changé). Réinitialiser le renomme en secrets.bin.bad ; il faudra ensuite saisir à nouveau la clé IA, le client Google et le jeton Telegram.",
  secretsReset: "Réinitialiser les clés",
  retry: "Réessayer",
  cancel: "Annuler",
};

const es: Dict = {
  starting: "Iniciando Molinova…",
  startFailed: "Molinova no pudo iniciar su servidor local.",
  seeLogs: "Detalles en {file}",
  watching: { one: "{n} cuenta de Gmail vigilada", other: "{n} cuentas de Gmail vigiladas" },
  notWatching: "Gmail no está vigilado",
  actions: { zero: "Ninguna acción pendiente", one: "{n} acción pendiente", other: "{n} acciones pendientes" },
  setupPending: "Instalación sin terminar",
  waLast: "WhatsApp leído {when}",
  waNever: "WhatsApp: aún no leído",
  waError: "WhatsApp: {error}",
  tgRunning: "Bot de Telegram activo",
  tgStopped: "Bot de Telegram detenido",
  reconnect: "Reconectar {email}",
  updateAvailable: "Actualización disponible: v{version} → abrir la página",
  updateTitle: "Molinova {version} está disponible",
  updateBody: "Haz clic para descargar la nueva versión.",
  serverStopped: "Servidor detenido tras varios fallos",
  serverStarting: "Iniciando el servidor…",
  open: "Abrir Molinova",
  keepAwake: "Mantener despierto con corriente",
  restartServer: "Reiniciar el servidor",
  quit: "Salir de Molinova",
  settings: "Ajustes…",
  view: "Visualización",
  crashTitle: "Molinova dejó de funcionar",
  crashBody: "El servidor local falló varias veces. Usa «Reiniciar el servidor» en la barra de menús.",
  tokenTitle: "Gmail te necesita",
  tokenBody: "Vuelve a conectar {email} en Molinova para seguir clasificando sus correos.",
  justNow: "ahora mismo",
  minutesAgo: "hace {n} min",
  hoursAgo: "hace {n} h",
  daysAgo: "hace {n} d",
  missingBinding: "Falta el binario SQLite para Electron. Ejecuta «pnpm native:electron» y vuelve a iniciar.",
  secretsTitle: "Molinova no puede guardar tus claves",
  secretsUnavailable: "Acceso al llavero denegado: las claves no se guardan",
  secretsUnreadable: "Claves guardadas ilegibles (secrets.bin)",
  secretsNotSaved: "{name} no se pudo guardar en el llavero: se perderá al reiniciar Molinova.",
  secretsRetryDetail: "Molinova cifra tus claves con el llavero de macOS (elemento «Molinova Safe Storage»). Reintenta y elige «Permitir siempre» cuando macOS lo pida. Si no pide nada, sal de Molinova y vuelve a abrirlo.",
  secretsResetDetail: "{file} ya no se puede descifrar (la clave del llavero cambió). Restablecer lo renombra a secrets.bin.bad; luego tendrás que volver a introducir la clave de IA, el cliente de Google y el token de Telegram.",
  secretsReset: "Restablecer las claves",
  retry: "Reintentar",
  cancel: "Cancelar",
};

const DICTS = { en, fr, es } as const;
export type Lang = keyof typeof DICTS;
type Key = keyof Dict;
type Plural = { zero?: string; one: string; other: string };

let lang: Lang = "en";

/** Langue du réglage de Molinova si le fichier existe, sinon la première langue du système que Molinova parle. */
export function detectLanguage(home: string, systemLanguages: string[]): Lang {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, "config", "settings.json"), "utf8")) as { language?: string };
    if (raw.language && raw.language in DICTS) return (lang = raw.language as Lang);
  } catch { /* pas encore de réglages : langue du système */ }
  for (const l of systemLanguages) {
    const base = l.toLowerCase().split("-")[0];
    if (base in DICTS) return (lang = base as Lang);
  }
  return (lang = "en");
}

export function currentLang(): Lang { return lang; }

/** Texte traduit ; {param} remplacés ; une entrée plurielle choisit sa forme avec `n`. */
export function tr(key: Key, params: Record<string, string | number> = {}): string {
  const entry = DICTS[lang][key] as string | Plural;
  let text: string;
  if (typeof entry === "string") text = entry;
  else {
    const n = Number(params.n ?? 0);
    text = (n === 0 && entry.zero) || (n === 1 ? entry.one : entry.other);
  }
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** « il y a 5 min » depuis une date ISO. */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (!Number.isFinite(min)) return iso;
  if (min < 1) return tr("justNow");
  if (min < 60) return tr("minutesAgo", { n: min });
  if (min < 48 * 60) return tr("hoursAgo", { n: Math.round(min / 60) });
  return tr("daysAgo", { n: Math.round(min / 1440) });
}
