import type { Edge, Node } from "@xyflow/react";

export type ChangeStatus = "new" | "changed" | "same" | "removed" | "risk";
export type TestStatus = "pass" | "fail" | "todo" | "skip";
export type TaskStatus = "planificado" | "en-curso" | "en-review" | "hecho" | "bloqueado";
export type BoardKind = "storymap" | "flow" | "tests" | "tech" | "ui" | "free";
export type BoardLayout = "lanes" | "storymap";

export type NodeData = {
  label: string;
  detail?: string;
  status?: ChangeStatus;
  test?: TestStatus;
  repo?: string;
  files?: string[];
  image?: string;
  lane?: string;
  activity?: string;
  color?: string;
  link?: string;
  manual?: boolean;
  edited?: boolean;
  [key: string]: unknown;
};

export type WsNode = Node<NodeData>;
export type WsEdge = Edge<{ manual?: boolean; dashed?: boolean }>;

export type Board = {
  id: string;
  title: string;
  kind: BoardKind;
  layout?: BoardLayout;
  direction?: "LR" | "TB";
  description?: string;
  order?: number;
  nodes: WsNode[];
  edges: WsEdge[];
};

export type BoardSummary = { id: string; title: string; kind: BoardKind; nodeCount: number };

export type RepoRef = { name: string; branch?: string; pr?: string; worktree?: string };

export type PrStatus = { url: string; error?: boolean; state?: "OPEN" | "MERGED" | "CLOSED" | "DRAFT"; title?: string; review?: string | null; checks?: { total: number; failing: number; pending: number } };

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  risk?: "bajo" | "medio" | "alto";
  tldr?: { problema?: string; solucion?: string; impacto?: string };
  summary?: string;
  repos?: RepoRef[];
  linear?: string;
  tags?: string[];
  updatedAt?: string;
  refreshedAt?: string;
  autoRefresh?: boolean;
  tests?: { pass: number; fail: number; todo: number; skip: number; total: number };
  relatedPrs?: (number | string)[];
  projects?: string[];
  projectIds?: string[];
  /** Folder the task was created in; its sessions start there. */
  cwd?: string;
  sessionIds?: string[];
  boardOrder?: number;
  boards: BoardSummary[];
  docs: string[];
  assets: string[];
};

export const CHANGE_STATUS: Record<ChangeStatus, { label: string; color: string }> = {
  new: { label: "New", color: "#16a34a" },
  changed: { label: "Changed", color: "#d97706" },
  same: { label: "Unchanged", color: "#94a3b8" },
  removed: { label: "Removed", color: "#dc2626" },
  risk: { label: "Risk", color: "#9333ea" },
};

export const TEST_STATUS: Record<TestStatus, { label: string; icon: string; color: string }> = {
  pass: { label: "Passed", icon: "✓", color: "#16a34a" },
  fail: { label: "Failed", icon: "✕", color: "#dc2626" },
  todo: { label: "Untested", icon: "○", color: "#64748b" },
  skip: { label: "Skipped", icon: "–", color: "#94a3b8" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> = {
  planificado: { label: "Planned", color: "#64748b" },
  "en-curso": { label: "In progress", color: "#2563eb" },
  "en-review": { label: "In review", color: "#d97706" },
  hecho: { label: "Done", color: "#16a34a" },
  bloqueado: { label: "Blocked", color: "#dc2626" },
};

export const BOARD_KIND: Record<BoardKind, { label: string; icon: string }> = {
  storymap: { label: "Story map", icon: "🗺️" },
  flow: { label: "Flow", icon: "🔀" },
  tests: { label: "Tests", icon: "🧪" },
  tech: { label: "Tech map", icon: "🧩" },
  ui: { label: "UI", icon: "🖼️" },
  free: { label: "Free", icon: "✏️" },
};

export type Project = { id: string; title: string; root: string; initials: string; color: string; hasIcon: boolean; parentId: string | null };
