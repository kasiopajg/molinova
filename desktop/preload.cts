// Preload de la fenêtre (sandbox, contextIsolation) : doit rester en CommonJS, d'où l'extension .cts → .cjs.
// Expose window.molinova à l'interface et marque <html class="molinova-app"> (voir docs/desktop-app.md).
import { contextBridge, ipcRenderer } from "electron";

const versionArg = process.argv.find((a) => a.startsWith("--molinova-version="));

contextBridge.exposeInMainWorld("molinova", {
  isApp: true,
  version: versionArg ? versionArg.slice("--molinova-version=".length) : "",
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("molinova:openExternal", String(url)),
  /** La nouvelle version publiée sur GitHub, ou null : { version, url }. */
  getUpdate: (): Promise<{ version: string; url: string } | null> => ipcRenderer.invoke("molinova:getUpdate"),
  onUpdate: (cb: (u: { version: string; url: string } | null) => void): void => { ipcRenderer.on("molinova:update", (_e, u) => cb(u)); },
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("molinova-app");
});
