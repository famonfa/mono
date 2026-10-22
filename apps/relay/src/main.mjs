import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as access from "./db.mjs";
import { landingPage } from "./landing.mjs";
import { adminPage, hostsPage, invitePage, loginPage, messagePage, pairPage, privacyPage } from "./pages.mjs";

/**
 * Mono relay: the public door to your Macs. Machines dial out to it (`mono connect`), you sign in
 * with Google from the phone or any browser, and every request is tunneled to the machine you pick.
 * It keeps no database: sessions and host tokens are HMAC-signed, live connections are in memory.
 */

const PORT = Number(process.env.PORT ?? 4700);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const SECRET = process.env.SESSION_SECRET ?? "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
/** Local testing only: sign in as any email without Google. Refused on https. */
const DEV_LOGIN = !PUBLIC_URL.startsWith("https:") && process.env.DEV_LOGIN === "1";
const SECURE = PUBLIC_URL.startsWith("https:");
const SESSION_DAYS = 30;
const REQUEST_TIMEOUT_MS = 120_000;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC_TYPES = { ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };

if (SECRET.length < 32) throw new Error("SESSION_SECRET tiene que tener al menos 32 caracteres (openssl rand -hex 32)");
if (!access.hasAdmins()) throw new Error("Falta ADMIN_EMAILS (tu email de Google; desde ahí invitás al resto)");
const GOOGLE_READY = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
if (!GOOGLE_READY) console.warn("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET: el login con Google queda apagado");

// ---------- signing & cookies ----------

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");

function sign(payload) {
  const data = b64(JSON.stringify(payload));
  return `${data}.${hmac(data)}`;
}

function verify(token) {
  const [data, mac] = String(token ?? "").split(".");
  if (!data || !mac) return null;
  const expected = Buffer.from(hmac(data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
  return payload.exp && payload.exp < Date.now() ? null : payload;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter(([k]) => k));
}

function setCookie(res, name, value, maxAgeSeconds) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (SECURE) parts.push("Secure");
  res.appendHeader("Set-Cookie", parts.join("; "));
}

const allowed = (email) => access.isAllowed(email);

function sessionEmail(req) {
  const session = verify(parseCookies(req).mono_session);
  return session?.t === "session" && allowed(session.email) ? session.email : null;
}

/** Name and picture ride along in the signed cookie so the app's user widget needs no database. */
function startSession(res, email, profile = {}) {
  const session = { t: "session", email, name: profile.name, picture: profile.picture, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  setCookie(res, "mono_session", sign(session), SESSION_DAYS * 86_400);
}

const sessionProfile = (req) => {
  const session = verify(parseCookies(req).mono_session);
  return { name: session?.name ?? null, picture: session?.picture ?? null };
};

// ---------- http helpers ----------

function send(res, status, body, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

const html = (res, body, status = 200) => send(res, status, body, "text/html; charset=utf-8");

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) return reject(new Error("Body demasiado grande")), req.destroy();
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readForm(req) {
  const raw = (await readBody(req, 64 * 1024)).toString();
  return (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
}

/** Only same-site paths, or the mobile app's deep link, are valid places to land after login. */
const safeNext = (next) => (typeof next === "string" && /^\/(?!\/)/.test(next) ? next : "/");

/** Cookies are SameSite=Lax; this also rejects cross-site form posts that browsers might still send. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === new URL(PUBLIC_URL).origin;
}

// ---------- hosts (Macs connected with `mono connect`) ----------

/** hostId → { ws, email, name, connectedAt, pending } */
const hosts = new Map();
/** hostId → Set<res>: SSE clients survive host reconnects so EventSource never gives up. */
const listeners = new Map();

function onlineCounts() {
  const counts = {};
  for (const host of hosts.values()) counts[host.email] = (counts[host.email] ?? 0) + 1;
  return counts;
}

const hostsFor = (email) => [...hosts.entries()].filter(([, h]) => h.email === email).map(([id, h]) => ({ id, name: h.name, connectedAt: h.connectedAt }));

function forward(hostId, request) {
  const host = hosts.get(hostId);
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error("La máquina no está conectada"));
    const id = randomId(9);
    const timer = setTimeout(() => {
      host.pending.delete(id);
      reject(new Error("La máquina no respondió a tiempo"));
    }, REQUEST_TIMEOUT_MS);
    host.pending.set(id, { resolve, reject, timer });
    host.ws.send(JSON.stringify({ type: "req", id, ...request }));
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

wss.on("connection", (ws) => {
  let hostId = null;
  const hello = setTimeout(() => ws.close(), 10_000);
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "hello" && !hostId) {
      clearTimeout(hello);
      const token = verify(msg.token);
      if (token?.t !== "host" || !allowed(token.email)) {
        ws.send(JSON.stringify({ type: "rejected", reason: token ? "el email ya no está autorizado" : "token inválido" }));
        return ws.close();
      }
      hostId = token.hostId;
      hosts.get(hostId)?.ws.close();
      hosts.set(hostId, { ws, email: token.email, name: String(msg.name ?? token.name).slice(0, 60), connectedAt: new Date().toISOString(), pending: new Map() });
      ws.send(JSON.stringify({ type: "welcome", hostId, email: token.email }));
      console.log(`host conectado: ${token.name} (${token.email})`);
      return;
    }
    const host = hostId && hosts.get(hostId);
    if (!host || host.ws !== ws) return;
    if (msg.type === "res") {
      const pending = host.pending.get(msg.id);
      if (!pending) return;
      host.pending.delete(msg.id);
      clearTimeout(pending.timer);
      pending.resolve(msg);
    }
    if (msg.type === "event") for (const res of listeners.get(hostId) ?? []) res.write(msg.frame);
  });
  ws.on("close", () => {
    clearTimeout(hello);
    const host = hostId && hosts.get(hostId);
    if (!host || host.ws !== ws) return;
    hosts.delete(hostId);
    for (const { reject, timer } of host.pending.values()) clearTimeout(timer), reject(new Error("La máquina se desconectó"));
  });
});

