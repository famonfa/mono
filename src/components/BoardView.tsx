import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import { Download, Maximize, Plus, Rows3, Sparkles, StickyNote, Image as ImageIcon, SquareStack } from "lucide-react";
import { api, onDataChange } from "../api";
import { useApp } from "../app-context";
import { autoLayout, prepareNodes, sortParentsFirst } from "../layout";
import { BoardContext, nodeTypes } from "../nodes";
import { CHANGE_STATUS, TEST_STATUS, type Board, type NodeData, type Task, type WsEdge, type WsNode } from "../types";
import { Inspector } from "./Inspector";

type Props = { task: Task; boardId: string; embedded?: boolean };

export function BoardView(props: Props) {
  return (
    <ReactFlowProvider>
      <BoardCanvas key={`${props.task.id}/${props.boardId}`} {...props} />
    </ReactFlowProvider>
  );
}

function toStored(nodes: WsNode[]): WsNode[] {
  return nodes.map(({ selected, dragging, measured, resizing, ...rest }) => rest as WsNode);
}

function toStoredEdges(edges: WsEdge[]): WsEdge[] {
  return edges.map(({ selected, style, markerEnd, type, ...rest }) => rest as WsEdge);
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function BoardCanvas({ task, boardId, embedded = false }: Props) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WsNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WsEdge>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving">("saved");
  const flow = useReactFlow<WsNode, WsEdge>();
  const { openDialog, theme } = useApp();
  const wrapper = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const lastSaved = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(
    async (fit: boolean) => {
      try {
        const data = await api.getBoard(task.id, boardId);
        if (!fit && JSON.stringify([data.nodes, data.edges ?? []]) === lastSaved.current) return;
        const { nodes: prepared, changed } = prepareNodes(data);
        lastSaved.current = JSON.stringify([toStored(prepared), toStoredEdges(data.edges ?? [])]);
        setBoard(data);
        setNodes(prepared);
        setEdges(data.edges ?? []);
        loaded.current = true;
        if (changed) await api.saveBoard(task.id, { ...data, nodes: toStored(prepared) });
        if (fit) requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 0 }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [task.id, boardId, setNodes, setEdges, flow],
  );

  useEffect(() => void load(true), [load]);
  useEffect(
    () =>
      onDataChange((tasks) => {
        if (tasks.includes(task.id) && saveState === "saved") void load(false);
      }),
    [load, task.id, saveState],
  );

  const persist = useCallback(
    (nextNodes: WsNode[], nextEdges: WsEdge[], nextBoard = board) => {
      if (!loaded.current || !nextBoard) return;
      setSaveState("pending");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState("saving");
        await api.saveBoard(task.id, { ...nextBoard, nodes: toStored(nextNodes), edges: toStoredEdges(nextEdges) });
        setSaveState("saved");
      }, 500);
    },
    [board, task.id],
  );

  useEffect(() => {
    if (!loaded.current) return;
    const snapshot = JSON.stringify([toStored(nodes), toStoredEdges(edges)]);
    if (snapshot === lastSaved.current) return;
    lastSaved.current = snapshot;
    persist(nodes, edges);
  }, [nodes, edges, persist]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, id: newId("e"), data: { manual: true } }, eds)),
    [setEdges],
  );

  const center = () => {
    const rect = wrapper.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 120, y: rect.top + rect.height / 2 - 40 });
  };

  const addNode = (type: string, extra: Partial<NodeData> = {}, position = center()) => {
    const defaults: Record<string, Partial<WsNode>> = {
      lane: { style: { width: 700, height: 260 }, width: 700, height: 260, zIndex: -1 },
      note: { width: 240, height: 140 },
      image: { width: 300, height: 230 },
    };
    const label = { card: "Nuevo paso", note: "Nota", lane: "Nuevo carril", actor: "Actor", activity: "Actividad", image: "Captura" }[type] ?? "Nuevo";
    const node: WsNode = { id: newId(type), type, position, data: { label, manual: true, ...extra }, selected: true, ...defaults[type] };
    setNodes((ns) => sortParentsFirst([...ns.map((n) => ({ ...n, selected: false })), node]));
  };

  const onPaneDoubleClick = (event: React.MouseEvent) => {
    if (!(event.target as HTMLElement).classList.contains("react-flow__pane")) return;
    addNode("card", {}, flow.screenToFlowPosition({ x: event.clientX - 120, y: event.clientY - 30 }));
  };

  const onNodeDragStop = useCallback(
    (_: unknown, dragged: WsNode) => {
      if (dragged.type === "lane") return;
      const absolute = flow.getInternalNode(dragged.id)?.internals.positionAbsolute;
      if (!absolute) return;
      const lane = flow
        .getIntersectingNodes(dragged)
        .filter((n) => n.type === "lane")
        .pop();
      if (lane?.id === dragged.parentId) return;
      if (!lane && !dragged.parentId) return;
      const lanePos = lane ? flow.getInternalNode(lane.id)?.internals.positionAbsolute : undefined;
      setNodes((ns) =>
        sortParentsFirst(
          ns.map((n) =>
            n.id !== dragged.id
              ? n
              : {
                  ...n,
                  parentId: lane?.id,
                  position: lanePos ? { x: absolute.x - lanePos.x, y: absolute.y - lanePos.y } : absolute,
                  data: { ...n.data, lane: lane ? String(lane.data.label) : undefined },
                },
          ),
        ),
      );
    },
    [flow, setNodes],
  );

  const relayout = () => {
    if (!board) return;
    openDialog({
      title: "¿Re-ordenar todo automáticamente? Se pierde el acomodo manual de este board.",
      submitLabel: "Re-ordenar",
      fields: [],
      onSubmit: () => {
        const content = nodes.filter((n) => n.type !== "lane").map((n) => ({ ...n, parentId: undefined }));
        setNodes(sortParentsFirst(autoLayout({ ...board, nodes: content, edges })));
        requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300 }));
      },
    });
  };

  const exportPng = async () => {
    const bounds = getNodesBounds(nodes);
    const width = Math.min(6000, Math.max(1200, bounds.width + 160));
    const height = Math.min(6000, Math.max(800, bounds.height + 160));
    const viewport = getViewportForBounds(bounds, width, height, 0.2, 3, 0.05);
    const el = wrapper.current!.querySelector<HTMLElement>(".react-flow__viewport")!;
    const dataUrl = await toPng(el, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg-canvas").trim() || "#ffffff",
      width,
      height,
      pixelRatio: 2,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` },
    });
    const a = document.createElement("a");
    a.download = `${task.id}-${boardId}.png`;
    a.href = dataUrl;
    a.click();
  };

  const renameBoard = () => {
    if (!board) return;
    openDialog({
      title: "Renombrar board",
      submitLabel: "Guardar",
      fields: [{ name: "title", label: "Nombre", defaultValue: board.title }],
      onSubmit: ({ title }) => {
        if (!title.trim()) return;
        const next = { ...board, title: title.trim() };
        setBoard(next);
        persist(nodes, edges, next);
      },
    });
  };

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected);
  const direction = board?.direction ?? "LR";

  const decoratedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        style: e.data?.dashed ? { strokeDasharray: "6 4" } : undefined,
      })),
    [edges],
  );

  const contextValue = useMemo(() => ({ taskId: task.id, direction, openImage: setLightbox }), [task.id, direction]);

  if (error) return <div className="empty">No se pudo abrir el board: {error}</div>;

  return (
    <div className={`board ${embedded ? "embedded" : ""}`}>
      <div className="board-toolbar">
        <button className="board-title" onClick={renameBoard} title="Renombrar">
          {board?.title ?? "…"}
        </button>
        {board?.description && <span className="board-description">{board.description}</span>}
        <span className="spacer" />
        <span className={`save-state ${saveState}`}>{saveState === "saved" ? "Guardado" : "Guardando…"}</span>
        <div className="tool-group">
          <button className="tool" onClick={() => addNode("card")} title="Tarjeta (o doble click en el lienzo)">
            <Plus size={14} /> Tarjeta
          </button>
          <button className="tool" onClick={() => addNode("note", { color: "#fef3c7" })} title="Nota">
            <StickyNote size={14} />
          </button>
          <button className="tool" onClick={() => addNode("lane")} title="Carril">
            <Rows3 size={14} />
          </button>
          {board?.layout === "storymap" && (
            <button className="tool" onClick={() => addNode("activity")} title="Actividad">
              <SquareStack size={14} />
            </button>
          )}
          {task.assets.length > 0 && (
            <button className="tool" onClick={() => addNode("image", { image: `assets/${task.assets[0]}` })} title="Imagen">
              <ImageIcon size={14} />
            </button>
          )}
        </div>
        <div className="tool-group">
          <button className="tool" onClick={relayout} title="Re-ordenar automáticamente">
            <Sparkles size={14} />
          </button>
          <button className="tool" onClick={() => flow.fitView({ padding: 0.15, duration: 300 })} title="Ajustar a la vista">
            <Maximize size={14} />
          </button>
          <button className="tool" onClick={exportPng} title="Exportar PNG">
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className="board-body">
        <div className="canvas" ref={wrapper} onDoubleClick={onPaneDoubleClick}>
          <BoardContext.Provider value={contextValue}>
            <ReactFlow
              nodes={nodes}
              edges={decoratedEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={onNodeDragStop}
              zoomOnDoubleClick={false}
              zoomOnScroll={!embedded}
              preventScrolling={!embedded}
              deleteKeyCode={["Backspace", "Delete"]}
              multiSelectionKeyCode="Shift"
              minZoom={0.1}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
              colorMode={theme}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="var(--canvas-dots)" />
              <Controls showInteractive={false} />
              {!embedded && <MiniMap
                pannable
                zoomable
                maskColor="var(--minimap-mask)"
                nodeColor={(n) => (n.type === "lane" ? "var(--minimap-lane)" : CHANGE_STATUS[(n.data as NodeData).status ?? "same"].color)}
              />}
            </ReactFlow>
          </BoardContext.Provider>
          {!embedded && <Legend />}
        </div>
        {(selectedNode || selectedEdge) && (
        <Inspector
          task={task}
          node={selectedNode}
          edge={selectedEdge}
          onNodeChange={(id, patch, top) =>
            setNodes((ns) =>
              ns.map((n) => (n.id === id ? { ...n, ...top, data: { ...n.data, ...patch, edited: n.data.manual ? undefined : true } } : n)),
            )
          }
          onEdgeChange={(id, patch) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)))}
          onDelete={() => {
            const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
            setNodes((ns) => ns.filter((n) => !ids.has(n.id) && !(n.parentId && ids.has(n.parentId))));
            setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
          }}
        />
        )}
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span className="legend-hint">Doble click para crear · arrastrá desde un punto para conectar</span>
      <span className="legend-sep" />
      {(["new", "changed", "same", "removed"] as const).map((s) => (
        <span key={s}>
          <i style={{ background: CHANGE_STATUS[s].color }} /> {CHANGE_STATUS[s].label}
        </span>
      ))}
      <span className="legend-sep" />
      {(["pass", "fail", "todo"] as const).map((t) => (
        <span key={t} style={{ color: TEST_STATUS[t].color }}>
          {TEST_STATUS[t].icon} {TEST_STATUS[t].label}
        </span>
      ))}
    </div>
  );
}
