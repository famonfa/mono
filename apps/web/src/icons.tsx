import { Boxes, FileText, FlaskConical, Image as ImageIcon, Map as MapIcon, PenLine, Workflow, type LucideProps } from "lucide-react";
import type { BoardKind, TaskStatus } from "./types";

export const STATUS_ORDER: TaskStatus[] = ["en-review", "en-curso", "planificado", "bloqueado", "hecho"];
export const STATUS_MENU_ORDER: TaskStatus[] = ["planificado", "en-curso", "en-review", "hecho", "bloqueado"];

export const STATUS_META: Record<TaskStatus, { label: string; color: string; key: string }> = {
  planificado: { label: "Planned", color: "var(--text-3)", key: "1" },
  "en-curso": { label: "In progress", color: "#f2c94c", key: "2" },
  "en-review": { label: "In review", color: "#4cb782", key: "3" },
  hecho: { label: "Done", color: "#5e6ad2", key: "4" },
  bloqueado: { label: "Blocked", color: "#eb5757", key: "5" },
};

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const color = STATUS_META[status]?.color ?? "var(--text-3)";
  const r = 6;
  const c = 2 * Math.PI * 3;
  const common = { width: size, height: size, viewBox: "0 0 14 14", className: "status-icon" };
  switch (status) {
    case "planificado":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2.2 1.8" />
        </svg>
      );
    case "en-curso":
    case "en-review": {
      const fraction = status === "en-curso" ? 0.5 : 0.75;
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" />
          <circle cx="7" cy="7" r="3" fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${c * fraction} ${c}`} transform="rotate(-90 7 7)" />
        </svg>
      );
    }
    case "hecho":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.2 7.2 6.1 9 9.8 5.2" fill="none" stroke="var(--bg-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "bloqueado":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="var(--bg-panel)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      );
  }
}

export type Risk = "bajo" | "medio" | "alto";

export const RISK_META: Record<Risk, { label: string }> = {
  bajo: { label: "Low risk" },
  medio: { label: "Medium risk" },
  alto: { label: "High risk" },
};

export function RiskIcon({ risk, size = 14 }: { risk?: Risk; size?: number }) {
  if (risk === "alto") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="risk-icon">
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#f2994a" />
        <path d="M7 3.5v4.2" stroke="var(--bg-panel)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="1" fill="var(--bg-panel)" />
      </svg>
    );
  }
  const level = risk === "medio" ? 2 : risk === "bajo" ? 1 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="risk-icon">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="1" fill={i < level ? "var(--text-2)" : "var(--text-4)"} />
      ))}
    </svg>
  );
}

const BOARD_ICONS: Record<BoardKind, typeof MapIcon> = {
  storymap: MapIcon,
  flow: Workflow,
  tests: FlaskConical,
  tech: Boxes,
  ui: ImageIcon,
  free: PenLine,
};

export function BoardIcon({ kind, ...props }: { kind: BoardKind } & LucideProps) {
  const Icon = BOARD_ICONS[kind] ?? PenLine;
  return <Icon size={14} strokeWidth={1.8} {...props} />;
}

export function DocIcon(props: LucideProps) {
  return <FileText size={14} strokeWidth={1.8} {...props} />;
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>;
}
