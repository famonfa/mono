import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const TASKS_DIR = path.join(DATA_DIR, "tasks");

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function assertSafe(...parts) {
  for (const part of parts) {
    if (!SAFE_ID.test(part)) throw new Error(`Nombre inválido: ${part}`);
  }
}

const taskDir = (id) => (assertSafe(id), path.join(TASKS_DIR, id));
const boardPath = (id, boardId) => (assertSafe(boardId), path.join(taskDir(id), "boards", `${boardId}.json`));
const docPath = (id, name) => (assertSafe(name), path.join(taskDir(id), "docs", name));

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

export function listTasks() {
  return listFiles(TASKS_DIR, (f) => fs.statSync(path.join(TASKS_DIR, f)).isDirectory())
    .map((id) => getTask(id))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function getTask(id) {
  const dir = taskDir(id);
  if (!fs.existsSync(dir)) return null;
  const meta = readJson(path.join(dir, "task.json"), {});
  const boards = listFiles(path.join(dir, "boards"), (f) => f.endsWith(".json")).map((f) => {
    const board = readJson(path.join(dir, "boards", f), {});
    const boardId = f.replace(/\.json$/, "");
    return { id: boardId, title: board.title ?? boardId, kind: board.kind ?? "free", order: board.order ?? 99, nodeCount: board.nodes?.filter((n) => n.type !== "lane").length ?? 0 };
  });
  boards.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return {
    status: "en-curso",
    title: id,
    ...meta,
    id,
    boards,
    docs: listFiles(path.join(dir, "docs"), (f) => f.endsWith(".md")),
    assets: listFiles(path.join(dir, "assets"), (f) => IMAGE_EXT.test(f)),
  };
}

export function saveTask(id, patch) {
  const file = path.join(taskDir(id), "task.json");
  const current = readJson(file, {});
  const { boards, docs, assets, ...rest } = patch;
  const next = { ...current, ...rest, id, updatedAt: new Date().toISOString() };
  writeJson(file, next);
  return getTask(id);
}

export function trashTask(id) {
  const trash = path.join(DATA_DIR, ".trash");
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(taskDir(id), path.join(trash, `${id}-${Date.now()}`));
}

export function getBoard(id, boardId) {
  return readJson(boardPath(id, boardId), null);
}

export function saveBoard(id, boardId, board) {
  writeJson(boardPath(id, boardId), { ...board, id: boardId });
  touchTask(id);
  return getBoard(id, boardId);
}

const HISTORY_LIMIT = 30;
const historyDir = (id, boardId) => (assertSafe(boardId), path.join(DATA_DIR, ".history", id, boardId));

/** Copies the board as it is now, before an agent overwrites it, so the change can be undone. */
export function snapshotBoard(id, boardId) {
  const file = boardPath(id, boardId);
  if (!fs.existsSync(file)) return null;
  const dir = historyDir(id, boardId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.copyFileSync(file, path.join(dir, name));
  const all = fs.readdirSync(dir).sort();
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT))) fs.rmSync(path.join(dir, old));
  return name;
}

export function boardHistory(id, boardId) {
  try {
    return fs.readdirSync(historyDir(id, boardId)).sort().reverse();
  } catch {
    return [];
  }
}

/** Puts back the most recent snapshot and removes it from the history (one step of undo). */
export function restoreBoard(id, boardId) {
  const [latest] = boardHistory(id, boardId);
  if (!latest) throw new Error("No hay versiones anteriores de este board");
  const snapshot = path.join(historyDir(id, boardId), latest);
  writeJson(boardPath(id, boardId), JSON.parse(fs.readFileSync(snapshot, "utf8")));
  fs.rmSync(snapshot);
  touchTask(id);
  return latest;
}

export function deleteBoard(id, boardId) {
  fs.rmSync(boardPath(id, boardId), { force: true });
  touchTask(id);
}

export function getDoc(id, name) {
  try {
    return fs.readFileSync(docPath(id, name), "utf8");
  } catch {
    return null;
  }
}

export function saveDoc(id, name, content) {
  const file = docPath(id, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  touchTask(id);
}

function touchTask(id) {
  const file = path.join(taskDir(id), "task.json");
  const current = readJson(file, { id, title: id });
  writeJson(file, { ...current, updatedAt: new Date().toISOString() });
}

const DATA_KEYS = ["label", "detail", "status", "test", "repo", "files", "image", "lane", "activity", "color", "kind", "link"];

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
