import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { GitPullRequest, Plus } from "lucide-react";
import { useApp } from "../app-context";
import { BoardIcon, RiskIcon, STATUS_META, StatusIcon, type Risk } from "../icons";
import { href, navigate } from "../router";
import type { Task, TaskStatus } from "../types";
import { formatDate } from "../ui";
import { StatusDot } from "./Agents";

const COL_WIDTH = 300;
const COL_GAP = 28;
const HEADER = 52;
const CARD_HEIGHT = 112;
const CARD_GAP = 10;
const PAD = 10;

type ColumnData = { status: TaskStatus; count: number; height: number };
type CardData = { task: Task; live: boolean };
type KanbanNode = Node<ColumnData, "column"> | Node<CardData, "card">;

/** Manual order inside a column (from dragging), then most recently updated first. */
function sortColumn(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const ao = a.boardOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.boardOrder ?? Number.POSITIVE_INFINITY;
    return ao !== bo ? ao - bo : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

const columnX = (index: number) => index * (COL_WIDTH + COL_GAP);
const cardY = (index: number) => HEADER + PAD + index * (CARD_HEIGHT + CARD_GAP);

function layout(tasks: Task[], statuses: TaskStatus[], liveTasks: Set<string>): KanbanNode[] {
  const columns = statuses.map((status) => ({ status, items: sortColumn(tasks.filter((t) => t.status === status)) }));
  const tallest = Math.max(4, ...columns.map((c) => c.items.length));
  const height = cardY(tallest) + PAD;
  return [
    ...columns.map(
      ({ status, items }, i): KanbanNode => ({
        id: `column:${status}`,
        type: "column",
        position: { x: columnX(i), y: 0 },
        data: { status, count: items.length, height },
        draggable: false,
        selectable: false,
        zIndex: -1,
        style: { width: COL_WIDTH, height },
      }),
    ),
    ...columns.flatMap(({ items }, i) =>
      items.map(
        (task, j): KanbanNode => ({
          id: task.id,
          type: "card",
          position: { x: columnX(i) + PAD, y: cardY(j) },
          data: { task, live: liveTasks.has(task.id) },
          style: { width: COL_WIDTH - PAD * 2 },
        }),
      ),
    ),
  ];
}

const ColumnNode = memo(({ data }: NodeProps<Node<ColumnData, "column">>) => {
  const { newTask } = useApp();
  return (
    <div className="kcol" style={{ height: data.height }}>
      <div className="kcol-head">
        <StatusIcon status={data.status} />
        <span className="group-label">{STATUS_META[data.status].label}</span>
        <span className="group-count">{data.count}</span>
        <span className="spacer" />
        <button className="icon-btn nodrag" onClick={() => newTask(data.status)} title="Nueva tarea en este estado">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
});

const CardNode = memo(({ data, dragging }: NodeProps<Node<CardData, "card">>) => {
  const { task, live } = data;
  return (
    <div className={`kcard ${dragging ? "dragging" : ""}`} style={{ height: CARD_HEIGHT }}>
      <div className="kanban-card-top">
        <span className="row-id">{task.id}</span>
        {live && (
          <span className="row-live">
            <StatusDot status="working" size={6} /> en vivo
          </span>
        )}
        <span className="spacer" />
        <span className="row-date">{formatDate(task.updatedAt)}</span>
      </div>
      <div className="kanban-card-title">
        <StatusIcon status={task.status} />
        <span className="kcard-title">{task.title}</span>
      </div>
      <div className="kanban-card-meta">
        <RiskIcon risk={task.risk as Risk | undefined} />
        {task.tags?.slice(0, 2).map((t) => (
          <span key={t} className="label-pill">
            <i />
            {t}
          </span>
        ))}
        {!!task.repos?.length && (
          <span className="meta-repos">
            <GitPullRequest size={12} />
            {task.repos.length}
          </span>
        )}
        {!!task.boards.length && (
          <span className="meta-boards">
            {task.boards.slice(0, 4).map((b) => (
              <BoardIcon key={b.id} kind={b.kind} size={13} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
});

const nodeTypes: NodeTypes = { column: ColumnNode, card: CardNode };

export function KanbanCanvas(props: { tasks: Task[]; statuses: TaskStatus[] }) {
  return (
    <ReactFlowProvider>
      <KanbanFlow {...props} />
    </ReactFlowProvider>
  );
}

function KanbanFlow({ tasks, statuses }: { tasks: Task[]; statuses: TaskStatus[] }) {
  const { sessions, updateTask, theme } = useApp();
  const flow = useReactFlow();
  const liveTasks = useMemo(() => new Set(sessions.filter((s) => s.status === "working").flatMap((s) => s.taskIds ?? [])), [sessions]);
  const computed = useMemo(() => layout(tasks, statuses, liveTasks), [tasks, statuses, liveTasks]);
  const [nodes, setNodes, onNodesChange] = useNodesState<KanbanNode>(computed);
  const fitted = useRef(false);

  useEffect(() => {
    setNodes(computed);
    if (!fitted.current && computed.length) {
      fitted.current = true;
      requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1 }));
    }
  }, [computed, setNodes, flow]);

  /** Dropping a card picks the column under its center and the slot under its top edge. */
  const onDragStop = useCallback(
    (_: unknown, node: KanbanNode) => {
      if (node.type !== "card") return;
      const center = node.position.x + COL_WIDTH / 2;
      const column = Math.max(0, Math.min(statuses.length - 1, Math.floor(center / (COL_WIDTH + COL_GAP))));
      const status = statuses[column];
      const others = sortColumn(tasks.filter((t) => t.status === status && t.id !== node.id));
      const slot = Math.max(0, Math.min(others.length, Math.round((node.position.y - HEADER - PAD) / (CARD_HEIGHT + CARD_GAP))));
      const ordered = [...others.slice(0, slot), node.data.task, ...others.slice(slot)];
      let changed = false;
      ordered.forEach((t, i) => {
        const patch: Partial<Task> = {};
        if (t.boardOrder !== i) patch.boardOrder = i;
        if (t.id === node.id && t.status !== status) patch.status = status;
        if (Object.keys(patch).length) {
          changed = true;
          void updateTask(t.id, patch);
        }
      });
      if (!changed) setNodes(computed);
    },
    [statuses, tasks, updateTask, setNodes, computed],
  );

  return (
    <div className="kanban-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onDragStop}
        onNodeClick={(_, node) => node.type === "card" && navigate(href.task(node.id))}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.6}
        colorMode={theme}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="var(--canvas-dots)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable maskColor="var(--minimap-mask)" nodeColor={(n) => (n.type === "column" ? "var(--minimap-lane)" : "var(--text-3)")} />
      </ReactFlow>
    </div>
  );
}
