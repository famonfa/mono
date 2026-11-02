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
/** Desktop app zips that `npx @famonfa/mono` installs (uploaded by publish-desktop.sh, kept across deploys). */
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? path.resolve("downloads");
const DOWNLOADS = new Set(["Mono-arm64.zip", "Mono-x64.zip"]);
const STATIC_TYPES = { ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".js": "text/javascript; charset=utf-8" };

if (SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)");
if (!access.hasAdmins()) throw new Error("Missing ADMIN_EMAILS (your Google email; admins can block members from /_mono/admin)");
const GOOGLE_READY = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
if (!GOOGLE_READY) console.warn("Missing GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: Google sign-in is disabled");

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
      if (size > limit) return reject(new Error("Body too large")), req.destroy();
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
/** hostId → Map<res, guest|null>: SSE clients survive host reconnects so EventSource never gives up. */
const listeners = new Map();

function onlineCounts() {
  const counts = {};
  for (const host of hosts.values()) counts[host.email] = (counts[host.email] ?? 0) + 1;
  return counts;
}

const hostsFor = (email) => [...hosts.entries()].filter(([, h]) => h.email === email).map(([id, h]) => ({ id, name: h.name, connectedAt: h.connectedAt }));

// ---------- sharing ----------

const shareLink = (id) => `${PUBLIC_URL}/s/${id}`;
const withLink = (share) => share && { ...share, link: shareLink(share.id) };
const sharedWith = (email) => access.sharedWith(email).map((s) => ({ ...withLink(s), online: hosts.get(s.hostId)?.email === s.owner, hostName: hosts.get(s.hostId)?.name ?? null }));

/** What a guest's requests carry to the owner's Mac: who they are and the only scope they may touch. */
function guestScope(email, shareId, profile = {}) {
  const share = access.getShare(shareId);
  const role = share && access.roleOn(shareId, email);
  if (!role) return null;
  return { email, name: profile.name ?? null, shareId: share.id, owner: share.owner, hostId: share.hostId, projectId: share.projectId || null, pageId: share.pageId, sessionId: share.sessionId, title: share.title, role };
}

/**
 * A guest's event stream only gets what their scope can show: data changes of the shared project,
 * session list pings (ids only; the list itself is filtered by the Mac) and chats the Mac tagged as theirs.
 */
function guestFrame(frame, guest) {
  const match = /^event: ([^\n]+)\ndata: (.*)\n\n$/s.exec(frame);
  if (!match) return null;
  const [, event, raw] = match;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (event === "ws:sessions") return frame;
  if (event === "ws:data") {
    const tasks = guest.projectId && !guest.sessionId ? (data.tasks ?? []).filter((t) => t === guest.projectId) : [];
    return tasks.length ? `event: ws:data\ndata: ${JSON.stringify({ tasks })}\n\n` : null;
  }
  if (event === "ws:chat") {
    const visible = data.sessionId === guest.sessionId || data.shareId === guest.shareId || (!guest.pageId && !guest.sessionId && data.projectId === guest.projectId);
    if (!visible) return null;
    const { projectId, shareId, ...rest } = data;
    return `event: ws:chat\ndata: ${JSON.stringify(rest)}\n\n`;
  }
  return null;
}

