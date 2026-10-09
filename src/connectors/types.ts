/**
 * Un « élément » est la forme commune de tout ce qui entre dans l'agent :
 * un email aujourd'hui, un message ou un fichier demain. Le classement ne
 * connaît que cette forme, jamais la source.
 */
export interface Item {
  /** Identifiant stable côté source (id Gmail par exemple). */
  externalId: string;
  threadId?: string;
  accountId: number;
  source: "gmail" | "whatsapp";
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  date: Date;
  /** Texte utile, déjà nettoyé : sans historique cité ni signature, tronqué. */
  bodyExcerpt: string;
  hasAttachments: boolean;
  hasListUnsubscribe: boolean;
  /** Vrai si l'élément a été envoyé par le propriétaire (utile pour « relancer »). */
  isOutgoing: boolean;
  /** Libellés déjà présents côté source. */
  labels: string[];
}

export interface ListPage {
  items: Item[];
  nextPageToken?: string;
}

export interface Connector {
  readonly source: Item["source"];
  /** Parcourt l'historique du plus récent au plus ancien, page par page. */
  list(opts: { pageToken?: string; pageSize?: number; query?: string; skip?: (externalId: string) => boolean; signal?: AbortSignal }): Promise<ListPage>;
  /** Crée les libellés manquants et renvoie leur identifiant côté source. */
  ensureLabels(labels: Array<{ name: string; color?: { background: string; text: string } }>): Promise<Map<string, string>>;
  applyLabels(externalId: string, add: string[], remove: string[]): Promise<void>;
}
