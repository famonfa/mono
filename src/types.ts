import type { Edge, Node } from "@xyflow/react";

export type ChangeStatus = "new" | "changed" | "same" | "removed" | "risk";
export type TestStatus = "pass" | "fail" | "todo" | "skip";
export type TaskStatus = "planificado" | "en-curso" | "en-review" | "hecho" | "bloqueado";
export type BoardKind = "storymap" | "flow" | "tests" | "tech" | "free";
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
  relatedPrs?: (number | string)[];
  projects?: string[];
  projectIds?: string[];
  boards: BoardSummary[];
  docs: string[];
  assets: string[];
};

export const CHANGE_STATUS: Record<ChangeStatus, { label: string; color: string }> = {
  new: { label: "Nuevo", color: "#16a34a" },
  changed: { label: "Modificado", color: "#d97706" },
  same: { label: "Sin cambios", color: "#94a3b8" },
  removed: { label: "Eliminado", color: "#dc2626" },
  risk: { label: "Riesgo", color: "#9333ea" },
};

export const TEST_STATUS: Record<TestStatus, { label: string; icon: string; color: string }> = {
  pass: { label: "Pasó", icon: "✓", color: "#16a34a" },
  fail: { label: "Falló", icon: "✕", color: "#dc2626" },
  todo: { label: "Sin probar", icon: "○", color: "#64748b" },
  skip: { label: "Omitido", icon: "–", color: "#94a3b8" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> = {
  planificado: { label: "Planificado", color: "#64748b" },
  "en-curso": { label: "En curso", color: "#2563eb" },
  "en-review": { label: "En review", color: "#d97706" },
  hecho: { label: "Hecho", color: "#16a34a" },
  bloqueado: { label: "Bloqueado", color: "#dc2626" },
};

export const BOARD_KIND: Record<BoardKind, { label: string; icon: string }> = {
  storymap: { label: "Story map", icon: "🗺️" },
  flow: { label: "Flujo", icon: "🔀" },
  tests: { label: "Testeo", icon: "🧪" },
  tech: { label: "Mapa técnico", icon: "🧩" },
  free: { label: "Libre", icon: "✏️" },
};

export type Project = { id: string; title: string; root: string; initials: string; color: string; hasIcon: boolean };
