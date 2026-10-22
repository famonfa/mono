import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_DIR, REPO_ROOT, writeConfig } from "./paths.mjs";
import { STATUS_FILE, readRemote, writeRemote } from "./remote.mjs";

const HOME = os.homedir();
export const PORT = Number(process.env.PORT ?? 4600);
export const APP_URL = `http://localhost:${PORT}`;
/** The shared relay everyone signs in to; override with MONO_RELAY or `mono connect <url>`. */
export const DEFAULT_RELAY = process.env.MONO_RELAY ?? "https://mono.155-181-39-178.sslip.io";
const SERVER_MAIN = path.join(PKG_DIR, "src", "main.mjs");
const CLI = path.join(PKG_DIR, "bin", "mono.mjs");
/** `npx` runs from a cache folder that can disappear, so nothing long-lived should point at it. */
const EPHEMERAL = PKG_DIR.includes(`${path.sep}_npx${path.sep}`);
const BUNDLED_SKILL = path.join(PKG_DIR, "skills", "workspace");
const SKILL_DIR = path.join(HOME, ".claude", "skills", "workspace");
const LOG = path.join(HOME, "Library", "Logs", "mono.log");
const SERVICE = "com.famonfa.mono";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${SERVICE}.plist`);
const PATH = [path.join(HOME, ".local/bin"), path.join(HOME, ".npm-global/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");

export async function isUp() {
  try {
    const res = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok && (await res.json()).app === "mono";
  } catch {
    return false;
  }
}

/**
 * Lets the desktop app find the server without hardcoding a path, and gives Claude Code the
 * `/workspace` skill that "Actualizar con IA" relies on (never overwriting one you already have).
 */
function setup() {
  if (!EPHEMERAL) writeConfig({ server: SERVER_MAIN, node: process.execPath });
  if (fs.existsSync(BUNDLED_SKILL) && !fs.existsSync(SKILL_DIR)) fs.cpSync(BUNDLED_SKILL, SKILL_DIR, { recursive: true });
}

/** Starts the server in the background unless it (or the launchd service) is already up. */
export async function ensureServer() {
  setup();
  if (await isUp()) return;
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.openSync(LOG, "a");
  spawn(process.execPath, [SERVER_MAIN], { cwd: HOME, detached: true, stdio: ["ignore", out, out], env: { ...process.env, PATH: `${PATH}:${process.env.PATH}` } }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isUp()) return;
  }
  throw new Error(`El server no arrancó; mirá ${LOG}`);
}

/** Opens Mono like `t3` does: the installed desktop app, the dev Electron shell, or the browser. */
export function openApp(hash = "") {
  const installed = ["/Applications/Mono.app", path.join(HOME, "Applications", "Mono.app")].find((p) => fs.existsSync(p));
  if (installed) return execFileSync("open", ["-a", installed]), "desktop";
  const electron = REPO_ROOT && path.join(REPO_ROOT, "node_modules", ".bin", "electron");
  if (electron && fs.existsSync(electron)) {
    // Terminals inside Electron apps (T3 Code, VS Code) export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
    spawn(electron, [path.join(REPO_ROOT, "apps", "desktop")], { detached: true, stdio: "ignore", env: { ...env, MONO_HASH: hash } }).unref();
    return "desktop";
  }
  execFileSync("open", [`${APP_URL}/${hash}`]);
  return "browser";
}

/**
 * `npx @famonfa/mono` runs from npm's cache, which can be wiped, while the server has to outlive it
 * (launchd, remote access). So npx only bootstraps: it installs the same version into ~/.mono/runtime
 * once and hands every command to that copy.
 */
export function runFromRuntime() {
  if (!EPHEMERAL || process.env.MONO_NO_BOOTSTRAP) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  const runtime = path.join(HOME, ".mono", "runtime");
  const installed = path.join(runtime, "node_modules", ...pkg.name.split("/"));
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8")).version;
  } catch {}
  if (current !== pkg.version) {
    console.log(current ? `Actualizando Mono ${current} → ${pkg.version}…` : `Instalando Mono ${pkg.version}…`);
    fs.mkdirSync(runtime, { recursive: true });
    if (!fs.existsSync(path.join(runtime, "package.json"))) fs.writeFileSync(path.join(runtime, "package.json"), '{ "private": true }\n');
    execFileSync("npm", ["install", "--prefix", runtime, "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error", process.env.MONO_RUNTIME_SPEC ?? `${pkg.name}@${pkg.version}`], { stdio: "inherit" });
  }
  const result = spawnSync(process.execPath, [path.join(installed, "bin", "mono.mjs"), ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, MONO_NO_BOOTSTRAP: "1" } });
  process.exit(result.status ?? 1);
}

export async function launch(hash) {
  await ensureServer();
  const where = openApp(hash);
  console.log(`🐒 Mono en ${APP_URL} (${where === "desktop" ? "app de escritorio" : "navegador"})`);
}

/**
 * Pairs this machine with a relay so the phone/web can reach it: the relay hands out a short code,
 * you approve it signed in with Google, and the relay returns a host token saved in ~/.mono.
 */
export async function connect(relayArg, name = os.hostname().replace(/\.local$/, "")) {
  const relay = new URL(relayArg ?? readRemote()?.relay ?? DEFAULT_RELAY).origin;
  const post = async (route, body) => {
    const res = await fetch(new URL(route, relay), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
    return json;
  };
  const { code, pollToken, url } = await post("/_mono/pair/start", { name });
  console.log(`\nAbrí este link y entrá con Google para conectar "${name}":\n\n  ${url}\n\nCódigo: ${code}\n`);
  try {
    execFileSync("open", [url]);
  } catch {}
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await post("/_mono/pair/poll", { pollToken });
    if (result.status === "approved") {
      writeRemote({ relay, token: result.token, hostId: result.hostId, email: result.email, name });
      // Remote access only helps if the server is still up after a reboot.
      if (!fs.existsSync(PLIST) && !REPO_ROOT) installService();
      await ensureServer();
      console.log(`✓ ${name} conectado a ${relay} como ${result.email}. Abrí ${relay} desde el celular.`);
      return;
    }
    if (result.status !== "pending") throw new Error("El código expiró o fue rechazado");
  }
  throw new Error("Se venció el tiempo para aprobar el código");
}

export function disconnect() {
  writeRemote(null);
  console.log("✓ Desconectado del relay");
}

/** How to spell commands back to the user: npx users don't have `mono` on their PATH. */
const CMD = process.env.MONO_NO_BOOTSTRAP ? "npx @famonfa/mono" : "mono";

export async function status() {
  const remote = readRemote();
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {}
  console.log(`Server:  ${(await isUp()) ? `✓ ${APP_URL}` : `✗ apagado (corré \`${CMD}\`)`}`);
  console.log(`Servicio: ${fs.existsSync(PLIST) ? "instalado (arranca solo al iniciar sesión)" : `no instalado (\`${CMD} service install\`)`}`);
  if (!remote) return console.log(`Remoto:  sin conectar (\`${CMD} connect\`)`);
  console.log(`Remoto:  ${remote.relay} · ${remote.email} · ${live?.state ?? "?"}${live?.reason ? ` (${live.reason})` : ""}`);
}

