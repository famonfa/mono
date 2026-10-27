import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronDown, ChevronRight, Folder, FolderGit2, FolderOpen, Plus, Search, Settings, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import { desktop } from "../desktop";
import type { SessionSummary } from "../sessions";
import type { FolderListing, Project, Task } from "../types";

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
  // A repo that was just added gets selected once the reloaded list has it.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current && projects.some((p) => p.id === pending.current)) {
      setProject(pending.current);
      pending.current = null;
    }
  }, [projects, setProject]);

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

  const [adding, setAdding] = useState<string | null>(null);
  const addRepo = () => {
    setOpen(false);
    setAdding(/^[/~]/.test(query.trim()) ? query.trim() : "~");
    setQuery("");
  };

  const removeRepo = async (p: Project) => {
    if (!window.confirm(`Remove "${p.title}" from Mono? The folder and its sessions stay as they are; you can add it again.`)) return;
    await api.removeProject(p.id);
    if (p.id === project) setProject(ALL_PROJECTS);
    reloadProjects();
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
                    if (e.key === "Enter" && /^[/~]/.test(query.trim()) && !options.length) addRepo();
                    else if (e.key === "Enter" && options[active] !== undefined) choose(options[active]);
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
                      <>
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
                        <button
                          className="icon-btn tiny project-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeRepo(p);
                          }}
                          title="Remove from Mono"
                        >
                          <X size={13} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {!options.length && <div className="menu-empty">No matching repos</div>}
              </div>
              <button className="project-add" onClick={addRepo}>
                <Plus size={14} />
                <span>{/^[/~]/.test(query.trim()) ? `Add ${query.trim()}` : "Add repo…"}</span>
              </button>
            </div>
          </div>,
          document.body,
        )}
      {adding !== null && (
        <AddRepoDialog
          start={adding}
          onClose={() => setAdding(null)}
          onAdded={(added) => {
            setAdding(null);
            pending.current = added.id;
            reloadProjects();
          }}
        />
      )}
    </>
  );
}

/** "~/Code/app" → ~ › Code › app, each one a place to jump back to. */
function crumbs(dir: string) {
  const root = dir.startsWith("~") ? "~" : "/";
  const parts = dir.slice(root.length).split("/").filter(Boolean);
  return [{ label: root, path: root }, ...parts.map((part, i) => ({ label: part, path: `${root === "~" ? "~/" : "/"}${parts.slice(0, i + 1).join("/")}` }))];
}

/** Add a repo by browsing folders: click to go in, the path bar to go back, Add on the one you want. */
function AddRepoDialog({ start, onClose, onAdded }: { start: string; onClose: () => void; onAdded: (project: Project) => void }) {
  const [dir, setDir] = useState(start);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [suggested, setSuggested] = useState<{ name: string; path: string }[]>([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => void api.suggestedRepos().then(setSuggested, () => {}), []);
  useEffect(() => {
    setFilter("");
    setActive(0);
    input.current?.focus();
    api.listFolder(dir).then(
      (l) => (setListing(l), setError(null)),
      (e: Error) => (dir !== "~" ? setDir("~") : setError(e.message)),
    );
  }, [dir]);
  // Braces matter: newer Chrome returns a promise from scrollIntoView, and an effect must not return one.
  useEffect(() => {
    list.current?.querySelector(".fb-row.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const entries = (listing?.entries ?? []).filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));
  const showSuggested = listing?.path === "~" && !filter && suggested.length > 0;
  const add = async (path: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onAdded(await api.addProject(path));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const browse = async () => {
    const picked = await desktop?.pickFolder?.();
    if (picked) void add(picked);
  };

  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog folder-browser"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(entries.length - 1, a + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) listing && !listing.added && void add(listing.path);
          else if (e.key === "Enter" && entries[active]) (e.preventDefault(), setDir(entries[active].path));
          else if (e.key === "Backspace" && !filter && listing?.parent) (e.preventDefault(), setDir(listing.parent));
          else return;
          input.current?.focus();
        }}
      >
        <div className="dialog-title">Add repo</div>
        <div className="fb-bar">
          <button className="icon-btn" disabled={!listing?.parent} onClick={() => listing?.parent && setDir(listing.parent)} title="Up (⌫)">
            <ArrowUp size={14} />
          </button>
          <div className="fb-crumbs">
            {listing &&
              crumbs(listing.path).map((c, i, all) => (
                <span key={c.path} className="fb-crumb">
                  {i > 0 && <ChevronRight size={12} />}
                  <button className={i === all.length - 1 ? "current" : ""} onClick={() => setDir(c.path)}>
                    {c.label}
                  </button>
                </span>
              ))}
          </div>
          <div className="fb-filter">
            <Search size={13} />
            <input ref={input} autoFocus placeholder="Filter" value={filter} onChange={(e) => (setFilter(e.target.value), setActive(0))} />
          </div>
        </div>

        <div className="fb-list" ref={list}>
          {showSuggested && (
            <>
              <div className="fb-section">Repos you've used with Claude Code</div>
              {suggested.map((s) => (
                <div key={s.path} className="fb-row suggested" onClick={() => void add(s.path)} title={`Add ${s.path}`}>
                  <FolderGit2 size={15} className="fb-icon repo" />
                  <span className="fb-name">{s.name}</span>
                  <span className="fb-hint">{s.path}</span>
                  <button className="btn ghost fb-add">Add</button>
                </div>
              ))}
              <div className="fb-section">Home</div>
            </>
          )}
          {entries.map((e, i) => (
            <div key={e.path} className={`fb-row ${i === active ? "active" : ""} ${e.repo ? "is-repo" : ""}`} onClick={() => setDir(e.path)} onMouseEnter={() => setActive(i)} title={e.path}>
              {e.repo ? <FolderGit2 size={15} className="fb-icon repo" /> : <Folder size={15} className="fb-icon" />}
              <span className="fb-name">{e.name}</span>
              <span className="fb-hint">{e.repos ? `${e.repos} ${e.repos === 1 ? "repo" : "repos"}` : ""}</span>
              {e.added ? (
                <span className="fb-added">Added</span>
              ) : (
                <button
                  className="btn ghost fb-add"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void add(e.path);
                  }}
                >
                  Add
                </button>
              )}
              <ChevronRight size={14} className="fb-chevron" />
            </div>
          ))}
          {listing && !entries.length && <div className="menu-empty">{filter ? "No matching folders" : "No folders inside"}</div>}
        </div>

        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          {desktop?.pickFolder && (
            <button type="button" className="btn ghost" onClick={() => void browse()}>
              <FolderOpen size={13} /> Browse…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!listing || listing.added || busy} onClick={() => listing && void add(listing.path)}>
            {busy ? "Adding…" : listing?.added ? "Already added" : `Add ${listing?.name === "~" ? "home folder" : `“${listing?.name ?? ""}”`}`} <kbd className="kbd on-primary">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
