import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder, Search, Settings } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import type { SessionSummary } from "../sessions";
import type { Project, Task } from "../types";

export const ALL_PROJECTS = "all";
const COLORS = ["#eb5757", "#f2994a", "#d9a23b", "#4cb782", "#26b5ce", "#5e6ad2", "#bb87fc", "#e15a97"];

/** Before the server restarts onto the new name, only /api/projects/:id/icon answers. */
function iconFallback(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.fallback) return;
  img.dataset.fallback = "1";
  img.src = img.src.replace("/api/repos/", "/api/projects/");
}

export function ProjectIcon({ project, size = 18 }: { project?: Project; size?: number }) {
  if (!project) {
    return (
      <span className="project-icon all" style={{ width: size, height: size }}>
        <Folder size={size - 5} />
      </span>
    );
  }
  if (project.hasIcon) {
    return <img className="project-icon img" src={`/api/repos/${encodeURIComponent(project.id)}/icon`} alt="" style={{ width: size, height: size }} onError={iconFallback} />;
  }
  return (
    <span className="project-icon" style={{ width: size, height: size, color: project.color, background: `${project.color}26`, fontSize: Math.round(size * 0.48) }}>
      {project.initials}
    </span>
  );
}

/** The selected project plus every project nested in it (a monorepo → its apps); null means all. */
export function projectScope(project: string, projects: Project[]): Set<string> | null {
  if (project === ALL_PROJECTS) return null;
  const scope = new Set([project]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) if (p.parentId && scope.has(p.parentId) && !scope.has(p.id)) (scope.add(p.id), (grew = true));
  }
  return scope;
}

export function inProject(scope: Set<string> | null, ids?: (string | null | undefined)[] | null) {
  return !scope || Boolean(ids?.some((id) => id && scope.has(id)));
}

/** Parents first, each followed by its nested projects, with their depth for indentation. */
export function projectTree(projects: Project[]) {
  const out: { project: Project; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const p of projects.filter((x) => (x.parentId ?? null) === parentId)) {
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A session shows up in the project it was opened in and in the projects of the tasks it works on. */
export function sessionInProject(scope: Set<string> | null, session: SessionSummary, tasks: Task[]) {
  if (!scope) return true;
  if (session.projectId && scope.has(session.projectId)) return true;
  return (session.taskIds ?? []).some((id) => inProject(scope, tasks.find((t) => t.id === id)?.projectIds));
}

export function ProjectSwitcher() {
  const { projects, project, setProject, openDialog, reloadProjects } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const current = projects.find((p) => p.id === project);

  const tree = projectTree(projects);
  const depthOf = (p: Project | null) => (p ? tree.find((t) => t.project.id === p.id)?.depth ?? 0 : 0);
  const options: (Project | null)[] = [null, ...tree.map((t) => t.project)].filter((p) => !query || (p?.title ?? "All repos").toLowerCase().includes(query.toLowerCase()));

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left });
  }, [open]);

  const choose = (p: Project | null) => {
    setProject(p?.id ?? ALL_PROJECTS);
    setOpen(false);
    setQuery("");
  };

  const editProject = (p: Project) => {
    setOpen(false);
    openDialog({
      title: `Project · ${p.root}`,
      submitLabel: "Save",
      fields: [
        { name: "title", label: "Name", defaultValue: p.title },
        { name: "color", label: "Color", defaultValue: p.hasIcon ? "" : p.color, options: [{ value: "", label: "Repo icon" }, ...COLORS.map((c) => ({ value: c, label: "", icon: <i className="dot" style={{ background: c, width: 12, height: 12 }} /> }))] },
      ],
      onSubmit: async ({ title, color }) => {
        await api.saveProject(p.id, { title: title.trim() || undefined, color: color || undefined });
        reloadProjects();
      },
    });
  };

  return (
    <>
      <button
        ref={trigger}
        className="project-switch"
        onClick={() => {
          setOpen((o) => !o);
          setActive(Math.max(0, [null, ...projectTree(projects).map((t) => t.project)].findIndex((p) => (p?.id ?? ALL_PROJECTS) === project)));
        }}
        title="Switch repo"
      >
        <ProjectIcon project={current} size={20} />
        <span className="project-switch-name">{current?.title ?? "All repos"}</span>
        <ChevronDown size={13} className="project-switch-chevron" />
      </button>
      {open &&
        createPortal(
          <div className="menu-backdrop" onMouseDown={() => setOpen(false)}>
            <div className="project-menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
              <div className="project-search">
                <Search size={14} />
                <input
                  autoFocus
                  placeholder="Search repos…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpen(false);
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((a) => Math.min(options.length - 1, a + 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((a) => Math.max(0, a - 1));
                    }
                    if (e.key === "Enter" && options[active] !== undefined) choose(options[active]);
                  }}
                />
              </div>
              <div className="project-items">
                {options.map((p, i) => (
                  <div
                    key={p?.id ?? ALL_PROJECTS}
                    className={`project-item ${i === active ? "active" : ""} ${(p?.id ?? ALL_PROJECTS) === project ? "current" : ""} ${!query && depthOf(p) ? "nested" : ""}`}
                    style={!query && depthOf(p) ? { paddingLeft: 10 + depthOf(p) * 22 } : undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(p)}
                    title={p?.root}
                  >
                    <ProjectIcon project={p ?? undefined} size={20} />
                    <span className="project-item-name">{p?.title ?? "All repos"}</span>
                    {p && (
                      <button
                        className="icon-btn tiny project-gear"
                        onClick={(e) => {
                          e.stopPropagation();
                          editProject(p);
                        }}
                        title="Settings"
                      >
                        <Settings size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {!options.length && <div className="menu-empty">No matching projects</div>}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
