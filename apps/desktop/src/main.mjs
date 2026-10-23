import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from "electron";
import { checkForUpdates, installUpdate, watchForUpdates } from "./updater.mjs";

const PORT = Number(process.env.PORT ?? 4600);
const APP_URL = `http://localhost:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PATH = [path.join(HOME, ".local/bin"), path.join(HOME, ".npm-global/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");

/** The downloaded app carries its own server (Resources/server); in dev it's the monorepo's. */
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, "server") : path.resolve(here, "../../server");
const SERVER_MAIN = path.join(SERVER_DIR, "src", "main.mjs");
const CLI = path.join(SERVER_DIR, "bin", "mono.mjs");

/** Runs the bundled Node code with this app's own binary, so users don't need Node installed. */
const nodeEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(PORT), PATH: `${PATH}:${process.env.PATH ?? ""}` });

async function isUp() {
  try {
    const res = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok && (await res.json()).app === "mono";
  } catch {
    return false;
  }
}

async function waitUntilUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await isUp()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let server = null;

/** Reuses a running server (the launchd service or `mono`); otherwise runs ours while the app is open. */
async function ensureServer() {
  if (await isUp()) return;
  server = spawn(process.execPath, [SERVER_MAIN], { cwd: HOME, stdio: "inherit", env: nodeEnv() });
  if (!(await waitUntilUp())) throw new Error("Mono server failed to start");
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI, ...args], { env: nodeEnv(), timeout: 11 * 60_000 }, (error, stdout, stderr) =>
      error ? reject(new Error((stderr || stdout || error.message).trim().split("\n").pop())) : resolve(stdout),
    );
  });
}

const notify = (body) => new Notification({ title: "Mono", body }).show();

/**
 * Using Mono from the phone needs the server up even with the app closed: hand it to launchd first
 * (stopping the copy this window started), then pair with the relay through Google in the browser.
 */
/** From the menu it asks first and reports with dialogs; from the in-app panel it just runs and throws. */
async function connectPhone({ fromApp = false } = {}) {
  if (!fromApp) {
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: "Connect phone",
      detail: "Mono will keep running in the background (and at login). Your browser will open: sign in with Google and approve the code.",
      buttons: ["Connect", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  try {
    if (server) {
      server.kill();
      server = null;
      await new Promise((r) => setTimeout(r, 800));
    }
    await runCli(["service", "install", "--if-missing"]);
    await waitUntilUp();
    await runCli(["connect"]);
    if (!fromApp) notify("Mac connected. Sign in with Google on your phone.");
  } catch (error) {
    if (fromApp) throw error;
    dialog.showErrorBox("Couldn't connect", error.message);
  }
}

/** Like VS Code's `code` command: a wrapper in /usr/local/bin that runs the bundled CLI. */
async function installCommand() {
  const wrapper = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${CLI}" "$@"\n`;
  const tmp = path.join(os.tmpdir(), "mono-cli");
  fs.writeFileSync(tmp, wrapper, { mode: 0o755 });
  const script = `do shell script "mkdir -p /usr/local/bin && cp '${tmp}' /usr/local/bin/mono && cp '${tmp}' /usr/local/bin/ws && chmod 755 /usr/local/bin/mono /usr/local/bin/ws" with administrator privileges`;
  execFile("osascript", ["-e", script], (error) => {
    if (error) return error.message.includes("-128") ? undefined : dialog.showErrorBox("Couldn't install", error.message);
    notify("`mono` is now available in the terminal.");
  });
}

function buildMenu() {
  const template = [
    {
      label: "Mono",
      submenu: [
        { role: "about", label: "About Mono" },
        { label: "Check for updates…", click: () => checkForUpdates() },
        { type: "separator" },
        { label: "Connect phone…", click: () => connectPhone() },
        { label: "Install “mono” command in terminal…", click: installCommand },
        { type: "separator" },
        { role: "hide", label: "Hide Mono" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit", label: "Quit Mono" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  buildMenu();
  try {
    await ensureServer();
  } catch (error) {
    dialog.showErrorBox("Mono", error.message);
    return app.quit();
  }
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  // The page shows updates as a toast; it asks for the current one on load and hears about new ones here.
  let available = null;
  watchForUpdates((version) => {
    available = version;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("mono:update", version);
  });
  ipcMain.handle("mono:update", () => available);
  ipcMain.handle("mono:install-update", () => installUpdate());
  ipcMain.handle("mono:connect-phone", () => connectPhone({ fromApp: true }));
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("before-quit", () => server?.kill());
