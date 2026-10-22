import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as store from "./store.mjs";
import { sessionCwd } from "./sessions.mjs";

const HOME = os.homedir();
export const AVOCADO_ROOT = path.join(HOME, "avocado-all", "avocado");
const REPOS = ["instamenu", "instamenu-api", "KDS", "crm", "pricing", "marketing-website"];
const IDLE_CLOSE_MS = 20 * 60_000;
/** Facundo's choice: agents launched from the workspace always run with full access, like T3 Code's default. */
const PERMISSION_MODE = "bypassPermissions";
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

const userMessage = (text) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, origin: { kind: "human" } });

function taskContext(task) {
  const lines = [
    `Estás trabajando en la tarea ${task.id} — "${task.title}" del Avocado Workspace personal de Facundo (http://localhost:4600/#/t/${task.id}).`,
    task.tldr?.problema && `Problema: ${task.tldr.problema}`,
    task.tldr?.solucion && `Solución: ${task.tldr.solucion}`,
    task.repos?.length && `Repos/PRs: ${task.repos.map((r) => `${r.name}${r.branch ? ` (${r.branch})` : ""}${r.pr ? ` ${r.pr}` : ""}`).join(", ")}`,
    task.boards?.length && `Boards: ${task.boards.map((b) => b.id).join(", ")} — leelos con \`ws get ${task.id} <board>\`.`,
    `Cuando termines un bloque de trabajo relevante (tests, fixes, hallazgos), actualizá el workspace con el skill workspace usando \`ws board ... --patch\`.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Worktrees that belong to a task: matching branch names or `.worktrees/<task>/`, plus the avocado root as fallback. */
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
export function startChat({ taskId, cwd, prompt, resume }) {
  if (resume && chats.get(resume) && !chats.get(resume).closed) throw new Error("La sesión ya está abierta en el workspace");
  const task = taskId ? store.getTask(taskId) : null;
  const workdir = cwd || AVOCADO_ROOT;
  if (workdir && !fs.existsSync(workdir)) throw new Error(`No existe la carpeta ${workdir}`);

  const input = new InputQueue();
  input.push(userMessage(prompt));
  const chat = { sessionId: resume ?? null, taskId, cwd: workdir, permissionMode: PERMISSION_MODE, state: "running", pending: new Map(), input, closed: false, q: null };
  let reqCounter = 0;

  const q = query({
    prompt: input,
    options: {
      ...(workdir ? { cwd: workdir } : {}),
      ...(resume ? { resume } : {}),
      permissionMode: PERMISSION_MODE,
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", ...(task ? { append: taskContext(task) } : {}) },
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
            chat.cwd = msg.cwd ?? chat.cwd;
            chats.set(chat.sessionId, chat);
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

export function sendMessage(sessionId, text, { workingSessions = [] } = {}) {
  const chat = chats.get(sessionId);
  if (chat && !chat.closed) {
    chat.input.push(userMessage(text));
    setState(chat, "running");
    return Promise.resolve(publicState(chat));
  }
  if (workingSessions.includes(sessionId)) {
    throw new Error("Esta sesión está trabajando en otra app (por ejemplo T3 Code). Esperá a que quede en pausa para escribirle desde acá.");
  }
  const cwd = sessionCwd(sessionId);
  if (!cwd) throw new Error("No encontré la carpeta original de esta sesión");
  return startChat({ resume: sessionId, cwd, prompt: text, taskId: chat?.taskId });
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


export function liveChatIds() {
  return [...chats.values()].filter((c) => !c.closed).map((c) => c.sessionId);
}
