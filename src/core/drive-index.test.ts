import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { driveSchema, sqliteOptions } from "../db.js";
import { FOLDER_MIME, type DriveEntry } from "../connectors/drive.js";
import { computeScope, driveState, folderChildren, forgetDrive, formatOf, ftsQuery, refreshScope, searchDocs, setFolderMode, syncDrive, type DriveSource, type ScopeDoc, type ScopeFolder } from "./drive-index.js";

const ROOT = "root";
const MB = 1024 * 1024;

describe("formats", () => {
  it("reconnaît les documents et écarte le reste", () => {
    expect(formatOf("application/pdf")).toBe("pdf");
    expect(formatOf("application/vnd.google-apps.document")).toBe("google");
    expect(formatOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("office");
    expect(formatOf("application/vnd.ms-excel")).toBe("office");
    expect(formatOf("text/csv")).toBe("text");
    expect(formatOf("image/jpeg")).toBe("image");
    expect(formatOf("video/mp4")).toBeNull();
    expect(formatOf("application/zip")).toBeNull();
    expect(formatOf("application/vnd.google-apps.form")).toBeNull();
  });
});

describe("périmètre", () => {
  const folders: ScopeFolder[] = [
    { id: ROOT, name: "", parentId: null, mode: null },
    { id: "admin", name: "01 ADMIN", parentId: ROOT, mode: null },
    { id: "assur", name: "Assurance", parentId: "admin", mode: null },
    { id: "photos", name: "Photos", parentId: ROOT, mode: null },
    { id: "proj", name: "Projets", parentId: ROOT, mode: "frozen" },
    { id: "old", name: "Archives", parentId: "admin", mode: "out" },
    { id: "keep", name: "À garder", parentId: "old", mode: "in" },
  ];
  const docs: ScopeDoc[] = [
    { id: "a", parentId: "assur", format: "pdf", size: 1000 },
    { id: "b", parentId: "admin", format: "google", size: null },
    { id: "c", parentId: "photos", format: "pdf", size: 1000 },
    { id: "d", parentId: "proj", format: "office", size: 1000 },
    { id: "e", parentId: "old", format: "pdf", size: 1000 },
    { id: "f", parentId: "keep", format: "pdf", size: 1000 },
    { id: "g", parentId: "assur", format: "image", size: 1000 },
    { id: "h", parentId: "assur", format: "pdf", size: 80 * MB },
    { id: "i", parentId: "shared-elsewhere", format: "pdf", size: 1000 },
    { id: "j", parentId: "assur", format: null, size: 1000 },
  ];
  const r = computeScope(folders, docs, { rootId: ROOT, formats: ["pdf", "google", "office", "text"], maxBytes: 50 * MB });

  it("chemins depuis Mon Drive", () => {
    expect(r.folders.get("assur")!.path).toBe("01 ADMIN/Assurance");
    expect(r.docs.get("a")!.path).toBe("01 ADMIN/Assurance");
    expect(r.docs.get("b")!.path).toBe("01 ADMIN");
  });
  it("les photos sont exclues d'office, un dossier exclu l'est avec ses sous-dossiers, sauf choix contraire", () => {
    expect(r.folders.get("photos")!.effective).toBe("out");
    expect(r.docs.get("c")!.inScope).toBe(false);
    expect(r.docs.get("e")!.inScope).toBe(false);
    expect(r.docs.get("f")!.inScope).toBe(true);
  });
  it("un dossier figé est lu mais marqué figé, jusque dans ses sous-dossiers", () => {
    expect(r.docs.get("d")).toEqual({ path: "Projets", inScope: true, frozen: true });
  });
  it("formats non retenus, fichiers trop lourds et non-documents restent hors du périmètre", () => {
    expect(r.docs.get("g")!.inScope).toBe(false);
    expect(r.docs.get("h")!.inScope).toBe(false);
    expect(r.docs.get("j")!.inScope).toBe(false);
  });
  it("un fichier qui n'est pas rangé dans Mon Drive n'est pas lu", () => {
    expect(r.docs.get("i")).toEqual({ path: null, inScope: false, frozen: false });
  });
  it("les compteurs remontent jusqu'à la racine", () => {
    // a, b (lus) ; e (exclu) et f (lu) sous admin.
    expect(r.folders.get("admin")).toMatchObject({ nDocs: 4, nScope: 3, nSub: 2 });
    expect(r.folders.get(ROOT)).toMatchObject({ nDocs: 6, nScope: 4 });
  });
  it("une boucle de parents (base abîmée) ne bloque pas le calcul", () => {
    const loop = computeScope([{ id: "x", name: "x", parentId: "y", mode: null }, { id: "y", name: "y", parentId: "x", mode: null }], [{ id: "z", parentId: "x", format: "pdf", size: 1 }], { rootId: ROOT, formats: ["pdf"], maxBytes: MB });
    expect(loop.docs.get("z")!.inScope).toBe(false);
  });
});

describe("recherche", () => {
  it("chaque mot devient un préfixe, la ponctuation disparaît", () => {
    expect(ftsQuery("attest. voiture")).toBe('"attest"* "voiture"*');
    expect(ftsQuery('  "  ')).toBeNull();
    expect(ftsQuery("AND OR NOT")).toBe('"AND"* "OR"* "NOT"*');
  });
});

// ---------- synchronisation, sur une base en mémoire et un faux Drive
function memDb() {
  const db = new Database(":memory:", sqliteOptions());
  db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE activity (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), channel TEXT NOT NULL, kind TEXT NOT NULL, params_json TEXT, item_id INTEGER)");
  driveSchema(db);
  return db;
}
const entry = (id: string, name: string, parentId: string, mimeType = "application/pdf"): DriveEntry => ({ id, name, mimeType, parentId, size: 1000, md5: null, modifiedAt: "2026-09-01T10:00:00Z", createdAt: null, ownedByMe: true, link: `https://drive/${id}` });
function fakeDrive(files: DriveEntry[]) {
  const state = { files: [...files], changes: { changed: [] as DriveEntry[], removed: [] as string[] }, listCalls: 0, tokenFails: false };
  const src: DriveSource = {
    rootId: async () => ROOT,
    startPageToken: async () => "t1",
    listAll: async () => { state.listCalls++; return state.files; },
    changesSince: async () => {
      if (state.tokenFails) throw Object.assign(new Error("Invalid Value"), { code: 400 });
      const c = state.changes; state.changes = { changed: [], removed: [] };
      return { ...c, next: "t2" };
    },
  };
  return { src, state };
}
const ACC = { id: 1, email: "me@example.com" };