/** The Mac's own calls (from its local server): authenticated with the host token `mono connect` stored. */
function hostCaller(req) {
  const token = verify((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  return token?.t === "host" && allowed(token.email) ? { email: token.email, hostId: token.hostId } : null;
}

async function hostApi(req, res, route) {
  const caller = hostCaller(req);
  if (!caller) return send(res, 401, { error: "This Mac isn't connected to the relay" });
  const { email, hostId } = caller;
  const parts = route.split("/").filter(Boolean).map(decodeURIComponent);
  const [resource, id, sub, subId] = parts;
  const url = new URL(req.url, PUBLIC_URL);
  const body = ["POST", "PUT"].includes(req.method) ? await readForm(req) : {};
  try {
    if (resource === "shared" && req.method === "GET") return send(res, 200, sharedWith(email));
    // A guest's own Mac reading what was shared with them (to give its own agent the context): read-only,
    // through the same guest checks as in the browser.
    if (resource === "shares" && id && sub === "proxy" && req.method === "GET") {
      const guest = guestScope(email, id);
      if (!guest) return send(res, 403, { error: "Not shared with you" });
      if (hosts.get(guest.hostId)?.email !== guest.owner) return send(res, 503, { error: `${guest.title} lives on ${guest.owner}'s Mac, which is offline right now` });
      const rest = route.split("/").slice(4).join("/");
      const reply = await forward(guest.hostId, { method: "GET", path: `/${rest}${url.search}`, headers: {}, body: null, guest });
      res.statusCode = reply.status;
      res.setHeader("Content-Type", reply.headers?.["content-type"] ?? "application/json");
      return res.end(Buffer.from(reply.body ?? "", "base64"));
    }
    if (resource !== "shares") return send(res, 404, { error: "not found" });
    if (!id && req.method === "GET") return send(res, 200, access.sharesFor(email, hostId, url.searchParams.get("project")).map(withLink));
    if (!id && req.method === "POST") {
      return send(res, 200, withLink(access.ensureShare({ owner: email, hostId, projectId: body.projectId ? String(body.projectId) : null, pageId: body.pageId ? String(body.pageId) : null, sessionId: body.sessionId ? String(body.sessionId) : null, title: body.title })));
    }
    if (id && sub === "people" && !subId && req.method === "POST") return send(res, 200, withLink(access.grant(id, email, body.email, body.role ?? "viewer")));
    if (id && sub === "people" && subId && req.method === "DELETE") {
      const share = withLink(access.revoke(id, email, subId));
      disconnectGuest(id, subId);
      return send(res, 200, share);
    }
    if (id && sub === "general" && req.method === "PUT") {
      const share = withLink(access.setGeneral(id, email, body.general ?? null));
      if (!share.general) disconnectGuest(id);
      return send(res, 200, share);
    }
    if (id && !sub && req.method === "DELETE") {
      access.deleteShare(id, email);
      disconnectGuest(id);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
}

/** Closes the event streams of guests who just lost access (their next request is refused anyway). */
function disconnectGuest(shareId, email) {
  for (const clients of listeners.values()) {
    for (const [res, guest] of clients) {
      if (guest?.shareId === shareId && (!email || guest.email === String(email).toLowerCase()) && !access.roleOn(shareId, guest.email)) res.end();
    }
  }
}

/** `/s/<id>`: a shared link. Signed-in people with access drive the owner's Mac inside that scope. */
function openShare(req, res, url, id) {
  const email = sessionEmail(req);
  if (!email) return redirect(res, `/_mono/login?next=${encodeURIComponent(url.pathname)}`);
  const share = access.getShare(id);
  if (!share) return html(res, messagePage("Link not found", "This share was removed. Ask for a new link."), 404);
  const target = shareTarget(share);
  if (share.owner === email) {
    // The owner opening their own link just goes to that Mac.
    pickHost(res, email, share.hostId);
    return redirect(res, target);
  }
  if (!access.roleOn(id, email)) {
    return html(res, messagePage("No access", `${email} can't open this. Ask ${share.ownerName ?? share.owner} to share it with you.`, { href: "/_mono/logout", label: "Use another account" }), 403);
  }
  access.markOpened(id, email);
  if (hosts.get(share.hostId)?.email !== share.owner) {
    return html(res, messagePage("Their Mac is offline", `${share.title} lives on ${share.ownerName ?? share.owner}'s Mac, which isn't connected right now. Try again later.`, { href: "/_mono/hosts", label: "Back" }), 503);
  }
  setCookie(res, "mono_host", sign({ t: "pick", email, hostId: share.hostId, shareId: share.id }), SESSION_DAYS * 86_400);
  return redirect(res, target);
}

const shareTarget = (share) => {
  const enc = encodeURIComponent;
  if (share.sessionId) return `/#/agentes/${enc(share.sessionId)}`;
  if (share.pageId) return `/#/t/${enc(share.projectId)}/f/${enc(share.pageId)}`;
  return `/#/t/${enc(share.projectId)}`;
};

function forward(hostId, request) {
  const host = hosts.get(hostId);
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error("Mac not connected"));
    const id = randomId(9);
    const timer = setTimeout(() => {
      host.pending.delete(id);
      reject(new Error("Mac timed out"));
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
        ws.send(JSON.stringify({ type: "rejected", reason: token ? "email no longer authorized" : "invalid token" }));
        return ws.close();
      }
      hostId = token.hostId;
      hosts.get(hostId)?.ws.close();
      hosts.set(hostId, { ws, email: token.email, name: String(msg.name ?? token.name).slice(0, 60), connectedAt: new Date().toISOString(), pending: new Map() });
      ws.send(JSON.stringify({ type: "welcome", hostId, email: token.email }));
      console.log(`host connected: ${token.name} (${token.email})`);
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
    if (msg.type === "event") {
      for (const [res, guest] of listeners.get(hostId) ?? []) {
        const frame = guest ? guestFrame(msg.frame, guest) : msg.frame;
        if (frame) res.write(frame);
      }
    }
  });
  ws.on("close", () => {
    clearTimeout(hello);
    const host = hostId && hosts.get(hostId);
    if (!host || host.ws !== ws) return;
    hosts.delete(hostId);
    for (const { reject, timer } of host.pending.values()) clearTimeout(timer), reject(new Error("Mac disconnected"));
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

/** Google said who you are; any account gets in on first sign-in unless an admin blocked it. */
function finishLogin(res, rawEmail, next, profile) {
  const email = String(rawEmail).trim().toLowerCase();
  if (!allowed(email) && !access.signUp(email)) {
    return html(res, messagePage("No access", `${email || "This email"} can't use Mono.`, { href: "/_mono/logout", label: "Use another account" }), 403);
  }
  access.saveProfile(email, profile);
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

  if (route === "/version") {
    // Written by publish-desktop.sh next to the zips; the desktop app checks it to offer updates.
    try {
      return send(res, 200, JSON.parse(fs.readFileSync(path.join(DOWNLOADS_DIR, "latest.json"), "utf8")));
    } catch {
      return send(res, 404, { error: "No published versions yet" });
    }
  }

  if (route.startsWith("/download/")) {
    const name = route.slice("/download/".length);
    const file = path.join(DOWNLOADS_DIR, name);
    if (!DOWNLOADS.has(name) || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", fs.statSync(file).size);
    return fs.createReadStream(file).pipe(res);
  }



  if (route.startsWith("/static/")) {
    const file = path.join(PUBLIC_DIR, path.basename(route));
    const type = STATIC_TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    // Caddy doesn't compress this site (it would buffer the event stream), so big scripts ship a .gz next to them.
    const gzipped = `${file}.gz`;
    if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "") && fs.existsSync(gzipped)) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      return fs.createReadStream(gzipped).pipe(res);
    }
    return fs.createReadStream(file).pipe(res);
  }

  if (route === "/login") return html(res, loginPage({ next: safeNext(url.searchParams.get("next")), dev: DEV_LOGIN, app: (req.headers["user-agent"] ?? "").includes("MonoApp"), ios: /iPhone|iPad/.test(req.headers["user-agent"] ?? "") }));

  if (route === "/auth/google") {
    if (!GOOGLE_READY) return html(res, messagePage("Sign-in not configured", "This relay has no Google credentials yet."), 503);
    const state = randomId();
    setCookie(res, "mono_oauth", sign({ t: "oauth", state, next: url.searchParams.get("next") ?? "/", exp: Date.now() + 10 * 60_000 }), 600);
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.search = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${PUBLIC_URL}/_mono/auth/callback`, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
    return redirect(res, google.toString());
  }

  if (route === "/auth/callback") {
    const pending = verify(parseCookies(req).mono_oauth);
    if (pending?.t !== "oauth" || pending.state !== url.searchParams.get("state")) return html(res, messagePage("Couldn't sign in", "Sign-in expired. Try again."), 400);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") ?? "", client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${PUBLIC_URL}/_mono/auth/callback`, grant_type: "authorization_code" }),
    });
    const tokens = await tokenRes.json();
    // The id_token comes straight from Google over TLS, so its claims can be read without checking the signature.
    const claims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) : {};
    const validIssuer = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
    if (!validIssuer || claims.aud !== GOOGLE_CLIENT_ID || !claims.email_verified) return html(res, messagePage("Couldn't sign in", "Google didn't verify your email."), 403);
    setCookie(res, "mono_oauth", "", 0);
    return finishLogin(res, claims.email, pending.next, { name: claims.name, picture: claims.picture });
  }

  if (route === "/auth/dev" && DEV_LOGIN) return finishLogin(res, url.searchParams.get("email") ?? "", url.searchParams.get("next"));

  // Links sent before sign-up was opened still land on a working sign-in page.
  if (route.startsWith("/invite/")) {
    const invite = access.getInvite(route.slice("/invite/".length));
    if (!invite) return html(res, messagePage("Invalid invite", "Ask for a new link."), 404);
    return html(res, invitePage({ invite, dev: DEV_LOGIN }));
  }

  if (route === "/logout") {
    setCookie(res, "mono_session", "", 0);
    setCookie(res, "mono_host", "", 0);
    return redirect(res, "/_mono/login");
  }

  if (route === "/pair/start" && req.method === "POST") {
    if (pairings.size > 50) return send(res, 429, { error: "Too many pending codes" });
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

  if (route.startsWith("/host-api/")) return hostApi(req, res, route.slice("/host-api".length));

  // Everything below needs a signed-in user.
  if (!email) return route === "/me" ? send(res, 401, { error: "Not signed in" }) : redirect(res, `/_mono/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  if (route === "/me") {
    const pick = pickFrom(req, email);
    const mine = hostsFor(email);
    const shared = sharedWith(email);
    if (pick?.shareId) {
      const guest = guestScope(email, pick.shareId);
      const share = guest && shared.find((s) => s.id === pick.shareId);
      if (share) {
        const { people, general, ...view } = share;
        return send(res, 200, { mode: "remote", email, ...sessionProfile(req), admin: access.isAdmin(email), host: { id: share.hostId, name: share.hostName ?? `${share.ownerName ?? share.owner}'s Mac` }, hosts: mine.map(({ id, name }) => ({ id, name })), share: { ...view, role: guest.role }, shared });
      }
    }
    const host = mine.find((h) => h.id === pick?.hostId) ?? (mine.length === 1 ? mine[0] : null);
    return send(res, 200, { mode: "remote", email, ...sessionProfile(req), admin: access.isAdmin(email), host: host && { id: host.id, name: host.name }, hosts: mine.map(({ id, name }) => ({ id, name })), share: null, shared });
  }

  if (route === "/mobile/done") {
    const code = randomId(24);
    mobileCodes.set(code, { email, expires: Date.now() + 2 * 60_000 });
    return redirect(res, `com.famonfa.mono://auth?code=${code}`);
  }

  if (route === "/pair" && req.method === "GET") {
    const code = String(url.searchParams.get("code") ?? "").toUpperCase();
    const pairing = pairings.get(code);
    if (!pairing || pairing.status !== "pending") return html(res, messagePage("Code expired", "Run `mono connect` again in the terminal."), 404);
    return html(res, pairPage({ code, name: pairing.name, email }));
  }

  if (route === "/pair/approve" && req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    const { code } = await readForm(req);
    const pairing = pairings.get(String(code ?? "").toUpperCase());
    if (!pairing || pairing.status !== "pending") return html(res, messagePage("Code expired", "Run `mono connect` again in the terminal."), 404);
    const hostId = randomId(12);
    pairing.status = "approved";
    pairing.result = { hostId, email, token: sign({ t: "host", hostId, email, name: pairing.name, iat: Date.now() }) };
    return html(res, messagePage("Connected", `${pairing.name} is linked to your account. You can return to the terminal.`, { href: "/", label: "Open Mono" }));
  }

  // From someone else's share in the browser: start a session on your own Mac (your Claude Code), which
  // pulls the share's context itself; then the app switches to your Mac.
  if (route === "/shared-start" && req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    const body = await readForm(req);
    if (!access.roleOn(String(body.shareId ?? ""), email)) return send(res, 403, { error: "Not shared with you" });
    const mine = hostsFor(email).sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
    if (!mine.length) return send(res, 409, { error: "Connect your Mac first: run `npx @famonfa/mono connect` with this same Google account, then try again.", code: "no_mac" });
    try {
      const reply = await forward(mine[0].id, {
        method: "POST",
        path: `/api/shared/${encodeURIComponent(body.shareId)}/sessions`,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ prompt: body.prompt, model: body.model, effort: body.effort, permissionMode: body.permissionMode })).toString("base64"),
      });
      const out = JSON.parse(Buffer.from(reply.body ?? "", "base64").toString() || "{}");
      if (reply.status !== 200) return send(res, reply.status, out);
      pickHost(res, email, mine[0].id);
      return send(res, 200, { ...out, host: { id: mine[0].id, name: mine[0].name } });
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
  }

  if (route === "/hosts" && req.method === "GET") return html(res, hostsPage({ email, hosts: hostsFor(email), current: pickedHost(req, email), admin: access.isAdmin(email), relay: PUBLIC_URL, shared: sharedWith(email) }));

  if (route.startsWith("/admin")) {
    if (!access.isAdmin(email)) return html(res, messagePage("No permission", "Only admins can manage members."), 403);
    if (req.method === "POST") {
      if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
      const form = await readForm(req);
      let notice = null;
      try {
        if (route === "/admin/block" && !access.isAdmin(form.email)) {
          access.blockUser(form.email, email);
          disconnectUser(String(form.email).toLowerCase());
        }
        if (route === "/admin/unblock") access.unblockUser(form.email);
      } catch (error) {
        notice = { error: error.message };
      }
      return html(res, adminPage({ email, ...access.listAccess(), online: onlineCounts(), notice }));
    }
    return html(res, adminPage({ email, ...access.listAccess(), online: onlineCounts() }));
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
  if (!email) return isApi ? send(res, 401, { error: "Not signed in" }) : redirect(res, `/_mono/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  const pick = pickFrom(req, email);
  let hostId = pick?.hostId ?? null;
  let guest = null;
  if (pick?.shareId) {
    guest = guestScope(email, pick.shareId, sessionProfile(req));
    if (!guest || guest.hostId !== hostId) {
      // Access was removed: forget the shared Mac and go back to your own.
      setCookie(res, "mono_host", "", 0);
      return isApi ? send(res, 403, { error: "You no longer have access to this share" }) : redirect(res, "/_mono/hosts");
    }
  }
  if (!hostId) {
    const mine = hostsFor(email);
    if (mine.length !== 1) return isApi ? send(res, 503, { error: "Pick a Mac" }) : redirect(res, "/_mono/hosts");
    hostId = mine[0].id;
    pickHost(res, email, hostId);
  }

  if (url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    if (!listeners.has(hostId)) listeners.set(hostId, new Map());
    listeners.get(hostId).set(res, guest);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      listeners.get(hostId)?.delete(res);
    });
    return;
  }

  if (!hosts.has(hostId)) {
    const offline = guest ? `${guest.title} lives on ${guest.owner}'s Mac, which is offline right now.` : "Your Mac is offline. Check that it's on and running `mono`.";
    return isApi ? send(res, 503, { error: offline }) : guest ? html(res, messagePage("Their Mac is offline", offline, { href: "/_mono/hosts", label: "Back" }), 503) : redirect(res, "/_mono/hosts");
  }
  if (req.method !== "GET" && !sameOrigin(req)) return send(res, 403, { error: "forbidden" });

  try {
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : null;
    const reply = await forward(hostId, {
      method: req.method,
      path: url.pathname + url.search,
      headers: { "content-type": req.headers["content-type"] },
      body: body?.length ? body.toString("base64") : null,
      ...(guest ? { guest } : {}),
    });
    for (const [key, value] of Object.entries(reply.headers ?? {})) res.setHeader(key, value);
    res.statusCode = reply.status;
    res.end(Buffer.from(reply.body ?? "", "base64"));
  } catch (error) {
    send(res, 502, { error: error.message });
  }
}

/** The chosen machine is remembered in a signed cookie, so it still resolves while that Mac is offline. */
function pickFrom(req, email) {
  const pick = verify(parseCookies(req).mono_host);
  return pick?.t === "pick" && pick.email === email ? pick : null;
}

/** The Mac of your own you picked (a shared Mac you're visiting doesn't count). */
function pickedHost(req, email) {
  const pick = pickFrom(req, email);
  return pick && !pick.shareId ? pick.hostId : null;
}

const pickHost = (res, email, hostId) => setCookie(res, "mono_host", sign({ t: "pick", email, hostId }), SESSION_DAYS * 86_400);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (url.pathname.startsWith("/_mono/")) return await relayRoute(req, res, url);
    const shared = /^\/s\/([A-Za-z0-9_-]{6,40})\/?$/.exec(url.pathname);
    if (shared && req.method === "GET") return openShare(req, res, url, shared[1]);
    return await tunnel(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "Internal error" });
  }
});

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, PUBLIC_URL).pathname !== "/_mono/host") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORT, () => console.log(`Mono relay at ${PUBLIC_URL} (port ${PORT})${DEV_LOGIN ? " — dev login enabled" : ""}`));
