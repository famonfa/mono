import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ArrowLeft, Download, Frame, Maximize, Plus, Rows3, Sparkles, StickyNote, Image as ImageIcon, SquareStack } from "lucide-react";
import { api, onDataChange } from "../api";
import { useApp } from "../app-context";
import { href, navigate } from "../router";
import { useHotkey } from "../ui";
import { autoLayout, prepareNodes, sortParentsFirst } from "../layout";
import { BoardContext, nodeTypes } from "../nodes";
import { CHANGE_STATUS, type Board, type FigmaFrame, type NodeData, type Task, type WsEdge, type WsNode } from "../types";
import { CanvasAssistant } from "./CanvasAssistant";
import { Inspector } from "./Inspector";

type Props = { task: Task; boardId: string; embedded?: boolean };

export function BoardView(props: Props) {
  return (
    <BoardErrorBoundary key={`${props.task.id}/${props.boardId}`} {...props}>
      <ReactFlowProvider>
        <BoardCanvas key={`${props.task.id}/${props.boardId}`} {...props} />
      </ReactFlowProvider>
    </BoardErrorBoundary>
  );
}

/** A board with data the canvas can't draw shows a recovery screen instead of blanking the app. */
class BoardErrorBoundary extends Component<Props & { children: ReactNode }, { error: string | null; busy: boolean }> {
  state = { error: null as string | null, busy: false };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message, busy: false };
  }

  private async recover(action: () => Promise<unknown>) {
    this.setState({ busy: true });
    try {
      await action();
      this.setState({ error: null, busy: false });
    } catch (e) {
      this.setState({ error: (e as Error).message, busy: false });
    }
  }

  private repair = () =>
    this.recover(async () => {
      const board = await api.getBoard(this.props.task.id, this.props.boardId);
      const nodes = board.nodes.filter((n) => n.type !== "lane").map(({ position, parentId, ...n }) => n as WsNode);
      await api.saveBoard(this.props.task.id, { ...board, nodes });
    });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="board-crash">
        <strong>This board has data the canvas can't render.</strong>
        <code>{this.state.error}</code>
        <div className="board-crash-actions">
          <button className="btn primary" disabled={this.state.busy} onClick={() => this.recover(() => api.undoBoard(this.props.task.id, this.props.boardId))}>
            Undo last AI change
          </button>
          <button className="btn ghost" disabled={this.state.busy} onClick={this.repair}>
            Repair (re-layout all)
          </button>
        </div>
      </div>
    );
  }
}

function toStored(nodes: WsNode[]): WsNode[] {
  return nodes.map(({ selected, dragging, measured, resizing, ...rest }) => rest as WsNode);
}

function toStoredEdges(edges: WsEdge[]): WsEdge[] {
  return edges.map(({ selected, style, markerEnd, type, ...rest }) => rest as WsEdge);
}

