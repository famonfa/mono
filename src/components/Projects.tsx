import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder, Search, Settings } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import type { SessionSummary } from "../sessions";
import type { Project, Task } from "../types";

export const ALL_PROJECTS = "all";
const COLORS = ["#eb5757", "#f2994a", "#d9a23b", "#4cb782", "#26b5ce", "#5e6ad2", "#bb87fc", "#e15a97"];

export function ProjectIcon({ project, size = 18 }: { project?: Project; size?: number }) {
  if (!project) {
    return (
      <span className="project-icon all" style={{ width: size, height: size }}>
        <Folder size={size - 5} />
      </span>
    );
  }
  if (project.hasIcon) {
    return <img className="project-icon img" src={`/api/projects/${encodeURIComponent(project.id)}/icon`} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <span className="project-icon" style={{ width: size, height: size, color: project.color, background: `${project.color}26`, fontSize: Math.round(size * 0.48) }}>
      {project.initials}
    </span>
  );
}

/** Belongs to the given project, or anything when "All projects" is selected. */
export function inProject(project: string, ids?: (string | null | undefined)[] | null) {
  return project === ALL_PROJECTS || Boolean(ids?.includes(project));
}

/** A session shows up in the project it was opened in and in the projects of the tasks it works on. */
export function sessionInProject(project: string, session: SessionSummary, tasks: Task[]) {
  if (project === ALL_PROJECTS) return true;
  if (session.projectId === project) return true;
  return (session.taskIds ?? []).some((id) => tasks.find((t) => t.id === id)?.projectIds?.includes(project));
}

export function ProjectSwitcher() {
  const { projects, project, setProject, openDialog, reloadProjects } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const current = projects.find((p) => p.id === project);

  const options: (Project | null)[] = [null, ...projects].filter((p) => !query || (p?.title ?? "All projects").toLowerCase().includes(query.toLowerCase()));

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
      title: `Proyecto · ${p.root}`,
      submitLabel: "Guardar",
      fields: [
        { name: "title", label: "Nombre", defaultValue: p.title },
        { name: "color", label: "Color", defaultValue: p.hasIcon ? "" : p.color, options: [{ value: "", label: "Ícono del repo" }, ...COLORS.map((c) => ({ value: c, label: "", icon: <i className="dot" style={{ background: c, width: 12, height: 12 }} /> }))] },
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
          setActive(Math.max(0, [null, ...projects].findIndex((p) => (p?.id ?? ALL_PROJECTS) === project)));
        }}
        title="Cambiar de proyecto"
      >
        <ProjectIcon project={current} size={20} />
        <span className="project-switch-name">{current?.title ?? "All projects"}</span>
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
                  placeholder="Search projects..."
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
                    className={`project-item ${i === active ? "active" : ""} ${(p?.id ?? ALL_PROJECTS) === project ? "current" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(p)}
                    title={p?.root}
                  >
                    <ProjectIcon project={p ?? undefined} size={20} />
                    <span className="project-item-name">{p?.title ?? "All projects"}</span>
                    {p && (
                      <button
                        className="icon-btn tiny project-gear"
                        onClick={(e) => {
                          e.stopPropagation();
                          editProject(p);
                        }}
                        title="Configurar proyecto"
                      >
                        <Settings size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {!options.length && <div className="menu-empty">Ningún proyecto coincide</div>}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
