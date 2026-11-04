import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PATH } from "./prs.mjs";

/** Metro bundlers started from a PR, one per PR, so a POS can load that PR's code live. */

const exec = promisify(execFile);
const FIRST_PORT = 8081;
const READY_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const LOG_LINES = 12;
const DEEP_LINK = /exp\+[\w-]+:\/\/expo-development-client\/\?url=[^\s\u001b]+/;
// Mono runs inside Electron, and CI turns off Metro's file watcher.
const { ELECTRON_RUN_AS_NODE: _electron, CI: _ci, ...parentEnv } = process.env;
const env = { ...parentEnv, PATH, EXPO_NO_TELEMETRY: "1" };

const servers = new Map();

function lanAddress() {
  const interfaces = os.networkInterfaces();
  const names = Object.keys(interfaces).sort((a, b) => (b === "en0") - (a === "en0"));
  for (const name of names) {
    const found = interfaces[name]?.find((i) => i.family === "IPv4" && !i.internal);
    if (found) return found.address;
  }
  return "127.0.0.1";
}

const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolve(true)));
  });

async function freePort() {
  const taken = new Set([...servers.values()].map((s) => s.port));
  for (let port = FIRST_PORT; port < FIRST_PORT + 50; port++) if (!taken.has(port) && (await portIsFree(port))) return port;
  throw new Error("No free port for Metro");
}

export function metroLink(schemes, host, port) {
  const scheme = schemes.find((s) => s.startsWith("exp+")) ?? `exp+${schemes[0]}`;
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(`http://${host}:${port}`)}`;
}

export function metroState(key) {
  const server = servers.get(key);
  if (!server) return { status: "stopped" };
  const { status, port, host, link, tunnel, error, log, stale } = server;
  return { status, port, host, link, tunnel, error, stale, log: status === "failed" ? log.slice(-LOG_LINES) : undefined };
}

/** Files git ignores but the app can't build without, like generated GraphQL types. */
async function generatedFiles(repo) {
  const { stdout } = await exec("git", ["-C", repo, "ls-files", "--others", "--ignored", "--exclude-standard", "--", "*.generated.*"], { env, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split("\n").filter((f) => f && !f.endsWith("/") && !f.startsWith("."));
}

/**
 * Generates them from the PR's own code. The schema comes from the app's API host, or the one codegen uses for
 * production: it only reads the schema, never data. The main checkout's copies are the last resort.
 */
async function generate(cwd, mainRepo, update) {
  const files = await generatedFiles(mainRepo);
  const { stdout } = await exec("git", ["-C", cwd, "ls-files", "*.graphql"], { env });
  const operations = stdout.split("\n").filter(Boolean).map((f) => f.replace(/\.graphql$/, ".generated.ts"));
  if ([...files, ...operations].every((f) => fs.existsSync(path.join(cwd, f)))) return;
  update({ status: "generating" });
  const scripts = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).scripts ?? {};
  if (scripts.codegen) {
    for (const extra of [{}, { ENVIRONMENT: "production" }]) {
      // codegen exits 0 even when it can't load the schema.
      const out = await exec("npm", ["run", "codegen"], { cwd, env: { ...env, DOTENV_CONFIG_PATH: ".env.local", ...extra }, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout + r.stderr, () => "[FAILED]");
      if (!out.includes("[FAILED]")) return;
    }
  }
  for (const file of files) {
    const to = path.join(cwd, file);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(mainRepo, file), to);
  }
  update({ stale: true });
}

/** A fresh worktree has no dependencies, local settings or generated code: git doesn't track any of them. */
async function prepare(cwd, mainRepo, update) {
  for (const file of [".env.local", ".env"]) {
    const from = path.join(mainRepo, file);
    const to = path.join(cwd, file);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
  if (!fs.existsSync(path.join(cwd, "node_modules"))) {
    update({ status: "installing" });
    await exec("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], { cwd, env, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  }
  await generate(cwd, mainRepo, update);
}

const ready = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) });
    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
};

/** Starts Metro for a PR and returns right away; `notify` runs on every change of state. */
export function startMetro(key, { cwd, mainRepo, schemes, tunnel = false, notify = () => {} }) {
  const current = servers.get(key);
  if (current && current.status !== "failed") return metroState(key);
  const server = { status: "starting", tunnel, cwd, log: [], host: lanAddress(), port: null, link: null, error: null, child: null };
  servers.set(key, server);
  const update = (patch) => {
    Object.assign(server, patch);
    notify();
  };
  const fail = (error) => {
    server.child = null;
    update({ status: "failed", error: String(error?.stderr || error?.message || error).trim().slice(-400) });
  };
  (async () => {
    await prepare(cwd, mainRepo, update);
    if (servers.get(key) !== server) return;
    const port = await freePort();
    update({ status: "starting", port });
    const child = spawn("npx", ["expo", "start", "--dev-client", "--port", String(port), ...(tunnel ? ["--tunnel"] : [])], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    server.child = child;
    const read = (chunk) => {
      const text = chunk.toString();
      server.log.push(...text.split("\n").filter(Boolean));
      server.log.splice(0, Math.max(0, server.log.length - 200));
      const printed = text.match(DEEP_LINK)?.[0];
      if (printed) update({ link: printed });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", fail);
    child.on("exit", (code) => {
      if (servers.get(key) !== server) return;
      server.child = null;
      if (!["stopping", "failed"].includes(server.status)) fail(`Metro exited (${code ?? "signal"}). ${server.log.slice(-3).join(" ")}`);
    });
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (server.child && Date.now() < deadline) {
      // The tunnel's address arrives after Metro is up, and only that link reaches another network.
      if ((await ready(port)) && (!tunnel || server.link)) {
        update({ status: "running", link: server.link ?? metroLink(schemes, server.host, port) });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (server.child) {
      const reason = tunnel ? "The tunnel didn't start. It needs @expo/ngrok: npm install -g @expo/ngrok" : "Metro didn't start in time";
      stopMetro(key);
      servers.set(key, server);
      fail(reason);
    }
  })().catch(fail);
  return metroState(key);
}

export function stopMetro(key) {
  const server = servers.get(key);
  if (!server) return { status: "stopped" };
  server.status = "stopping";
  // Detached: npx, expo and node share a group, and killing only npx would leave Metro holding the port.
  if (server.child?.pid) {
    try {
      process.kill(-server.child.pid, "SIGTERM");
    } catch {}
  }
  servers.delete(key);
  return { status: "stopped" };
}

function stopAll() {
  for (const key of [...servers.keys()]) stopMetro(key);
}

process.once("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopAll();
    process.exit(0);
  });
}
