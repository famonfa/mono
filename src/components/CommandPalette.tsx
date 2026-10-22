import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Home, Moon, Plus, Search, Sun, Trash2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import { BoardIcon, DocIcon, STATUS_META, STATUS_ORDER, StatusIcon } from "../icons";
import { href, navigate, type Route } from "../router";

type Command = { id: string; group: string; label: string; sublabel?: string; icon: ReactNode; shortcut?: string; run: () => void };

export function CommandPalette({ route, onClose }: { route: Route; onClose: () => void }) {
  const { tasks, newTask, updateTask, theme, toggleTheme, openDialog, reloadTasks } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const currentTask = route.view === "home" ? undefined : tasks.find((t) => t.id === route.taskId);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (currentTask) {
      for (const b of currentTask.boards) {
        list.push({ id: `b:${b.id}`, group: currentTask.id, label: b.title, sublabel: "Board", icon: <BoardIcon kind={b.kind} />, run: () => navigate(href.board(currentTask.id, b.id)) });
      }
      for (const d of currentTask.docs) {
        list.push({ id: `d:${d}`, group: currentTask.id, label: d.replace(/\.md$/, ""), sublabel: "Documento", icon: <DocIcon />, run: () => navigate(href.doc(currentTask.id, d)) });
      }
      for (const s of STATUS_ORDER) {
        if (s === currentTask.status) continue;
        list.push({ id: `s:${s}`, group: currentTask.id, label: `Cambiar estado a ${STATUS_META[s].label}`, icon: <StatusIcon status={s} />, run: () => void updateTask(currentTask.id, { status: s }) });
      }
      list.push({
        id: "trash",
        group: currentTask.id,
        label: "Eliminar tarea",
        icon: <Trash2 size={14} />,
        run: () =>
          openDialog({
            title: `¿Eliminar ${currentTask.id}? Se mueve a data/.trash, no se borra del disco.`,
            submitLabel: "Eliminar",
            fields: [],
            onSubmit: async () => {
              await api.trashTask(currentTask.id);
              reloadTasks();
              navigate(href.home());
            },
          }),
      });
    }
    list.push({ id: "new", group: "Acciones", label: "Nueva tarea", icon: <Plus size={14} />, shortcut: "C", run: () => newTask() });
    list.push({ id: "home", group: "Acciones", label: "Ir a todas las tareas", icon: <Home size={14} />, shortcut: "G H", run: () => navigate(href.home()) });
    list.push({ id: "theme", group: "Acciones", label: theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro", icon: theme === "dark" ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme });
    for (const t of tasks) {
      list.push({ id: `t:${t.id}`, group: "Tareas", label: t.title, sublabel: t.id, icon: <StatusIcon status={t.status} />, run: () => navigate(href.task(t.id)) });
    }
    return list;
  }, [tasks, currentTask, newTask, updateTask, theme, toggleTheme, openDialog, reloadTasks]);

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
            placeholder="Buscá una tarea o escribí un comando…"
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
          {!ordered.length && <div className="menu-empty">Nada coincide con “{query}”</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
