import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { appleToDate, checkSchema, dateToApple, hasDateHint } from "./whatsapp.js";
import { setLanguage } from "../i18n/index.js";
// Les textes attendus ici sont français : la langue par défaut d'une nouvelle installation est l'anglais.
setLanguage("fr");

describe("indices de date", () => {
  it("reconnaît un jour, une heure ou une date en français, espagnol, catalan et anglais", () => {
    for (const t of ["Réunion jeudi soir", "Recordatorio: mañana excursión, salida 8:45", "Partido sábado a las 9", "Divendres no hi ha classe", "Pickup tomorrow at 5", "RDV le 12/10", "on dit 18h ?", "le 3 octobre"]) expect(hasDateHint(t), t).toBe(true);
  });
  it("laisse passer le bavardage", () => {
    for (const t of ["Merci !", "jajaja", "Photo trop belle", "ok pour moi", "", null, undefined]) expect(hasDateHint(t as string), String(t)).toBe(false);
  });
});

describe("dates Core Data", () => {
  it("convertit dans les deux sens", () => {
    const d = new Date("2026-09-24T10:00:00Z");
    expect(appleToDate(dateToApple(d))!.toISOString()).toBe(d.toISOString());
    expect(appleToDate(null)).toBeNull();
  });
});

describe("format de la base WhatsApp", () => {
  const make = (sql: string) => { const db = new Database(":memory:"); db.exec(sql); return db; };
  const full = `
    CREATE TABLE ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZSESSIONTYPE, ZARCHIVED, ZREMOVED, ZLASTMESSAGEDATE);
    CREATE TABLE ZWAMESSAGE (Z_PK, ZCHATSESSION, ZMESSAGEDATE, ZMESSAGETYPE, ZISFROMME, ZTEXT, ZFROMJID, ZGROUPMEMBER, ZSTANZAID, ZMEDIAITEM);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK, ZCHATSESSION, ZISACTIVE, ZMEMBERJID, ZCONTACTNAME);
    CREATE TABLE ZWAPROFILEPUSHNAME (ZJID, ZPUSHNAME);
    CREATE TABLE ZWAMEDIAITEM (Z_PK, ZTITLE);`;
  it("accepte le schéma attendu", () => expect(checkSchema(make(full))).toBeNull());
  it("refuse une table absente", () => expect(checkSchema(make(full.replace(/CREATE TABLE ZWAMEDIAITEM.*;/, "")))).toMatch(/ZWAMEDIAITEM absente/));
  it("refuse une colonne manquante et nomme le secours", () => {
    const err = checkSchema(make(full.replace("ZGROUPMEMBER, ", "")));
    expect(err).toMatch(/ZWAMESSAGE sans ZGROUPMEMBER/);
    expect(err).toMatch(/export manuel/);
  });
});
