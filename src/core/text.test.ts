import { describe, expect, it } from "vitest";
import { clip, decodeEntities, htmlToText, parseAddress, splitAddresses, wellFormed, wellFormedDeep } from "./text.js";
import { decodeBody } from "../connectors/gmail.js";

describe("splitAddresses", () => {
  it("ne coupe pas un nom entre guillemets qui contient une virgule", () => {
    const parts = splitAddresses('"Dupont, Jean" <j@x.fr>, marie@y.es');
    expect(parts).toEqual(['"Dupont, Jean" <j@x.fr>', "marie@y.es"]);
    expect(parts.map((p) => parseAddress(p).address)).toEqual(["j@x.fr", "marie@y.es"]);
  });
  it("renvoie une liste vide pour un en-tête vide", () => {
    expect(splitAddresses("")).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("décode les entités nommées et numériques", () => {
    expect(htmlToText("<p>R&eacute;union de l&#8217;&eacute;cole &#x27;demain&#x27;</p>").trim()).toBe("Réunion de l’école 'demain'");
  });
  it("ne décode qu'une fois", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });
  it("retire l'en-tête et le titre", () => {
    expect(htmlToText("<html><head><title>Newsletter</title></head><body>Bonjour</body></html>").trim()).toBe("Bonjour");
  });
});

describe("decodeBody", () => {
  it("respecte le charset de la partie", () => {
    const latin1 = Buffer.from([0x52, 0xe9, 0x75, 0x6e, 0x69, 0x6f, 0x6e]).toString("base64url"); // « Réunion » en iso-8859-1
    expect(decodeBody(latin1, "text/plain; charset=iso-8859-1")).toBe("Réunion");
    expect(decodeBody(Buffer.from("Réunion").toString("base64url"), "text/plain; charset=UTF-8")).toBe("Réunion");
    expect(decodeBody(Buffer.from("Réunion").toString("base64url"))).toBe("Réunion");
  });
});

describe("coupes sans casser l'Unicode", () => {
  it("ne tranche pas un emoji en deux", () => {
    const s = "Bon cumpleaños 👍🎈";
    const cut = clip(s, s.indexOf("👍") + 1);
    expect(cut).toBe("Bon cumpleaños ");
    expect(clip(s, 100)).toBe(s);
    expect(clip("abcdef", 3, "…")).toBe("abc…");
  });
  it("répare une moitié d'emoji orpheline, partout dans une valeur", () => {
    const half = "👍".slice(0, 1);
    expect(wellFormed(`ok ${half}`)).toBe("ok �");
    expect(wellFormed("ok 👍")).toBe("ok 👍");
    expect(wellFormedDeep({ a: [`x${half}`], n: 1, d: { s: half } })).toEqual({ a: ["x�"], n: 1, d: { s: "�" } });
  });
});
