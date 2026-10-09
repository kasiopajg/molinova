import { afterEach, describe, expect, it } from "vitest";
import { fr } from "./fr.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { capitalize, currentLanguage, fmtDayLong, fmtDayShort, fmtWeekday, fmtWeekdayDay, languageName, setLanguage, t, tn } from "./index.js";
import { CLAIMS_DONE, WHO } from "./words.js";

afterEach(() => setLanguage("fr"));

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("dictionnaires", () => {
  it("anglais et espagnol ont exactement les clés du français, sans valeur vide", () => {
    const keys = Object.keys(fr).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(es).sort()).toEqual(keys);
    for (const k of keys) { expect((en as Record<string, string>)[k], `en ${k}`).not.toBe(""); expect((es as Record<string, string>)[k], `es ${k}`).not.toBe(""); }
  });
  it("chaque clé garde les mêmes {paramètres} dans les trois langues", () => {
    for (const k of Object.keys(fr) as Array<keyof typeof fr>) {
      expect(params(en[k]), `en ${k}`).toBe(params(fr[k]));
      expect(params(es[k]), `es ${k}`).toBe(params(fr[k]));
    }
  });
  it("une forme .one a toujours sa forme .other", () => {
    for (const k of Object.keys(fr)) if (k.endsWith(".one")) expect(fr, k).toHaveProperty(k.replace(/\.one$/, ".other"));
  });
  it("aucune clé ne se répète entre core et errors", () => {
    // Un doublon serait écrasé silencieusement par le spread : on le détecte par le nombre de clés.
    expect(new Set(Object.keys(fr)).size).toBe(Object.keys(fr).length);
  });
});

describe("t, tn, langues", () => {
  it("interpole, retombe sur le français, et suit la langue posée", () => {
    setLanguage("fr");
    expect(currentLanguage()).toBe("fr");
    expect(t("tool.taskAddedReply", { id: 7 })).toBe("Tâche #7 ajoutée.");
    setLanguage("en");
    expect(t("tool.taskAddedReply", { id: 7 })).toBe("Task #7 added.");
    expect(t("tool.taskAddedReply", { id: 7 }, "es")).toBe("Tarea #7 añadida.");
    expect(languageName("en", "fr")).toBe("anglais");
    expect(languageName("fr", "en")).toBe("French");
  });
  it("choisit le pluriel selon la langue : 0 est singulier en français, pluriel en anglais", () => {
    expect(tn("week.toCal", 1)).toBe("1 proposition encore à caler dans l'app.");
    expect(tn("week.toCal", 2)).toBe("2 propositions encore à caler dans l'app.");
    expect(tn("week.toCal", 0)).toBe("0 proposition encore à caler dans l'app.");
    expect(tn("week.toCal", 0, undefined, "en")).toBe("0 proposals still to schedule in the app.");
    expect(tn("week.toCal", 1, undefined, "es")).toBe("1 propuesta pendiente de agendar en la app.");
  });
});

describe("dates Intl", () => {
  const d = new Date(2026, 8, 24); // jeudi 24 septembre 2026
  it("écrit les jours et les mois dans la langue, sans tableau en dur", () => {
    expect(fmtDayLong(d)).toBe("jeudi 24 sept.");
    expect(fmtDayLong(d, { lang: "en" })).toBe("Thursday 24 Sept");
    expect(fmtDayLong(d, { lang: "es" })).toBe("jueves, 24 sept");
    expect(fmtDayShort("2026-09-20")).toBe("20 sept.");
    expect(fmtDayShort("2026-09-20T10:00:00Z", { lang: "en" })).toBe("20 Sept");
    expect(fmtDayShort("pas une date")).toBe("pas une date");
    expect(capitalize(fmtWeekdayDay("2026-09-28"))).toBe("Lundi 28");
    expect(fmtWeekday(1)).toBe("lundi");
    expect(fmtWeekday(7, { lang: "en" })).toBe("Sunday");
    expect(fmtWeekday(3, { lang: "es" })).toBe("miércoles");
  });
});

describe("mots par langue", () => {
  it("chaque langue a ses quatre familles de mots et son « c'est fait »", () => {
    for (const l of ["fr", "en", "es"] as const) {
      expect(WHO[l].spouse).toBeInstanceOf(RegExp);
      expect(WHO[l].family).toBeInstanceOf(RegExp);
      expect(WHO[l].self).toBeInstanceOf(RegExp);
      expect(WHO[l].nobody).toBeInstanceOf(RegExp);
      expect(CLAIMS_DONE[l]).toBeInstanceOf(RegExp);
    }
    expect(CLAIMS_DONE.en.test("It's done, I've added the trainings.")).toBe(true);
    expect(CLAIMS_DONE.en.test("What time is the dentist?")).toBe(false);
    expect(CLAIMS_DONE.es.test("Ya está hecho, lo he añadido a la agenda.")).toBe(true);
  });
});
