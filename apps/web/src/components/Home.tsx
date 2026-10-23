import { useEffect, useState } from "react";
import { ChevronRight, GitPullRequest, Kanban, List, Plus } from "lucide-react";
import { useApp } from "../app-context";
import { BoardIcon, RISK_META, RiskIcon, STATUS_META, STATUS_MENU_ORDER, STATUS_ORDER, StatusIcon, type Risk } from "../icons";
import { href, navigate, type HomeFilter } from "../router";
import type { Task, TaskStatus } from "../types";
import { formatDate, Menu, useHotkey } from "../ui";
import { StatusDot } from "./Agents";
import { KanbanCanvas } from "./KanbanCanvas";
import { inProject, ProjectIcon, projectScope } from "./Projects";

type Display = "list" | "board";

const TITLES: Record<HomeFilter, string> = { todas: "All tasks", activas: "Active", hechas: "Done" };
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
        <ListView tasks={visible} statuses={statuses} />
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
      <h2>No tasks yet</h2>
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
          New task <kbd className="kbd">C</kbd>
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
      className="status-trigger"
    >
      <StatusIcon status={task.status} />
    </Menu>
  );
}

function TaskMeta({ task }: { task: Task }) {
  return (
    <>
      {task.tags?.slice(0, 3).map((t) => (
        <span key={t} className="label-pill">
          <i />
          {t}
        </span>
      ))}
      {!!task.repos?.length && (
        <span className="meta-repos" title={task.repos.map((r) => r.name).join(", ")}>
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
    </>
  );
}

function ListView({ tasks, statuses }: { tasks: Task[]; statuses: TaskStatus[] }) {
  const { newTask, sessions } = useApp();
  const workingTasks = new Set(sessions.filter((s) => s.status === "working").flatMap((s) => s.taskIds ?? []));
  const groups = statuses.map((s) => ({ status: s, items: tasks.filter((t) => t.status === s) })).filter((g) => g.items.length);
  const ordered = groups.flatMap((g) => g.items);
  const [cursor, setCursor] = useState(-1);

  useHotkey("j", () => setCursor((c) => Math.min(ordered.length - 1, c + 1)));
  useHotkey("arrowdown", () => setCursor((c) => Math.min(ordered.length - 1, c + 1)));
  useHotkey("k", () => setCursor((c) => Math.max(0, c - 1)));
  useHotkey("arrowup", () => setCursor((c) => Math.max(0, c - 1)));
  useHotkey("enter", () => ordered[cursor] && navigate(href.task(ordered[cursor].id)));

  return (
    <div className="list">
      {groups.map((g) => (
        <section key={g.status}>
          <div className="group-header">
            <StatusIcon status={g.status} />
            <span className="group-label">{STATUS_META[g.status].label}</span>
            <span className="group-count">{g.items.length}</span>
            <span className="spacer" />
            <button className="icon-btn" onClick={() => newTask(g.status)} title="New task">
              <Plus size={14} />
            </button>
          </div>
          {g.items.map((t) => {
            const index = ordered.indexOf(t);
            return (
              <div
                key={t.id}
                className={`row ${index === cursor ? "cursor" : ""}`}
                onClick={() => navigate(href.task(t.id))}
                onMouseEnter={() => setCursor(index)}
              >
                <span className="row-risk" title={t.risk ? RISK_META[t.risk as Risk]?.label ?? `Risk: ${t.risk}` : "No risk"}>
                  <RiskIcon risk={t.risk as Risk | undefined} />
                </span>
                <span className="row-id">{t.id}</span>
                <span className="row-status" onClick={(e) => e.stopPropagation()}>
                  <StatusMenu task={t} />
                </span>
                <span className="row-title">{t.title}</span>
                {workingTasks.has(t.id) && (
                  <span className="row-live" title="Agents working">
                    <StatusDot status="working" size={6} /> live
                  </span>
                )}
                <span className="row-tldr">{t.tldr?.solucion}</span>
                <span className="row-meta">
                  <TaskMeta task={t} />
                </span>
                <span className="row-date">{formatDate(t.updatedAt)}</span>
              </div>
            );
          })}
        </section>
      ))}
      {!groups.length && <div className="empty">No tasks.</div>}
    </div>
  );
}