/** Runs the server at login via launchd and puts `mono`/`ws` on PATH. */
export function installService({ ifMissing = false } = {}) {
  // The desktop app asks with ifMissing so it never replaces a service someone set up from a checkout.
  if (ifMissing && fs.existsSync(PLIST)) return console.log(`✓ Servicio ${SERVICE} ya instalado`);
  if (EPHEMERAL) throw new Error("Corré `npx @famonfa/mono service install`");
  setup();
  // npm's global install already puts mono/ws on PATH; a checkout links them into ~/.local/bin.
  if (REPO_ROOT) {
    const bin = path.join(HOME, ".local", "bin");
    fs.mkdirSync(bin, { recursive: true });
    for (const name of ["mono", "ws"]) {
      fs.rmSync(path.join(bin, name), { force: true });
      fs.symlinkSync(CLI, path.join(bin, name));
    }
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${SERVER_MAIN}</string></array>
  <key>WorkingDirectory</key><string>${HOME}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${PATH}</string>${process.versions.electron ? "<key>ELECTRON_RUN_AS_NODE</key><string>1</string>" : ""}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  const domain = `gui/${process.getuid()}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${SERVICE}`], { stdio: "ignore" });
  } catch {}
  // bootout finishes asynchronously; bootstrap fails with EIO until the old job is gone.
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync("launchctl", ["bootstrap", domain, PLIST], { stdio: "pipe" });
      break;
    } catch (error) {
      if (attempt >= 10) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  console.log(`✓ Servicio ${SERVICE} → ${SERVER_MAIN}`);
}

export function uninstallService() {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${SERVICE}`], { stdio: "ignore" });
  } catch {}
  fs.rmSync(PLIST, { force: true });
  console.log(`✓ Servicio ${SERVICE} desinstalado`);
}
