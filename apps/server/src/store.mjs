import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PKG_DIR, REPO_ROOT } from "./paths.mjs";

export { DATA_DIR };
export const ROOT = REPO_ROOT ?? PKG_DIR;
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
/** Where projects lived when they were called tasks; migrated on first use (see migrateTasks). */
const LEGACY_TASKS_DIR = path.join(DATA_DIR, "tasks");

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i;
const BOARD_EXT = ".board.json";
const DOC_EXT = ".md";
/** Per-folder metadata inside pages/: `{ title?, order?: slug[] }`. */
const META_FILE = "_meta.json";

export function assertSafe(...parts) {
  for (const part of parts) {
    if (!SAFE_ID.test(part) || part === "." || part === "..") throw new Error(`Invalid name: ${part}`);
  }
}

/**
 * A page id is its path inside `pages/`, slugs joined by `/` ("implementacion/tests/e2e"). A page is a
 * doc (`<id>.md`) or a canvas (`<id>.board.json`); its children live in the folder `<id>/`, so any page
 * can hold pages and a folder with no file of its own is just a folder.
 */
export function pageSegments(pageId) {
  const segments = String(pageId).replace(/\.md$/, "").split("/").filter(Boolean);
  if (!segments.length) throw new Error("Page path is empty");
  assertSafe(...segments);
  if (segments.some((s) => s.startsWith("_"))) throw new Error(`Invalid name: ${pageId}`);
  return segments;
}

const projectDir = (id) => (assertSafe(id), path.join(PROJECTS_DIR, id));
const pagesDir = (id) => path.join(projectDir(id), "pages");
const pageBase = (id, pageId) => path.join(pagesDir(id), ...pageSegments(pageId));
const boardPath = (id, pageId) => pageBase(id, pageId) + BOARD_EXT;
const docPath = (id, pageId) => pageBase(id, pageId) + DOC_EXT;
const metaPath = (id) => path.join(projectDir(id), "project.json");

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

const isDir = (p) => Boolean(fs.statSync(p, { throwIfNoEntry: false })?.isDirectory());

function listFiles(dir, filter) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith(".") && filter(f))
      .sort();
  } catch {
    return [];
  }
}

/** One task folder (`task.json`, `boards/*.json`, `docs/*.md`) rewritten as a project with a flat `pages/`. */
function convertTask(src, dest) {
  const pages = path.join(dest, "pages");
  fs.mkdirSync(pages, { recursive: true });
  const boards = new Set();
  for (const f of listFiles(path.join(src, "boards"), (f) => f.endsWith(".json"))) {
    const slug = f.replace(/\.json$/, "");
    boards.add(slug);
    fs.copyFileSync(path.join(src, "boards", f), path.join(pages, slug + BOARD_EXT));
  }
  for (const f of listFiles(path.join(src, "docs"), (f) => f.endsWith(DOC_EXT))) {
    let slug = f.slice(0, -DOC_EXT.length).replace(/^_+/, "") || "doc";
    if (boards.has(slug)) slug += "-doc";
    fs.copyFileSync(path.join(src, "docs", f), path.join(pages, slug + DOC_EXT));
  }
  for (const entry of fs.readdirSync(src)) {
    if (entry === "task.json") fs.copyFileSync(path.join(src, entry), path.join(dest, "project.json"));
    else if (entry !== "boards" && entry !== "docs") fs.cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true });
  }
}

/**
 * Tasks became projects: `tasks/<id>` → `projects/<id>` with boards and docs as pages. Each project is
 * built aside and renamed into place, so a crash or a second process (server + CLI) never leaves half a
 * project; the old folder ends up in `.trash` instead of being deleted.
 */
