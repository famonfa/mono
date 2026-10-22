import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

export const CONFIG_DIR = path.join(os.homedir(), ".mono");
export const REMOTE_FILE = path.join(CONFIG_DIR, "remote.json");

export function readRemote() {
  try {
    return JSON.parse(fs.readFileSync(REMOTE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function writeRemote(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (config) fs.writeFileSync(REMOTE_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  else fs.rmSync(REMOTE_FILE, { force: true });
}

/** Status the relay connection publishes for `mono status`. */
export const STATUS_FILE = path.join(CONFIG_DIR, "remote-status.json");

/**
 * Keeps an outbound WebSocket to the relay (`mono connect`) so the phone or any browser can use this
 * machine without opening ports. The relay sends HTTP requests over the socket; they are replayed
 * against the local server as if they came from localhost, so the API's own checks still apply.
 * Server events are pushed up as SSE frames for the relay to fan out.
 */
export function startRemote({ port }) {
  let socket = null;
  let retry = 1000;
  let config = null;

  const writeStatus = (status) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...status, relay: config?.relay ?? null, at: new Date().toISOString() }));
    } catch {}
  };

  function connect() {
    config = readRemote();
    if (!config?.relay || !config?.token) return writeStatus({ state: "off" });
    const url = new URL("/_mono/host", config.relay);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
    socket = ws;
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on("pong", () => (alive = true));
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: config.token, name: config.name ?? os.hostname() })));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        retry = 1000;
        console.log(`Mono conectado al relay ${config.relay} como ${msg.email}`);
        writeStatus({ state: "connected", email: msg.email, hostId: msg.hostId });
      }
      if (msg.type === "rejected") {
        console.error(`El relay rechazó esta máquina: ${msg.reason}`);
        writeStatus({ state: "rejected", reason: msg.reason });
        retry = 5 * 60_000;
      }
      if (msg.type === "req") proxy(ws, msg, port);
    });
    ws.on("error", (error) => writeStatus({ state: "error", reason: error.message }));
    ws.on("close", () => {
      clearInterval(heartbeat);
      if (socket !== ws) return;
      socket = null;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 5 * 60_000);
    });
  }

  // `mono connect` / `mono disconnect` rewrite the config file; pick it up without a restart.
  fs.watchFile(REMOTE_FILE, { interval: 2000 }, () => {
    const previous = socket;
    socket = null;
    previous?.close();
    retry = 1000;
    connect();
  });
  connect();

  return {
    forward(frame) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "event", frame }));
    },
  };
}

function proxy(ws, msg, port) {
  const headers = { host: `localhost:${port}` };
  if (msg.headers?.["content-type"]) headers["content-type"] = msg.headers["content-type"];
  if (msg.method !== "GET" && msg.method !== "HEAD") headers.origin = `http://localhost:${port}`;
  const body = msg.body ? Buffer.from(msg.body, "base64") : null;
  if (body) headers["content-length"] = body.length;

  const reply = (status, resHeaders, chunks) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "res", id: msg.id, status, headers: resHeaders, body: Buffer.concat(chunks).toString("base64") }));
  };

  const req = http.request({ host: "127.0.0.1", port, method: msg.method, path: msg.path, headers }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => reply(res.statusCode, pick(res.headers, ["content-type", "cache-control"]), chunks));
  });
  req.on("error", (error) => reply(502, { "content-type": "application/json" }, [Buffer.from(JSON.stringify({ error: error.message }))]));
  req.end(body ?? undefined);
}

const pick = (headers, keys) => Object.fromEntries(keys.filter((k) => headers[k]).map((k) => [k, headers[k]]));
