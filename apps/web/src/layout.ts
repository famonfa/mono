import dagre from "@dagrejs/dagre";
import type { Board, WsEdge, WsNode } from "./types";

const LANE_PAD = 32;
const LANE_HEADER = 44;
const LANE_GAP = 48;
const COL_GAP = 40;
const ROW_GAP = 24;

export function estimateSize(node: WsNode) {
  if (node.measured?.width && node.measured?.height) return { width: node.measured.width, height: node.measured.height };
  if (node.width && node.height) return { width: node.width, height: node.height };
  const hasImage = Boolean(node.data.image);
  const detailLines = node.data.detail ? Math.min(3, Math.ceil(node.data.detail.length / 38)) : 0;
  switch (node.type) {
    case "actor":
      return { width: 160, height: 72 };
    case "activity":
      return { width: 240, height: 64 };
    case "note":
      return { width: 240, height: 140 };
    case "image":
      return { width: 300, height: 230 };
    case "lane":
      return { width: Number(node.style?.width ?? 600), height: Number(node.style?.height ?? 300) };
    default:
      return { width: 250, height: 74 + detailLines * 18 + (hasImage ? 150 : 0) + (node.data.files?.length ? 24 : 0) };
  }
}

const laneId = (name: string) => `lane:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function dagreLayout(nodes: WsNode[], edges: WsEdge[], direction: "LR" | "TB") {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 36, ranksep: 70, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, estimateSize(n));
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return new Map(
    nodes.map((n) => {
      const p = g.node(n.id);
      const { width, height } = estimateSize(n);
      return [n.id, { x: p.x - width / 2, y: p.y - height / 2 }];
    }),
  );
}

function layoutLanes(board: Board): WsNode[] {
  const content = board.nodes.filter((n) => n.type !== "lane");
  const direction = board.direction ?? "LR";
  const laneOrder: string[] = [];
  const byLane = new Map<string, WsNode[]>();
  for (const n of content) {
    const lane = n.data.lane ?? "";
    if (!byLane.has(lane)) {
      byLane.set(lane, []);
      laneOrder.push(lane);
    }
    byLane.get(lane)!.push(n);
  }

  if (laneOrder.length === 1 && laneOrder[0] === "") {
    const positions = dagreLayout(content, board.edges, direction);
    return content.map((n) => ({ ...n, parentId: undefined, position: positions.get(n.id)! }));
  }

  const result: WsNode[] = [];
  const children: WsNode[] = [];
  const columns = direction === "LR" && laneOrder.length > 6 ? Math.ceil(laneOrder.length / 6) : 1;
  const perColumn = Math.ceil(laneOrder.length / columns);
  let columnX = 0;
  let columnWidth = 0;
  let offset = 0;
  laneOrder.forEach((lane, index) => {
    if (index > 0 && index % perColumn === 0) {
      columnX += columnWidth + LANE_GAP * 2;
      columnWidth = 0;
      offset = 0;
    }
    const members = byLane.get(lane)!;
    const positions = dagreLayout(members, board.edges, direction);
    const xs = members.map((n) => positions.get(n.id)!.x);
    const ys = members.map((n) => positions.get(n.id)!.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...members.map((n) => positions.get(n.id)!.x + estimateSize(n).width));
    const maxY = Math.max(...members.map((n) => positions.get(n.id)!.y + estimateSize(n).height));
    const width = maxX - minX + LANE_PAD * 2;
    const height = maxY - minY + LANE_PAD + LANE_HEADER;
    const id = laneId(lane || "otros");
    result.push({
      id,
      type: "lane",
      position: direction === "LR" ? { x: columnX, y: offset } : { x: offset, y: 0 },
      data: { label: lane || "Other" },
      style: { width, height },
      width,
      height,
      zIndex: -1,
    });
    for (const n of members) {
      const p = positions.get(n.id)!;
      children.push({ ...n, parentId: id, position: { x: p.x - minX + LANE_PAD, y: p.y - minY + LANE_HEADER } });
    }
    columnWidth = Math.max(columnWidth, width);
    offset += (direction === "LR" ? height : width) + LANE_GAP;
  });
  return [...result, ...children];
}

function layoutStorymap(board: Board): WsNode[] {
  const content = board.nodes.filter((n) => n.type !== "lane");
  const actors = content.filter((n) => n.type === "actor");
  const activities = content.filter((n) => n.type === "activity");
  const activityIds = new Set(activities.map((a) => a.id));
  const steps = content.filter((n) => n.type !== "actor" && n.type !== "activity" && n.data.activity && activityIds.has(n.data.activity));
  const loose = content.filter((n) => !actors.includes(n) && !activities.includes(n) && !steps.includes(n));

  const out: WsNode[] = [];
  const colWidth = 260;
  const startX = actors.length ? 220 : 0;
  let actorY = 0;
  for (const a of actors) {
    out.push({ ...a, parentId: undefined, position: { x: 0, y: actorY } });
    actorY += estimateSize(a).height + ROW_GAP;
  }
  let maxBottom = actorY;
  activities.forEach((activity, i) => {
    const x = startX + i * (colWidth + COL_GAP);
    out.push({ ...activity, parentId: undefined, position: { x, y: 0 } });
    let y = estimateSize(activity).height + ROW_GAP * 2;
    for (const step of steps.filter((s) => s.data.activity === activity.id)) {
      out.push({ ...step, parentId: undefined, position: { x, y } });
      y += estimateSize(step).height + ROW_GAP;
    }
    maxBottom = Math.max(maxBottom, y);
  });
  let x = startX;
  for (const n of loose) {
    out.push({ ...n, parentId: undefined, position: { x, y: maxBottom + LANE_GAP } });
    x += estimateSize(n).width + COL_GAP;
  }
  return out;
}

export function autoLayout(board: Board): WsNode[] {
  return board.layout === "storymap" ? layoutStorymap(board) : layoutLanes(board);
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Places only the nodes that have no position yet, next to what the user already arranged. */
function placeMissing(board: Board): WsNode[] {
  const nodes = board.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = () => nodes.filter((n) => n.position);

  const rectOf = (n: WsNode) => ({ ...n.position!, ...estimateSize(n) });
  const siblingsOf = (parentId?: string) => placed().filter((n) => n.parentId === parentId && n.type !== "lane");
  const freeSpot = (start: { x: number; y: number }, node: WsNode, parentId?: string) => {
    const size = estimateSize(node);
    const spot = { ...start };
    const others = siblingsOf(parentId).map(rectOf);
    while (others.some((o) => overlaps({ ...spot, ...size }, o))) spot.y += size.height + ROW_GAP;
    return spot;
  };
  const bottomOfAll = () => Math.max(0, ...placed().filter((n) => !n.parentId).map((n) => n.position!.y + estimateSize(n).height));
  const findLane = (name: string) => nodes.find((n) => n.type === "lane" && (n.data.label === name || n.id === laneId(name)));

  // New nodes for a lane that doesn't exist yet get their own lane, laid out below everything else.
  const orphanLanes = new Map<string, WsNode[]>();
  for (const node of nodes) {
    if (node.position || node.type === "lane" || !node.data.lane || findLane(node.data.lane)) continue;
    orphanLanes.set(node.data.lane, [...(orphanLanes.get(node.data.lane) ?? []), node]);
  }
  for (const [name, members] of orphanLanes) {
    const positions = dagreLayout(members, board.edges, board.direction ?? "LR");
    const minX = Math.min(...members.map((n) => positions.get(n.id)!.x));
    const minY = Math.min(...members.map((n) => positions.get(n.id)!.y));
    const maxX = Math.max(...members.map((n) => positions.get(n.id)!.x + estimateSize(n).width));
    const maxY = Math.max(...members.map((n) => positions.get(n.id)!.y + estimateSize(n).height));
    const width = maxX - minX + LANE_PAD * 2;
    const height = maxY - minY + LANE_PAD + LANE_HEADER;
    let id = laneId(name);
    while (byId.has(id)) id = `${id}-2`;
    const lane: WsNode = { id, type: "lane", position: { x: 0, y: bottomOfAll() + LANE_GAP }, data: { label: name }, style: { width, height }, width, height, zIndex: -1 };
    nodes.push(lane);
    byId.set(id, lane);
    for (const n of members) {
      const pos = positions.get(n.id)!;
      n.parentId = id;
      n.position = { x: pos.x - minX + LANE_PAD, y: pos.y - minY + LANE_HEADER };
    }
  }

  for (const node of nodes) {
    if (node.position || node.type === "lane") continue;

    if (board.layout === "storymap") {
      if (node.type === "activity") {
        const cols = placed().filter((n) => n.type === "activity");
        const right = Math.max(-COL_GAP, ...cols.map((c) => c.position!.x + estimateSize(c).width));
        node.position = { x: right + COL_GAP, y: 0 };
        continue;
      }
      const column = node.data.activity ? byId.get(node.data.activity) : undefined;
      if (column?.position) {
        const below = placed().filter((n) => n.data.activity === column.id && n.position!.x === column.position!.x);
        const bottom = Math.max(column.position.y + estimateSize(column).height + ROW_GAP, ...below.map((n) => n.position!.y + estimateSize(n).height + ROW_GAP));
        node.position = { x: column.position.x, y: bottom };
        continue;
      }
    }

    const lane = node.data.lane ? findLane(node.data.lane) : undefined;
    const source = board.edges.map((e) => (e.target === node.id ? byId.get(e.source) : undefined)).find((n) => n?.position);
    if (source && source.parentId === (lane?.id ?? source.parentId)) {
      node.parentId = source.parentId;
      node.position = freeSpot({ x: source.position!.x + estimateSize(source).width + 70, y: source.position!.y }, node, source.parentId);
    } else if (lane) {
      const kids = siblingsOf(lane.id);
      const right = Math.max(LANE_PAD - 70, ...kids.map((k) => k.position!.x + estimateSize(k).width));
      node.parentId = lane.id;
      node.position = freeSpot({ x: right + 70, y: LANE_HEADER }, node, lane.id);
    } else {
      node.parentId = undefined;
      node.position = { x: 0, y: bottomOfAll() + LANE_GAP };
    }
  }

  for (const lane of nodes.filter((n) => n.type === "lane")) {
    const kids = nodes.filter((n) => n.parentId === lane.id && n.position);
    if (!kids.length) continue;
    const width = Math.max(Number(lane.style?.width ?? 0), ...kids.map((k) => k.position!.x + estimateSize(k).width + LANE_PAD));
    const height = Math.max(Number(lane.style?.height ?? 0), ...kids.map((k) => k.position!.y + estimateSize(k).height + LANE_PAD));
    lane.style = { ...lane.style, width, height };
    lane.width = width;
    lane.height = height;
  }
  return nodes;
}

const RESIZABLE_DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  note: { width: 240, height: 140 },
  image: { width: 300, height: 230 },
};

/**
 * Ensures every node has a position and parents come before children (React Flow requirement).
 * Tolerates bad data from agents: lanes without a position are dropped and their nodes re-placed by
 * lane name, and nodes pointing at a missing parent are re-placed too, instead of crashing the canvas.
 */
export function prepareNodes(board: Board): { nodes: WsNode[]; changed: boolean } {
  const unplacedLanes = new Map(board.nodes.filter((n) => n.type === "lane" && !n.position).map((n) => [n.id, String(n.data.label ?? "")]));
  const ids = new Set(board.nodes.filter((n) => !unplacedLanes.has(n.id)).map((n) => n.id));
  let sized = unplacedLanes.size > 0;
  const cleaned = board.nodes.filter((n) => !unplacedLanes.has(n.id)).map((n) => {
    const orphan = n.parentId && !ids.has(n.parentId);
    const node = orphan ? { ...n, parentId: undefined, position: undefined as never, data: { ...n.data, lane: n.data.lane ?? unplacedLanes.get(n.parentId!) } } : n;
    const size = RESIZABLE_DEFAULT_SIZE[node.type ?? ""];
    if (!size || (node.width && node.height)) return node;
    sized = true;
    return { ...node, ...size };
  });
  const wrapped = wrapLooseLaneNodes(cleaned);
  if (wrapped) {
    cleaned.splice(0, cleaned.length, ...wrapped);
    sized = true;
  }
  const missing = cleaned.filter((n) => !n.position);
  if (!missing.length) return { nodes: sortParentsFirst(cleaned), changed: sized };
  const anyPlaced = cleaned.some((n) => n.position && n.type !== "lane");
  const nodes = anyPlaced ? placeMissing({ ...board, nodes: cleaned }) : autoLayout({ ...board, nodes: cleaned });
  return { nodes: sortParentsFirst(nodes), changed: true };
}

/**
 * Positioned nodes that name a lane which doesn't exist (agent writes) get that lane built around them
 * where they already are. Dragging a node out of a lane clears its lane name, so manual moves never match.
 */
function wrapLooseLaneNodes(nodes: WsNode[]): WsNode[] | null {
  const lanes = nodes.filter((n) => n.type === "lane");
  const loose = new Map<string, WsNode[]>();
  for (const n of nodes) {
    if (n.type === "lane" || n.parentId || !n.position || !n.data.lane) continue;
    if (lanes.some((l) => l.data.label === n.data.lane || l.id === laneId(n.data.lane!))) continue;
    loose.set(n.data.lane, [...(loose.get(n.data.lane) ?? []), n]);
  }
  if (!loose.size) return null;
  const out = nodes.map((n) => ({ ...n }));
  for (const [name, members] of loose) {
    const minX = Math.min(...members.map((n) => n.position!.x));
    const minY = Math.min(...members.map((n) => n.position!.y));
    const maxX = Math.max(...members.map((n) => n.position!.x + estimateSize(n).width));
    const maxY = Math.max(...members.map((n) => n.position!.y + estimateSize(n).height));
    const width = maxX - minX + LANE_PAD * 2;
    const height = maxY - minY + LANE_PAD + LANE_HEADER;
    let id = laneId(name);
    while (out.some((n) => n.id === id)) id = `${id}-2`;
    out.push({ id, type: "lane", position: { x: minX - LANE_PAD, y: minY - LANE_HEADER }, data: { label: name }, style: { width, height }, width, height, zIndex: -1 });
    for (const m of members) {
      const node = out.find((n) => n.id === m.id)!;
      node.parentId = id;
      node.position = { x: m.position!.x - minX + LANE_PAD, y: m.position!.y - minY + LANE_HEADER };
    }
  }
  return out;
}

export function sortParentsFirst(nodes: WsNode[]) {
  return [...nodes].sort((a, b) => Number(b.type === "lane") - Number(a.type === "lane"));
}
