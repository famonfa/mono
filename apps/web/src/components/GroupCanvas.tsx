import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionLineType,
  BackgroundVariant,
  Controls,
  Handle,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  MiniMap,
  Position,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  useReactFlow,
  type Connection,
  type FinalConnectionState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import { ChevronRight, Clock, ExternalLink, LayoutGrid, Layers, Maximize, Pencil, Plus, Trash2, X } from "lucide-react";
import { useApp } from "../app-context";
import { groupsApi, reloadGroups, useGroups, type GroupPane, type QueuedPane, type SessionGroup } from "../groups";
import { StatusIcon } from "../icons";
import { href, navigate } from "../router";
import type { SessionSummary } from "../sessions";
import { formatDate, Menu, useHotkey } from "../ui";
import { markSeen, useUnread } from "../unread";
import { useIsMobile } from "../mobile";
import { SessionRow, StatusDot } from "./Agents";
import { LaunchSessions, SessionChat } from "./Chat";

type PaneData = { sessionId: string; title?: string };
type PaneNode = Node<PaneData, "pane">;
type QueuedData = { title: string; after?: string };
type QueuedNode = Node<QueuedData, "queued">;
type CanvasNode = PaneNode | QueuedNode;

const PaneActions = createContext<{ remove: (sessionId: string) => void; focus: (nodeId: string) => void }>(null as never);

const TILE_GAP = 48;
// Match the server's layout for launched sessions (groups.mjs).
const CHILD_ROW = 6;
const CHILD_DROP = 140;
const QUEUED_SIZE = { w: 300, h: 96 };
const viewportKey = (id: string) => `ws-group-viewport-${id}`;

function toNode(pane: GroupPane): PaneNode {
  return {
    id: pane.sessionId,
    type: "pane",
    position: { x: pane.x, y: pane.y },
    width: pane.w,
    height: pane.h,
    dragHandle: ".group-pane-head",
    data: { sessionId: pane.sessionId, title: pane.title },
  };
}

function toPanes(nodes: CanvasNode[]): GroupPane[] {
  return nodes.filter((n): n is PaneNode => n.type === "pane").map((n) => ({
    sessionId: n.data.sessionId,
    title: n.data.title,
    x: n.position.x,
    y: n.position.y,
    w: n.width ?? n.measured?.width ?? 0,
    h: n.height ?? n.measured?.height ?? 0,
  }));
}

const layoutKey = (panes: GroupPane[]) => JSON.stringify(panes.map((p) => [p.sessionId, Math.round(p.x), Math.round(p.y), Math.round(p.w), Math.round(p.h)]));

function SessionPane({ id, data }: NodeProps<PaneNode>) {
  const { sessions, tasks } = useApp();
  const { remove, focus } = useContext(PaneActions);
  const summary = sessions.find((s) => s.id === data.sessionId);
  const status = summary?.status ?? "inactive";
  const unread = useUnread()(summary);

  return (
    <>
      <NodeResizer isVisible minWidth={340} minHeight={280} lineClassName="group-pane-resize" handleClassName="group-pane-handle" />
      <Handle type="target" position={Position.Top} className="group-pane-port" />
      <Handle type="source" position={Position.Bottom} className="group-pane-port group-pane-out" title="Drag onto another session to make it a child" />
      <div className={`group-pane ${status} ${unread ? "unread" : ""}`} onPointerDownCapture={() => unread && summary && markSeen([summary])}>
        <header className="group-pane-head" onDoubleClick={() => focus(id)} title="Drag to move · double-click to zoom">
          <StatusDot status={unread ? "unread" : status} size={7} />
          <span className="group-pane-title">{summary?.title ?? data.title ?? "Session"}</span>
          {summary?.taskIds?.map((taskId) => {
            const task = tasks.find((t) => t.id === taskId);
            return (
              <a key={taskId} className="task-chip nodrag" href={href.task(taskId)}>
                {task && <StatusIcon status={task.status} size={11} />}
                {taskId}
              </a>
            );
          })}
          <span className="spacer" />
          {summary && <span className="group-pane-date">{formatDate(summary.lastTs)}</span>}
          <a className="icon-btn tiny nodrag" href={href.session(data.sessionId)} title="Open session">
            <ExternalLink size={13} />
          </a>
          <button className="icon-btn tiny nodrag" onClick={() => remove(data.sessionId)} title="Remove from group">
            <X size={13} />
          </button>
        </header>
        <div className="group-pane-body nodrag nowheel nopan">
          <SessionChat sessionId={data.sessionId} summary={summary} />
        </div>
      </div>
    </>
  );
}

