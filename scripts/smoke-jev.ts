/** Un seul appel à Jev sur un email fictif, pour vérifier la clé et le format des réponses. */
import { loadContext, loadSettings, loadTaxonomy } from "../src/config.js";
import { askJev } from "../src/core/jev.js";
import { buildQuestions, buildState } from "../src/core/questions.js";

const taxonomy = loadTaxonomy();
const ctx = loadContext();
const questions = buildQuestions(taxonomy, ctx);
const state = buildState(
  {
    externalId: "smoke",
    accountId: 0,
    source: "gmail",
    fromName: "Service facturation",
    fromAddress: "billing@example-hosting.com",
    to: ["alex.martin@example.com"],
    subject: "Facture n° 2026-0912 — échéance le 30 septembre",
    date: new Date(),
    bodyExcerpt: "Bonjour, veuillez trouver ci-joint votre facture de 89,00 € pour l'hébergement. Paiement attendu avant le 30 septembre par virement.",
    hasAttachments: true,
    hasListUnsubscribe: false,
    isOutgoing: false,
    labels: [],
  },
  ctx,
);
const r = await askJev(state, questions, loadSettings());
console.log(JSON.stringify({ answers: r.answers, confidence: r.confidence, inputTokens: r.inputTokens, latencyMs: r.latencyMs }, null, 2));