function migrateTasks() {
  if (!fs.existsSync(LEGACY_TASKS_DIR)) return;
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  for (const id of listFiles(LEGACY_TASKS_DIR, (f) => isDir(path.join(LEGACY_TASKS_DIR, f)))) {
    const dest = path.join(PROJECTS_DIR, id);
    if (fs.existsSync(dest)) continue;
    const tmp = path.join(PROJECTS_DIR, `.migrating-${id}-${process.pid}`);
    try {
      convertTask(path.join(LEGACY_TASKS_DIR, id), tmp);
      fs.renameSync(tmp, dest);
    } catch (error) {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (!fs.existsSync(dest)) throw error;
    }
  }
  const trash = path.join(DATA_DIR, ".trash");
  fs.mkdirSync(trash, { recursive: true });
  try {
    fs.renameSync(LEGACY_TASKS_DIR, path.join(trash, `tasks-before-projects-${Date.now()}`));
  } catch {
    // Another process moved it first.
  }
}

/** Where the workspace skill files the boards and docs it generates, so they don't crowd the project's own pages. */
export const WORKSPACE_FOLDER = "workspace";
const WORKSPACE_PAGES = ["story-map", "flujo", "testeo", "mapa-tecnico", "ui", "decisiones"];
const PAGES_VERSION = 2;

/** Projects from before the Workspace folder: their generated pages sat at the top of the tree. Moved once. */
function migrateWorkspaceFolder() {
  for (const id of listFiles(PROJECTS_DIR, (f) => isDir(path.join(PROJECTS_DIR, f)))) {
    const meta = readJson(metaPath(id), null);
    if (!meta || (meta.pagesVersion ?? 1) >= PAGES_VERSION) continue;
    const pages = pagesDir(id);
    const folder = path.join(pages, WORKSPACE_FOLDER);
    for (const slug of WORKSPACE_PAGES) {
      for (const ext of [BOARD_EXT, DOC_EXT]) {
        const from = path.join(pages, slug + ext);
        if (!fs.existsSync(from) || fs.existsSync(path.join(folder, slug + ext))) continue;
        fs.mkdirSync(folder, { recursive: true });
        fs.renameSync(from, path.join(folder, slug + ext));
      }
      const history = path.join(DATA_DIR, ".history", id, slug);
      const movedHistory = path.join(DATA_DIR, ".history", id, WORKSPACE_FOLDER, slug);
      if (fs.existsSync(history) && !fs.existsSync(movedHistory)) {
        fs.mkdirSync(path.dirname(movedHistory), { recursive: true });
        fs.renameSync(history, movedHistory);
      }
    }
    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, META_FILE))) writeJson(path.join(folder, META_FILE), { title: "Workspace" });
    writeJson(metaPath(id), { ...meta, pagesVersion: PAGES_VERSION });
  }
}

try {
  migrateTasks();
  migrateWorkspaceFolder();
} catch (error) {
  console.error(`Mono: could not migrate projects (will retry next start): ${error.message}`);
}

const pageExists = (id, pageId) => [boardPath(id, pageId), docPath(id, pageId), pageBase(id, pageId)].some((p) => fs.existsSync(p));

/**
 * The CLI's page names: agents keep saying `testeo` or `decisiones.md`, and those live in the Workspace
 * folder. A bare name that exists at the top stays there; otherwise it means `workspace/<name>`, and a
 * new generated page (story-map, flujo, testeo…) is created inside the folder.
 */
export function resolvePageId(id, pageId) {
  const segments = pageSegments(pageId);
  if (segments.length > 1) return segments.join("/");
  const [bare] = segments;
  const nested = `${WORKSPACE_FOLDER}/${bare}`;
  if (pageExists(id, bare)) return bare;
  if (pageExists(id, nested) || WORKSPACE_PAGES.includes(bare)) {
    saveFolderMeta(id);
    return nested;
  }
  return bare;
}

function saveFolderMeta(id) {
  const file = path.join(pagesDir(id), WORKSPACE_FOLDER, META_FILE);
  if (!fs.existsSync(file)) writeJson(file, { title: "Workspace" });
}

