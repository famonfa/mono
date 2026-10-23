import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, CircleDot, LayoutGrid, Layers, MessageSquarePlus, Moon, PanelLeft, Plus, Search, SquarePen, Sun } from "lucide-react";
import { api, useLiveData } from "./api";
import { AppContext, useApp, type AppContextValue } from "./app-context";
import { AgentsPage, SessionView, StatusDot } from "./components/Agents";
import { BoardView } from "./components/BoardView";
import { NewSession, TaskSessions } from "./components/Chat";
import { CommandPalette } from "./components/CommandPalette";
import { UpdateToast } from "./components/UpdateToast";
import { DocView } from "./components/DocView";
import { GroupView } from "./components/GroupCanvas";
import { Home } from "./components/Home";
import { ALL_PROJECTS, inProject, projectScope, ProjectSwitcher, sessionInProject } from "./components/Projects";
import { TaskOverview, TaskTopBar } from "./components/TaskView";
import { UserWidget } from "./components/UserWidget";
import { StatusIcon, STATUS_META, STATUS_ORDER } from "./icons";
import { groupsApi, reloadGroups, useGroups } from "./groups";
import { href, navigate, useRoute, type Route } from "./router";
import { lastSessionId, useSessions } from "./sessions";
import type { Task, TaskStatus } from "./types";
import { Dialog, useHotkey, useTheme, type DialogRequest } from "./ui";
import { useUnread } from "./unread";

