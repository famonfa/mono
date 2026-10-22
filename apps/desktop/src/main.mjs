import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme, shell } from "electron";

const PORT = Number(process.env.PORT ?? 4600);
const APP_URL = `http://localhost:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PATH = [path.join(HOME, ".local/bin"), path.join(HOME, ".npm-global/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");

/** In dev this checkout; packaged, wherever `mono` last ran from (it writes ~/.mono/config.json). */
function monoConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(path.join(HOME, ".mono", "config.json"), "utf8"));
  } catch {}
  return { home: app.isPackaged ? (saved.home ?? path.join(HOME, "mono")) : path.resolve(here, "../../.."), node: saved.node };
}

async function isUp() {
  try {
    const res = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok && (await res.json()).app === "mono";
  } catch {
    return false;
  }
}

let server = null;

/** Reuses the server if `mono` or the launchd service already runs it; otherwise starts our own. */
async function ensureServer() {
  if (await isUp()) return;
  const { home, node } = monoConfig();
  const main = path.join(home, "apps", "server", "src", "main.mjs");
  if (!fs.existsSync(main)) throw new Error(`No encontré Mono en ${home}. Corré \`mono\` una vez desde la terminal.`);
  const useNode = node && fs.existsSync(node);
  server = spawn(useNode ? node : process.execPath, [main], {
    cwd: home,
    stdio: "inherit",
    env: { ...process.env, PATH: `${PATH}:${process.env.PATH ?? ""}`, ...(useNode ? {} : { ELECTRON_RUN_AS_NODE: "1" }) },
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isUp()) return;
  }
  throw new Error("El server de Mono no arrancó");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 560,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f10" : "#fafafa",
    webPreferences: { preload: path.join(here, "preload.cjs") },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  win.loadURL(`${APP_URL}/${process.env.MONO_HASH ?? ""}`);
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  try {
    await ensureServer();
  } catch (error) {
    const { dialog } = await import("electron");
    dialog.showErrorBox("Mono", error.message);
    return app.quit();
  }
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("before-quit", () => server?.kill());
