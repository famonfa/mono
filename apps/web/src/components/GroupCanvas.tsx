import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import { ChevronRight, ExternalLink, LayoutGrid, Maximize, Pencil, Plus, Trash2, X } from "lucide-react";
import { useApp } from "../app-context";
import { groupsApi, reloadGroups, useGroups, type GroupPane, type SessionGroup } from "../groups";
import { StatusIcon } from "../icons";
import { href, navigate } from "../router";
import type { SessionSummary } from "../sessions";
import { formatDate, Menu, useHotkey } from "../ui";
import { markSeen, useUnread } from "../unread";
import { useIsMobile } from "../mobile";
import { SessionRow, StatusDot } from "./Agents";
import { SessionChat } from "./Chat";

type PaneData = { sessionId: string; title?: string };
type PaneNode = Node<PaneData, "pane">;

const PaneActions = createContext<{ remove: (sessionId: string) => void; focus: (nodeId: string) => void }>(null as never);

const TILE_GAP = 48;
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

function toPanes(nodes: PaneNode[]): GroupPane[] {
  return nodes.map((n) => ({
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
      <div className={`group-pane ${status} ${unread ? "unread" : ""}`} onPointerDownCapture={() => unread && summary && markSeen([summary])}>
        <header className="group-pane-head" onDoubleClick={() => focus(id)} title="Arrastrá para mover · doble click para acercar">
          <StatusDot status={unread ? "unread" : status} size={7} />
          <span className="group-pane-title">{summary?.title ?? data.title ?? "Sesión"}</span>
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
          <a className="icon-btn tiny nodrag" href={href.session(data.sessionId)} title="Abrir la sesión">
            <ExternalLink size={13} />
          </a>
          <button className="icon-btn tiny nodrag" onClick={() => remove(data.sessionId)} title="Quitar del grupo">
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

const nodeTypes = { pane: SessionPane };

export function GroupView({ groupId }: { groupId: string }) {
  const groups = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const mobile = useIsMobile();
  if (!group) return <div className="empty">{groups.length ? "No existe este grupo." : null}</div>;
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
        <span className="topbar-sub">{members.length} sesiones</span>
      </header>
      <div className="list">
        {members.map((s) => (
          <SessionRow key={s.id} session={s} compact />
        ))}
        {!members.length && <div className="empty">Este grupo está vacío.</div>}
      </div>
    </div>
  );
}

function GroupCanvas({ group }: { group: SessionGroup }) {
  const { sessions, openDialog, theme } = useApp();
  const flow = useReactFlow<PaneNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<PaneNode>(group.panes.map(toNode));
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
    document.title = `${group.name} · Grupos`;
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
    (changes: NodeChange<PaneNode>[]) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) persist();
    },
    [onNodesChange, persist],
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

  const tile = () => {
    const ordered = [...flow.getNodes()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const perRow = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ordered.length * 1.5))));
    const rowHeights: number[] = [];
    ordered.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, n.height ?? 0);
    });
    let x = 0;
    const placed = ordered.map((n, i) => {
      const row = Math.floor(i / perRow);
      if (i % perRow === 0) x = 0;
      const y = rowHeights.slice(0, row).reduce((sum, h) => sum + h + TILE_GAP, 0);
      const position = { x, y };
      x += (n.width ?? 0) + TILE_GAP;
      return { ...n, position };
    });
    setNodes(placed);
    persist();
    setTimeout(fitAll, 50);
  };

  const rename = () =>
    openDialog({
      title: "Renombrar grupo",
      submitLabel: "Guardar",
      fields: [{ name: "name", label: "Nombre", defaultValue: group.name }],
      onSubmit: async ({ name }) => {
        if (!name.trim()) throw new Error("Poné un nombre");
        await groupsApi.update(group.id, { name: name.trim() });
      },
    });

  const destroy = async () => {
    if (!window.confirm(`¿Borrar el grupo "${group.name}"? Las sesiones no se tocan.`)) return;
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

  useHotkey("!", fitAll);

  return (
    <PaneActions.Provider value={{ remove, focus }}>
      <div className="task-shell group-shell">
        <header className="topbar task-topbar">
          <nav className="breadcrumb">
            <span>Grupos</span>
            <ChevronRight size={13} />
            <button className="crumb-task group-rename" onClick={rename} title="Renombrar">
              <span className="crumb-title">{group.name}</span>
              <Pencil size={11} />
            </button>
          </nav>
          <span className="group-stats">
            {working > 0 && (
              <span className="status-pill-live working">
                <StatusDot status="working" size={7} /> {working} trabajando
              </span>
            )}
            {unreadIds.size > 0 && (
              <span className="status-pill-live unread">
                <StatusDot status="unread" size={7} /> {unreadIds.size} sin ver
              </span>
            )}
            {idle > 0 && (
              <span className="status-pill-live idle">
                <StatusDot status="idle" size={7} /> {idle} en pausa
              </span>
            )}
            {group.queued?.length ? (
              <span className="status-pill-live idle" title={group.queued.join("\n")}>
                {group.queued.length} en cola
              </span>
            ) : null}
            {group.failed?.length ? (
              <span className="status-pill-live failed" title={group.failed.map((f) => `${f.title}: ${f.error}`).join("\n")}>
                {group.failed.length} no arrancaron
              </span>
            ) : null}
          </span>
          <span className="spacer" />
          <Menu
            placeholder="Buscar sesión…"
            options={candidates.map((s) => ({ value: s.id, label: `${s.title} · ${s.project}`, icon: <StatusDot status={s.status} size={7} /> }))}
            onChange={(id) => void add(id)}
            className="btn ghost"
          >
            <Plus size={14} /> Agregar sesión
          </Menu>
          <button className="icon-btn" onClick={tile} title="Ordenar en grilla" disabled={!nodes.length}>
            <LayoutGrid size={15} />
          </button>
          <button className="icon-btn" onClick={fitAll} title="Ver todo (⇧1)" disabled={!nodes.length}>
            <Maximize size={15} />
          </button>
          <button className="icon-btn" onClick={() => void destroy()} title="Borrar grupo">
            <Trash2 size={15} />
          </button>
        </header>
        <div className="group-canvas">
          <ReactFlow
            nodes={nodes}
            onNodesChange={handleNodesChange}
            nodeTypes={nodeTypes}
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
              <p>Este grupo está vacío.</p>
              <p className="hint">
                Agregá sesiones con <b>Agregar sesión</b>, o desde cualquier sesión con <b>Enviar a grupo</b>.
              </p>
            </div>
          )}
        </div>
      </div>
    </PaneActions.Provider>
  );
}

