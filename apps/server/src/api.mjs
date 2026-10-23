import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_DIR, REPO_ROOT } from "./paths.mjs";
import { remoteStatus } from "./remote.mjs";
import * as store from "./store.mjs";
import * as sessions from "./sessions.mjs";
import * as chats from "./chats.mjs";
import * as groups from "./groups.mjs";
import * as projects from "./projects.mjs";
import { listCommands } from "./commands.mjs";
import { refreshStatus, startRefresh } from "./refresh.mjs";
import { listCaptureSkills } from "./capture.mjs";
import { prStatus } from "./prs.mjs";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body ?? null));
}

export function serveStatic(res, root, rel, req) {
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const { size } = fs.statSync(file);
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  // Video needs byte ranges to seek and, in Safari, to play at all.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req?.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return true;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.setHeader("Content-Length", size);
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * The API can launch agents, so it only answers same-machine requests: the Host header must be
 * localhost (blocks DNS rebinding) and mutating requests must come from the app's own origin
 * with a JSON body (blocks other websites from posting to localhost).
 */
function isTrusted(req) {
  if (!ALLOWED_HOSTS.test(req.headers.host ?? "")) return false;
  if (req.method === "GET") return true;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!ALLOWED_HOSTS.test(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return (req.headers["content-type"] ?? "").includes("application/json") || req.method === "DELETE";
}

function sessionList(days) {
  const list = sessions.listSessions({ days });
  const live = new Set(chats.liveChatIds());
  const focus = chats.readSessionFocus();
  for (const task of store.listTasks()) {
    for (const s of sessions.sessionsForTask(task, list)) (s.taskIds ??= []).push(task.id);
  }
  for (const s of list) {
    s.ownedByWorkspace = live.has(s.id);
    s.focusCwd = focus[s.id] ?? null;
    s.projectId = projects.projectForPath(focus[s.id] ?? s.firstCwd ?? s.cwd);
  }
  return list;
}

/** What the user widget shows when Mono is used on this Mac (through the relay it asks the relay instead). */
function localAccount() {
  const remote = remoteStatus();
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  return {
    mode: "local",
    hostname: os.hostname().replace(/\.local$/, ""),
    user: os.userInfo().username,
    version: pkg.version,
    remote: remote.state === "connected" ? { email: remote.email, relay: remote.relay } : null,
    connectCommand: REPO_ROOT ? "mono connect" : "npx @famonfa/mono connect",
    claude: chats.claudeInfo(),
  };
}

const withProjects = (task) => ({ ...task, projectIds: projects.projectsForTask(task) });

function workingElsewhere(sessionId) {
  const live = new Set(chats.liveChatIds());
  return sessions
    .listSessions({ days: 1 })
    .filter((s) => s.status === "working" && !live.has(s.id))
    .map((s) => s.id)
    .filter((id) => id === sessionId);
}

async function handleChats(res, method, parts, body) {
  const [, sessionId, action, actionId] = parts;
  if (!sessionId && method === "POST") {
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) throw new Error("Escribí un mensaje");
    return send(res, 200, await chats.startChat({ taskId: body.taskId, cwd: body.cwd, prompt, model: body.model, effort: body.effort, permissionMode: body.permissionMode, attachments: body.attachments ?? [] }));
  }
  if (sessionId && !action && method === "GET") return send(res, 200, chats.chatState(sessionId));
  if (action === "messages" && method === "POST") {
    const text = String(body.text ?? "").trim();
    if (!text) throw new Error("Escribí un mensaje");
    return send(res, 200, await chats.sendMessage(sessionId, text, { workingSessions: workingElsewhere(sessionId), model: body.model, effort: body.effort, permissionMode: body.permissionMode, attachments: body.attachments ?? [] }));
  }
  if (action === "interrupt" && method === "POST") return send(res, 200, await chats.interrupt(sessionId));
  if (action === "config" && method === "POST") return send(res, 200, await chats.configure(sessionId, body));
  if (action === "cwd" && method === "POST") return send(res, 200, chats.setSessionCwd(sessionId, body.cwd));
  if (action === "permissions" && actionId && method === "POST") return send(res, 200, chats.answerPermission(sessionId, actionId, body));
  return send(res, 404, { error: "not found" });
}

function handleGroups(res, method, parts, body) {
  const [, id, sub, sessionId] = parts;
  if (!id && method === "GET") return send(res, 200, groups.listGroups());
  if (!id && method === "POST") return send(res, 200, groups.createGroup(body));
  if (id && !sub && method === "PUT") return send(res, 200, groups.updateGroup(id, body));
  if (id && !sub && method === "DELETE") {
    groups.deleteGroup(id);
    return send(res, 200, { ok: true });
  }
  if (sub === "sessions" && !sessionId && method === "POST") return send(res, 200, groups.addSession(id, body.sessionId, body.title));
  if (sub === "sessions" && sessionId && method === "DELETE") return send(res, 200, groups.removeSession(id, sessionId));
  return send(res, 404, { error: "not found" });
}

/** Creates the request handler plus file watchers that broadcast `ws:data`, `ws:sessions`, `ws:groups` and `ws:chat` events. */
export function createApi(broadcast) {
  fs.mkdirSync(store.TASKS_DIR, { recursive: true });

  let timer;
  const pending = new Set();
  fs.watch(store.TASKS_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || filename.endsWith(".tmp")) return;
    pending.add(filename.split(path.sep)[0]);
    clearTimeout(timer);
    timer = setTimeout(() => {
      broadcast("ws:data", { tasks: [...pending] });
      pending.clear();
    }, 150);
  });

  let sessionTimer;
  const changedSessions = new Set();
  if (fs.existsSync(sessions.PROJECTS_DIR)) {
    fs.watch(sessions.PROJECTS_DIR, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith(".jsonl")) return;
      const id = sessions.sessionIdFromPath(filename);
      if (!id) return;
      changedSessions.add(id);
      clearTimeout(sessionTimer);
      sessionTimer = setTimeout(() => {
        broadcast("ws:sessions", { ids: [...changedSessions] });
        changedSessions.clear();
      }, 300);
    });
  }

  let groupsTimer;
  fs.watch(store.DATA_DIR, (_event, filename) => {
    if (filename !== path.basename(groups.GROUPS_FILE)) return;
    clearTimeout(groupsTimer);
    groupsTimer = setTimeout(() => broadcast("ws:groups", {}), 100);
  });

  chats.onChatChange((sessionId) => broadcast("ws:chat", { sessionId, state: chats.chatState(sessionId) }));

  return async function handle(req, res, next) {
    if (!isTrusted(req)) return send(res, 403, { error: "forbidden" });
    if (req.url.startsWith("/files/")) {
      const rel = decodeURIComponent(req.url.replace(/^\/files\//, "").split("?")[0]);
      return serveStatic(res, store.TASKS_DIR, rel, req) || next();
    }
    if (!req.url.startsWith("/api/")) return next();

    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
    const method = req.method;
    try {
      const body = ["PUT", "POST"].includes(method) ? JSON.parse((await readBody(req)) || "{}") : undefined;
      const [resource, id, sub, subId] = parts;

      if (resource === "health") return send(res, 200, { app: "mono", ok: true });
      if (resource === "me" && method === "GET") return send(res, 200, localAccount());
      if (resource === "chats") return await handleChats(res, method, parts, body);
      if (resource === "groups") return handleGroups(res, method, parts, body);
      if (resource === "capture-skills" && method === "GET") return send(res, 200, listCaptureSkills());
      if (resource === "models" && method === "GET") return send(res, 200, chats.listModels());
      if (resource === "commands" && method === "GET") return send(res, 200, listCommands(url.searchParams.get("cwd") ? chats.expandHome(url.searchParams.get("cwd")) : null));
      if (resource === "uploads" && method === "POST") return send(res, 200, chats.saveUpload(body));
      if (resource === "uploads" && method === "GET" && id === "file") {
        const file = path.resolve(url.searchParams.get("path") ?? "");
        return file.startsWith(chats.UPLOADS_DIR + path.sep) && serveStatic(res, path.dirname(file), path.basename(file)) ? undefined : send(res, 404, { error: "not found" });
      }
      if (resource === "projects") {
        if (!id && method === "GET") return send(res, 200, projects.listProjects({ fresh: url.searchParams.has("fresh") }).map(({ favicon, ...p }) => ({ ...p, hasIcon: Boolean(favicon) })));
        if (id && sub === "icon" && method === "GET") {
          const icon = projects.projectIcon(id);
          return icon && serveStatic(res, path.dirname(icon), path.basename(icon)) ? undefined : send(res, 404, { error: "not found" });
        }
        if (id && !sub && method === "PUT") return send(res, 200, projects.saveOverride(id, { title: body.title || undefined, color: body.color || undefined }));
        if (id && sub === "worktrees" && method === "GET") {
          return projects.listProjects().some((p) => p.id === id) ? send(res, 200, chats.worktreesForProject(id)) : send(res, 404, { error: "not found" });
        }
        return send(res, 404, { error: "not found" });
      }
      if (resource === "sessions") {
        if (!id) return send(res, 200, sessionList(Number(url.searchParams.get("days") ?? 3)));
        const since = url.searchParams.get("since");
        const detail = sessions.readSessionEvents(id, { since: since === null ? undefined : Number(since), agent: url.searchParams.get("agent") ?? undefined });
        return detail ? send(res, 200, detail) : send(res, 404, { error: "not found" });
      }
      if (resource !== "tasks") return send(res, 404, { error: "not found" });

      if (id && sub === "worktrees" && method === "GET") {
        const task = store.getTask(id);
        const roots = projects.listProjects().filter((p) => projects.projectsForTask(task ?? {}).includes(p.id)).map((p) => p.root);
        return send(res, 200, chats.worktreesForTask(task, roots));
      }
      if (id && sub === "prs" && method === "GET") {
        const task = store.getTask(id);
        return send(res, 200, await prStatus((task?.repos ?? []).map((r) => r.pr).filter(Boolean)));
      }
      if (id && sub === "refresh") {
        if (method === "POST") return send(res, 200, startRefresh(id, { mode: body?.mode === "capture" ? "capture" : "refresh" }));
        if (method === "GET") return send(res, 200, refreshStatus(id));
      }

      if (!id) {
        if (method === "GET") return send(res, 200, store.listTasks().map(withProjects));
        if (method === "POST") {
          store.assertSafe(body.id);
          return send(res, 200, store.saveTask(body.id, body));
        }
      }

      if (id && !sub) {
        if (method === "GET") {
          const task = store.getTask(id);
          return task ? send(res, 200, withProjects(task)) : send(res, 404, { error: "not found" });
        }
        if (method === "PUT") return send(res, 200, withProjects(store.saveTask(id, body)));
        if (method === "DELETE") {
          store.trashTask(id);
          return send(res, 200, { ok: true });
        }
      }

      if (sub === "boards" && subId && parts[4] === "undo" && method === "POST") {
        const restored = store.restoreBoard(id, subId);
        return send(res, 200, { restored, remaining: store.boardHistory(id, subId).length });
      }
      if (sub === "boards" && subId && parts[4] === "history" && method === "GET") return send(res, 200, store.boardHistory(id, subId));
      if (sub === "boards" && subId) {
        if (method === "GET") {
          const board = store.getBoard(id, subId);
          return board ? send(res, 200, board) : send(res, 404, { error: "not found" });
        }
        if (method === "PUT") return send(res, 200, store.saveBoard(id, subId, body));
        if (method === "DELETE") {
          store.deleteBoard(id, subId);
          return send(res, 200, { ok: true });
        }
      }

      if (sub === "docs" && subId) {
        if (method === "GET") {
          const doc = store.getDoc(id, subId);
          return doc === null ? send(res, 404, { error: "not found" }) : send(res, 200, { name: subId, content: doc });
        }
        if (method === "PUT") {
          store.saveDoc(id, subId, body.content ?? "");
          return send(res, 200, { ok: true });
        }
      }

      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 400, { error: String(error.message ?? error) });
    }
  };
}
