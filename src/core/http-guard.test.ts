import { describe, expect, it } from "vitest";
import { checkRequest, cookieName, hasSession, readCookie, sameKey, sessionCookie } from "./http-guard.js";

const P = 4310;
const KEY = "k".repeat(43);
const json = "application/json";
const cookie = `${cookieName(P)}=${KEY}`;
const api = (over: Record<string, string>) => ({ method: "GET", path: "/api/items", host: "127.0.0.1:4310", cookie, ...over });

describe("checkRequest", () => {
  it("accepte l'interface locale munie de sa clé", () => {
    expect(checkRequest(api({}), P, KEY).ok).toBe(true);
    expect(checkRequest(api({ method: "POST", host: "localhost:4310", origin: "http://localhost:4310", contentType: json, fetchSite: "same-origin" }), P, KEY).ok).toBe(true);
    expect(checkRequest(api({ method: "PUT", contentType: "application/json; charset=utf-8" }), P, KEY).ok).toBe(true);
  });
  it("accepte le processus principal par l'en-tête X-Molinova-Key", () => {
    expect(checkRequest({ method: "GET", path: "/api/app/status", host: "127.0.0.1:4310", keyHeader: KEY }, P, KEY).ok).toBe(true);
  });
  it("refuse /api/ sans clé, ou avec une mauvaise clé (autre compte du Mac, autre app)", () => {
    expect(checkRequest(api({ cookie: "" }), P, KEY)).toEqual({ ok: false, reason: "session" });
    expect(checkRequest(api({ cookie: `${cookieName(P)}=faux` }), P, KEY)).toEqual({ ok: false, reason: "session" });
    expect(checkRequest(api({ method: "POST", path: "/api/telegram/pair", cookie: "", contentType: json }), P, KEY)).toEqual({ ok: false, reason: "session" });
    // Le cookie d'un autre serveur Molinova (autre port) ne vaut pas pour celui-ci.
    expect(checkRequest(api({ cookie: `${cookieName(4390)}=${KEY}` }), P, KEY)).toEqual({ ok: false, reason: "session" });
  });
  it("sert les fichiers de l'interface sans clé", () => {
    expect(checkRequest({ method: "GET", path: "/app.js", host: "127.0.0.1:4310" }, P, KEY).ok).toBe(true);
  });
  it("refuse un Host étranger (DNS rebinding), même en lecture", () => {
    expect(checkRequest(api({ host: "evil.test:4310" }), P, KEY)).toEqual({ ok: false, reason: "host" });
    expect(checkRequest(api({ host: "127.0.0.1:9999" }), P, KEY)).toEqual({ ok: false, reason: "host" });
    expect(checkRequest({ method: "GET", path: "/" }, P, KEY)).toEqual({ ok: false, reason: "host" });
  });
  it("refuse une lecture déclenchée par un autre site, même avec le cookie", () => {
    expect(checkRequest(api({ fetchSite: "cross-site" }), P, KEY)).toEqual({ ok: false, reason: "site" });
    expect(checkRequest(api({ fetchSite: "same-site" }), P, KEY)).toEqual({ ok: false, reason: "site" });
    expect(checkRequest(api({ fetchSite: "none" }), P, KEY).ok).toBe(true);
  });
  it("refuse une écriture venue d'un autre site", () => {
    expect(checkRequest(api({ method: "POST", origin: "https://evil.test", contentType: json }), P, KEY)).toEqual({ ok: false, reason: "origin" });
  });
  it("refuse une requête simple sans JSON déclaré", () => {
    expect(checkRequest(api({ method: "POST", contentType: "text/plain" }), P, KEY)).toEqual({ ok: false, reason: "content-type" });
    expect(checkRequest(api({ method: "DELETE" }), P, KEY)).toEqual({ ok: false, reason: "content-type" });
  });
});

describe("session", () => {
  it("lit le cookie parmi d'autres", () => {
    expect(readCookie(`a=1; ${cookie}; b=2`, cookieName(P))).toBe(KEY);
    expect(readCookie(undefined, cookieName(P))).toBeUndefined();
    expect(hasSession({ cookie: `x=1;${cookie}` }, P, KEY)).toBe(true);
  });
  it("compare les clés sans accepter le vide", () => {
    expect(sameKey(KEY, KEY)).toBe(true);
    expect(sameKey("", "")).toBe(false);
    expect(sameKey(undefined, KEY)).toBe(false);
  });
  it("pose un cookie HttpOnly, SameSite=Strict", () => {
    expect(sessionCookie(P, KEY, false)).toBe(`${cookieName(P)}=${KEY}; Path=/; HttpOnly; SameSite=Strict`);
    expect(sessionCookie(P, KEY, true)).toMatch(/Max-Age=31536000$/);
  });
});
