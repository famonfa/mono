import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as store from "./store.mjs";
import { sessionCwd } from "./sessions.mjs";
import { allProjects, descendantIds, launchRootFor } from "./projects.mjs";

const HOME = os.homedir();
export const AVOCADO_ROOT = path.join(HOME, "avocado-all", "avocado");

/** Folders typed by hand in the picker may start with `~`. */
export const expandHome = (dir) => (dir === "~" || dir.startsWith("~/") ? path.join(HOME, dir.slice(1)) : dir);
const REPOS = ["instamenu", "instamenu-api", "KDS", "crm", "pricing", "marketing-website"];
const IDLE_CLOSE_MS = 20 * 60_000;
/** Facundo's choice: full access by default (like T3 Code); the other modes stay selectable per session. */
const DEFAULT_PERMISSION_MODE = "bypassPermissions";
const PERMISSION_MODES = new Set(["bypassPermissions", "acceptEdits", "default", "plan"]);
const modeOrDefault = (mode) => (PERMISSION_MODES.has(mode) ? mode : DEFAULT_PERMISSION_MODE);
const CLAUDE_BIN = [path.join(HOME, ".npm-global/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].find((p) => fs.existsSync(p));
const PATH = [path.join(HOME, ".local/bin"), path.join(HOME, ".npm-global/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].join(":");

/** Chats this server is driving, keyed by Claude session id. */
const chats = new Map();
let notify = () => {};

export function onChatChange(fn) {
  notify = fn;
}

class InputQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }
  push(item) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export const UPLOADS_DIR = path.join(store.DATA_DIR, "uploads");
const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only files the workspace itself stored can be attached, so a request can't smuggle arbitrary paths. */
function resolveAttachment(file) {
  const real = path.resolve(file.path);
  if (!real.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(real)) throw new Error(`Adjunto inválido: ${file.name}`);
  return { ...file, path: real, size: fs.statSync(real).size };
}

/**
 * Images go inline so the model sees them; every attachment is also listed by path so
 * Claude can open non-image files (PDFs, CSVs, code) with its own tools.
 */
function userMessage(text, attachments = []) {
  if (!attachments.length) return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, origin: { kind: "human" } };
  const files = attachments.map(resolveAttachment);
  const listing = `${text}\n\nArchivos adjuntos:\n${files.map((f) => `- ${f.path}`).join("\n")}`;
  const images = files
    .filter((f) => INLINE_IMAGE.test(f.type) && f.size <= MAX_INLINE_IMAGE_BYTES)
    .map((f) => ({ type: "image", source: { type: "base64", media_type: f.type, data: fs.readFileSync(f.path).toString("base64") } }));
  return { type: "user", message: { role: "user", content: [{ type: "text", text: listing }, ...images] }, parent_tool_use_id: null, origin: { kind: "human" } };
}

export function saveUpload({ name, type, data }) {
  if (!name || !data) throw new Error("Falta el archivo");
  const dir = path.join(UPLOADS_DIR, `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, "-").slice(0, 120) || "archivo";
  const file = path.join(dir, safe);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return { path: file, name, type: type || "application/octet-stream", size: fs.statSync(file).size };
}

const T3_MODELS = path.join(HOME, ".t3", "caches", "claudeAgent.json");
const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"];

/** Same model list T3 Code shows for this account, with each model's effort levels. */
export function listModels() {
  try {
    const cache = JSON.parse(fs.readFileSync(T3_MODELS, "utf8"));
    return cache.models.map((m) => {
      const effort = m.capabilities?.optionDescriptors?.find((d) => d.id === "effort");
      return {
        id: m.slug,
        name: m.name,
        efforts: (effort?.options ?? []).filter((o) => EFFORTS.includes(o.id)).map((o) => ({ id: o.id, label: o.label, isDefault: Boolean(o.isDefault) })),
      };
    });
  } catch {
    return [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, label: id, isDefault: id === "medium" })) }];
  }
}

const effortOptions = (effort) =>
  !effort ? {} : effort === "ultracode" ? { effort: "xhigh", settings: { ultracode: true } } : { effort };

function focusContext(launchCwd, focusCwd) {
  if (!focusCwd || focusCwd === launchCwd) return null;
  return `Carpeta de trabajo de esta sesión: ${focusCwd}\nLa sesión arranca en ${launchCwd} para cargar sus skills y su CLAUDE.md, pero hacé los cambios, builds y tests en la carpeta de trabajo (usá rutas absolutas o \`cd\` a ella en cada comando).`;
}

function taskContext(task) {
  const lines = [
    `Estás trabajando en la tarea ${task.id} — "${task.title}" de Mono, el workspace personal de Facundo (http://localhost:4600/#/t/${task.id}).`,
    task.tldr?.problema && `Problema: ${task.tldr.problema}`,
    task.tldr?.solucion && `Solución: ${task.tldr.solucion}`,
    task.repos?.length && `Repos/PRs: ${task.repos.map((r) => `${r.name}${r.branch ? ` (${r.branch})` : ""}${r.pr ? ` ${r.pr}` : ""}`).join(", ")}`,
    task.boards?.length && `Boards: ${task.boards.map((b) => b.id).join(", ")} — leelos con \`ws get ${task.id} <board>\`.`,
    `Cuando termines un bloque de trabajo relevante (tests, fixes, hallazgos), actualizá el workspace con el skill workspace usando \`ws board ... --patch\`.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Worktrees that belong to a task: matching branch names or `.worktrees/<task>/`, plus the avocado root as fallback. */
/** The project's own folder plus every git worktree of it, for sessions started without a task. */
function gitWorktrees(root) {
  const found = [{ path: root, repo: path.basename(root), branch: null, root: true }];
  try {
    const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    for (const block of out.split("\n\n")) {
      const wtPath = block.match(/^worktree (.+)$/m)?.[1];
      const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
      if (wtPath && fs.realpathSync(wtPath) !== root) found.push({ path: wtPath, repo: path.basename(root), branch: branch ?? null });
    }
  } catch {}
  return found;
}

/** A project's folder and worktrees, followed by those of the projects nested in it (avocado → instamenu, KDS…). */
export function worktreesForProject(projectId) {
  const ids = descendantIds(projectId);
  const projects = allProjects();
  const top = projects.find((p) => p.id === projectId);
  if (!top) return [];
  const roots = [top.root, ...projects.filter((p) => p.id !== projectId && ids.has(p.id)).map((p) => p.root)];
  for (const entry of fs.readdirSync(top.root, { withFileTypes: true })) {
    const dir = path.join(top.root, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && fs.existsSync(path.join(dir, ".git")) && !roots.includes(dir)) roots.push(dir);
  }
  const all = roots.flatMap((root) => gitWorktrees(root));
  return [...all.filter((w) => w.root), ...all.filter((w) => !w.root)];
}

export function worktreesForTask(task, projectRoots = []) {
  const branches = new Set((task?.repos ?? []).map((r) => r.branch).filter(Boolean));
  const found = [];
  for (const repo of REPOS) {
    const dir = path.join(AVOCADO_ROOT, repo);
    if (!fs.existsSync(dir)) continue;
    let out = "";
    try {
      out = execFileSync("git", ["-C", dir, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 5000 });
    } catch {
      continue;
    }
    for (const block of out.split("\n\n")) {
      const wtPath = block.match(/^worktree (.+)$/m)?.[1];
      const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
      if (!wtPath || wtPath === dir) continue;
      if ((branch && branches.has(branch)) || (task && wtPath.includes(`/.worktrees/${task.id}/`))) found.push({ path: wtPath, repo, branch });
    }
  }
  for (const root of projectRoots) {
    if (!found.some((f) => f.path === root)) found.push({ path: root, repo: path.basename(root), branch: null, root: true });
  }
  if (!found.some((f) => f.path === AVOCADO_ROOT)) found.push({ path: AVOCADO_ROOT, repo: "avocado", branch: null, root: true });
  return found;
}

function publicState(chat) {
  return {
    sessionId: chat.sessionId,
    live: !chat.closed,
    state: chat.state,
    permissionMode: chat.permissionMode,
    model: chat.model,
    effort: chat.effort,
    cwd: chat.cwd,
    taskId: chat.taskId,
    pending: [...chat.pending.values()].map(({ resolve, ...p }) => p),
    error: chat.error,
  };
}

function scheduleIdleClose(chat) {
  clearTimeout(chat.idleTimer);
  if (chat.state !== "idle") return;
  chat.idleTimer = setTimeout(() => chat.input.close(), IDLE_CLOSE_MS);
}

function setState(chat, state) {
  chat.state = state;
  scheduleIdleClose(chat);
  notify(chat.sessionId);
}

const FOCUS_FILE = path.join(store.DATA_DIR, "session-focus.json");

export function readSessionFocus() {
  try {
    return JSON.parse(fs.readFileSync(FOCUS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSessionFocus(sessionId, focus) {
  const all = readSessionFocus();
  all[sessionId] = focus;
  fs.writeFileSync(FOCUS_FILE, JSON.stringify(all, null, 2));
}

function linkSessionToTask(taskId, sessionId) {
  if (!taskId) return;
  const task = store.getTask(taskId);
  if (!task) return;
  const ids = new Set(task.sessionIds ?? []);
  if (ids.has(sessionId)) return;
  store.saveTask(taskId, { sessionIds: [...ids, sessionId] });
}

/**
 * Starts (or resumes) a Claude Code session driven from the workspace. Resolves with the session id
 * once the CLI reports it, so the UI can navigate to the live feed straight away.
 */
export function startChat({ taskId, cwd, prompt, resume, model, effort, permissionMode, attachments = [] }) {
  const mode = modeOrDefault(permissionMode);
  if (resume && chats.get(resume) && !chats.get(resume).closed) throw new Error("La sesión ya está abierta en el workspace");
  const task = taskId ? store.getTask(taskId) : null;
  const focus = cwd ? expandHome(cwd) : AVOCADO_ROOT;
  if (!path.isAbsolute(focus) || !fs.statSync(focus, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No existe la carpeta ${focus}`);
  const workdir = resume ? focus : launchRootFor(focus);
  const append = [task && taskContext(task), !resume && focusContext(workdir, focus)].filter(Boolean).join("\n\n");

  const input = new InputQueue();
  input.push(userMessage(prompt, attachments));
  const chat = { sessionId: resume ?? null, taskId, cwd: focus, launchCwd: workdir, model, effort, permissionMode: mode, state: "running", pending: new Map(), input, closed: false, q: null };
  let reqCounter = 0;

  const q = query({
    prompt: input,
    options: {
      ...(workdir ? { cwd: workdir } : {}),
      ...(resume ? { resume } : {}),
      permissionMode: mode,
      allowDangerouslySkipPermissions: true,
      ...(model ? { model } : {}),
      ...effortOptions(effort),
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", ...(append ? { append } : {}) },
      ...(CLAUDE_BIN ? { pathToClaudeCodeExecutable: CLAUDE_BIN } : {}),
      env: { ...process.env, PATH },
      canUseTool: (toolName, toolInput, { signal, suggestions, decisionReason, blockedPath }) =>
        new Promise((resolve) => {
          const id = `req-${++reqCounter}`;
          chat.pending.set(id, { id, toolName, input: toolInput, decisionReason, blockedPath, canAlwaysAllow: Boolean(suggestions?.length), suggestions, resolve });
          setState(chat, "requires_action");
          signal.addEventListener("abort", () => {
            if (!chat.pending.delete(id)) return;
            resolve({ behavior: "deny", message: "Cancelado" });
            notify(chat.sessionId);
          });
        }),
    },
  });
  chat.q = q;

  return new Promise((resolveStart, rejectStart) => {
    let started = Boolean(resume);
    if (resume) {
      chats.set(resume, chat);
      resolveStart(publicState(chat));
    }
    (async () => {
      try {
        for await (const msg of q) {
          if (msg.session_id && !chat.sessionId) chat.sessionId = msg.session_id;
          if (msg.type === "system" && msg.subtype === "init") {
            chats.set(chat.sessionId, chat);
            if (!resume) saveSessionFocus(chat.sessionId, focus);
            linkSessionToTask(taskId, chat.sessionId);
            if (!started) {
              started = true;
              resolveStart(publicState(chat));
            }
            notify(chat.sessionId);
          } else if (msg.type === "system" && msg.subtype === "session_state_changed") {
            setState(chat, msg.state);
          } else if (msg.type === "result") {
            if (chat.pending.size === 0) setState(chat, "idle");
            if (msg.subtype !== "success") chat.error = msg.subtype;
          }
        }
      } catch (error) {
        chat.error = String(error?.message ?? error);
        if (!started) rejectStart(error);
      } finally {
        chat.closed = true;
        chat.state = "idle";
        clearTimeout(chat.idleTimer);
        for (const p of chat.pending.values()) p.resolve({ behavior: "deny", message: "Sesión cerrada" });
        chat.pending.clear();
        notify(chat.sessionId);
      }
    })();
  });
}

export function sendMessage(sessionId, text, { workingSessions = [], model, effort, permissionMode, attachments = [] } = {}) {
  const chat = chats.get(sessionId);
  if (chat && !chat.closed) {
    chat.input.push(userMessage(text, attachments));
    setState(chat, "running");
    return Promise.resolve(publicState(chat));
  }
  if (workingSessions.includes(sessionId)) {
    throw new Error("Esta sesión está trabajando en otra app (por ejemplo T3 Code). Esperá a que quede en pausa para escribirle desde acá.");
  }
  const cwd = sessionCwd(sessionId);
  if (!cwd) throw new Error("No encontré la carpeta original de esta sesión");
  return startChat({ resume: sessionId, cwd, prompt: text, taskId: chat?.taskId, model, effort, permissionMode, attachments });
}

export function chatState(sessionId) {
  const chat = chats.get(sessionId);
  return chat ? publicState(chat) : { sessionId, live: false, state: "idle", pending: [] };
}

export async function interrupt(sessionId) {
  const chat = chats.get(sessionId);
  if (!chat || chat.closed) throw new Error("La sesión no está abierta en el workspace");
  for (const p of chat.pending.values()) p.resolve({ behavior: "deny", message: "Interrumpido por el usuario", interrupt: true });
  chat.pending.clear();
  await chat.q.interrupt();
  setState(chat, "idle");
  return publicState(chat);
}

export function answerPermission(sessionId, requestId, { allow, always, message }) {
  const chat = chats.get(sessionId);
  const req = chat?.pending.get(requestId);
  if (!req) throw new Error("El pedido de permiso ya no está pendiente");
  chat.pending.delete(requestId);
  req.resolve(
    allow
      ? { behavior: "allow", updatedInput: req.input, ...(always && req.suggestions ? { updatedPermissions: req.suggestions } : {}) }
      : { behavior: "deny", message: message || "El usuario rechazó este paso" },
  );
  setState(chat, chat.pending.size ? "requires_action" : "running");
  return publicState(chat);
}


export async function configure(sessionId, { model, effort, permissionMode }) {
  const chat = chats.get(sessionId);
  if (!chat || chat.closed) return { sessionId, live: false, state: "idle", pending: [], model, effort, permissionMode };
  if (permissionMode && PERMISSION_MODES.has(permissionMode) && permissionMode !== chat.permissionMode) {
    await chat.q.setPermissionMode(permissionMode);
    chat.permissionMode = permissionMode;
  }
  if (model && model !== chat.model) {
    await chat.q.setModel(model);
    chat.model = model;
  }
  if (effort && effort !== chat.effort) {
    await chat.q.applyFlagSettings(effort === "ultracode" ? { effortLevel: "xhigh", ultracode: true } : { effortLevel: effort, ultracode: false });
    chat.effort = effort;
  }
  notify(sessionId);
  return publicState(chat);
}

export function liveChatIds() {
  return [...chats.values()].filter((c) => !c.closed).map((c) => c.sessionId);
}