function docTitle(file, fallback) {
  try {
    return /^#\s+(.+)$/m.exec(fs.readFileSync(file, "utf8").slice(0, 2000))?.[1].trim() || fallback;
  } catch {
    return fallback;
  }
}

/** The page tree under `dir`, ordered by the folder's `_meta.json` order, then each board's `order`, then title. */
function readPages(dir, prefix, tests) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bySlug = new Map();
  const page = (slug) => {
    if (!bySlug.has(slug)) bySlug.set(slug, { id: prefix ? `${prefix}/${slug}` : slug, title: slug, kind: "folder", children: [] });
    return bySlug.get(slug);
  };
  const folders = [];
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith(".") || name.startsWith("_")) continue;
    if (entry.isDirectory()) {
      if (SAFE_ID.test(name)) folders.push(page(name));
    } else if (name.endsWith(BOARD_EXT)) {
      const slug = name.slice(0, -BOARD_EXT.length);
      const board = readJson(path.join(dir, name), {});
      const nodes = board.nodes?.filter((n) => n.type !== "lane") ?? [];
      if (board.kind === "tests") for (const n of nodes) if (n.data?.test in tests) tests[n.data.test]++;
      Object.assign(page(slug), { kind: "board", title: board.title ?? slug, boardKind: board.kind ?? "free", order: board.order, nodeCount: nodes.length });
    } else if (name.endsWith(DOC_EXT)) {
      const slug = name.slice(0, -DOC_EXT.length);
      // A board and a doc can't share a path (saveBoard/saveDoc refuse); if one slips in, the board wins.
      if (bySlug.get(slug)?.kind === "board") continue;
      Object.assign(page(slug), { kind: "doc", title: docTitle(path.join(dir, name), slug) });
    }
  }
  for (const folder of folders) {
    folder.children = readPages(path.join(dir, folder.id.split("/").pop()), folder.id, tests);
    if (folder.kind === "folder") folder.title = readJson(path.join(dir, folder.id.split("/").pop(), META_FILE), {}).title ?? folder.title;
  }
  const order = readJson(path.join(dir, META_FILE), {}).order ?? [];
  const rank = (p) => {
    const at = order.indexOf(p.id.split("/").pop());
    return at < 0 ? Infinity : at;
  };
  return [...bySlug.values()].sort((a, b) => rank(a) - rank(b) || (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title));
}

export function flattenPages(pages) {
  return pages.flatMap((p) => [p, ...flattenPages(p.children)]);
}

export function listProjects() {
  return listFiles(PROJECTS_DIR, (f) => isDir(path.join(PROJECTS_DIR, f)))
    .map((id) => getProject(id))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * The project plus its page tree. `boards` and `docs` are the same pages flattened, in the shape the
 * UI read when projects were tasks with a fixed set of boards.
 */
export function getProject(id) {
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) return null;
  const meta = readJson(metaPath(id), {});
  const tests = { pass: 0, fail: 0, todo: 0, skip: 0 };
  const pages = readPages(pagesDir(id), "", tests);
  const flat = flattenPages(pages);
  const boards = flat.filter((p) => p.kind === "board").map((p) => ({ id: p.id, title: p.title, kind: p.boardKind, order: p.order ?? 99, nodeCount: p.nodeCount }));
  boards.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return {
    status: "en-curso",
    title: id,
    ...meta,
    id,
    pages,
    boards,
    docs: flat.filter((p) => p.kind === "doc").map((p) => p.id + DOC_EXT),
    assets: listFiles(path.join(dir, "assets"), (f) => MEDIA_EXT.test(f)),
    tests: { ...tests, total: tests.pass + tests.fail + tests.todo + tests.skip },
  };
}

export function saveProject(id, patch) {
  const current = readJson(metaPath(id), null) ?? { pagesVersion: PAGES_VERSION };
  const { pages, boards, docs, assets, tests, ...rest } = patch;
  // Starring or changing the icon isn't work on the project: it shouldn't jump to the top of "updated".
  const cosmetic = Object.keys(rest).every((k) => k === "starred" || k === "icon");
  writeJson(metaPath(id), { ...current, ...rest, id, ...(cosmetic && current.updatedAt ? {} : { updatedAt: new Date().toISOString() }) });
  return getProject(id);
}

