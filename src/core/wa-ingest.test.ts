import { describe, expect, it } from "vitest";
import type { Item } from "../connectors/types.js";
import { dateToApple } from "../connectors/whatsapp.js";
import { cursorAfter, windowItem, windows } from "./wa-ingest.js";

const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m);
const msg = (h: number, text: string, from = "Marta", out = false): Item => ({ externalId: `s${h}${text.length}`, accountId: 1, source: "whatsapp", fromName: from, fromAddress: "x@s.whatsapp.net", to: [], subject: "", date: at(h), bodyExcerpt: text, hasAttachments: false, hasListUnsubscribe: false, isOutgoing: out, labels: [] });

describe("fenêtres de conversation", () => {
  it("coupe quand plus de trois heures séparent deux messages", () => {
    const w = windows([msg(8, "a"), msg(9, "b"), msg(13, "c"), msg(14, "d")]);
    expect(w.map((x) => x.length)).toEqual([2, 2]);
  });
  it("coupe aussi à douze messages", () => {
    const w = windows(Array.from({ length: 15 }, (_, i) => ({ date: new Date(2026, 8, 24, 8, i) })));
    expect(w.map((x) => x.length)).toEqual([12, 3]);
  });
  it("renvoie rien pour rien", () => expect(windows([])).toEqual([]));
});

describe("une fenêtre devient un élément", () => {
  it("porte le groupe, les lignes horodatées et le premier message reçu en sujet", () => {
    const it_ = windowItem({ jid: "123@g.us", name: "Parents CE2" }, [msg(8, "ok pour moi", "Alex", true), msg(8, "Excursion jeudi, salida 8:45", "Marta")], 7, 4000);
    expect(it_.source).toBe("whatsapp");
    expect(it_.externalId).toBe("123@g.us#s811");
    expect(it_.threadId).toBe("123@g.us");
    expect(it_.subject).toBe("WhatsApp · Parents CE2 · Excursion jeudi, salida 8:45");
    expect(it_.bodyExcerpt).toBe("24/09 08:00 · Alex : ok pour moi\n24/09 08:00 · Marta : Excursion jeudi, salida 8:45");
    expect(it_.isOutgoing).toBe(false);
    expect(it_.labels).toEqual(["INBOX"]);
  });
  it("compte même quand tout vient de moi, et tronque les longs textes", () => {
    const it_ = windowItem({ jid: "1@g.us", name: "G" }, [msg(8, "x".repeat(100), "Alex", true)], 7, 40);
    expect(it_.isOutgoing).toBe(false);
    expect(it_.bodyExcerpt.length).toBe(41);
  });
});

describe("curseur de lecture", () => {
  it("convertit un ancien curseur en millisecondes et exclut le message déjà traité", () => {
    const at = 811973296.347602; // horodatage Apple d'un message, avec microsecondes
    const legacy = new Date((at + 978307200) * 1000).getTime(); // ce que l'ancien code stockait
    expect(legacy).toBe(1790280496347);
    expect(dateToApple(new Date(legacy))).toBeLessThan(at); // le bug : le message serait relu
    const after = cursorAfter(legacy);
    expect(after).toBeGreaterThan(at);
    expect(after - at).toBeLessThan(0.001);
  });
  it("laisse un horodatage Apple tel quel, et zéro reste zéro", () => {
    expect(cursorAfter(811973296.347602)).toBe(811973296.347602);
    expect(cursorAfter(0)).toBe(0);
  });
});
