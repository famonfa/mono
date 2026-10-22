import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const WORKING_MS = 90_000;
const RECENT_MS = 2 * 60 * 60_000;
const TAIL_BYTES = 4 * 1024 * 1024;
const MENTION = /\b(IME-\d{3,5}|PR-\d{2,5})\b/g;

/** Incremental per-file state: only bytes appended since the last read are parsed. */
const metaCache = new Map();

function readFrom(file, start, end) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function splitLines(buf) {
  const lines = [];
  let from = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) {
      lines.push(buf.subarray(from, i).toString("utf8"));
      from = i + 1;
    }
  }
  return { lines, rest: buf.subarray(from) };
}

function parse(line) {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

const truncate = (text, max) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

function toolTitle(name, input = {}) {
  return input.description || input.title || input.file_path || input.pattern || input.query || input.url || input.skill || (typeof input.command === "string" ? input.command : "") || "";
}

function toolDetail(name, input = {}) {
  if (typeof input.command === "string") return input.command;
  if (input.prompt) return input.prompt;
  if (input.file_path && (input.old_string || input.content)) return `${input.file_path}\n\n${input.new_string ?? input.content ?? ""}`;
  return JSON.stringify(input, null, 2);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return "";
}

function isSystemText(text) {
  return /^\s*<(task-notification|system-reminder|local-command|command-|bash-|user-memory|ide_)/.test(text);
}

function emptyMeta(file) {
  return {
    file,
    title: null,
    customTitle: null,
    cwd: null,
    gitBranch: null,
    model: null,
    prLinks: new Set(),
    mentions: new Set(),
    firstTs: null,
    lastTs: null,
    lastPrompt: null,
    lastText: null,
    lastAction: null,
    turns: 0,
  };
}

function applyRecord(meta, rec) {
  if (rec.timestamp) {
    meta.firstTs ??= rec.timestamp;
    if (!meta.lastTs || rec.timestamp > meta.lastTs) meta.lastTs = rec.timestamp;
  }
  switch (rec.type) {
    case "ai-title":
      if (rec.aiTitle) meta.title = rec.aiTitle;
      break;
    case "custom-title":
      if (rec.customTitle) meta.customTitle = rec.customTitle;
      break;
    case "summary":
      if (rec.summary && !meta.title) meta.title = rec.summary;
      break;
    case "pr-link":
      if (rec.prUrl) meta.prLinks.add(rec.prUrl);
      break;
    case "user": {
      if (rec.cwd) meta.cwd = rec.cwd;
      if (rec.gitBranch) meta.gitBranch = rec.gitBranch;
      const content = rec.message?.content;
      const typedByUser = typeof content === "string" || (Array.isArray(content) && !content.some((c) => c.type === "tool_result"));
      const text = textOf(content);
      if (typedByUser && text && !isSystemText(text)) {
        meta.lastPrompt = truncate(text.trim(), 280);
        meta.turns++;
      }
      for (const m of text.slice(0, 4000).matchAll(MENTION)) meta.mentions.add(m[1]);
      break;
    }
    case "assistant": {
      if (rec.message?.model && !rec.message.model.startsWith("<")) meta.model = rec.message.model;
      for (const block of rec.message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) meta.lastText = truncate(block.text.trim(), 400);
        if (block.type === "tool_use") meta.lastAction = { tool: block.name, title: truncate(toolTitle(block.name, block.input), 160), ts: rec.timestamp };
      }
      break;
    }
  }
}

function readMeta(file) {
  const stat = fs.statSync(file);
  let entry = metaCache.get(file);
  if (!entry || stat.size < entry.offset) entry = { offset: 0, rest: Buffer.alloc(0), meta: emptyMeta(file) };
  if (stat.size > entry.offset) {
    const chunk = Buffer.concat([entry.rest, readFrom(file, entry.offset, stat.size)]);
    const { lines, rest } = splitLines(chunk);
    for (const line of lines) {
      const rec = parse(line);
      if (rec) applyRecord(entry.meta, rec);
    }
    entry.offset = stat.size;
    entry.rest = rest;
  }
  entry.mtimeMs = stat.mtimeMs;
  metaCache.set(file, entry);
  return { ...entry.meta, mtimeMs: stat.mtimeMs, size: stat.size };
}

function statusFor(mtimeMs, now = Date.now()) {
  if (now - mtimeMs < WORKING_MS) return "working";
  if (now - mtimeMs < RECENT_MS) return "idle";
  return "inactive";
}

function projectLabel(cwd, dir) {
  const source = cwd ?? dir;
  const worktree = source.match(/\.worktrees\/([^/]+)\/([^/]+)/);
  if (worktree) return `${worktree[1]} · ${worktree[2]}`;
  return path.basename(source);
}

function listSubagents(sessionFile) {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ""), "subagents");
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const file = path.join(dir, f);
      const id = f.replace(/\.jsonl$/, "").replace(/^agent-/, "");
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      } catch {}
      const meta = readMeta(file);
      return {
        id,
        description: info.description ?? meta.lastPrompt ?? id,
        agentType: info.agentType,
        toolUseId: info.toolUseId,
        status: statusFor(meta.mtimeMs),
        lastTs: meta.lastTs,
        lastAction: meta.lastAction,
        lastText: meta.lastText,
      };
    })
    .sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
}

function sessionFiles(maxAgeMs) {
  const now = Date.now();
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const full = path.join(PROJECTS_DIR, dir);
    let entries;
    try {
      entries = fs.readdirSync(full);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(full, f);
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs <= maxAgeMs) out.push({ id: f.replace(/\.jsonl$/, ""), dir, file });
    }
  }
  return out;
}