/** A launched session that hasn't started: waiting for a free slot or for the session it follows. */
function QueuedCard({ data }: NodeProps<QueuedNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="group-pane-port" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="group-pane-port" />
      <div className="group-queued">
        <span className="group-queued-title">{data.title}</span>
        <span className="group-queued-sub">
          <Clock size={12} /> {data.after ? `Waiting for ${data.after}` : "Queued"}
        </span>
      </div>
    </>
  );
}

const nodeTypes = { pane: SessionPane, queued: QueuedCard };

/**
 * How much energy a wire carries: `flowing` while the child works (sparks run from parent to child),
 * `charged` once it has worked, `waiting` toward a card that hasn't started, `idle` otherwise.
 */
type EnergyState = "flowing" | "charged" | "waiting" | "idle";
type EnergyEdge = Edge<{ state: EnergyState; tag?: string }, "energy">;

const SPARKS = 3;

function EnergyWire({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<EnergyEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 18 });
  const state = data?.state ?? "idle";
  // Sparks keep a steady speed whatever the wire's length.
  const seconds = Math.min(6, Math.max(2.2, (Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY)) / 190));
  return (
    <g className={`energy ${state} ${selected ? "selected" : ""}`}>
      {state !== "idle" && state !== "waiting" && <path d={path} className="energy-glow" />}
      <BaseEdge id={id} path={path} className="energy-line" interactionWidth={18} />
      {state === "flowing" && <path d={path} className="energy-current" pathLength={100} />}
      {state === "flowing" &&
        Array.from({ length: SPARKS }, (_, i) => (
          <circle key={i} r={3.5} className="energy-spark">
            {/* Negative begins put every spark on the wire from the first frame. */}
            <animateMotion dur={`${seconds}s`} begin={`${(-seconds * i) / SPARKS}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
      <circle cx={sourceX} cy={sourceY} r={4.5} className="energy-socket" />
      <circle cx={targetX} cy={targetY} r={4.5} className="energy-socket" />
      {data?.tag && (
        <EdgeLabelRenderer>
          <span className={`energy-tag ${state}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.tag}
          </span>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

const edgeTypes = { energy: EnergyWire };

const asQueued = (q: string | QueuedPane, i: number): QueuedPane => (typeof q === "string" ? { key: `legacy-${i}`, title: q } : q);

/**
 * Waiting cards sit where their session will appear: under the pane (or card) they hang from, after the
 * siblings already there. Cards with nothing to hang from line up to the right of the canvas.
 */
function queuedNodes(queued: QueuedPane[], panes: PaneNode[]): QueuedNode[] {
  const size = (n: CanvasNode) => ({ w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 });
  const placed = new Map<string, QueuedNode>();
  const byId = new Map<string, CanvasNode>(panes.map((n) => [n.id, n]));
  const right = panes.length ? Math.max(...panes.map((n) => n.position.x + size(n).w)) + TILE_GAP * 2 : 0;
  let looseY = 0;
  const place = (q: QueuedPane, depth = 0): QueuedNode => {
    const id = `queued:${q.key}`;
    const done = placed.get(id);
    if (done) return done;
    let parent = q.parent ? byId.get(q.parent) : undefined;
    const waitingOn = q.parent?.startsWith("queued:") ? queued.find((o) => `queued:${o.key}` === q.parent) : undefined;
    if (!parent && waitingOn && depth < 50) parent = place(waitingOn, depth + 1);
    let position: { x: number; y: number };
    if (parent) {
      const below = parent.position.y + size(parent).h + CHILD_DROP;
      const row = [...byId.values()].filter((n) => n.id !== parent!.id && Math.abs(n.position.y - below) < 1 && n.position.x + size(n).w > parent!.position.x - 2000);
      const next = row.length ? Math.max(...row.map((n) => n.position.x + size(n).w)) + TILE_GAP : parent.position.x + size(parent).w / 2 - QUEUED_SIZE.w / 2;
      position = { x: next, y: below };
    } else {
      position = { x: right, y: looseY };
      looseY += QUEUED_SIZE.h + TILE_GAP / 2;
    }
    const node: QueuedNode = { id, type: "queued", position, width: QUEUED_SIZE.w, height: QUEUED_SIZE.h, draggable: false, selectable: false, data: { title: q.title, after: q.after } };
    placed.set(id, node);
    byId.set(id, node);
    return node;
  };
  for (const q of queued) place(q);
  return [...placed.values()];
}

export function GroupView({ groupId }: { groupId: string }) {
  const groups = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const mobile = useIsMobile();
  if (!group) return <div className="empty">{groups.length ? "Group not found." : null}</div>;
  if (mobile) return <GroupList group={group} />;
  return (
    <ReactFlowProvider>
      <GroupCanvas key={group.id} group={group} />
    </ReactFlowProvider>
  );
}

/** On a phone a canvas of chats can't be used: the group becomes a list of its sessions. */
function GroupList({ group }: { group: SessionGroup }) {
  const { sessions } = useApp();
  const members = group.panes.map((p) => sessions.find((s) => s.id === p.sessionId)).filter((s): s is SessionSummary => Boolean(s));
  return (
    <div className="group-mobile">
      <header className="topbar">
        <div className="topbar-title">{group.name}</div>
        <span className="topbar-sub">{members.length} {members.length === 1 ? "session" : "sessions"}</span>
      </header>
      <div className="list">
        {members.map((s) => (
          <SessionRow key={s.id} session={s} compact />
        ))}
        {!members.length && <div className="empty">Empty group.</div>}
      </div>
    </div>
  );
}

function GroupCanvas({ group }: { group: SessionGroup }) {
  const { sessions, openDialog, theme } = useApp();
  const flow = useReactFlow<CanvasNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<PaneNode>(group.panes.map(toNode));
  const queued = useMemo(() => (group.queued ?? []).map(asQueued), [group.queued]);
  const [waiting, setWaiting] = useState<QueuedNode[]>([]);
  useEffect(() => setWaiting((prev) => queuedNodes(queued, nodes).map((n) => ({ ...n, measured: prev.find((p) => p.id === n.id)?.measured }))), [queued, nodes]);
  const onCanvasNodesChange = onNodesChange as (changes: NodeChange<CanvasNode>[]) => void;
  const savedLayout = useRef(layoutKey(group.panes));
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const viewportTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const initialViewport = useMemo<Viewport | undefined>(() => {
    try {
      return JSON.parse(localStorage.getItem(viewportKey(group.id)) ?? "null") ?? undefined;
    } catch {
      return undefined;
    }
  }, [group.id]);

  useEffect(() => {
    const incoming = layoutKey(group.panes);
    if (incoming === savedLayout.current) return;
    savedLayout.current = incoming;
    setNodes((current) => group.panes.map((p) => ({ ...toNode(p), selected: current.find((n) => n.id === p.sessionId)?.selected })));
  }, [group.panes, setNodes]);

  useEffect(() => {
    document.title = `${group.name} · Groups`;
    return () => void (document.title = "Mono");
  }, [group.name]);

  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const panes = toPanes(flow.getNodes());
      const key = layoutKey(panes);
      if (key === savedLayout.current) return;
      savedLayout.current = key;
      void groupsApi.update(group.id, { panes });
    }, 250);
  }, [flow, group.id]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      // Waiting cards are derived from the group and kept apart from the persisted layout; they only take their measurements.
      const isQueued = (c: NodeChange<CanvasNode>) => "id" in c && String(c.id).startsWith("queued:");
      const queuedChanges = changes.filter(isQueued) as NodeChange<QueuedNode>[];
      if (queuedChanges.length) setWaiting((ns) => applyNodeChanges(queuedChanges, ns));
      onCanvasNodesChange(changes.filter((c) => !isQueued(c)));
      if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) persist();
    },
    [onCanvasNodesChange, persist],
  );

  const focus = useCallback((nodeId: string) => void flow.fitView({ nodes: [{ id: nodeId }], padding: 0.08, maxZoom: 1.2, duration: 300 }), [flow]);
  const fitAll = useCallback(() => void flow.fitView({ padding: 0.08, maxZoom: 1, duration: 300 }), [flow]);

  const remove = useCallback(
    async (sessionId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== sessionId));
      savedLayout.current = layoutKey(toPanes(flow.getNodes().filter((n) => n.id !== sessionId)));
      await groupsApi.removeSession(group.id, sessionId);
    },
    [flow, group.id, setNodes],
  );

  // Trees (a planner, its sessions, and the stacked sessions below those) stay as trees; everything else tiles as before.
  const tile = () => {
    const all = flow.getNodes().filter((n): n is PaneNode => n.type === "pane");
    const parentOf = new Map(group.panes.filter((p) => p.parent && all.some((n) => n.id === p.parent)).map((p) => [p.sessionId, p.parent!]));
    const byPos = (a: PaneNode, b: PaneNode) => a.position.y - b.position.y || a.position.x - b.position.x;
    const roots = all.filter((n) => !parentOf.has(n.id)).sort(byPos);
    const kids = (id: string) => all.filter((n) => parentOf.get(n.id) === id).sort(byPos);
    const w = (n: PaneNode) => n.width ?? n.measured?.width ?? 0;
    const h = (n: PaneNode) => n.height ?? n.measured?.height ?? 0;
    const rowsOf = (list: PaneNode[]) => Array.from({ length: Math.ceil(list.length / CHILD_ROW) }, (_, i) => list.slice(i * CHILD_ROW, (i + 1) * CHILD_ROW));
    const rowWidth = (row: PaneNode[]) => row.reduce((sum, n) => sum + w(n), 0) + Math.max(0, row.length - 1) * TILE_GAP;

    // Children that are leaves wrap in rows of six; once any of them has its own children, they share one row
    // so every subtree keeps its column.
    const widths = new Map<string, number>();
    const width = (n: PaneNode): number => {
      const cached = widths.get(n.id);
      if (cached !== undefined) return cached;
      const children = kids(n.id);
      const branchy = children.some((c) => kids(c.id).length);
      const span = !children.length ? 0 : branchy ? children.reduce((sum, c) => sum + width(c), 0) + (children.length - 1) * TILE_GAP : Math.max(...rowsOf(children).map(rowWidth));
      const result = Math.max(w(n), span);
      widths.set(n.id, result);
      return result;
    };
    const placed = new Map<string, { x: number; y: number }>();
    const layout = (n: PaneNode, x: number, y: number) => {
      const span = width(n);
      placed.set(n.id, { x: x + (span - w(n)) / 2, y });
      const children = kids(n.id);
      if (!children.length) return;
      const top = y + h(n) + CHILD_DROP;
      if (children.some((c) => kids(c.id).length)) {
        let cx = x + (span - (children.reduce((sum, c) => sum + width(c), 0) + (children.length - 1) * TILE_GAP)) / 2;
        for (const c of children) {
          layout(c, cx, top);
          cx += width(c) + TILE_GAP;
        }
        return;
      }
      let ry = top;
      for (const row of rowsOf(children)) {
        let cx = x + (span - rowWidth(row)) / 2;
        for (const c of row) {
          placed.set(c.id, { x: cx, y: ry });
          cx += w(c) + TILE_GAP;
        }
        ry += Math.max(...row.map(h)) + TILE_GAP;
      }
    };

    const trees = roots.filter((r) => kids(r.id).length);
    const loose = roots.filter((r) => !kids(r.id).length);
    let x = 0;
    for (const root of trees) {
      layout(root, x, 0);
      x += width(root) + TILE_GAP * 3;
    }
    // Panes without a planner: the old grid, to the right of the trees.
    const perRow = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(loose.length * 1.5))));
    const rowHeights: number[] = [];
    loose.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, h(n));
    });
    let lx = x;
    loose.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      if (i % perRow === 0) lx = x;
      placed.set(n.id, { x: lx, y: rowHeights.slice(0, row).reduce((sum, rh) => sum + rh + TILE_GAP, 0) });
      lx += w(n) + TILE_GAP;
    });
    setNodes((ns) => ns.map((n) => ({ ...n, position: placed.get(n.id) ?? n.position })));
    persist();
    setTimeout(fitAll, 50);
  };

  const rename = () =>
    openDialog({
      title: "Rename group",
      submitLabel: "Save",
      fields: [{ name: "name", label: "Name", defaultValue: group.name }],
      onSubmit: async ({ name }) => {
        if (!name.trim()) throw new Error("Name is required");
        await groupsApi.update(group.id, { name: name.trim() });
      },
    });

  const destroy = async () => {
    if (!window.confirm(`Delete group "${group.name}"? Sessions are kept.`)) return;
    await groupsApi.remove(group.id);
    localStorage.removeItem(viewportKey(group.id));
    reloadGroups();
    navigate(href.agents());
  };

  const inGroup = new Set(nodes.map((n) => n.id));
  const candidates = sessions.filter((s) => !inGroup.has(s.id));
  const add = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    const updated = await groupsApi.addSession(group.id, sessionId, session?.title);
    const pane = updated.panes.find((p) => p.sessionId === sessionId);
    if (pane) setTimeout(() => focus(pane.sessionId), 120);
  };

  const live = nodes.map((n) => sessions.find((s) => s.id === n.id)).filter((s): s is SessionSummary => Boolean(s));
  const workingIds = new Set(live.filter((s) => s.status === "working").map((s) => s.id));
  const working = workingIds.size;
  const isUnread = useUnread();
  const unreadIds = new Set(live.filter((s) => isUnread(s)).map((s) => s.id));
  const idle = live.filter((s) => s.status === "idle" && !unreadIds.has(s.id)).length;

  const canvasNodes: CanvasNode[] = waiting.length ? [...nodes, ...waiting] : nodes;
  const doneIds = new Set(live.filter((s) => s.status !== "working" && s.turns > 0).map((s) => s.id));

  // The circuit: each launched session hangs from its planner, a stacked one from the session it waited on.
  // Energy runs down a wire while the session it feeds works; waiting cards hang by dashed wires.
  const wire = { type: "energy", selectable: false, focusable: false } as const;
  const energy = (sessionId: string): EnergyState => (workingIds.has(sessionId) ? "flowing" : doneIds.has(sessionId) ? "charged" : "idle");
  const edges: EnergyEdge[] = [
    ...group.panes
      .filter((p) => p.parent && inGroup.has(p.parent) && inGroup.has(p.sessionId))
      .map((p) => ({
        ...wire,
        id: `${p.parent}->${p.sessionId}`,
        // Selectable so the wire takes the double click that unwires it.
        selectable: true,
        interactionWidth: 16,
        source: p.parent!,
        target: p.sessionId,
        data: { state: energy(p.sessionId), tag: p.link === "after" ? "base branch" : undefined },
      })),
    ...waiting.flatMap((n) => {
      const q = queued.find((o) => `queued:${o.key}` === n.id);
      const source = q?.parent;
      if (!source || !(inGroup.has(source) || waiting.some((o) => o.id === source))) return [];
      return [{ ...wire, id: `${source}->${n.id}`, source, target: n.id, data: { state: "waiting" as const } }];
    }),
  ];

  // Dragging from a session's bottom port onto another one hangs the second below the first.
  const connect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target || c.target.startsWith("queued:") || c.source.startsWith("queued:")) return;
      groupsApi.link(group.id, c.target, c.source).catch((error) => window.alert(String(error?.message ?? error)));
    },
    [group.id],
  );
  // Dropping anywhere on a session counts, not just on its small top port.
  const connectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const target = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node")?.getAttribute("data-id");
      if (target) connect({ source: state.fromNode.id, target, sourceHandle: null, targetHandle: null });
    },
    [connect],
  );
  const unlink = useCallback(
    (_e: unknown, edge: Edge) => {
      if (edge.target.startsWith("queued:")) return;
      void groupsApi.link(group.id, edge.target, null);
    },
    [group.id],
  );

  useHotkey("!", fitAll);
  const [launching, setLaunching] = useState(false);

  return (
    <PaneActions.Provider value={{ remove, focus }}>
      <div className="task-shell group-shell">
        <header className="topbar task-topbar">
          <nav className="breadcrumb">
            <span>Groups</span>
            <ChevronRight size={13} />
            <button className="crumb-task group-rename" onClick={rename} title="Rename">
              <span className="crumb-title">{group.name}</span>
              <Pencil size={11} />
            </button>
          </nav>
          <span className="group-stats">
            {working > 0 && (
              <span className="status-pill-live working">
                <StatusDot status="working" size={7} /> {working} working
              </span>
            )}
            {unreadIds.size > 0 && (
              <span className="status-pill-live unread">
                <StatusDot status="unread" size={7} /> {unreadIds.size} unread
              </span>
            )}
            {idle > 0 && (
              <span className="status-pill-live idle">
                <StatusDot status="idle" size={7} /> {idle} idle
              </span>
            )}
            {group.queued?.length ? (
              <span className="status-pill-live idle" title={queued.map((q) => (q.after ? `${q.title} (waiting for ${q.after})` : q.title)).join("\n")}>
                {group.queued.length} queued
              </span>
            ) : null}
            {group.failed?.length ? (
              <span className="status-pill-live failed" title={group.failed.map((f) => `${f.title}: ${f.error}`).join("\n")}>
                {group.failed.length} failed
              </span>
            ) : null}
          </span>
          <span className="spacer" />
          <Menu
            placeholder="Search sessions…"
            options={candidates.map((s) => ({ value: s.id, label: `${s.title} · ${s.project}`, icon: <StatusDot status={s.status} size={7} /> }))}
            onChange={(id) => void add(id)}
            className="btn ghost"
          >
            <Plus size={14} /> Add session
          </Menu>
          <button className="btn ghost" onClick={() => setLaunching(true)}>
            <Layers size={14} /> Launch sessions
          </button>
          <button className="icon-btn" onClick={tile} title="Tile" disabled={!nodes.length}>
            <LayoutGrid size={15} />
          </button>
          <button className="icon-btn" onClick={fitAll} title="Fit all (⇧1)" disabled={!nodes.length}>
            <Maximize size={15} />
          </button>
          <button className="icon-btn" onClick={() => void destroy()} title="Delete group">
            <Trash2 size={15} />
          </button>
        </header>
        <div className="group-canvas">
          <ReactFlow
            nodes={canvasNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onConnect={connect}
            onConnectEnd={connectEnd}
            onEdgeDoubleClick={unlink}
            connectionLineType={ConnectionLineType.SmoothStep}
            onNodeDragStop={persist}
            onSelectionDragStop={persist}
            onMoveEnd={(_e, viewport) => {
              clearTimeout(viewportTimer.current);
              viewportTimer.current = setTimeout(() => localStorage.setItem(viewportKey(group.id), JSON.stringify(viewport)), 200);
            }}
            defaultViewport={initialViewport}
            fitView={!initialViewport && nodes.length > 0}
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            panOnScroll
            panOnDrag={[1]}
            selectionOnDrag
            deleteKeyCode={null}
            colorMode={theme}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeBorderRadius={10}
              nodeStrokeWidth={6}
              nodeClassName={(n) => (unreadIds.has(n.id) ? "unread" : (sessions.find((s) => s.id === n.id)?.status ?? "inactive"))}
            />
          </ReactFlow>
          {!nodes.length && (
            <div className="group-empty">
              <p>Empty group.</p>
              <p className="hint">
                Or use <b>Send to group</b> from any session.
              </p>
            </div>
          )}
          {launching && <LaunchSessions group={group} onClose={() => setLaunching(false)} />}
        </div>
      </div>
    </PaneActions.Provider>
  );
}

