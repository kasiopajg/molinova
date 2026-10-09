#!/usr/bin/env node
// pnpm native:electron — construit better_sqlite3.node pour l'ABI d'Electron, À CÔTÉ de celui de Node.
//
// Un seul node_modules, deux ABI : le serveur de dev (Node 20, tsx) garde le binaire normal de
// node_modules/better-sqlite3 ; l'app charge build/native/darwin-<arch>/better_sqlite3.node via
// MOLINOVA_SQLITE_BINDING (voir docs/desktop-app.md). On travaille sur une COPIE du paquet dans un dossier
// temporaire : node_modules n'est jamais recompilé sur place.
//
// 1. prebuild-install --runtime electron (binaire officiel de better-sqlite3, téléchargé) ;
// 2. sinon @electron/rebuild depuis les sources (en-têtes Electron, node-gyp).
// Options : --arch arm64|x64 (défaut : celle de la machine), --force (ignore le cache).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arch = args.includes("--arch") ? args[args.indexOf("--arch") + 1] : process.arch;
const force = args.includes("--force");
const require = createRequire(path.join(ROOT, "package.json"));

const electronVersion = JSON.parse(fs.readFileSync(require.resolve("electron/package.json"), "utf8")).version;
const sqliteDir = fs.realpathSync(path.dirname(require.resolve("better-sqlite3/package.json")));
const sqliteVersion = JSON.parse(fs.readFileSync(path.join(sqliteDir, "package.json"), "utf8")).version;

const outDir = path.join(ROOT, "build", "native", `darwin-${arch}`);
const out = path.join(outDir, "better_sqlite3.node");
const stamp = path.join(outDir, "better_sqlite3.json");
const want = { electron: electronVersion, betterSqlite3: sqliteVersion, arch };

function log(msg) { console.log(`[native:electron] ${msg}`); }

// Cache : même Electron, même better-sqlite3, même architecture → rien à faire.
if (!force && fs.existsSync(out) && fs.existsSync(stamp)) {
  try {
    const have = JSON.parse(fs.readFileSync(stamp, "utf8"));
    if (have.electron === want.electron && have.betterSqlite3 === want.betterSqlite3 && have.arch === want.arch) {
      log(`à jour (Electron ${electronVersion}, better-sqlite3 ${sqliteVersion}, ${arch}) : ${path.relative(ROOT, out)}`);
      verify();
      process.exit(0);
    }
  } catch { /* tampon illisible : on reconstruit */ }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "molinova-native-"));
try {
  // Copie du paquet sans son build/ (le binaire Node ne doit jamais servir ni être touché).
  const appDir = path.join(tmp, "app");
  const modDir = path.join(appDir, "node_modules", "better-sqlite3");
  fs.mkdirSync(path.dirname(modDir), { recursive: true });
  fs.cpSync(sqliteDir, modDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = path.relative(sqliteDir, src);
      return rel !== "build" && !rel.startsWith(`build${path.sep}`) && rel !== "node_modules" && !rel.startsWith(`node_modules${path.sep}`);
    },
  });
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "molinova-native", version: "0.0.0", private: true, dependencies: { "better-sqlite3": sqliteVersion } }));
  const built = path.join(modDir, "build", "Release", "better_sqlite3.node");

  let how = "";
  try {
    const sqliteRequire = createRequire(path.join(sqliteDir, "package.json"));
    const prebuild = path.join(path.dirname(sqliteRequire.resolve("prebuild-install/package.json")), "bin.js");
    log(`prebuild-install --runtime electron --target ${electronVersion} --arch ${arch}`);
    execFileSync(process.execPath, [prebuild, "--runtime", "electron", "--target", electronVersion, "--arch", arch, "--platform", "darwin"], { cwd: modDir, stdio: "inherit" });
    if (!fs.existsSync(built)) throw new Error("prebuild-install n'a rien produit");
    how = "prebuild officiel";
  } catch (err) {
    log(`pas de binaire préconstruit (${err instanceof Error ? err.message.split("\n")[0] : err}) : compilation avec @electron/rebuild`);
    const { rebuild } = await import(pathToImport(require.resolve("@electron/rebuild")));
    await rebuild({ buildPath: appDir, electronVersion, arch, onlyModules: ["better-sqlite3"], force: true, buildFromSource: true, mode: "sequential" });
    if (!fs.existsSync(built)) throw new Error(`@electron/rebuild n'a pas produit ${built}`);
    how = "compilé depuis les sources";
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(built, out);
  fs.writeFileSync(stamp, JSON.stringify({ ...want, how, builtAt: new Date().toISOString() }, null, 2) + "\n");
  log(`${how} → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} Ko)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
verify();

function pathToImport(p) { return new URL(`file://${p}`).href; }

// Le binaire doit s'ouvrir sous Electron (ELECTRON_RUN_AS_NODE) — et seulement quand l'arch est celle de la machine.
function verify() {
  if (arch !== process.arch) return log(`vérification sautée (arch ${arch} ≠ ${process.arch})`);
  let electronBin;
  try { electronBin = require("electron"); } catch { return log("vérification sautée : binaire Electron absent (node node_modules/electron/install.js)"); }
  if (typeof electronBin !== "string" || !fs.existsSync(electronBin)) return log("vérification sautée : binaire Electron absent");
  const code = `const D=require(${JSON.stringify(path.join(sqliteDir, "lib", "index.js"))});`
    + `const db=new D(':memory:',{nativeBinding:${JSON.stringify(out)}});`
    + `console.log('sqlite '+db.prepare('select sqlite_version() v').get().v+' / electron '+process.versions.electron+' / abi '+process.versions.modules);`;
  const res = execFileSync(electronBin, ["-e", code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" });
  log(`chargé sous Electron : ${res.trim()}`);
}