export function App() {
  const route = useRoute();
  const { data, reload: reloadTasks, setData } = useLiveData(api.listTasks, []);
  const tasks = useMemo(() => data ?? [], [data]);
  const { theme, toggleTheme } = useTheme();
  const sessions = useSessions(3);
  const { data: projectData, reload: reloadProjects } = useLiveData(api.listProjects, []);
  const projects = useMemo(() => projectData ?? [], [projectData]);
  const [project, setProjectState] = useState(() => localStorage.getItem("ws-project") ?? ALL_PROJECTS);
  const setProject = useCallback((id: string) => {
    localStorage.setItem("ws-project", id);
    setProjectState(id);
  }, []);
  useEffect(() => {
    if (projectData && project !== ALL_PROJECTS && !projectData.some((p) => p.id === project)) setProject(ALL_PROJECTS);
  }, [projectData, project, setProject]);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ws-sidebar") === "collapsed");
  useEffect(() => localStorage.setItem("ws-sidebar", collapsed ? "collapsed" : "open"), [collapsed]);
  // On phones the sidebar is a drawer over the content: close it after picking a destination.
  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setCollapsed(true);
  }, [route]);
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
          await api.createTask({ id: taskId, title: title.trim(), status: chosen as TaskStatus, ...(project !== ALL_PROJECTS ? { projects: [project] } : {}) });
          reloadTasks();
          navigate(href.task(taskId));
        },
      }),
    [tasks, reloadTasks, project],
  );

  const ctx: AppContextValue = {
    tasks,
    sessions,
    projects,
    project,
    setProject,
    reloadProjects,
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
  useHotkey("s", () => navigate(href.newSession()), { enabled: !overlayOpen });
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
        {/* Only visible on phones (mobile.css), where the sidebar is a drawer over the content. */}
        {!collapsed && <div className="drawer-backdrop" onClick={() => setCollapsed(true)} />}
        <main className="panel">
          {collapsed && (
            <button className="icon-btn sidebar-reopen" onClick={() => setCollapsed(false)} title="Mostrar barra lateral ([)">
              <PanelLeft size={15} />
            </button>
          )}
          {route.view === "home" ? (
            <Home filter={route.filter} />
          ) : route.view === "agents" ? (
            <AgentsPage sessions={sessions.filter((s) => sessionInProject(projectScope(project, projects), s, tasks))} />
          ) : route.view === "newSession" ? (
            <NewSession />
          ) : route.view === "session" ? (
            <SessionView key={`${route.sessionId}/${route.agentId ?? ""}`} sessionId={route.sessionId} agentId={route.agentId} sessions={sessions} />
          ) : route.view === "group" ? (
            <GroupView groupId={route.groupId} />
          ) : (
            <TaskShell key={route.taskId} route={route} />
          )}
        </main>
      </div>
      {palette && <CommandPalette route={route} onClose={() => setPalette(false)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      <UpdateToast />
    </AppContext.Provider>
  );
}

function Sidebar({ route, onToggle }: { route: Route; onToggle: () => void }) {
  const { tasks: allTasks, sessions: allSessions, project, projects, openPalette, newTask, openDialog, theme, toggleTheme } = useApp();
  const groups = useGroups();
  const scope = projectScope(project, projects);
  const tasks = allTasks.filter((t) => inProject(scope, t.projectIds));
  const sessions = allSessions.filter((s) => sessionInProject(scope, s, allTasks));
  const activeTaskId = "taskId" in route ? route.taskId : undefined;
  const working = sessions.filter((s) => s.status === "working");
  const workingTasks = new Set(working.flatMap((s) => s.taskIds ?? []));
  const isUnread = useUnread();
  const unread = sessions.filter((s) => isUnread(s));
  const unreadTasks = new Set(unread.flatMap((s) => s.taskIds ?? []));
  const unreadIds = new Set(allSessions.filter((s) => isUnread(s)).map((s) => s.id));
  const counts = {
    todas: tasks.length,
    activas: tasks.filter((t) => t.status !== "hecho").length,
    hechas: tasks.filter((t) => t.status === "hecho").length,
  };
  const recent = tasks.slice(0, 12);
  const inAgents = ["agents", "session", "newSession"].includes(route.view);
  const last = lastSessionId();
  const agentsHref = !inAgents && last && allSessions.some((s) => s.id === last) ? href.session(last) : href.agents();
  const workingIds = new Set(allSessions.filter((s) => s.status === "working").map((s) => s.id));
  const newGroup = () =>
    openDialog({
      title: "Nuevo grupo",
      submitLabel: "Crear grupo",
      fields: [{ name: "name", label: "Nombre del grupo" }],
      onSubmit: async ({ name }) => {
        const group = await groupsApi.create(name);
        reloadGroups();
        navigate(href.group(group.id));
      },
    });

  const nav = [
    { filter: "todas" as const, label: "Todas las tareas", icon: <Layers size={15} /> },
    { filter: "activas" as const, label: "Activas", icon: <CircleDot size={15} /> },
    { filter: "hechas" as const, label: "Hechas", icon: <CheckCircle2 size={15} /> },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <ProjectSwitcher />
        <button className="icon-btn" onClick={openPalette} title="Buscar (⌘K)">
          <Search size={15} />
        </button>
        <a className="icon-btn" href={href.newSession()} title="Nueva sesión sin tarea (S)">
          <MessageSquarePlus size={15} />
        </a>
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
        <a href={agentsHref} className={inAgents ? "active" : ""}>
          <Bot size={15} />
          <span>Agentes</span>
          <span className="nav-count">
            <LiveCounts working={working.length} unread={unread.length} />
          </span>
        </a>
      </nav>

      <div className="sidebar-section sidebar-section-row">
        Grupos
        <button className="icon-btn tiny" onClick={newGroup} title="Nuevo grupo de sesiones">
          <Plus size={13} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {groups.map((g) => {
          const live = g.panes.filter((p) => workingIds.has(p.sessionId)).length;
          const toSee = g.panes.filter((p) => unreadIds.has(p.sessionId)).length;
          return (
            <a key={g.id} href={href.group(g.id)} className={route.view === "group" && route.groupId === g.id ? "active" : ""} title={`${g.name} · ${g.panes.length} sesiones`}>
              <LayoutGrid size={14} />
              <span className="recent-title">{g.name}</span>
              <span className="nav-count">
                {live || toSee ? <LiveCounts working={live} unread={toSee} /> : g.panes.length || ""}
              </span>
            </a>
          );
        })}
        {!groups.length && <span className="sidebar-empty">Juntá sesiones para verlas lado a lado</span>}
      </nav>

      <div className="sidebar-section">Recientes</div>
      <nav className="sidebar-nav recent">
        {recent.map((t) => (
          <a key={t.id} href={href.task(t.id)} className={t.id === activeTaskId ? "active" : ""} title={`${t.id} · ${t.title}`}>
            <StatusIcon status={t.status} size={13} />
            <span className="recent-title">{t.title}</span>
            {workingTasks.has(t.id) ? <StatusDot status="working" size={6} /> : unreadTasks.has(t.id) && <StatusDot status="unread" size={6} />}
          </a>
        ))}
        {!recent.length && <span className="sidebar-empty">Sin tareas todavía</span>}
      </nav>

      <UserWidget />
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

function LiveCounts({ working, unread }: { working: number; unread: number }) {
  return (
    <span className="live-counts">
      {working > 0 && (
        <span className="nav-live" title="Trabajando">
          <StatusDot status="working" size={6} /> {working}
        </span>
      )}
      {unread > 0 && (
        <span className="nav-live unread" title="Terminaron y no las viste">
          <StatusDot status="unread" size={6} /> {unread}
        </span>
      )}
    </span>
  );
}

type TaskRoute = Extract<Route, { taskId: string }>;

function TaskShell({ route }: { route: TaskRoute }) {
  const { reloadTasks } = useApp();
  const { data: task, error, reload } = useLiveData<Task>(() => api.getTask(route.taskId), [route.taskId], route.taskId);

  if (error) return <div className="empty">No existe la tarea {route.taskId}.</div>;
  if (!task) return null;

  const active = route.view === "board" ? `b:${route.boardId}` : route.view === "doc" ? `d:${route.doc}` : route.view === "sessions" ? "sessions" : "overview";
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
        {route.view === "sessions" && <TaskSessions task={task} sessionId={route.sessionId} />}
      </div>
    </div>
  );
}
