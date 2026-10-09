import { describe, expect, it } from "vitest";
import { composeTitle, dateCandidates, docDate, partyCandidates, spreadSample } from "./doc-facts.js";

describe("dates du texte", () => {
  it("formats français, espagnols, anglais, passeport ; sans doublon, dans l'ordre", () => {
    const text = "Délivrée le 12/03/2021. Valable jusqu'au : 12.03.2031. Date of expiry 12 MAR 2031. Emitida el 5 de mayo de 2020, March 1, 2024, réf 2024-02-30, 2025-01-15.";
    expect(dateCandidates(text).map((d) => d.date)).toEqual(["2021-03-12", "2031-03-12", "2020-05-05", "2024-03-01", "2025-01-15"]);
  });
  it("chaque date garde les mots qui la précèdent", () => {
    expect(dateCandidates("Nom : MARTIN. Valable jusqu'au : 12.03.2031")[0].snippet).toMatch(/Valable jusqu'au : 12\.03\.2031$/);
  });
  it("passeport français (« 12 03 2031 »), allemand (« 7. Mai 2023 », « 15. März 2030 »), italien (« 3 dicembre 2025 »)", () => {
    expect(dateCandidates("Date d'expiration 12 03 2031 · gültig bis 15. März 2030 · rilasciato il 3 dicembre 2025").map((d) => d.date)).toEqual(["2031-03-12", "2030-03-15", "2025-12-03"]);
    expect(dateCandidates("Tél. 06 12 3456 · 01 23 2019")).toEqual([]);
  });
  it("rien d'impossible : 31 février, mois 13, an 1800", () => {
    expect(dateCandidates("31/02/2024 12/13/2024 01/01/1800")).toEqual([]);
  });
});

describe("tiers candidats", () => {
  it("noms connus, raisons sociales, domaines d'adresses (pas les webmails)", () => {
    const text = "MAPFRE ESPAÑA S.A. — Contrat 123. Contact : sinistres@axa.fr ou jean.dupont@gmail.com. Votre agence Caixabank.";
    expect(partyCandidates(text, ["Caixabank", "Endesa"]).slice(0, 3)).toEqual(["Caixabank", "MAPFRE ESPAÑA S.A", "Axa"]);
  });
  it("l'émetteur en capitales en haut du document, sans les rubriques du formulaire", () => {
    const text = "FINANZAMT MUSTERSTADT\nSteuernummer 123\nNAME: MARTIN VORNAME: Alex\nBescheinigung";
    const p = partyCandidates(text);
    expect(p[0]).toBe("FINANZAMT MUSTERSTADT");
    expect(p).not.toContain("NAME");
    expect(partyCandidates("Contact : service@fa-musterstadt.de")).toEqual(["Fa Musterstadt"]);
  });
});

describe("organismes", () => {
  it("mots composés allemands et organismes nommés en toutes lettres", () => {
    const p = partyCandidates("Anmeldung zur Prüfung. Der Teilnehmer verzichtet gegenüber dem Landesfischereiverband und dem Fischereiverein. Agencia Tributaria, Caisse primaire d'assurance maladie de Paris.");
    expect(p).toEqual(expect.arrayContaining(["Landesfischereiverband", "Fischereiverein", "Agencia Tributaria", "Caisse primaire d'assurance maladie de Paris"]));
  });
});

describe("titre et échantillon", () => {
  it("la date du titre est la plus ancienne : un papier de 2012 mis sur Drive en 2019 garde 2012", () => {
    expect(docDate("2019-06-30T10:00:00Z", "2012-05-05T16:10:18Z")).toBe("2012-05-05T16:10:18Z");
    expect(docDate(null, "2024-01-01T00:00:00Z")).toBe("2024-01-01T00:00:00Z");
    expect(docDate(null, null)).toBeNull();
  });
  it("titre composé", () => {
    expect(composeTitle({ date: "2024-03-12T10:00:00Z", type: "Pièce d'identité", people: ["Alex"], context: "Administratif" })).toBe("2024-03-12 Pièce d'identité · Alex – Administratif");
    expect(composeTitle({ type: "Facture", party: "Endesa", context: "Énergie et services" })).toBe("Facture Endesa – Énergie et services");
  });
  it("l'échantillon passe par chaque dossier et chaque année avant de prendre un deuxième document du même groupe", () => {
    const docs = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, path: "Factures", modifiedAt: "2025-01-01" })),
      { id: "a", path: "Admin/ID", modifiedAt: "2019-05-01" },
      { id: "b", path: "Admin", modifiedAt: "2023-05-01" },
      { id: "c", path: "Santé", modifiedAt: "2025-05-01" },
    ];
    const s = spreadSample(docs, 4).map((d) => d.id);
    expect(s).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(s.filter((x) => x.startsWith("f"))).toHaveLength(1);
    expect(spreadSample(docs, 100)).toHaveLength(53);
  });
});
