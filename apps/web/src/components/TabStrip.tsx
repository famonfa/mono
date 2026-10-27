import { useState, type ReactNode } from "react";
import { Bot, FileText, Folder, LayoutGrid, Layers, MessageSquarePlus, PanelLeft, Plus, Sparkles, X } from "lucide-react";
import { useApp } from "../app-context";
import { useGroups } from "../groups";
import { StatusIcon } from "../icons";
import { flattenPages } from "../pages";
import { parse } from "../router";
import type { Tab } from "../tabs";
import { useUnread } from "../unread";
import { StatusDot } from "./Agents";

type Props = {
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onMove: (id: string, to: number) => void;
  /** Shown at the start of the strip while the sidebar is hidden. */
  onShowSidebar?: () => void;
};

/** Browser-style tabs above the panel: each one remembers where it was. */
export function TabStrip({ tabs, active, onSelect, onClose, onNew, onMove, onShowSidebar }: Props) {
  const describe = useDescribe();
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <div className="tabstrip">
      {onShowSidebar && (
        <button className="icon-btn" onClick={onShowSidebar} title="Show sidebar ([)">
          <PanelLeft size={15} />
        </button>
      )}
      <div className="tabstrip-tabs" role="tablist">
        {tabs.map((tab, index) => {
          const { label, icon, title } = describe(tab.hash);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active}
              className={`tab ${tab.id === active ? "active" : ""} ${dragging === tab.id ? "dragging" : ""}`}
              title={`${title ?? label}${index < 8 ? ` · ⌘${index + 1}` : ""}`}
              draggable
              onDragStart={(e) => {
                setDragging(tab.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!dragging || dragging === tab.id) return;
                e.preventDefault();
                onMove(dragging, index);
              }}
              onDragEnd={() => setDragging(null)}
              onMouseDown={(e) => e.button === 0 && onSelect(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            >
              <span className="tab-icon">{icon}</span>
              <span className="tab-label">{label}</span>
              {tabs.length > 1 && (
                <button
                  className="tab-close"
                  title="Close tab (⌘W)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="icon-btn tab-new" onClick={onNew} title="New tab (⌘T)">
        <Plus size={14} />
      </button>
    </div>
  );
}

/** What a tab shows for a route: the project, page, session or group it points at. */
function useDescribe() {
  const { tasks, sessions } = useApp();
  const groups = useGroups();
  const isUnread = useUnread();
  const sessionTab = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    const status = s?.status === "working" ? "working" : isUnread(s) ? "unread" : null;
    return { label: s?.title || "Session", icon: status ? <StatusDot status={status} size={7} /> : <Bot size={13} /> };
  };
  return (hash: string): { label: string; icon: ReactNode; title?: string } => {
    const route = parse(hash);
    switch (route.view) {
      case "home":
        return { label: "All projects", icon: <Layers size={13} /> };
      case "agents":
        return { label: "Agents", icon: <Bot size={13} /> };
      case "skills":
        return { label: route.name ?? "Skills", icon: <Sparkles size={13} /> };
      case "newSession":
        return { label: "New session", icon: <MessageSquarePlus size={13} /> };
      case "session":
        return sessionTab(route.sessionId);
      case "group":
        return { label: groups.find((g) => g.id === route.groupId)?.name ?? "Group", icon: <LayoutGrid size={13} /> };
    }
    const task = tasks.find((t) => t.id === route.taskId);
    const project = task?.title ?? route.taskId;
    const taskIcon = task ? task.icon ? <span>{task.icon}</span> : <StatusIcon status={task.status} size={13} /> : <Layers size={13} />;
    if (route.view === "sessions") {
      if (!route.sessionId) return { label: `Sessions · ${project}`, icon: taskIcon };
      const s = sessionTab(route.sessionId);
      return { ...s, title: `${s.label} · ${project}` };
    }
    if (route.view === "task") return { label: project, icon: taskIcon };
    const id = route.view === "board" ? route.boardId : route.view === "doc" ? route.doc.replace(/\.md$/, "") : route.path;
    const page = flattenPages(task?.pages ?? []).find((p) => p.id === id);
    const icon = route.view === "doc" ? <FileText size={13} /> : route.view === "folder" ? <Folder size={13} /> : <LayoutGrid size={13} />;
    const label = page?.title ?? id;
    return { label, icon, title: `${label} · ${project}` };
  };
}