// ---------- pairing (`mono connect`) and mobile sign-in codes ----------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const shortCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("").replace(/^(.{4})/, "$1-");

/** code → { pollToken, name, expires, status, result } */
const pairings = new Map();
/** one-time code → { email, expires } handed to the mobile app through its deep link */
const mobileCodes = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [code, p] of pairings) if (p.expires < now) pairings.delete(code);
  for (const [code, m] of mobileCodes) if (m.expires < now) mobileCodes.delete(code);
}, 60_000).unref();

// ---------- routes ----------

/** Google said who you are; you're in if you're an admin, a user, or have a pending invite. */
function finishLogin(res, rawEmail, next, profile) {
  const email = String(rawEmail).trim().toLowerCase();
  if (!allowed(email) && !access.acceptInvite(email)) {
    return html(res, messagePage("Sin acceso", `${email || "Ese email"} no tiene invitación. Pedile a quien usa Mono que te invite.`, { href: "/_mono/logout", label: "Probar con otra cuenta" }), 403);
  }
  startSession(res, email, profile);
  return redirect(res, safeNext(next));
}

/** Machines of a removed user must stop answering right away, not at their next reconnect. */
function disconnectUser(email) {
  for (const host of hosts.values()) if (host.email === email) host.ws.close();
}

async function relayRoute(req, res, url) {
  const route = url.pathname.slice("/_mono".length);
  const email = sessionEmail(req);

  if (route === "/health") return send(res, 200, { ok: true, hosts: hosts.size });
  if (route === "/privacidad") return html(res, privacyPage());



  if (route.startsWith("/static/")) {
    const file = path.join(PUBLIC_DIR, path.basename(route));
    const type = STATIC_TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return fs.createReadStream(file).pipe(res);
  }

  if (route === "/login") return html(res, loginPage({ next: safeNext(url.searchParams.get("next")), dev: DEV_LOGIN, app: (req.headers["user-agent"] ?? "").includes("MonoApp"), ios: /iPhone|iPad/.test(req.headers["user-agent"] ?? "") }));

  if (route === "/auth/google") {
    if (!GOOGLE_READY) return html(res, messagePage("Login no configurado", "Este relay todavía no tiene credenciales de Google."), 503);
    const state = randomId();
    setCookie(res, "mono_oauth", sign({ t: "oauth", state, next: url.searchParams.get("next") ?? "/", exp: Date.now() + 10 * 60_000 }), 600);
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.search = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${PUBLIC_URL}/_mono/auth/callback`, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
    return redirect(res, google.toString());
  }

  if (route === "/auth/callback") {
    const pending = verify(parseCookies(req).mono_oauth);
    if (pending?.t !== "oauth" || pending.state !== url.searchParams.get("state")) return html(res, messagePage("No se pudo entrar", "El login venció. Probá de nuevo."), 400);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") ?? "", client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${PUBLIC_URL}/_mono/auth/callback`, grant_type: "authorization_code" }),
    });
    const tokens = await tokenRes.json();
    // The id_token comes straight from Google over TLS, so its claims can be read without checking the signature.
    const claims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) : {};
    const validIssuer = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
    if (!validIssuer || claims.aud !== GOOGLE_CLIENT_ID || !claims.email_verified) return html(res, messagePage("No se pudo entrar", "Google no confirmó tu email."), 403);
    setCookie(res, "mono_oauth", "", 0);
    return finishLogin(res, claims.email, pending.next, { name: claims.name, picture: claims.picture });
  }

  if (route === "/auth/dev" && DEV_LOGIN) return finishLogin(res, url.searchParams.get("email") ?? "", url.searchParams.get("next"));

  if (route.startsWith("/invite/")) {
    const invite = access.getInvite(route.slice("/invite/".length));
    if (!invite) return html(res, messagePage("Invitación inválida", "Pedile a quien te invitó un link nuevo."), 404);
    return html(res, invitePage({ invite, dev: DEV_LOGIN }));
  }

  if (route === "/logout") {
    setCookie(res, "mono_session", "", 0);
    setCookie(res, "mono_host", "", 0);
    return redirect(res, "/_mono/login");
  }

  if (route === "/pair/start" && req.method === "POST") {
    if (pairings.size > 50) return send(res, 429, { error: "Demasiados códigos pendientes" });
    const body = await readForm(req);
    const code = shortCode();
    const pollToken = randomId(32);
    pairings.set(code, { pollToken, name: String(body.name ?? "Mac").slice(0, 60), expires: Date.now() + 10 * 60_000, status: "pending" });
    return send(res, 200, { code, pollToken, url: `${PUBLIC_URL}/_mono/pair?code=${code}` });
  }

  if (route === "/pair/poll" && req.method === "POST") {
    const { pollToken } = await readForm(req);
    const entry = [...pairings.entries()].find(([, p]) => p.pollToken === pollToken);
    if (!entry) return send(res, 200, { status: "expired" });
    const [code, pairing] = entry;
    if (pairing.status !== "approved") return send(res, 200, { status: pairing.status });
    pairings.delete(code);
    return send(res, 200, { status: "approved", ...pairing.result });
  }

  if (route === "/mobile/exchange") {
    const entry = mobileCodes.get(url.searchParams.get("code") ?? "");
    mobileCodes.delete(url.searchParams.get("code") ?? "");
    if (!entry || entry.expires < Date.now()) return redirect(res, "/_mono/login");
    startSession(res, entry.email);
    return redirect(res, "/");
  }

  // Everything below needs a signed-in user.
  if (!email) return route === "/me" ? send(res, 401, { error: "Iniciá sesión" }) : redirect(res, `/_mono/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  if (route === "/me") {
    const picked = pickedHost(req, email);
    const mine = hostsFor(email);
    const host = mine.find((h) => h.id === picked) ?? (mine.length === 1 ? mine[0] : null);
    return send(res, 200, { mode: "remote", email, ...sessionProfile(req), admin: access.isAdmin(email), host: host && { id: host.id, name: host.name }, hosts: mine.map(({ id, name }) => ({ id, name })) });
  }

  if (route === "/mobile/done") {
    const code = randomId(24);
    mobileCodes.set(code, { email, expires: Date.now() + 2 * 60_000 });
    return redirect(res, `com.famonfa.mono://auth?code=${code}`);
  }

  if (route === "/pair" && req.method === "GET") {
    const code = String(url.searchParams.get("code") ?? "").toUpperCase();
    const pairing = pairings.get(code);
    if (!pairing || pairing.status !== "pending") return html(res, messagePage("Código vencido", "Corré `mono connect` de nuevo en la terminal."), 404);
    return html(res, pairPage({ code, name: pairing.name, email }));
  }

  if (route === "/pair/approve" && req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    const { code } = await readForm(req);
    const pairing = pairings.get(String(code ?? "").toUpperCase());
    if (!pairing || pairing.status !== "pending") return html(res, messagePage("Código vencido", "Corré `mono connect` de nuevo en la terminal."), 404);
    const hostId = randomId(12);
    pairing.status = "approved";
    pairing.result = { hostId, email, token: sign({ t: "host", hostId, email, name: pairing.name, iat: Date.now() }) };
    return html(res, messagePage("Listo ✓", `${pairing.name} quedó conectada a tu cuenta. Volvé a la terminal.`, { href: "/", label: "Abrir Mono" }));
  }

  if (route === "/hosts" && req.method === "GET") return html(res, hostsPage({ email, hosts: hostsFor(email), current: pickedHost(req, email), admin: access.isAdmin(email), relay: PUBLIC_URL }));

  if (route.startsWith("/admin")) {
    if (!access.isAdmin(email)) return html(res, messagePage("Sin permiso", "Solo los admins pueden invitar gente."), 403);
    if (req.method === "POST") {
      if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
      const form = await readForm(req);
      let notice = null;
      try {
        if (route === "/admin/invite") {
          const invite = access.createInvite(form.email, email);
          notice = { link: `${PUBLIC_URL}/_mono/invite/${invite.token}`, email: invite.email };
        }
        if (route === "/admin/revoke") access.revokeInvite(form.token);
        if (route === "/admin/remove" && !access.isAdmin(form.email)) {
          access.removeUser(form.email);
          disconnectUser(String(form.email).toLowerCase());
        }
      } catch (error) {
        notice = { error: error.message };
      }
      return html(res, adminPage({ email, ...access.listAccess(), online: onlineCounts(), notice, relay: PUBLIC_URL }));
    }
    return html(res, adminPage({ email, ...access.listAccess(), online: onlineCounts(), relay: PUBLIC_URL }));
  }

  if (route === "/hosts/select" && req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    const { hostId } = await readForm(req);
    if (!hostsFor(email).some((h) => h.id === hostId)) return redirect(res, "/_mono/hosts");
    pickHost(res, email, hostId);
    return redirect(res, "/");
  }

  return send(res, 404, { error: "not found" });
}