function moveToTrash(from, name) {
  const trash = path.join(DATA_DIR, ".trash");
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(from, path.join(trash, `${name}-${Date.now()}`));
}

export function trashProject(id) {
  moveToTrash(projectDir(id), id);
}

/** Old names: the HTTP API, chats and refresh still say task until the UI switches to projects. */
export const listTasks = listProjects;
export const getTask = getProject;
export const saveTask = saveProject;
export const trashTask = trashProject;

/** What sits at a page path: a board, a doc, or a folder (its children). Null when nothing does. */
export function getPage(id, pageId) {
  const board = getBoard(id, pageId);
  if (board) return { kind: "board", id: pageId, board };
  const content = getDoc(id, pageId);
  if (content !== null) return { kind: "doc", id: pageId, content };
  const base = pageBase(id, pageId);
  if (!isDir(base)) return null;
  return { kind: "folder", id: pageId, title: readJson(path.join(base, META_FILE), {}).title ?? pageSegments(pageId).at(-1), children: readPages(base, pageSegments(pageId).join("/"), { pass: 0, fail: 0, todo: 0, skip: 0 }) };
}

/** Saves an uploaded file (base64, optionally a data: URL) into the project's assets; returns its path for docs and boards. */
export function saveAsset(id, name, data) {
  const base64 = data.replace(/^data:[^;]+;base64,/, "");
  if (!base64) throw new Error("File is empty");
  const clean = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "file";
  const dir = path.join(projectDir(id), "assets");
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(clean);
  let file = clean;
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${path.basename(clean, ext)}-${n}${ext}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(base64, "base64"));
  touchProject(id);
  return `assets/${file}`;
}

export function getBoard(id, boardId) {
  return readJson(boardPath(id, boardId), null);
}

export function saveBoard(id, boardId, board) {
  if (fs.existsSync(docPath(id, boardId))) throw new Error(`A doc already lives at ${boardId}`);
  writeJson(boardPath(id, boardId), { ...board, id: boardId });
  touchProject(id);
  return getBoard(id, boardId);
}

/** Creates a folder page (or retitles one); children are added by saving boards or docs under its path. */
export function saveFolder(id, pageId, title) {
  const base = pageBase(id, pageId);
  fs.mkdirSync(base, { recursive: true });
  if (title) writeJson(path.join(base, META_FILE), { ...readJson(path.join(base, META_FILE), {}), title });
  touchProject(id);
}

/** Moves or renames a page with its children and board history; the page id is its path, so it changes. */
export function movePage(id, from, to) {
  const src = pageSegments(from).join("/");
  const dest = pageSegments(to).join("/");
  if (!pageExists(id, src)) throw new Error(`Page not found: ${src}`);
  if (dest === src || dest.startsWith(`${src}/`)) throw new Error("A page can't move inside itself");
  if (pageExists(id, dest)) throw new Error(`A page already lives at ${dest}`);
  fs.mkdirSync(path.dirname(pageBase(id, dest)), { recursive: true });
  for (const suffix of [BOARD_EXT, DOC_EXT, ""]) {
    if (fs.existsSync(pageBase(id, src) + suffix)) fs.renameSync(pageBase(id, src) + suffix, pageBase(id, dest) + suffix);
  }
  if (fs.existsSync(historyDir(id, src))) {
    fs.mkdirSync(path.dirname(historyDir(id, dest)), { recursive: true });
    fs.renameSync(historyDir(id, src), historyDir(id, dest));
  }
  touchProject(id);
  return dest;
}