describe("synchronisation", () => {
  const files = [
    entry("admin", "Admin", ROOT, FOLDER_MIME),
    entry("photos", "Photos", ROOT, FOLDER_MIME),
    entry("a", "Attestation assurance voiture 2026.pdf", "admin"),
    entry("b", "Plage.pdf", "photos"),
    entry("s", "raccourci", "admin", "application/vnd.google-apps.shortcut"),
  ];
  it("première lecture complète, puis seulement les changements", async () => {
    const db = memDb();
    const { src, state } = fakeDrive(files);
    const r1 = await syncDrive(db, ACC, src);
    expect(r1).toMatchObject({ full: true, inScope: 1 });
    expect(driveState(db, 1)).toMatchObject({ rootId: ROOT, pageToken: "t1" });
    expect(searchDocs(db, "assur voit").map((d) => d.id)).toEqual(["a"]);
    expect(searchDocs(db, "plage")).toEqual([]); // dans Photos, exclu d'office

    state.changes = { changed: [entry("c", "Contrat Axa.pdf", "admin")], removed: ["a"] };
    const r2 = await syncDrive(db, ACC, src);
    expect(r2).toMatchObject({ full: false, changed: 2, inScope: 1 });
    expect(state.listCalls).toBe(1);
    expect(searchDocs(db, "axa").map((d) => d.id)).toEqual(["c"]);
    expect(searchDocs(db, "attestation")).toEqual([]);
    expect(driveState(db, 1).pageToken).toBe("t2");
  });
  it("un choix de dossier survit à une relecture complète et change la recherche", async () => {
    const db = memDb();
    const { src } = fakeDrive(files);
    await syncDrive(db, ACC, src);
    setFolderMode(db, 1, "photos", "in");
    refreshScope(db, 1);
    expect(searchDocs(db, "plage").map((d) => d.id)).toEqual(["b"]);
    await syncDrive(db, ACC, src, { full: true });
    expect(folderChildren(db, 1, ROOT).find((f) => f.id === "photos")).toMatchObject({ mode: "in", effective: "in", nScope: 1 });
  });
  it("point de départ refusé par Google : relecture complète", async () => {
    const db = memDb();
    const { src, state } = fakeDrive(files);
    await syncDrive(db, ACC, src);
    state.tokenFails = true;
    const r = await syncDrive(db, ACC, src);
    expect(r.full).toBe(true);
    expect(state.listCalls).toBe(2);
  });
  it("une erreur est gardée et notée une seule fois au fil", async () => {
    const db = memDb();
    const src: DriveSource = { rootId: async () => { throw new Error("boom"); }, startPageToken: async () => "t", listAll: async () => [], changesSince: async () => ({ changed: [], removed: [], next: "t" }) };
    await expect(syncDrive(db, ACC, src)).rejects.toThrow("boom");
    await expect(syncDrive(db, ACC, src)).rejects.toThrow("boom");
    expect(driveState(db, 1).error).toBe("boom");
    expect((db.prepare("SELECT COUNT(*) n FROM activity WHERE kind = 'error'").get() as { n: number }).n).toBe(1);
  });
  it("oublier l'index garde les choix de dossiers", async () => {
    const db = memDb();
    const { src } = fakeDrive(files);
    await syncDrive(db, ACC, src);
    setFolderMode(db, 1, "admin", "frozen");
    forgetDrive(db, 1);
    expect((db.prepare("SELECT COUNT(*) n FROM docs").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT mode FROM drive_folders WHERE folder_id = 'admin'").get() as { mode: string }).mode).toBe("frozen");
    expect(driveState(db, 1).pageToken).toBeNull();
  });
});

describe("index de recherche, ancienne forme", () => {
  it("une base d'avant les fiches (noms et chemins seulement) est refaite avec ses colonnes, sans rien perdre", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE docs (account_id INTEGER NOT NULL, file_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, format TEXT, size INTEGER, md5 TEXT, parent_id TEXT, path TEXT, modified_at TEXT, created_at TEXT, owned INTEGER NOT NULL DEFAULT 1, link TEXT, in_scope INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0, indexed_at TEXT, PRIMARY KEY (account_id, file_id))");
    db.exec("CREATE VIRTUAL TABLE docs_fts USING fts5(account_id UNINDEXED, file_id UNINDEXED, name, path, tokenize = 'unicode61 remove_diacritics 2')");
    db.prepare("INSERT INTO docs (account_id, file_id, name, mime, format, path, in_scope) VALUES (1, 'a', 'Attestation assurance.pdf', 'application/pdf', 'pdf', 'Voiture', 1)").run();
    db.prepare("INSERT INTO docs_fts (account_id, file_id, name, path) VALUES (1, 'a', 'Attestation assurance.pdf', 'Voiture')").run();
    driveSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('docs_fts')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["account_id", "file_id", "name", "path", "title", "facets", "body"]);
    expect(searchDocs(db, "assurance").map((d) => d.id)).toEqual(["a"]);
    // Une deuxième ouverture ne refait rien.
    driveSchema(db);
    expect((db.prepare("SELECT COUNT(*) n FROM docs_fts").get() as { n: number }).n).toBe(1);
  });
});
