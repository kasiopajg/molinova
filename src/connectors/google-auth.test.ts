import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// gmail.ts charge config.ts : dossier de données neuf, jamais le dépôt. Aucun appel à Google ici.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-gauth-"));
let gmail: typeof import("./gmail.js");
let i18n: typeof import("../i18n/index.js");
let isAuthError: typeof import("../jobs.js").isAuthError;
beforeAll(async () => {
  process.env.MOLINOVA_HOME = home;
  vi.resetModules();
  gmail = await import("./gmail.js");
  i18n = await import("../i18n/index.js");
  ({ isAuthError } = await import("../jobs.js"));
  i18n.setLanguage("en");
});
afterAll(() => { delete process.env.MOLINOVA_HOME; fs.rmSync(home, { recursive: true, force: true }); });

const MAIL = "https://www.googleapis.com/auth/gmail.modify";
const DRAFTS = "https://www.googleapis.com/auth/gmail.compose";
const CAL = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.app.created"];
const ALL = [MAIL, DRAFTS, ...CAL];

describe("droits réellement accordés par Google", () => {
  it("toutes les cases cochées : rien ne manque, les droits accordés sont gardés", () => {
    const r = gmail.analyseGrantedScopes(ALL, ALL.join(" "));
    expect(r).toEqual({ granted: ALL, missingMail: false, missing: [] });
  });
  it("case Gmail décochée : refus, même si le reste est accordé", () => {
    const r = gmail.analyseGrantedScopes(ALL, [DRAFTS, ...CAL].join(" "));
    expect(r.missingMail).toBe(true);
    expect(r.granted).not.toContain(MAIL);
  });
  it("brouillons ou agenda décochés : signalés, la boîte reste connectable", () => {
    expect(gmail.analyseGrantedScopes(ALL, [MAIL, ...CAL].join(" "))).toEqual({ granted: [MAIL, ...CAL], missingMail: false, missing: ["drafts"] });
    // Un seul des trois droits agenda manquant suffit : la page Agenda en a besoin.
    expect(gmail.analyseGrantedScopes(ALL, [MAIL, DRAFTS, CAL[0]].join(" ")).missing).toEqual(["calendar"]);
    expect(gmail.analyseGrantedScopes(ALL, MAIL).missing).toEqual(["drafts", "calendar"]);
  });
  it("Drive demandé mais décoché : signalé, la boîte reste connectée", () => {
    const DRIVE = "https://www.googleapis.com/auth/drive.readonly";
    expect(gmail.analyseGrantedScopes([...ALL, DRIVE], ALL.join(" ")).missing).toEqual(["drive"]);
    expect(gmail.analyseGrantedScopes([...ALL, DRIVE], [...ALL, DRIVE].join(" ")).missing).toEqual([]);
  });
  it("un droit non demandé n'est jamais signalé manquant", () => {
    expect(gmail.analyseGrantedScopes([MAIL], MAIL)).toEqual({ granted: [MAIL], missingMail: false, missing: [] });
    expect(gmail.analyseGrantedScopes([MAIL, DRAFTS], `${MAIL} ${DRAFTS}`).missing).toEqual([]);
  });
  it("sans `scope` dans la réponse (anciennes bibliothèques) : les droits demandés font foi", () => {
    expect(gmail.analyseGrantedScopes(ALL, undefined)).toEqual({ granted: ALL, missingMail: false, missing: [] });
    expect(gmail.analyseGrantedScopes(ALL, "  ")).toEqual({ granted: ALL, missingMail: false, missing: [] });
  });
  it("espaces multiples et doublons dans `scope` sont tolérés", () => {
    expect(gmail.analyseGrantedScopes([MAIL], `  ${MAIL}   ${MAIL} openid `).granted).toEqual([MAIL, "openid"]);
  });
});

describe("erreurs OAuth de Google traduites", () => {
  const cases: Array<[string, string]> = [
    ["access_denied", "gmail.errAccessDenied"],
    ["redirect_uri_mismatch", "gmail.errRedirectUri"],
    ["admin_policy_enforced", "gmail.errAdminPolicy"],
    ["org_internal", "gmail.errOrgInternal"],
    ["invalid_client", "gmail.errInvalidClient"],
    ["invalid_grant", "gmail.errInvalidGrant"],
  ];
  it("chaque code du retour local (?error=) a son explication et sa clé", () => {
    for (const [raw, key] of cases) {
      const e = gmail.googleAuthError(raw);
      expect(e?.code, raw).toBe(key);
      expect(e?.status).toBe(400);
      expect(e?.message).toBe(i18n.t(key as import("../i18n/index.js").Key));
    }
  });
  it("lit le code d'un échange de jeton (gaxios : response.data.error) ou du message", () => {
    const gaxios = Object.assign(new Error("Request failed with status code 400"), { response: { status: 400, data: { error: "invalid_grant", error_description: "Bad Request" } } });
    expect(gmail.oauthErrorCode(gaxios)).toBe("invalid_grant");
    expect(gmail.oauthErrorCode(new Error("invalid_client"))).toBe("invalid_client");
    expect(gmail.googleAuthError(new Error("invalid_grant"))?.code).toBe("gmail.errInvalidGrant");
  });
  it("une erreur inconnue n'est pas traduite : l'appelant garde l'originale", () => {
    expect(gmail.googleAuthError("server_error")).toBeNull();
    expect(gmail.googleAuthError(new Error("socket hang up"))).toBeNull();
    expect(gmail.oauthErrorCode(new Error("my_invalid_grantee"))).toBeNull();
    expect(gmail.oauthErrorCode(null)).toBeNull();
  });
  it("les solutions renvoient aux étapes du guide, dans les trois langues", () => {
    expect(i18n.t("gmail.errAccessDenied", undefined, "fr")).toMatch(/« Publie ton app »/);
    expect(i18n.t("gmail.errRedirectUri", undefined, "en")).toMatch(/“Create your app's key”/);
    expect(i18n.t("gmail.errInvalidGrant", undefined, "es")).toMatch(/«Publica tu app»/);
  });
  it("les messages traduits restent reconnus comme accès refusé par les travaux de fond", () => {
    for (const lang of i18n.LANGUAGES) {
      expect(isAuthError(new Error(i18n.t("gmail.errInvalidGrant", undefined, lang))), lang).toBe(true);
      expect(isAuthError(new Error(i18n.t("gmail.errInvalidClient", undefined, lang))), lang).toBe(true);
    }
  });
});

describe("code d'erreur renvoyé à l'interface", () => {
  it("garde une clé du dictionnaire, ignore les autres codes", () => {
    expect(i18n.keyOf("gmail.missingMailScope")).toBe("gmail.missingMailScope");
    expect(i18n.keyOf("err.unknownRoute")).toBe("err.unknownRoute");
    expect(i18n.keyOf("ENOENT")).toBeUndefined();
    expect(i18n.keyOf(400)).toBeUndefined();
    expect(i18n.keyOf("toString")).toBeUndefined();
  });
});