/** Everything that isn't `/_mono/*` is the Mono app itself, served by the chosen machine. */
async function tunnel(req, res, url) {
  const isApi = /^\/(api|files)\//.test(url.pathname);
  const email = sessionEmail(req);
  if (!email && url.pathname === "/" && req.method === "GET") return html(res, landingPage({ relay: PUBLIC_URL }));
  if (!email) return isApi ? send(res, 401, { error: "Iniciá sesión" }) : redirect(res, `/_mono/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  let hostId = pickedHost(req, email);
  if (!hostId) {
    const mine = hostsFor(email);
    if (mine.length !== 1) return isApi ? send(res, 503, { error: "Elegí una máquina" }) : redirect(res, "/_mono/hosts");
    hostId = mine[0].id;
    pickHost(res, email, hostId);
  }

  if (url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    if (!listeners.has(hostId)) listeners.set(hostId, new Set());
    listeners.get(hostId).add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      listeners.get(hostId)?.delete(res);
    });
    return;
  }

  if (!hosts.has(hostId)) return isApi ? send(res, 503, { error: "Tu Mac está desconectada. ¿Está prendida y con `mono` corriendo?" }) : redirect(res, "/_mono/hosts");
  if (req.method !== "GET" && !sameOrigin(req)) return send(res, 403, { error: "forbidden" });

  try {
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : null;
    const reply = await forward(hostId, {
      method: req.method,
      path: url.pathname + url.search,
      headers: { "content-type": req.headers["content-type"] },
      body: body?.length ? body.toString("base64") : null,
    });
    for (const [key, value] of Object.entries(reply.headers ?? {})) res.setHeader(key, value);
    res.statusCode = reply.status;
    res.end(Buffer.from(reply.body ?? "", "base64"));
  } catch (error) {
    send(res, 502, { error: error.message });
  }
}

/** The chosen machine is remembered in a signed cookie, so it still resolves while that Mac is offline. */
function pickedHost(req, email) {
  const pick = verify(parseCookies(req).mono_host);
  return pick?.t === "pick" && pick.email === email ? pick.hostId : null;
}

const pickHost = (res, email, hostId) => setCookie(res, "mono_host", sign({ t: "pick", email, hostId }), SESSION_DAYS * 86_400);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (url.pathname.startsWith("/_mono/")) return await relayRoute(req, res, url);
    return await tunnel(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "Error interno" });
  }
});

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, PUBLIC_URL).pathname !== "/_mono/host") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORT, () => console.log(`Mono relay en ${PUBLIC_URL} (puerto ${PORT})${DEV_LOGIN ? " — login de desarrollo activado" : ""}`));
