/**
 * Les mots que le coordinateur reconnaît quand on lui dit pour qui est une chose, ou qu'il affirme l'avoir faite.
 * Une langue à la fois, jamais l'union : « on » en anglais (« on Monday ») n'est pas le « on » français.
 * Les textes sont comparés sans accents ni majuscules (voir strip() dans brain.ts) : écrire ici sans accents.
 */
import type { Language } from "./index.js";

export interface WhoWords {
  /** L'autre adulte du foyer : « mon mari », « my wife ». */
  spouse: RegExp;
  /** Toute la famille : « nous », « les enfants ». */
  family: RegExp;
  /** La personne qui parle : « moi », « je », « mon rendez-vous ». */
  self: RegExp;
  /** Personne n'accompagne : « personne », « seul », « nobody ». */
  nobody: RegExp;
}

export const WHO: Record<Language, WhoWords> = {
  fr: {
    spouse: / (mon mari|ma femme|mon epoux|mon epouse|ma conjointe|mon conjoint|mon copain|ma copine|mon partenaire|ma partenaire) /,
    // « tous » seul est exclu : « tous les lundis » parle du rythme, pas de la famille.
    family: / (nous|on|notre|nos|la famille|famille|tous ensemble|tout le monde|les enfants|enfants) /,
    self: / (moi|je|j|me|mon|ma|mes|pour moi) /,
    nobody: / (personne|seul|seule|seuls|sans nous|sans adulte|pas besoin|aucun) /,
  },
  en: {
    spouse: / (my husband|my wife|my spouse|my partner|my boyfriend|my girlfriend) /,
    family: / (we|us|our|the family|family|all of us|everyone|everybody|the kids|the children|kids|children|all together) /,
    self: / (me|i|my|mine|myself|for me) /,
    nobody: / (nobody|no one|noone|alone|by himself|by herself|on his own|on her own|without us|no adult|no need) /,
  },
  es: {
    spouse: / (mi marido|mi mujer|mi esposo|mi esposa|mi pareja|mi novio|mi novia|mi companero|mi companera) /,
    family: / (nosotros|nosotras|nuestro|nuestra|nuestros|nuestras|la familia|familia|todos juntos|todo el mundo|los ninos|las ninas|los hijos|ninos) /,
    self: / (yo|me|mi|mis|mio|mia|para mi|conmigo) /,
    nobody: / (nadie|solo|sola|solos|solas|sin nosotros|sin adulto|no hace falta|ninguno|ninguna) /,
  },
};

/** Le modèle affirme avoir fait quelque chose (« c'est fait », « I've added ») : à confronter aux outils réellement appelés. */
export const CLAIMS_DONE: Record<Language, RegExp> = {
  fr: /\b(c'est (fait|noté|ajouté|créé|enregistré|prêt)|j'ai (ajouté|créé|noté|enregistré|préparé|mis)|(est|sont) (ajouté|créé|enregistré|noté|prêt)|ajoutée?s? (à|dans) (l'agenda|la liste|ton agenda)|prêt à (confirmer|être confirmé))\b/i,
  en: /\b(it's (done|added|created|saved|noted|ready)|(i've|i have|i) (added|created|saved|noted|prepared|put|set up)|(is|are|has been|have been) (added|created|saved|noted|ready)|added to (the|your) (calendar|list)|ready (to|for) confirm(ation)?)\b/i,
  es: /\b(ya esta (hecho|anotado|anadido|añadido|creado|guardado|listo)|(he|lo he|la he) (anadido|añadido|creado|anotado|guardado|preparado|puesto)|(esta|estan|está|están) (anadido|añadido|creado|guardado|anotado|listo)|(anadido|añadido)s? (a|en) (la agenda|el calendario|la lista|tu agenda)|listo para confirmar)\b/i,
};
