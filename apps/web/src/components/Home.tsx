import { useEffect, useState } from "react";
import { ChevronRight, Kanban, List, Plus, Star } from "lucide-react";
import { useApp } from "../app-context";
import { STATUS_META, STATUS_MENU_ORDER, STATUS_ORDER, StatusIcon } from "../icons";
import { href, navigate, type HomeFilter } from "../router";
import type { Task, TaskStatus } from "../types";
import { Menu, timeAgo, useHotkey } from "../ui";
import { flattenPages } from "../pages";
import { viewedAt } from "../viewed";
import { StatusDot } from "./Agents";
import { KanbanCanvas } from "./KanbanCanvas";
import { inProject, ProjectIcon, projectScope } from "./Projects";

type Display = "list" | "board";

const TITLES: Record<HomeFilter, string> = { todas: "All projects", activas: "Active", hechas: "Done" };
const TABS: Record<HomeFilter, string> = { todas: "All", activas: "Active", hechas: "Done" };

export function Home({ filter }: { filter: HomeFilter }) {
  const { tasks: allTasks, newTask, project, projects } = useApp();
  const currentProject = projects.find((p) => p.id === project);
  const tasks = allTasks.filter((t) => inProject(projectScope(project, projects), t.projectIds));
  const [display, setDisplay] = useState<Display>(() => (localStorage.getItem("ws-display") as Display) ?? "list");
  useEffect(() => localStorage.setItem("ws-display", display), [display]);

  const visible = tasks.filter((t) => (filter === "activas" ? t.status !== "hecho" : filter === "hechas" ? t.status === "hecho" : true));
  const statuses = STATUS_ORDER.filter((s) => (filter === "activas" ? s !== "hecho" : filter === "hechas" ? s === "hecho" : true));

  return (
    <div className="home">
      <header className="topbar">
        <div className="topbar-title">
          {currentProject && (
            <span className="topbar-project">
              <ProjectIcon project={currentProject} size={16} /> {currentProject.title}
              <ChevronRight size={13} />
            </span>
          )}
          {TITLES[filter]}
        </div>
        <div className="view-tabs">
          {(["todas", "activas", "hechas"] as const).map((f) => (
            <a key={f} href={href.home(f)} className={f === filter ? "active" : ""}>
              {TABS[f]}
            </a>
          ))}
        </div>
        <span className="spacer" />
        <div className="segmented small">
          <button className={display === "list" ? "active" : ""} onClick={() => setDisplay("list")} title="List">
            <List size={14} />
          </button>
          <button className={display === "board" ? "active" : ""} onClick={() => setDisplay("board")} title="Board">
            <Kanban size={14} />
          </button>
        </div>
      </header>

      {!tasks.length ? (
        <EmptyState onCreate={() => newTask()} />
      ) : display === "list" ? (
        <ProjectList tasks={visible} />
      ) : (
        <KanbanCanvas tasks={visible} statuses={statuses} />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">🐒</div>
      <h2>No projects yet</h2>
      <p>
        Run <code>/workspace</code> in Claude Code to document a task.
      </p>
      <div className="empty-actions">
        <a className="btn primary" href={href.newSession()}>
          <Plus size={14} /> New session
        </a>
        <a className="btn" href={href.agents()}>
          Agents
        </a>
        <button className="btn" onClick={onCreate}>
          New project <kbd className="kbd">C</kbd>
        </button>
      </div>
    </div>
  );
}

function StatusMenu({ task }: { task: Task }) {
  const { updateTask } = useApp();
  return (
    <Menu
      value={task.status}
      placeholder="Change status…"
      options={STATUS_MENU_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, icon: <StatusIcon status={s} />, hint: STATUS_META[s].key }))}
      onChange={(status) => void updateTask(task.id, { status })}
      className="proj-status"
    >
      <StatusIcon status={task.status} size={13} /> {STATUS_META[task.status]?.label}
    </Menu>
  );
}

const TILE_COLORS = ["#eb5757", "#f2994a", "#d9a23b", "#4cb782", "#26b5ce", "#5e6ad2", "#bb87fc", "#e15a97"];

