import { MockLanguageModelV4 } from "ai/test";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadContext, loadSettings, type Context } from "../config.js";
import { setLanguage } from "../i18n/index.js";
import { chat } from "./brain.js";
import type { Classifier } from "./classify.js";
import type { DocQuery, DocResult } from "./doc-search.js";

const settings0 = loadSettings();
setLanguage("fr");
const ctx: Context = { ...loadContext(), owner: { ...loadContext().owner, name: "Alex Martin" }, keyPeople: [{ name: "Clara Martin", relation: "épouse", emails: [] }], family: { children: [{ name: "Léo", activities: [] }], schoolDomains: [], activityDomains: [] } };

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
/** Un faux modèle de chat qui joue un scénario : une étape par appel (appel d'outil, puis texte). */
function scripted(steps: Array<{ tool?: string; input?: unknown; text?: string }>) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const s = steps[Math.min(i++, steps.length - 1)];
      return s.tool
        ? { content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: s.tool, input: JSON.stringify(s.input) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text" as const, text: s.text ?? "" }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}

const doc: DocResult = { accountId: 1, id: "f42", name: "IMG_4521.jpg", path: "Scans", link: null, format: "image", mime: "image/jpeg", size: 1000, modifiedAt: null, title: "2024-03-12 Pièce d'identité · Alex – Administratif", type: "identity", typeName: "Pièce d'identité", context: "admin", contextName: "Administratif", people: ["me"], peopleNames: ["Alex"], party: null, expiry: "2032-09-15", valid: 1, sensitive: true, by: "jev", classified: true, frozen: false, score: 5, match: 0.95 };

describe("Telegram : trouver et envoyer un document", () => {
  it("« ma carte d'identité » : la personne vient du code (« ma » = qui parle), l'envoi attend le bouton", async () => {
    const queries: DocQuery[] = [];
    const model = scripted([
      { tool: "find_document", input: { request: "ma carte d'identité", words: ["carte d'identité", "CNI", "DNI"], type: "identity", peopleBasis: "ma carte" } },
      { tool: "send_document", input: { code: "[d:1:f42]" } },
      { text: "J'ai trouvé ta carte d'identité, valable jusqu'au 12 mars 2031. Confirme l'envoi." },
    ]);
    const c = { db: new Database(":memory:"), ctx, settings: { ...settings0, language: "fr", chatModel: model as never } } as unknown as Classifier;
    const r = await chat(c, { contacts: [], mail: true, drive: { search: async (q) => { queries.push(q); return [doc]; }, get: async (a, f) => (a === 1 && f === "f42" ? doc : null) } }, [{ role: "user", content: "Envoie-moi ma carte d'identité" }]);
    expect(queries[0]).toMatchObject({ request: "ma carte d'identité", type: "identity", people: ["me"] });
    expect(r.pending).toEqual([expect.objectContaining({ kind: "file", accountId: 1, fileId: "f42", name: "IMG_4521.jpg" })]);
  });

  it("un code inventé n'envoie rien ; sans droit Drive, les outils n'existent pas", async () => {
    const model = scripted([{ tool: "send_document", input: { code: "d:9:inconnu" } }, { text: "Je ne trouve pas ce document." }]);
    const c = { db: new Database(":memory:"), ctx, settings: { ...settings0, language: "fr", chatModel: model as never } } as unknown as Classifier;
    const r = await chat(c, { contacts: [], mail: true, drive: { search: async () => [], get: async () => null } }, [{ role: "user", content: "envoie le document" }]);
    expect(r.pending).toEqual([]);
    let tools: string[] = [];
    const spy = new MockLanguageModelV4({ doGenerate: async (o) => { tools = (o.tools ?? []).map((x) => x.name); return { content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }; } });
    const c2 = { db: new Database(":memory:"), ctx, settings: { ...settings0, language: "fr", chatModel: spy as never } } as unknown as Classifier;
    await chat(c2, { contacts: [], speaker: { key: "spouse", name: "Clara" }, mail: false }, [{ role: "user", content: "ma carte ?" }]);
    expect(tools).not.toContain("find_document");
    expect(tools).not.toContain("search_mail");
  });
});
