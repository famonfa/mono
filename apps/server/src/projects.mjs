import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./store.mjs";

const T3_DB = path.join(os.homedir(), ".t3", "userdata", "state.sqlite");
const CLAUDE_CONFIG = path.join(os.homedir(), ".claude.json");
const OVERRIDES_FILE = path.join(DATA_DIR, "projects.json");
const CACHE_MS = 30_000;
const FAVICONS = ["favicon.svg", "favicon.png", "favicon.ico", "public/favicon.svg", "public/favicon.png", "public/favicon.ico", "assets/favicon.svg", "assets/favicon.png", "app/favicon.ico", "static/favicon.ico"];
const COLORS = ["#eb5757", "#f2994a", "#d9a23b", "#4cb782", "#26b5ce", "#5e6ad2", "#bb87fc", "#e15a97"];

let cache = { at: 0, projects: [] };

function realpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function slug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashColor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function readOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** Projects T3 Code knows about (read-only), so both apps share the same list of directories. */
function readT3Projects() {
  if (!fs.existsSync(T3_DB)) return [];
  try {
    const out = execFileSync("sqlite3", ["-readonly", "-json", `file:${T3_DB}?mode=ro`, "select title, workspace_root as root from projection_projects where deleted_at is null order by created_at"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return JSON.parse(out || "[]");
  } catch {
    return [];
  }
}

/** Without T3 Code: the git repos Claude Code has been used in (keys of `projects` in ~/.claude.json). */
function readClaudeProjects() {
  try {
    const dirs = Object.keys(JSON.parse(fs.readFileSync(CLAUDE_CONFIG, "utf8")).projects ?? {});
    return dirs.filter((dir) => dir !== os.homedir() && fs.existsSync(path.join(dir, ".git"))).map((root) => ({ title: path.basename(root), root }));
  } catch {
    return [];
  }
}

/** Every project T3 knows, including ones nested inside another (internal: folder pickers, launch roots). */
export function allProjects({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < CACHE_MS) return cache.projects;
  const overrides = readOverrides();
  const seen = new Set();
  const projects = [];
  const t3 = readT3Projects();
  for (const { title, root } of [...(t3.length ? t3 : readClaudeProjects()), ...(overrides.extra ?? [])]) {
    const real = realpath(root);
    if (seen.has(real) || !fs.existsSync(real)) continue;
    seen.add(real);
    const custom = overrides[real] ?? {};
    let id = slug(title) || slug(path.basename(real));
    while (projects.some((p) => p.id === id)) id = `${id}-2`;
    const favicon = FAVICONS.map((f) => path.join(real, f)).find((f) => fs.existsSync(f));
    const name = custom.title ?? title;
    projects.push({
      id,
      title: name,
      root: real,
      initials: (name[0] + name[name.length - 1]).toUpperCase(),
      color: custom.color ?? hashColor(name),
      favicon: custom.color ? undefined : favicon,
    });
  }
  for (const project of projects) project.parentId = parentOf(project, projects)?.id ?? null;
  cache = { at: Date.now(), projects };
  return projects;
}

const HOME_DIR = realpath(os.homedir());
const isInside = (dir, root) => dir === root || dir.startsWith(root + path.sep);

/**
 * The nearest project that contains this one (a monorepo contains its apps). The home folder is a
 * catch-all project, so it never acts as a parent.
 */
function parentOf(project, projects) {
  return projects
    .filter((p) => p !== project && p.root !== HOME_DIR && isInside(project.root, p.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
}

/**
 * Projects shown in the app: only outermost ones. A repo inside a monorepo is a folder of
 * the monorepo, not a project of its own: the monorepo is the single home for that family and holds the skills.
 */
export function listProjects(opts) {
  return allProjects(opts).filter((p) => !p.parentId);
}

function topProjectId(id) {
  const projects = allProjects();
  let current = projects.find((p) => p.id === id);
  while (current?.parentId) current = projects.find((p) => p.id === current.parentId);
  return current?.id ?? null;
}

export function descendantIds(projectId) {
  const projects = allProjects();
  const ids = new Set([projectId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) (ids.add(p.id), (grew = true));
  }
  return ids;
}

/**
 * Where a session must start so it loads the shared skills and CLAUDE.md: the outermost project that
 * contains the folder (the monorepo for anything under it). Claude Code doesn't load skills from parent folders.
 */
export function launchRootFor(dir) {
  const real = realpath(dir);
  const main = mainRepoRoot(real) ?? real;
  const containing = allProjects().filter((p) => p.root !== HOME_DIR && (isInside(real, p.root) || isInside(main, p.root)));
  return containing.sort((a, b) => a.root.length - b.root.length)[0]?.root ?? real;
}

export function saveOverride(projectId, patch) {
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const overrides = readOverrides();
  overrides[project.root] = { ...overrides[project.root], ...patch };
  fs.mkdirSync(path.dirname(OVERRIDES_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
  return allProjects({ fresh: true }).find((p) => p.root === project.root);
}

const repoRootCache = new Map();

/** For a path inside a git worktree, the main checkout it belongs to (so `.worktrees/X/app` counts as app). */
function mainRepoRoot(dir) {
  if (repoRootCache.has(dir)) return repoRootCache.get(dir);
  let root = null;
  try {
    const common = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (common.endsWith(`${path.sep}.git`)) root = realpath(path.dirname(common));
  } catch {}
  repoRootCache.set(dir, root);
  return root;
}

export function projectForPath(dir) {
  if (!dir) return null;
  const real = realpath(dir);
  const candidates = [mainRepoRoot(real), real].filter(Boolean);
  const projects = listProjects();
  for (const candidate of candidates) {
    const match = projects
      .filter((p) => candidate === p.root || candidate.startsWith(p.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (match) return match.id;
  }
  return null;
}

/** Explicit `projects` on the task win; otherwise repos are matched to projects by folder or title. Nested ones roll up to their outermost project. */
export function projectsForTask(task) {
  const projects = allProjects();
  const explicit = Array.isArray(task.projects) && task.projects.length ? task.projects : null;
  const ids = explicit ?? (task.repos ?? []).map((repo) => projects.find((p) => path.basename(p.root) === repo.name || p.title === repo.name)?.id);
  return [...new Set(ids.map((id) => id && topProjectId(id)).filter(Boolean))];
}

export function projectIcon(projectId) {
  return allProjects().find((p) => p.id === projectId)?.favicon ?? null;
}