function summarize({ id, dir, file }, withSubagents = true) {
  const meta = readMeta(file);
  const subagents = withSubagents ? listSubagents(file) : [];
  const anySubWorking = subagents.some((s) => s.status === "working");
  const status = anySubWorking ? "working" : statusFor(meta.mtimeMs);
  return {
    id,
    title: meta.customTitle ?? meta.title ?? meta.lastPrompt ?? "Sesión sin título",
    project: projectLabel(meta.cwd, dir),
    cwd: meta.cwd,
    gitBranch: meta.gitBranch,
    model: meta.model,
    prLinks: [...meta.prLinks],
    mentions: [...meta.mentions],
    firstTs: meta.firstTs,
    lastTs: meta.lastTs,
    status,
    lastAction: meta.lastAction,
    lastText: meta.lastText,
    lastPrompt: meta.lastPrompt,
    turns: meta.turns,
    subagents: subagents.map(({ toolUseId, ...s }) => s),
  };
}

export function listSessions({ days = 3 } = {}) {
  return sessionFiles(days * 24 * 60 * 60_000)
    .map((s) => summarize(s))
    .sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
}

function findSessionFile(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const file = path.join(PROJECTS_DIR, dir, `${id}.jsonl`);
    if (fs.existsSync(file)) return { id, dir, file };
  }
  return null;
}

function toEvents(rec, agentsByToolUse) {
  const ts = rec.timestamp;
  const events = [];
  if (rec.type === "user") {
    const content = rec.message?.content;
    if (typeof content === "string") {
      if (content.startsWith("<task-notification")) {
        const summary = content.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
        events.push({ kind: "notice", ts, text: truncate(summary ?? "Notificación de tarea en background", 300) });
      } else if (!isSystemText(content)) {
        events.push({ kind: "prompt", ts, text: truncate(content, 6000) });
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content) ? block.content.map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[imagen]" : "")).join("\n") : String(block.content ?? "");
          events.push({ kind: "result", ts, toolUseId: block.tool_use_id, isError: Boolean(block.is_error), text: truncate(text, 4000) });
        } else if (block.type === "text" && block.text && !isSystemText(block.text)) {
          events.push({ kind: "prompt", ts, text: truncate(block.text, 6000) });
        } else if (block.type === "image") {
          events.push({ kind: "prompt", ts, text: "[imagen adjunta]" });
        }
      }
    }
  } else if (rec.type === "assistant") {
    for (const block of rec.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) events.push({ kind: "text", ts, text: truncate(block.text, 12000) });
      if (block.type === "tool_use") {
        events.push({
          kind: "tool",
          ts,
          id: block.id,
          name: block.name,
          title: truncate(toolTitle(block.name, block.input), 200),
          detail: truncate(toolDetail(block.name, block.input), 4000),
          agentId: agentsByToolUse?.get(block.id),
        });
      }
    }
  } else if (rec.type === "system" && rec.subtype === "compact_boundary") {
    events.push({ kind: "notice", ts, text: "Contexto compactado" });
  }
  return events;
}

/** Returns timeline events after `since` (byte offset), or the tail of the file when `since` is omitted. */
export function readSessionEvents(id, { since, agent } = {}) {
  const session = findSessionFile(id);
  if (!session) return null;
  const subagents = listSubagents(session.file);
  const file = agent ? path.join(session.file.replace(/\.jsonl$/, ""), "subagents", `agent-${agent}.jsonl`) : session.file;
  if (agent && (!/^[\w-]+$/.test(agent) || !fs.existsSync(file))) return null;

  const agentsByToolUse = new Map();
  const subDir = path.join(session.file.replace(/\.jsonl$/, ""), "subagents");
  for (const s of subagents) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(subDir, `agent-${s.id}.meta.json`), "utf8"));
      if (info.toolUseId) agentsByToolUse.set(info.toolUseId, s.id);
    } catch {}
  }

  const size = fs.statSync(file).size;
  const start = since !== undefined ? Math.min(Number(since), size) : Math.max(0, size - TAIL_BYTES);
  const { lines, rest } = splitLines(readFrom(file, start, size));
  if (since === undefined && start > 0) lines.shift();
  const events = [];
  for (const line of lines) {
    const rec = parse(line);
    if (rec) events.push(...toEvents(rec, agentsByToolUse));
  }
  return {
    session: summarize(session),
    events: since === undefined ? events.slice(-600) : events,
    cursor: size - rest.length,
    truncated: since === undefined && start > 0,
  };
}

/** Sessions whose PRs, branch, worktree or mentions point at the given task. */
export function sessionsForTask(task, sessions = listSessions()) {
  const prUrls = new Set();
  const prNumbers = new Set();
  for (const r of task.repos ?? []) {
    if (r.pr) {
      prUrls.add(r.pr);
      prNumbers.add(r.pr.split("/").pop());
    }
  }
  for (const pr of task.relatedPrs ?? []) prNumbers.add(String(pr).split("/").pop());
  const branches = new Set((task.repos ?? []).map((r) => r.branch).filter((b) => b && !["main", "develop", "master"].includes(b)));
  return sessions.filter(
    (s) =>
      s.prLinks.some((url) => prUrls.has(url) || prNumbers.has(url.split("/").pop())) ||
      (s.gitBranch && branches.has(s.gitBranch)) ||
      s.mentions.includes(task.id) ||
      (s.cwd ?? "").includes(`/.worktrees/${task.id}/`),
  );
}

export function sessionIdFromPath(relPath) {
  const parts = relPath.split(path.sep);
  if (parts.length < 2) return null;
  return parts[1].replace(/\.jsonl$/, "");
}