/** The project's emoji, or its initial on a color picked from the id so it stays put. */
export function ProjectTile({ task, size = 40 }: { task: Task; size?: number }) {
  let h = 0;
  for (const ch of task.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = TILE_COLORS[h % TILE_COLORS.length];
  return (
    <span className="proj-tile" style={{ width: size, height: size, fontSize: Math.round(size * (task.icon ? 0.5 : 0.42)), ...(task.icon ? {} : { color, background: `${color}1f` }) }}>
      {task.icon || task.title.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

type Sort = "viewed" | "updated" | "title";
const SORTS: Record<Sort, string> = { viewed: "Sort by viewed", updated: "Sort by updated", title: "Sort by name" };

function ProjectList({ tasks }: { tasks: Task[] }) {
  const { sessions, projects, updateTask } = useApp();
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("ws-sort") as Sort) ?? "viewed");
  useEffect(() => localStorage.setItem("ws-sort", sort), [sort]);
  const viewed = viewedAt();
  const workingTasks = new Set(sessions.filter((s) => s.status === "working").flatMap((s) => s.taskIds ?? []));
  const key = (t: Task) => (sort === "viewed" ? viewed[t.id] ?? t.updatedAt ?? "" : t.updatedAt ?? "");
  // Starred first, like pinned docs; then the chosen order.
  const ordered = [...tasks].sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || (sort === "title" ? a.title.localeCompare(b.title) : key(b).localeCompare(key(a))));
  const [cursor, setCursor] = useState(-1);

  useHotkey("j", () => setCursor((c) => Math.min(ordered.length - 1, c + 1)));
  useHotkey("arrowdown", () => setCursor((c) => Math.min(ordered.length - 1, c + 1)));
  useHotkey("k", () => setCursor((c) => Math.max(0, c - 1)));
  useHotkey("arrowup", () => setCursor((c) => Math.max(0, c - 1)));
  useHotkey("enter", () => ordered[cursor] && navigate(href.task(ordered[cursor].id)));

  return (
    <div className="list proj-list">
      <div className="proj-hero">
        <div>
          <h1>Projects</h1>
          <p>Everything you're working on, across your repos.</p>
        </div>
        <span className="spacer" />
        <Menu value={sort} options={(Object.keys(SORTS) as Sort[]).map((s) => ({ value: s, label: SORTS[s] }))} onChange={setSort} className="btn proj-sort">
          {SORTS[sort]} <ChevronRight size={12} className="proj-sort-chevron" />
        </Menu>
      </div>
      {ordered.map((t, index) => {
        const pages = flattenPages(t.pages ?? []).length;
        const seen = viewed[t.id];
        return (
          <div key={t.id} className={`proj-row ${index === cursor ? "cursor" : ""}`} onClick={() => navigate(href.task(t.id))} onMouseEnter={() => setCursor(index)}>
            <ProjectTile task={t} />
            <div className="proj-main">
              <div className="proj-title">
                <span className="proj-name">{t.title}</span>
                {t.starred && <Star size={13} className="proj-star-mark" />}
                {workingTasks.has(t.id) && (
                  <span className="row-live" title="Agents working">
                    <StatusDot status="working" size={6} /> live
                  </span>
                )}
              </div>
              <div className="proj-sub">
                <span onClick={(e) => e.stopPropagation()}>
                  <StatusMenu task={t} />
                </span>
                {(t.projectIds ?? []).slice(0, 3).map((id) => {
                  const repo = projects.find((p) => p.id === id);
                  return (
                    <span key={id} className="proj-chip" title={repo?.root}>
                      <ProjectIcon project={repo} size={13} /> {repo?.title ?? id}
                    </span>
                  );
                })}
                <span className="proj-when">
                  {seen ? `Viewed ${timeAgo(seen)}` : `Updated ${timeAgo(t.updatedAt)}`}
                  {pages > 0 && ` · ${pages} ${pages === 1 ? "page" : "pages"}`}
                </span>
              </div>
            </div>
            <button
              className={`icon-btn proj-star ${t.starred ? "on" : ""}`}
              title={t.starred ? "Unstar" : "Star"}
              onClick={(e) => {
                e.stopPropagation();
                void updateTask(t.id, { starred: !t.starred });
              }}
            >
              <Star size={15} />
            </button>
          </div>
        );
      })}
      {!ordered.length && <div className="empty">No projects.</div>}
    </div>
  );
}
