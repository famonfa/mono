import { createContext, memo, useContext, useState, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { ExternalLink, RefreshCw, User } from "lucide-react";
import { fileUrl } from "../api";
import { timeAgo } from "../ui";
import { CHANGE_STATUS, TEST_STATUS, type WsNode } from "../types";

export const BoardContext = createContext<{
  taskId: string;
  direction: "LR" | "TB";
  openImage: (src: string) => void;
  refreshDesign: (nodeId: string) => Promise<void>;
}>({
  taskId: "",
  direction: "LR",
  openImage: () => {},
  refreshDesign: async () => {},
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
          {data.files.length === 1 ? data.files[0].split("/").pop() : `${data.files.length} files`}
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
      {src ? <img src={src} alt={data.label} onDoubleClick={() => openImage(src)} draggable={false} /> : <div className="image-empty">No image</div>}
      <div className="image-caption">
        <TestBadge test={data.test} /> {data.label}
      </div>
    </div>
  );
});

const DESIGN_SOURCE = { figma: "Figma", pen: "Pencil" } as const;

/** A frame imported from Figma or Pencil: the exported PNG, where it came from, and a way back. */
const DesignNode = memo(({ id, data, selected }: NodeProps<WsNode>) => {
  const { taskId, openImage, refreshDesign } = useContext(BoardContext);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const design = data.design;
  // The PNG keeps its name across refreshes, so the sync time busts the browser cache.
  const src = data.image ? `${fileUrl(taskId, data.image)}${design?.syncedAt ? `?v=${encodeURIComponent(design.syncedAt)}` : ""}` : undefined;
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshDesign(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className={`node design-node ${selected ? "selected" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={160} />
      <Handles />
      <div className="design-head">
        {design && <span className={`design-source ${design.source}`}>{DESIGN_SOURCE[design.source]}</span>}
        <span className="design-label">{data.label}</span>
        <TestBadge test={data.test} />
      </div>
      {src ? <img src={src} alt={data.label} onDoubleClick={() => openImage(src)} draggable={false} /> : <div className="image-empty">No snapshot yet</div>}
      <div className="design-foot">
        <span className="design-meta" title={error ?? (design?.source === "pen" ? design.file : undefined)}>
          {error ? <span className="design-error">{error}</span> : design?.source === "pen" ? design.file.split("/").pop() : design?.syncedAt ? `Synced ${timeAgo(design.syncedAt)}` : null}
        </span>
        {data.link && (
          <a className="icon-btn tiny nodrag" href={data.link} target="_blank" rel="noreferrer" title={`Open in ${design ? DESIGN_SOURCE[design.source] : "source"}`}>
            <ExternalLink size={12} />
          </a>
        )}
        {design?.source === "figma" && (
          <button className="icon-btn tiny nodrag" onClick={refresh} disabled={refreshing} title="Re-export from Figma">
            <RefreshCw size={12} className={refreshing ? "spin" : undefined} />
          </button>
        )}
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
  design: DesignNode,
  lane: LaneNode,
};

export const NODE_TYPE_LABEL: Record<string, string> = {
  card: "Card",
  actor: "Actor",
  activity: "Activity",
  note: "Note",
  image: "Image",
  design: "Design",
  lane: "Lane",
};