/** "Enviar a grupo" menu for a session: adds it to an existing group or creates a new one with it. */
export function SendToGroup({ sessionId, title, className = "btn ghost" }: { sessionId: string; title?: string; className?: string }) {
  const { openDialog } = useApp();
  const groups = useGroups();
  const member = groups.filter((g) => g.panes.some((p) => p.sessionId === sessionId));
  const NEW = "__new__";

  const choose = async (value: string) => {
    if (value === NEW) {
      openDialog({
        title: "Nuevo grupo",
        submitLabel: "Crear y enviar",
        fields: [{ name: "name", label: "Nombre del grupo" }],
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
      placeholder="Elegí un grupo…"
      options={[
        ...groups.map((g) => ({
          value: g.id,
          label: member.some((m) => m.id === g.id) ? `${g.name} · ya está (abrir)` : `${g.name} · ${g.panes.length} sesiones`,
          icon: <LayoutGrid size={13} />,
        })),
        { value: NEW, label: "Nuevo grupo…", icon: <Plus size={13} /> },
      ]}
      onChange={(v) => void choose(v)}
      className={className}
    >
      <LayoutGrid size={14} /> {member.length ? `En ${member.length === 1 ? member[0].name : `${member.length} grupos`}` : "Enviar a grupo"}
    </Menu>
  );
}
