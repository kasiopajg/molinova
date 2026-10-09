// Rendu SVG → PNG transparent avec l'Electron du projet (qlmanage pose un fond blanc opaque, inutilisable pour une
// icône d'app ou une image « template » de la barre des menus).
// Usage : electron scripts/render-svg.mjs <entrée.svg> <taille en px> <sortie.png>
// Une seule image par lancement : un second rendu hors écran dans le même processus échoue parfois (bac à sable macOS).
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const self = process.argv.findIndex((a) => a.endsWith("render-svg.mjs"));
const [input, sizeArg, outArg] = process.argv.slice(self + 1);
const size = Number(sizeArg);
if (!input || !outArg || !(size > 0)) {
  console.error("usage : electron scripts/render-svg.mjs <entrée.svg> <taille> <sortie.png>");
  process.exit(2);
}

app.dock?.hide();
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.resolve(input));
  const out = path.resolve(outArg);
  const win = new BrowserWindow({
    show: false, width: size, height: size, useContentSize: true, frame: false, transparent: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
    img{display:block;width:${size}px;height:${size}px}</style></head>
    <body><img src="data:image/svg+xml;base64,${svg.toString("base64")}"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 300));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  if (img.getSize().width !== size) img = img.resize({ width: size, height: size, quality: "best" });
  fs.writeFileSync(out, img.toPNG());
  console.log(`${path.basename(input)} → ${path.relative(process.cwd(), out)} (${size} px)`);
  win.destroy();
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
