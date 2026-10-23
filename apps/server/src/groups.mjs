import crypto from "node:crypto";
import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "./store.mjs";

export const GROUPS_FILE = path.join(DATA_DIR, "groups.json");

export const PANE_SIZE = { w: 600, h: 680 };
const PANE_GAP = 48;

const readAll = () => readJson(GROUPS_FILE, { groups: [] }).groups ?? [];
const writeAll = (groups) => writeJson(GROUPS_FILE, { groups });

export function listGroups() {
  return readAll().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** Finds a group by id or, for the CLI, by its name (case-insensitive). */
export function findGroup(ref) {
  const needle = String(ref ?? "").toLowerCase();
  return readAll().find((g) => g.id === ref || g.name.toLowerCase() === needle) ?? null;
}

function mutate(id, change) {
  const groups = readAll();
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`No existe el grupo ${id}`);
  change(group);
  group.updatedAt = new Date().toISOString();
  writeAll(groups);
  return group;
}

/** New panes go to the right of the rightmost one, aligned to the top row. */
function nextSlot(panes) {
  if (!panes.length) return { x: 0, y: 0 };
  const right = Math.max(...panes.map((p) => p.x + p.w));
  const top = Math.min(...panes.map((p) => p.y));
  return { x: right + PANE_GAP, y: top };
}

const CHILD_ROW = 6;
const CHILD_DROP = 140;

/** Child `slot` of `total` goes in rows of up to six under its parent, each row centered below it. */
function childSlot(parent, slot, total) {
  const row = Math.floor(slot / CHILD_ROW);
  const inRow = Math.min(CHILD_ROW, total - row * CHILD_ROW);
  const col = slot % CHILD_ROW;
  const rowWidth = inRow * PANE_SIZE.w + (inRow - 1) * PANE_GAP;
  return {
    x: Math.round(parent.x + parent.w / 2 - rowWidth / 2 + col * (PANE_SIZE.w + PANE_GAP)),
    y: parent.y + parent.h + CHILD_DROP + row * (PANE_SIZE.h + PANE_GAP),
  };
}

/** `child` ({ parent, slot, total }) hangs the pane under the session that launched it, wired to it in the canvas. */
function addPane(group, sessionId, title, child) {
  if (group.panes.some((p) => p.sessionId === sessionId)) return;
  const parent = child && group.panes.find((p) => p.sessionId === child.parent);
  const position = parent ? childSlot(parent, child.slot, child.total) : nextSlot(group.panes);
  group.panes.push({ sessionId, title: title || undefined, ...(parent ? { parent: parent.sessionId } : {}), ...position, ...PANE_SIZE });
}

export function createGroup({ name, sessions = [] }) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("Poné un nombre para el grupo");
  const groups = readAll();
  if (groups.some((g) => g.name.toLowerCase() === clean.toLowerCase())) throw new Error(`Ya existe el grupo "${clean}"`);
  const now = new Date().toISOString();
  const group = { id: crypto.randomUUID().slice(0, 8), name: clean, createdAt: now, updatedAt: now, panes: [] };
  for (const s of sessions) addPane(group, s.sessionId, s.title);
  groups.push(group);
  writeAll(groups);
  return group;
}

export function updateGroup(id, { name, panes }) {
  return mutate(id, (group) => {
    if (typeof name === "string" && name.trim()) group.name = name.trim();
    if (Array.isArray(panes)) {
      const known = new Map(group.panes.map((p) => [p.sessionId, p]));
      group.panes = panes
        .filter((p) => known.has(p.sessionId))
        .map((p) => ({ ...known.get(p.sessionId), x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) }));
    }
  });
}

export function deleteGroup(id) {
  writeAll(readAll().filter((g) => g.id !== id));
}

export function addSession(id, sessionId, title, child) {
  if (!sessionId) throw new Error("Falta la sesión");
  return mutate(id, (group) => addPane(group, sessionId, title, child));
}

export function removeSession(id, sessionId) {
  return mutate(id, (group) => {
    group.panes = group.panes.filter((p) => p.sessionId !== sessionId);
  });
}

/** Fan-out progress shown in the canvas: titles still waiting to start, and children that failed to start. */
export function setSpawnState(id, { queued, failed }) {
  return mutate(id, (group) => {
    if (Array.isArray(queued)) group.queued = queued.length ? queued : undefined;
    if (Array.isArray(failed)) group.failed = [...(group.failed ?? []), ...failed];
  });
}