/** Orders the pages directly inside `parentId` (null: the top level); slugs not listed keep sorting after them. */
export function setPageOrder(id, parentId, order) {
  const dir = parentId ? pageBase(id, parentId) : pagesDir(id);
  const slugs = order.map(String);
  assertSafe(...slugs);
  const file = path.join(dir, META_FILE);
  writeJson(file, { ...readJson(file, {}), order: slugs });
  touchProject(id);
}

/** Sends a page and everything under it to `.trash`. */
export function trashPage(id, pageId) {
  const name = `${id}-${pageSegments(pageId).join("-")}`;
  let found = false;
  for (const suffix of [BOARD_EXT, DOC_EXT, ""]) {
    const p = pageBase(id, pageId) + suffix;
    if (!fs.existsSync(p)) continue;
    moveToTrash(p, `${name}${suffix || "-pages"}`);
    found = true;
  }
  if (!found) throw new Error(`Page not found: ${pageId}`);
  touchProject(id);
}

const HISTORY_LIMIT = 30;
const historyDir = (id, boardId) => (assertSafe(id), path.join(DATA_DIR, ".history", id, ...pageSegments(boardId)));

/** Copies the board as it is now, before an agent overwrites it, so the change can be undone. */
export function snapshotBoard(id, boardId) {
  const file = boardPath(id, boardId);
  if (!fs.existsSync(file)) return null;
  const dir = historyDir(id, boardId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.copyFileSync(file, path.join(dir, name));
  const all = boardHistory(id, boardId).reverse();
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT))) fs.rmSync(path.join(dir, old));
  return name;
}

/** Snapshots newest first. Child pages keep their history in subfolders, hence the .json filter. */
export function boardHistory(id, boardId) {
  return listFiles(historyDir(id, boardId), (f) => f.endsWith(".json")).reverse();
}

/** Puts back the most recent snapshot and removes it from the history (one step of undo). */
export function restoreBoard(id, boardId) {
  const [latest] = boardHistory(id, boardId);
  if (!latest) throw new Error("No earlier versions of this board");
  const snapshot = path.join(historyDir(id, boardId), latest);
  writeJson(boardPath(id, boardId), JSON.parse(fs.readFileSync(snapshot, "utf8")));
  fs.rmSync(snapshot);
  touchProject(id);
  return latest;
}

/** Docs get the same undo as boards: a copy before an agent rewrites one, restored newest first. */
export function snapshotDoc(id, pageId) {
  const file = docPath(id, pageId);
  if (!fs.existsSync(file)) return null;
  const dir = historyDir(id, pageId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  fs.copyFileSync(file, path.join(dir, name));
  const all = docHistory(id, pageId).reverse();
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT))) fs.rmSync(path.join(dir, old));
  return name;
}

export function docHistory(id, pageId) {
  return listFiles(historyDir(id, pageId), (f) => f.endsWith(".md")).reverse();
}

export function restoreDoc(id, pageId) {
  const [latest] = docHistory(id, pageId);
  if (!latest) throw new Error("No earlier versions of this doc");
  const snapshot = path.join(historyDir(id, pageId), latest);
  fs.writeFileSync(docPath(id, pageId), fs.readFileSync(snapshot, "utf8"));
  fs.rmSync(snapshot);
  touchProject(id);
  return latest;
}

export function deleteBoard(id, boardId) {
  fs.rmSync(boardPath(id, boardId), { force: true });
  touchProject(id);
}

/** `name` is a page path; a trailing `.md` (how docs were named when they lived in docs/) is ignored. */
export function getDoc(id, name) {
  try {
    return fs.readFileSync(docPath(id, name), "utf8");
  } catch {
    return null;
  }
}

