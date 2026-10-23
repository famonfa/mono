import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, CornerDownLeft, Home, MessageSquarePlus, Moon, Palette, Plus, Search, Sparkles, Sun, Trash2 } from "lucide-react";
import { PALETTES, TINT_LABELS, type TintLevel } from "../appearance";
import { api } from "../api";
import { ALL_PROJECTS, ProjectIcon } from "./Projects";
import { useApp } from "../app-context";
import { BoardIcon, DocIcon, STATUS_META, STATUS_ORDER, StatusIcon } from "../icons";
import { href, navigate, type Route } from "../router";

type Command = { id: string; group: string; label: string; sublabel?: string; icon: ReactNode; shortcut?: string; run: () => void };

export function CommandPalette({ route, onClose }: { route: Route; onClose: () => void }) {
  const { tasks, sessions, projects, project, setProject, newTask, updateTask, theme, toggleTheme, appearance, setAppearance, openDialog, reloadTasks } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const currentTask = "taskId" in route ? tasks.find((t) => t.id === route.taskId) : undefined;

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (currentTask) {
      for (const b of currentTask.boards) {
        list.push({ id: `b:${b.id}`, group: currentTask.id, label: b.title, sublabel: "Board", icon: <BoardIcon kind={b.kind} />, run: () => navigate(href.board(currentTask.id, b.id)) });
      }
      for (const d of currentTask.docs) {
        list.push({ id: `d:${d}`, group: currentTask.id, label: d.replace(/\.md$/, ""), sublabel: "Doc", icon: <DocIcon />, run: () => navigate(href.doc(currentTask.id, d)) });
      }
      for (const s of STATUS_ORDER) {
        if (s === currentTask.status) continue;
        list.push({ id: `s:${s}`, group: currentTask.id, label: `Set status: ${STATUS_META[s].label}`, icon: <StatusIcon status={s} />, run: () => void updateTask(currentTask.id, { status: s }) });
      }
      list.push({
        id: "trash",
        group: currentTask.id,
        label: "Delete task",
        icon: <Trash2 size={14} />,
        run: () =>
          openDialog({
            title: `Delete ${currentTask.id}? It moves to data/.trash.`,
            submitLabel: "Delete",
            fields: [],
            onSubmit: async () => {
              await api.trashTask(currentTask.id);
              reloadTasks();
              navigate(href.home());
            },
          }),
      });
    }
    list.push({ id: "new", group: "Actions", label: "New task", icon: <Plus size={14} />, shortcut: "C", run: () => newTask() });
    list.push({ id: "home", group: "Actions", label: "Go to all tasks", icon: <Home size={14} />, shortcut: "G H", run: () => navigate(href.home()) });
    for (const p of [null, ...projects]) {
      if ((p?.id ?? ALL_PROJECTS) === project) continue;
      list.push({ id: `project:${p?.id ?? ALL_PROJECTS}`, group: "Projects", label: `Switch to ${p?.title ?? "All projects"}`, icon: <ProjectIcon project={p ?? undefined} size={16} />, run: () => setProject(p?.id ?? ALL_PROJECTS) });
    }
    list.push({ id: "new-session", group: "Actions", label: "New session", icon: <MessageSquarePlus size={14} />, shortcut: "S", run: () => navigate(href.newSession()) });
    list.push({ id: "agents", group: "Actions", label: "Agents", icon: <Bot size={14} />, shortcut: "G A", run: () => navigate(href.agents()) });
    list.push({ id: "skills", group: "Actions", label: "Skills", icon: <Sparkles size={14} />, run: () => navigate(href.skills()) });
    for (const s of sessions.filter((x) => x.status !== "inactive")) {
      list.push({ id: `session:${s.id}`, group: "Agents", label: s.title, sublabel: s.project, icon: <Bot size={14} />, run: () => navigate(href.session(s.id)) });
    }
    list.push({ id: "theme", group: "Actions", label: theme === "dark" ? "Light theme" : "Dark theme", icon: theme === "dark" ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme });
    for (const p of PALETTES) {
      if (p.id === appearance.palette) continue;
      list.push({ id: `palette:${p.id}`, group: "Appearance", label: `Accent: ${p.label}`, icon: <span className="palette-dot" style={{ background: p.accent }} />, run: () => setAppearance({ palette: p.id }) });
    }
    for (const level of [0, 1, 2] as TintLevel[]) {
      if (level === appearance.tint) continue;
      list.push({ id: `tint:${level}`, group: "Appearance", label: `Background: ${TINT_LABELS[level]}`, icon: <Palette size={14} />, run: () => setAppearance({ tint: level }) });
    }
    for (const t of tasks) {
      list.push({ id: `t:${t.id}`, group: "Tasks", label: t.title, sublabel: t.id, icon: <StatusIcon status={t.status} />, run: () => navigate(href.task(t.id)) });
    }
    return list;
  }, [tasks, sessions, projects, project, setProject, currentTask, newTask, updateTask, theme, toggleTheme, appearance, setAppearance, openDialog, reloadTasks]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = commands.filter((c) => words.every((w) => `${c.label} ${c.sublabel ?? ""} ${c.group}`.toLowerCase().includes(w)));
  const groups = [...new Set(filtered.map((c) => c.group))];
  const ordered = groups.flatMap((g) => filtered.filter((c) => c.group === g));

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search tasks or commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(ordered.length - 1, a + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter") run(ordered[active]);
            }}
          />
        </div>
        <div className="palette-list">
          {groups.map((g) => (
            <div key={g}>
              <div className="palette-group">{g}</div>
              {filtered
                .filter((c) => c.group === g)
                .map((c) => {
                  const index = ordered.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      className={`palette-item ${index === active ? "active" : ""}`}
                      onMouseMove={() => setActive(index)}
                      onClick={() => run(c)}
                      ref={(el) => {
                        if (index === active) el?.scrollIntoView({ block: "nearest" });
                      }}
                    >
                      <span className="palette-icon">{c.icon}</span>
                      <span className="palette-label">{c.label}</span>
                      {c.sublabel && <span className="palette-sub">{c.sublabel}</span>}
                      <span className="spacer" />
                      {c.shortcut && <span className="palette-shortcut">{c.shortcut.split(" ").map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</span>}
                      {index === active && <CornerDownLeft size={13} className="palette-enter" />}
                    </button>
                  );
                })}
            </div>
          ))}
          {!ordered.length && <div className="menu-empty">No matches for “{query}”</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
