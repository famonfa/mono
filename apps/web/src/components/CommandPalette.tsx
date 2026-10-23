import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, CornerDownLeft, FolderOpen, Home, LayoutDashboard, MessageSquarePlus, Moon, Palette, Plus, Search, Sparkles, Sun, Trash2 } from "lucide-react";
import { PALETTES, TINT_LABELS, type TintLevel } from "../appearance";
import { api } from "../api";
import { ALL_PROJECTS, ProjectIcon } from "./Projects";
import { useApp } from "../app-context";
import { BoardIcon, DocIcon, STATUS_META, STATUS_ORDER, StatusIcon } from "../icons";
import { href, navigate, type Route } from "../router";
import type { SearchHit } from "../types";

type Command = { id: string; group: string; label: string; sublabel?: string; snippet?: string; icon: ReactNode; shortcut?: string; run: () => void };

const NOTES = "In your notes";

/** Lowercase without accents, one character in → one out, so match positions line up with the original text. */
const foldChar = (c: string) => c.normalize("NFD")[0].toLowerCase();
const fold = (text: string) => [...text].map(foldChar).join("");

/** The snippet with each searched word in bold, accents and case ignored. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const chars = [...text];
  const folded = chars.map(foldChar).join("");
  const marked = new Array(chars.length).fill(false);
  for (const w of words.map(fold)) {
    for (let at = folded.indexOf(w); at >= 0 && w; at = folded.indexOf(w, at + w.length)) for (let i = at; i < at + w.length; i++) marked[i] = true;
  }
  const parts: { text: string; on: boolean }[] = [];
  chars.forEach((c, i) => (parts.at(-1)?.on === marked[i] ? (parts.at(-1)!.text += c) : parts.push({ text: c, on: marked[i] })));
  return <>{parts.map((p, i) => (p.on ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

function hitCommand(hit: SearchHit): Command {
  const to = !hit.page ? href.task(hit.project) : hit.kind === "board" ? href.board(hit.project, hit.page) : hit.kind === "doc" ? href.doc(hit.project, `${hit.page}.md`) : href.folder(hit.project, hit.page);
  const icon = !hit.page ? <LayoutDashboard size={14} /> : hit.kind === "board" ? <BoardIcon kind="free" /> : hit.kind === "doc" ? <DocIcon /> : <FolderOpen size={14} />;
  return { id: `hit:${hit.project}/${hit.page ?? ""}`, group: NOTES, label: hit.title, sublabel: hit.page ? hit.projectTitle : "Project summary", snippet: hit.snippet, icon, run: () => navigate(to) };
}

/** Full-text search over every project's notes, canvases and summaries, as you type. */
function useNoteSearch(query: string) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    let stale = false;
    const timer = window.setTimeout(() => {
      api.search(q).then(
        (found) => !stale && setHits(found),
        () => !stale && setHits([]),
      );
    }, 150);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);
  return hits;
}

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
        label: "Delete project",
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
    list.push({ id: "new", group: "Actions", label: "New project", icon: <Plus size={14} />, shortcut: "C", run: () => newTask() });
    list.push({ id: "home", group: "Actions", label: "Go to all projects", icon: <Home size={14} />, shortcut: "G H", run: () => navigate(href.home()) });
    for (const p of [null, ...projects]) {
      if ((p?.id ?? ALL_PROJECTS) === project) continue;
      list.push({ id: `project:${p?.id ?? ALL_PROJECTS}`, group: "Repos", label: `Switch to ${p?.title ?? "All repos"}`, icon: <ProjectIcon project={p ?? undefined} size={16} />, run: () => setProject(p?.id ?? ALL_PROJECTS) });
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
      list.push({ id: `t:${t.id}`, group: "Projects", label: t.title, sublabel: t.id, icon: <StatusIcon status={t.status} />, run: () => navigate(href.task(t.id)) });
    }
    return list;
  }, [tasks, sessions, projects, project, setProject, currentTask, newTask, updateTask, theme, toggleTheme, appearance, setAppearance, openDialog, reloadTasks]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useNoteSearch(query);
  const matched = commands.filter((c) => words.every((w) => `${c.label} ${c.sublabel ?? ""} ${c.group}`.toLowerCase().includes(w)));
  // Note hits already matched on the server; they come right after the projects, before actions and settings.
  const filtered = [...matched, ...hits.map(hitCommand)];
  const first = [currentTask?.id, "Projects", NOTES];
  const groups = [...new Set(filtered.map((c) => c.group))].sort((a, b) => {
    const rank = (g: string) => (first.includes(g) ? first.indexOf(g) : first.length);
    return rank(a) - rank(b);
  });
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
            placeholder="Search projects, notes or commands…"
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
                      {c.snippet !== undefined ? (
                        <span className="palette-hit">
                          <span className="palette-hit-head">
                            <span className="palette-label">{c.label}</span>
                            <span className="palette-sub">{c.sublabel}</span>
                          </span>
                          {c.snippet && (
                            <span className="palette-snippet">
                              <Highlight text={c.snippet} words={words} />
                            </span>
                          )}
                        </span>
                      ) : (
                        <>
                          <span className="palette-label">{c.label}</span>
                          {c.sublabel && <span className="palette-sub">{c.sublabel}</span>}
                        </>
                      )}
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