/** "Send to group" menu for a session: adds it to an existing group or creates a new one with it. */
export function SendToGroup({ sessionId, title, className = "btn ghost" }: { sessionId: string; title?: string; className?: string }) {
  const { openDialog } = useApp();
  const groups = useGroups();
  const member = groups.filter((g) => g.panes.some((p) => p.sessionId === sessionId));
  const NEW = "__new__";

  const choose = async (value: string) => {
    if (value === NEW) {
      openDialog({
        title: "New group",
        submitLabel: "Create and send",
        fields: [{ name: "name", label: "Name" }],
        onSubmit: async ({ name }) => {
          await groupsApi.create(name, [{ sessionId, title }]);
          reloadGroups();
        },
      });
      return;
    }
    if (member.some((g) => g.id === value)) return navigate(href.group(value));
    await groupsApi.addSession(value, sessionId, title);
    reloadGroups();
  };

  return (
    <Menu
      placeholder="Pick a group…"
      options={[
        ...groups.map((g) => ({
          value: g.id,
          label: member.some((m) => m.id === g.id) ? `${g.name} · already in (open)` : `${g.name} · ${g.panes.length} ${g.panes.length === 1 ? "session" : "sessions"}`,
          icon: <LayoutGrid size={13} />,
        })),
        { value: NEW, label: "New group…", icon: <Plus size={13} /> },
      ]}
      onChange={(v) => void choose(v)}
      className={className}
    >
      <LayoutGrid size={14} /> {member.length ? `In ${member.length === 1 ? member[0].name : `${member.length} groups`}` : "Send to group"}
    </Menu>
  );
}
