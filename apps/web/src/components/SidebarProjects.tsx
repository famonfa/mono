import { useState } from "react";
import { ChevronRight, MessagesSquare } from "lucide-react";
import { useApp } from "../app-context";
import { StatusIcon } from "../icons";
import { href, type Route } from "../router";
import { lastSessionId } from "../sessions";
import type { Task } from "../types";
import { useUnread } from "../unread";
import { StatusDot } from "./Agents";
import { draggedPage, PageList, usePageActions } from "./PageTree";

const OPEN_KEY = "ws-open-projects";

function readOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/**
 * The sidebar's projects, Notion-style: every project is a row that opens into its sessions and page
 * tree. The one on screen opens by itself, so moving into a project expands a row instead of
 * swapping the sidebar.
 */
export function SidebarProjects({ route, tasks }: { route: Route; tasks: Task[] }) {
  const { tasks: allTasks } = useApp();
  const activeId = "taskId" in route ? route.taskId : undefined;
  const [open, setOpen] = useState(readOpen);
  // The project on screen opens by itself; this remembers that the user closed it anyway.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  const isOpen = (id: string) => open.has(id) || (id === activeId && !closed.has(id));
  const toggle = (id: string) => {
    const next = new Set(open);
    const closing = isOpen(id);
    if (closing) next.delete(id);
    else next.add(id);
    localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    setOpen(next);
    setClosed((current) => {
      const out = new Set(current);
      if (closing) out.add(id);
      else out.delete(id);
      return out;
    });
  };

  const list = tasks.slice(0, 12);
  // The project on screen always shows, even when it's not among the recent ones or in the chosen repo.
  const active = allTasks.find((t) => t.id === activeId);
  if (active && !list.some((t) => t.id === active.id)) list.push(active);

  const activePage =
    route.view === "board" ? route.boardId : route.view === "doc" ? route.doc.replace(/\.md$/, "") : route.view === "folder" ? route.path : undefined;

  return (
    <>
      {list.map((t) => (
        <ProjectNode key={t.id} task={t} route={route} here={t.id === activeId} expanded={isOpen(t.id)} onToggle={() => toggle(t.id)} activePage={t.id === activeId ? activePage : undefined} />
      ))}
      {!list.length && <span className="sidebar-empty">No projects yet</span>}
    </>
  );
}

function ProjectNode({ task: t, route, here, expanded, onToggle, activePage }: { task: Task; route: Route; here: boolean; expanded: boolean; onToggle: () => void; activePage?: string }) {
  const { sessions } = useApp();
  const isUnread = useUnread();
  const actions = usePageActions(t);
  const [dropping, setDropping] = useState(false);
  const linked = sessions.filter((s) => s.taskIds?.includes(t.id));
  const working = linked.filter((s) => s.status === "working").length;
  const unread = linked.filter((s) => isUnread(s)).length;
  const last = lastSessionId(t.id);
  const resume = last && linked.some((s) => s.id === last) ? last : undefined;
  return (
    <div className="sidebar-project-group">
      <div
        className={`page-row ${here && route.view === "task" ? "active" : ""} ${dropping ? "drop-inside" : ""}`}
        style={{ paddingLeft: 8 }}
        // Dropping a page on its project moves it to the top level.
        onDragOver={(e) => {
          if (!draggedPage(t.id)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          const moving = draggedPage(t.id);
          if (!moving) return;
          e.preventDefault();
          void actions.place(moving, null, t.pages?.length ?? 0);
        }}
      >
        <button className={`page-toggle ${expanded ? "open" : ""}`} onClick={onToggle} title={expanded ? "Collapse" : "Expand"}>
          <span className="page-toggle-icon">
            <StatusIcon status={t.status} size={13} />
          </span>
          <ChevronRight size={13} className="page-toggle-chevron" />
        </button>
        <a className="page-link" href={href.task(t.id)} title={`${t.id} · ${t.title}`}>
          <span className="page-title">{t.title}</span>
        </a>
        {working > 0 ? <StatusDot status="working" size={6} /> : unread > 0 && <StatusDot status="unread" size={6} />}
      </div>
      {expanded && (
        <>
          <a className={`page-row ${here && route.view === "sessions" ? "active" : ""}`} style={{ paddingLeft: 22 }} href={href.taskSession(t.id, resume)}>
            <span className="page-toggle leaf">
              <MessagesSquare size={14} />
            </span>
            <span className="page-title">Sessions</span>
            {linked.length > 0 && <span className="page-count">{linked.length}</span>}
          </a>
          <PageList task={t} activeId={activePage} depth={1} />
        </>
      )}
    </div>
  );
}
