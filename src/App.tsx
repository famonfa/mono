import { useCallback, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, CircleDot, Layers, Moon, PanelLeft, Search, SquarePen, Sun } from "lucide-react";
import { api, useLiveData } from "./api";
import { AppContext, useApp, type AppContextValue } from "./app-context";
import { AgentsPage, SessionView, StatusDot } from "./components/Agents";
import { BoardView } from "./components/BoardView";
import { CommandPalette } from "./components/CommandPalette";
import { DocView } from "./components/DocView";
import { Home } from "./components/Home";
import { TaskOverview, TaskTopBar } from "./components/TaskView";
import { StatusIcon, STATUS_META, STATUS_ORDER } from "./icons";
import { href, navigate, useRoute, type Route } from "./router";
import { useSessions } from "./sessions";
import type { Task, TaskStatus } from "./types";
import { Dialog, useHotkey, useTheme, type DialogRequest } from "./ui";

export function App() {
  const route = useRoute();
  const { data, reload: reloadTasks, setData } = useLiveData(api.listTasks, []);
  const tasks = useMemo(() => data ?? [], [data]);
  const { theme, toggleTheme } = useTheme();
  const sessions = useSessions(3);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pendingG = useRef(0);

  const updateTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      setData((ts) => ts?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? ts);
      await api.saveTask(id, patch);
      reloadTasks();
    },
    [setData, reloadTasks],
  );

  const newTask = useCallback(
    (status: TaskStatus = "en-curso") =>
      setDialog({
        title: "Nueva tarea",
        submitLabel: "Crear tarea",
        fields: [
          { name: "title", label: "Título de la tarea" },
          { name: "id", label: "ID (ej: IME-3001)", mono: true },
          { name: "status", label: "Estado", defaultValue: status, options: STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, icon: <StatusIcon status={s} /> })) },
        ],
        onSubmit: async ({ title, id, status: chosen }) => {
          const taskId = id.trim().toUpperCase().replace(/\s+/g, "-") || `T-${Date.now().toString(36).toUpperCase()}`;
          if (!title.trim()) throw new Error("Poné un título");
          if (tasks.some((t) => t.id === taskId)) throw new Error(`${taskId} ya existe`);
          await api.createTask({ id: taskId, title: title.trim(), status: chosen as TaskStatus });
          reloadTasks();
          navigate(href.task(taskId));
        },
      }),
    [tasks, reloadTasks],
  );

  const ctx: AppContextValue = {
    tasks,
    sessions,
    reloadTasks,
    updateTask,
    openDialog: setDialog,
    openPalette: () => setPalette(true),
    newTask,
    theme,
    toggleTheme,
  };

  const overlayOpen = Boolean(dialog || palette);
  useHotkey("k", () => setPalette((p) => !p), { meta: true });
  useHotkey("c", () => newTask(), { enabled: !overlayOpen });
  useHotkey("[", () => setCollapsed((c) => !c), { enabled: !overlayOpen });
  useHotkey("g", () => (pendingG.current = Date.now()), { enabled: !overlayOpen });
  useHotkey(
    "h",
    () => {
      if (Date.now() - pendingG.current < 800) navigate(href.home());
    },
    { enabled: !overlayOpen },
  );
  useHotkey(
    "a",
    () => {
      if (Date.now() - pendingG.current < 800) navigate(href.agents());
    },
    { enabled: !overlayOpen },
  );

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app ${collapsed ? "collapsed" : ""}`}>
        <Sidebar route={route} onToggle={() => setCollapsed((c) => !c)} />
        <main className="panel">
          {route.view === "home" ? (
            <Home filter={route.filter} />
          ) : route.view === "agents" ? (
            <AgentsPage sessions={sessions} />
          ) : route.view === "session" ? (
            <SessionView key={`${route.sessionId}/${route.agentId ?? ""}`} sessionId={route.sessionId} agentId={route.agentId} sessions={sessions} />
          ) : (
            <TaskShell key={route.taskId} route={route} />
          )}
        </main>
      </div>
      {palette && <CommandPalette route={route} onClose={() => setPalette(false)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </AppContext.Provider>
  );
}

function Sidebar({ route, onToggle }: { route: Route; onToggle: () => void }) {
  const { tasks, sessions, openPalette, newTask, theme, toggleTheme } = useApp();
  const activeTaskId = "taskId" in route ? route.taskId : undefined;
  const working = sessions.filter((s) => s.status === "working");
  const workingTasks = new Set(working.flatMap((s) => s.taskIds ?? []));
  const counts = {
    todas: tasks.length,
    activas: tasks.filter((t) => t.status !== "hecho").length,
    hechas: tasks.filter((t) => t.status === "hecho").length,
  };
  const recent = tasks.slice(0, 12);

  const nav = [
    { filter: "todas" as const, label: "Todas las tareas", icon: <Layers size={15} /> },
    { filter: "activas" as const, label: "Activas", icon: <CircleDot size={15} /> },
    { filter: "hechas" as const, label: "Hechas", icon: <CheckCircle2 size={15} /> },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <a className="workspace-switch" href={href.home()}>
          <span className="workspace-logo">🥑</span>
          <span className="workspace-name">Avocado</span>
        </a>
        <span className="spacer" />
        <button className="icon-btn" onClick={openPalette} title="Buscar (⌘K)">
          <Search size={15} />
        </button>
        <button className="icon-btn new-btn" onClick={() => newTask()} title="Nueva tarea (C)">
          <SquarePen size={15} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {nav.map((n) => (
          <a key={n.filter} href={href.home(n.filter)} className={route.view === "home" && route.filter === n.filter ? "active" : ""}>
            {n.icon}
            <span>{n.label}</span>
            <span className="nav-count">{counts[n.filter] || ""}</span>
          </a>
        ))}
        <a href={href.agents()} className={route.view === "agents" || route.view === "session" ? "active" : ""}>
          <Bot size={15} />
          <span>Agentes</span>
          <span className="nav-count">
            {working.length > 0 && (
              <span className="nav-live">
                <StatusDot status="working" size={6} /> {working.length}
              </span>
            )}
          </span>
        </a>
      </nav>

      <div className="sidebar-section">Recientes</div>
      <nav className="sidebar-nav recent">
        {recent.map((t) => (
          <a key={t.id} href={href.task(t.id)} className={t.id === activeTaskId ? "active" : ""} title={`${t.id} · ${t.title}`}>
            <StatusIcon status={t.status} size={13} />
            <span className="recent-title">{t.title}</span>
            {workingTasks.has(t.id) && <StatusDot status="working" size={6} />}
          </a>
        ))}
        {!recent.length && <span className="sidebar-empty">Sin tareas todavía</span>}
      </nav>

      <div className="sidebar-bottom">
        <button className="icon-btn" onClick={toggleTheme} title="Cambiar tema">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-btn" onClick={onToggle} title="Ocultar barra lateral ([)">
          <PanelLeft size={15} />
        </button>
        <span className="spacer" />
        <span className="sidebar-hint">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </div>
    </aside>
  );
}

type TaskRoute = Extract<Route, { taskId: string }>;

function TaskShell({ route }: { route: TaskRoute }) {
  const { reloadTasks } = useApp();
  const { data: task, error, reload } = useLiveData<Task>(() => api.getTask(route.taskId), [route.taskId], route.taskId);

  if (error) return <div className="empty">No existe la tarea {route.taskId}.</div>;
  if (!task) return null;

  const active = route.view === "board" ? `b:${route.boardId}` : route.view === "doc" ? `d:${route.doc}` : "overview";
  const refresh = () => {
    reload();
    reloadTasks();
  };
  return (
    <div className="task-shell">
      <TaskTopBar task={task} active={active} />
      <div className="task-content">
        {route.view === "task" && <TaskOverview task={task} onChange={refresh} />}
        {route.view === "board" && <BoardView task={task} boardId={route.boardId} />}
        {route.view === "doc" && <DocView task={task} doc={route.doc} />}
      </div>
    </div>
  );
}