export function saveDoc(id, name, content) {
  if (fs.existsSync(boardPath(id, name))) throw new Error(`A board already lives at ${name.replace(/\.md$/, "")}`);
  const file = docPath(id, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  touchProject(id);
}

function touchProject(id) {
  const current = readJson(metaPath(id), { id, title: id });
  writeJson(metaPath(id), { ...current, updatedAt: new Date().toISOString() });
}

const DATA_KEYS = ["label", "detail", "status", "test", "repo", "files", "image", "lane", "activity", "color", "kind", "link", "video", "design"];

/** Accepts the flat node shape the AI writes ({id, type, label, status, ...}) and returns a React Flow node. */
export function normalizeNode(node) {
  const data = { ...(node.data ?? {}) };
  for (const key of DATA_KEYS) {
    if (node[key] !== undefined && data[key] === undefined) data[key] = node[key];
  }
  const out = { id: String(node.id), type: node.type ?? "card", data };
  if (node.position) out.position = node.position;
  if (node.parentId) out.parentId = node.parentId;
  if (node.width) out.width = node.width;
  if (node.height) out.height = node.height;
  if (node.style) out.style = node.style;
  return out;
}

export function normalizeEdge(edge, index) {
  const source = String(edge.source ?? edge.from);
  const target = String(edge.target ?? edge.to);
  return {
    id: String(edge.id ?? `${source}->${target}${index ? `#${index}` : ""}`),
    source,
    target,
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.animated ? { animated: true } : {}),
    ...(edge.dashed ? { data: { dashed: true } } : {}),
  };
}

/**
 * Merges an AI-generated board into what is on disk without destroying the user's work.
 * With `patch`, incoming nodes and edges are upserted and nothing existing is removed.
 * Otherwise:
 * positions the user arranged are kept, nodes edited in the UI keep their data,
 * and nodes or edges created in the UI survive regeneration.
 */
export function mergeBoard(existing, incoming, { relayout = false, patch = false } = {}) {
  const prevNodes = new Map((existing?.nodes ?? []).map((n) => [n.id, n]));
  // Layout belongs to the app: agent-supplied lanes, parents and positions are ignored (a lane without
  // a position once blanked a whole board). Lanes come from each node's `lane` name instead.
  const incomingNodes = (incoming.nodes ?? [])
    .map(normalizeNode)
    .filter((n) => n.type !== "lane")
    .map(({ position, parentId, width, height, ...n }) => n);
  const incomingIds = new Set(incomingNodes.map((n) => n.id));

  const nodes = incomingNodes.map((node) => {
    const prev = prevNodes.get(node.id);
    if (!prev) return node;
    const data = prev.data?.edited ? prev.data : { ...node.data, edited: undefined };
    const merged = { ...node, data };
    if (!relayout && prev.position) {
      merged.position = prev.position;
      if (prev.parentId) merged.parentId = prev.parentId;
      if (prev.width) merged.width = prev.width;
      if (prev.height) merged.height = prev.height;
    }
    return merged;
  });

  const isUserOwned = (n) => patch || n.data?.manual || (n.type === "lane" && !relayout);
  for (const prev of prevNodes.values()) {
    if (!incomingIds.has(prev.id) && isUserOwned(prev)) nodes.push(prev);
  }

  const keptIds = new Set(nodes.map((n) => n.id));
  const incomingEdges = (incoming.edges ?? []).map(normalizeEdge);
  const incomingEdgeIds = new Set(incomingEdges.map((e) => e.id));
  const manualEdges = (existing?.edges ?? []).filter((e) => (patch || e.data?.manual) && !incomingEdgeIds.has(e.id));
  const edges = [...incomingEdges, ...manualEdges].filter((e) => keptIds.has(e.source) && keptIds.has(e.target));

  if (relayout) {
    for (const n of nodes) {
      delete n.position;
      delete n.parentId;
    }
  }
  const finalNodes = relayout ? nodes.filter((n) => n.type !== "lane") : nodes;

  return {
    ...(existing ?? {}),
    title: incoming.title ?? existing?.title,
    kind: incoming.kind ?? existing?.kind ?? "free",
    layout: incoming.layout ?? existing?.layout ?? "lanes",
    direction: incoming.direction ?? existing?.direction ?? "LR",
    order: incoming.order ?? existing?.order,
    description: incoming.description ?? existing?.description,
    nodes: finalNodes,
    edges,
  };
}
