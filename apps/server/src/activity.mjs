import fs from "node:fs";
import path from "node:path";
import * as store from "./store.mjs";
import * as sessions from "./sessions.mjs";

const DAY_MS = 24 * 60 * 60_000;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i;

const COMMIT_LINE = /\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,12})\] ((?:[^"\\]|\\[^n])+)/g;
const commitCache = new Map();

function sessionFile(id) {
  for (const dir of fs.readdirSync(sessions.PROJECTS_DIR)) {
    const file = path.join(sessions.PROJECTS_DIR, dir, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Commits the session itself made, read from `git commit` output in its transcript ("[branch sha] subject").
 * Several agents often work in the same repo at once, so commit times alone can't say whose commit it is.
 */
function sessionCommits(id) {
  const file = sessionFile(id);
  if (!file) return [];
  const { size } = fs.statSync(file);
  const cached = commitCache.get(file);
  if (cached?.size === size) return cached.commits;
  const seen = new Map(cached?.size < size ? cached.commits.map((c) => [c.sha, c]) : []);
  const fd = fs.openSync(file, "r");
  try {
    const start = cached?.size < size ? cached.size : 0;
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes('"tool_result"')) continue;
      for (const m of line.matchAll(COMMIT_LINE)) {
        if (!seen.has(m[2])) seen.set(m[2], { sha: m[2], branch: m[1], subject: m[3].replace(/\\"/g, '"').trim() });
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  const commits = [...seen.values()];
  commitCache.set(file, { size, commits });
  return commits;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Pages whose file changed after `since`, newest first. */
function editedPages(task, since) {
  const dir = path.join(store.PROJECTS_DIR, task.id, "pages");
  const titles = new Map(store.flattenPages(task.pages ?? []).map((p) => [p.id, p.title]));
  return walkFiles(dir)
    .filter((f) => /\.(board\.json|md)$/.test(f))
    .map((f) => {
      const id = path.relative(dir, f).replace(/\.(board\.json|md)$/, "").split(path.sep).join("/");
      return { id, title: titles.get(id) ?? id, ts: fs.statSync(f).mtime.toISOString() };
    })
    .filter((p) => p.ts >= since);
}

function newAssets(task, since) {
  const dir = path.join(store.PROJECTS_DIR, task.id, "assets");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => MEDIA_EXT.test(name))
    .map((name) => ({ name, ts: fs.statSync(path.join(dir, name)).mtime.toISOString() }))
    .filter((a) => a.ts >= since);
}

const isRefreshSession = (s) => /ws-refresh\//.test(s.cwd ?? "") || /ws-refresh\//.test(s.firstCwd ?? "");

/**
 * What happened in a project, built only from what is already on disk: the linked agent sessions
 * (with the commits and PRs they produced), screenshots added and pages edited. No AI involved,
 * so it can't break the boards and is always current.
 */
export function projectActivity(id, { days = 14 } = {}) {
  const task = store.getTask(id);
  if (!task) return null;
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const events = [];

  for (const s of sessions.sessionsForTask(task)) {
    if (isRefreshSession(s) || (s.lastTs ?? "") < since) continue;
    events.push({
      kind: "session",
      ts: s.lastTs,
      startTs: s.firstTs,
      sessionId: s.id,
      title: s.title,
      status: s.status,
      turns: s.turns,
      lastPrompt: s.lastPrompt,
      lastText: s.lastText,
      branch: s.gitBranch,
      prs: s.prLinks,
      commits: sessionCommits(s.id),
    });
  }

  const byDay = (items) => {
    const days = new Map();
    for (const item of items) {
      const day = item.ts.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), item]);
    }
    return [...days.values()];
  };
  for (const assets of byDay(newAssets(task, since))) {
    events.push({ kind: "evidence", ts: assets.map((a) => a.ts).sort().at(-1), assets: assets.map((a) => a.name) });
  }
  for (const pages of byDay(editedPages(task, since))) {
    events.push({ kind: "pages", ts: pages.map((p) => p.ts).sort().at(-1), pages: pages.map(({ id, title }) => ({ id, title })) });
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts));
  return { since, events };
}
