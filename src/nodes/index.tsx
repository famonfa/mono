import { createContext, memo, useContext, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { User } from "lucide-react";
import { fileUrl } from "../api";
import { CHANGE_STATUS, TEST_STATUS, type WsNode } from "../types";

export const BoardContext = createContext<{ taskId: string; direction: "LR" | "TB"; openImage: (src: string) => void }>({
  taskId: "",
  direction: "LR",
  openImage: () => {},
});

function Handles() {
  const { direction } = useContext(BoardContext);
  const horizontal = direction === "LR";
  return (
    <>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} />
    </>
  );
}

function StatusChip({ status }: { status?: WsNode["data"]["status"] }) {
  if (!status) return null;
  const s = CHANGE_STATUS[status];
  return (
    <span className="chip" style={{ background: `${s.color}1f`, color: s.color }}>
      {s.label}
    </span>
  );
}

function TestBadge({ test }: { test?: WsNode["data"]["test"] }) {
  if (!test) return null;
  const t = TEST_STATUS[test];
  return (
    <span className="test-badge" style={{ background: t.color }} title={t.label}>
      {t.icon} {t.label}
    </span>
  );
}

const CardNode = memo(({ data, selected }: NodeProps<WsNode>) => {
  const { taskId, openImage } = useContext(BoardContext);
  const accent = data.color ?? (data.status ? CHANGE_STATUS[data.status].color : "transparent");
  return (
    <div className={`node card ${selected ? "selected" : ""} ${data.status === "removed" ? "removed" : ""}`} style={{ "--accent-color": accent } as CSSProperties}>
      <Handles />
      {(data.status || data.repo || data.test) && (
        <div className="card-meta">
          <StatusChip status={data.status} />
          {data.repo && <span className="chip repo">{data.repo}</span>}
          <span className="spacer" />
          <TestBadge test={data.test} />
        </div>
      )}
      <div className="card-label">{data.label}</div>
      {data.detail && <div className="card-detail">{data.detail}</div>}
      {data.image && (
        <img
          className="card-image nodrag"
          src={fileUrl(taskId, data.image)}
          alt={data.label}
          onDoubleClick={() => openImage(fileUrl(taskId, data.image!))}
        />
      )}
      {!!data.files?.length && (
        <div className="card-files" title={data.files.join("\n")}>
          {data.files.length === 1 ? data.files[0].split("/").pop() : `${data.files.length} archivos`}
        </div>
      )}
    </div>
  );
});

const ActorNode = memo(({ data, selected }: NodeProps<WsNode>) => (
  <div className={`node actor ${selected ? "selected" : ""}`}>
    <Handles />
    <span className="actor-icon">
      <User size={14} />
    </span>
    <span>{data.label}</span>
  </div>
));

const ActivityNode = memo(({ data, selected }: NodeProps<WsNode>) => (
  <div className={`node activity ${selected ? "selected" : ""}`}>
    <Handles />
    <div className="activity-label">{data.label}</div>
    {data.status && data.status !== "same" && <div className="activity-dot" style={{ background: CHANGE_STATUS[data.status].color }} />}
  </div>
));

const NoteNode = memo(({ data, selected }: NodeProps<WsNode>) => (
  <div className={`node note ${selected ? "selected" : ""}`} style={data.color ? { background: data.color } : undefined}>
    <NodeResizer isVisible={selected} minWidth={160} minHeight={80} />
    <Handles />
    <div className="note-label">{data.label}</div>
    {data.detail && <div className="note-detail">{data.detail}</div>}
  </div>
));

const ImageNode = memo(({ data, selected }: NodeProps<WsNode>) => {
  const { taskId, openImage } = useContext(BoardContext);
  const src = data.image ? fileUrl(taskId, data.image) : undefined;
  return (
    <div className={`node image-node ${selected ? "selected" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} keepAspectRatio />
      <Handles />
      {src ? <img src={src} alt={data.label} onDoubleClick={() => openImage(src)} draggable={false} /> : <div className="image-empty">Sin imagen</div>}
      <div className="image-caption">
        <TestBadge test={data.test} /> {data.label}
      </div>
    </div>
  );
});

const LaneNode = memo(({ data, selected }: NodeProps<WsNode>) => (
  <div className={`lane ${selected ? "selected" : ""}`} style={data.color ? { background: `${data.color}14`, borderColor: `${data.color}55` } : undefined}>
    <NodeResizer isVisible={selected} minWidth={200} minHeight={120} />
    <div className="lane-label">{data.label}</div>
  </div>
));

export const nodeTypes: NodeTypes = {
  card: CardNode,
  actor: ActorNode,
  activity: ActivityNode,
  note: NoteNode,
  image: ImageNode,
  lane: LaneNode,
};

export const NODE_TYPE_LABEL: Record<string, string> = {
  card: "Tarjeta",
  actor: "Actor",
  activity: "Actividad",
  note: "Nota",
  image: "Imagen",
  lane: "Carril",
};