const DESIGN_WIDTH = 360;
/** Head + foot around the snapshot, so a frame keeps its proportions on the canvas. */
const DESIGN_CHROME = 64;
/** Stable per frame (matches `ws figma`), so importing the same frame again refreshes it. */
const figmaNodeId = ({ fileKey, nodeId }: { fileKey: string; nodeId: string }) => `figma-${fileKey.slice(0, 8)}-${nodeId.replace(/[^A-Za-z0-9]/g, "-")}`;
const figmaLink = (fileKey: string, nodeId: string) => `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, "-")}`;

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
  const knownIds = useRef<Set<string>>(new Set());
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
        const added = prepared.some((n) => !knownIds.current.has(n.id));
        knownIds.current = new Set(prepared.map((n) => n.id));
        if (fit) requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 0 }));
        else if (added) requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 400 }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [task.id, boardId, setNodes, setEdges, flow],
  );

  useEffect(() => void load(true), [load]);

  useEffect(() => {
    const el = wrapper.current;
    if (!embedded || !el) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => flow.fitView({ padding: 0.15, duration: 0 }), 80);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [embedded, flow]);
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
    const label = { card: "New step", note: "Note", lane: "New lane", actor: "Actor", activity: "Activity", image: "Screenshot" }[type] ?? "New";
    const node: WsNode = { id: newId(type), type, position, data: { label, manual: true, ...extra }, selected: true, ...defaults[type] };
    setNodes((ns) => sortParentsFirst([...ns.map((n) => ({ ...n, selected: false })), node]));
  };

  /** Frames already on the board are refreshed in place; new ones go in a row to the right of everything else. */
  const placeFrames = (frames: FigmaFrame[]) => {
    const current = flow.getNodes().filter((n) => !n.parentId);
    const bounds = current.length ? getNodesBounds(current) : null;
    const origin = bounds ? { x: bounds.x + bounds.width + 80, y: bounds.y } : center();
    const fresh = frames.filter((f) => !flow.getNode(figmaNodeId(f.design))).length;
    if (fresh) requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300 }));
    setNodes((ns) => {
      const existing = new Set(ns.map((n) => n.id));
      const updated = ns.map((n) => {
        const frame = frames.find((f) => figmaNodeId(f.design) === n.id);
        return frame ? { ...n, data: { ...n.data, image: frame.image, link: frame.link, design: frame.design } } : { ...n, selected: false };
      });
      const added = frames
        .filter((f) => !existing.has(figmaNodeId(f.design)))
        .map((frame, i): WsNode => {
          const height = Math.round(Math.min(900, Math.max(160, DESIGN_WIDTH / frame.aspect + DESIGN_CHROME)));
          return {
            id: figmaNodeId(frame.design),
            type: "design",
            position: { x: origin.x + i * (DESIGN_WIDTH + 40), y: origin.y },
            data: { label: frame.label, image: frame.image, link: frame.link, design: frame.design, manual: true },
            width: DESIGN_WIDTH,
            height,
            selected: frames.length === 1,
          };
        });
      return sortParentsFirst([...updated, ...added]);
    });
  };

  const importFigma = async () => {
    const { hasToken } = await api.figmaStatus(task.id).catch(() => ({ hasToken: false }));
    openDialog({
      title: "Import from Figma",
      submitLabel: "Import",
      fields: [
        { name: "url", label: "Frame or page link", placeholder: "https://www.figma.com/design/…?node-id=…", mono: true },
        {
          name: "token",
          label: "Token",
          render: (value, set) => (
            <input
              className="dialog-input mono"
              type="password"
              autoComplete="off"
              placeholder={hasToken ? "Saved (paste a new one to replace it)" : "Figma personal access token (file_content:read)"}
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          ),
        },
      ],
      onSubmit: async ({ url, token }) => {
        if (!url.trim()) throw new Error("Paste a Figma link");
        placeFrames(await api.importFigma(task.id, url.trim(), token.trim() || undefined));
      },
    });
  };

  const refreshDesign = useCallback(
    async (nodeId: string) => {
      const design = flow.getNode(nodeId)?.data.design;
      if (design?.source !== "figma") return;
      const [frame] = await api.importFigma(task.id, figmaLink(design.fileKey, design.nodeId));
      if (!frame) throw new Error("Figma returned nothing for this frame");
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, image: frame.image, design: frame.design } } : n)));
    },
    [flow, task.id, setNodes],
  );

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
      title: "Auto-layout this board? Manual positions will be lost.",
      submitLabel: "Re-layout",
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
      title: "Rename board",
      submitLabel: "Save",
      fields: [{ name: "title", label: "Name", defaultValue: board.title }],
      onSubmit: ({ title }) => {
        if (!title.trim()) return;
        const next = { ...board, title: title.trim() };
        setBoard(next);
        persist(nodes, edges, next);
      },
    });
  };

  useHotkey("Escape", () => navigate(href.task(task.id)), { enabled: !embedded });

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

  const contextValue = useMemo(() => ({ taskId: task.id, direction, openImage: setLightbox, refreshDesign }), [task.id, direction, refreshDesign]);

  if (error) return <div className="empty">Couldn't open board: {error}</div>;

  return (
    <div className={`board ${embedded ? "embedded" : ""}`}>
      <div className="board-toolbar">
        <a className="tool" href={href.task(task.id)} title="Back (Esc)">
          <ArrowLeft size={14} /> Overview
        </a>
        <button className="board-title" onClick={renameBoard} title="Rename">
          {board?.title ?? "…"}
        </button>
        {board?.description && <span className="board-description">{board.description}</span>}
        <span className="spacer" />
        <span className={`save-state ${saveState}`}>{saveState === "saved" ? "Saved" : "Saving…"}</span>
        <div className="tool-group">
          <button className="tool" onClick={() => addNode("card")} title="Or double-click the canvas">
            <Plus size={14} /> Card
          </button>
          <button className="tool" onClick={() => addNode("note", { color: "#fef3c7" })} title="Note">
            <StickyNote size={14} />
          </button>
          <button className="tool" onClick={() => addNode("lane")} title="Lane">
            <Rows3 size={14} />
          </button>
          {board?.layout === "storymap" && (
            <button className="tool" onClick={() => addNode("activity")} title="Activity">
              <SquareStack size={14} />
            </button>
          )}
          {task.assets.length > 0 && (
            <button className="tool" onClick={() => addNode("image", { image: `assets/${task.assets[0]}` })} title="Image">
              <ImageIcon size={14} />
            </button>
          )}
          <button className="tool" onClick={importFigma} title="Import from Figma">
            <Frame size={14} />
          </button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={relayout} title="Auto-layout">
            <Sparkles size={14} />
          </button>
          <button className="tool" onClick={() => flow.fitView({ padding: 0.15, duration: 300 })} title="Fit view">
            <Maximize size={14} />
          </button>
          <button className="tool" onClick={exportPng} title="Export PNG">
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
          {!embedded && (
            <CanvasAssistant task={task} boardId={boardId} selected={nodes.filter((n) => n.selected && n.type !== "lane").map((n) => ({ id: n.id, label: String(n.data.label ?? n.id) }))} />
          )}
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

