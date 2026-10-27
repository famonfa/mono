import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, ChevronRight, Maximize2, Loader2, Sparkles, ExternalLink, Film, GitBranch, GitPullRequest, Image as ImageIcon, Link2, Plus, Target, Wrench, X } from "lucide-react";
import { api, fileUrl } from "../api";
import { useApp } from "../app-context";
import { BoardIcon, RISK_META, RiskIcon, STATUS_META, STATUS_MENU_ORDER, STATUS_ORDER, StatusIcon, type Risk } from "../icons";
import { href, navigate } from "../router";
import { BOARD_KIND, type BoardKind, type Task } from "../types";
import { formatDate, Menu, slugify, timeAgo } from "../ui";
import { sessionsApi, useRefreshJob } from "../sessions";
import { StatusDot } from "./Agents";
import { BoardView } from "./BoardView";
import { isVideo, StatusStrip } from "./Evidence";
import { Markdown } from "./Markdown";
import { ProjectTile } from "./Home";
import { ProjectActivity, ProjectAgents } from "./ProjectAgents";
import { ProjectIcon } from "./Projects";

/** Projects › project › page, plus who is working on it right now. Overview, sessions and pages live in the sidebar. */
export function TaskTopBar({ task, crumb }: { task: Task; crumb?: string }) {
  const { sessions } = useApp();
  const working = sessions.filter((s) => s.status === "working" && s.taskIds?.includes(task.id));
  return (
    <header className="topbar task-topbar">
      <nav className="breadcrumb">
        <a href={href.home()}>Projects</a>
        <ChevronRight size={13} />
        <a href={href.task(task.id)} className="crumb-task">
          <ProjectTile task={task} size={16} />
          <span>{task.title}</span>
        </a>
        {crumb && (
          <>
            <ChevronRight size={13} />
            <span className="crumb-page">{crumb}</span>
          </>
        )}
      </nav>
      <span className="spacer" />
      {working.length > 0 && (
        <a className="status-pill-live working" href={href.taskSession(task.id, working[0].id)} title={working.map((s) => s.title).join("\n")}>
          <StatusDot status="working" size={7} />
          {working.length === 1 ? "1 agent working" : `${working.length} agents working`}
        </a>
      )}
    </header>
  );
}

function EditableText({
  value,
  placeholder,
  onSave,
  onDone,
  autoFocus,
  className = "",
  multiline = false,
}: {
  value?: string;
  placeholder: string;
  onSave: (v: string) => void;
  onDone?: () => void;
  autoFocus?: boolean;
  className?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commit = () => {
    if (draft.trim() !== (value ?? "").trim()) onSave(draft.trim());
    onDone?.();
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      className={`editable ${className}`}
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value ?? "");
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Enter" && (!multiline || e.metaKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

const TLDR = [
  { key: "problema", label: "Problem", icon: <AlertTriangle size={14} /> },
  { key: "solucion", label: "Solution", icon: <Wrench size={14} /> },
  { key: "impacto", label: "Impact", icon: <Target size={14} /> },
] as const;

function RefreshButton({ task, onDone, onAuto }: { task: Task; onDone: () => void; onAuto: (on: boolean) => Promise<void> }) {
  const { openDialog } = useApp();
  const { job, start } = useRefreshJob(task.id, onDone);
  const refreshing = job.status === "running";
  const showOutput = () =>
    openDialog({ title: job.status === "failed" ? "Update failed" : "Last update", submitLabel: "Close", fields: [{ name: "out", label: "Output", defaultValue: job.output?.trim() || "(no output)", multiline: true, readOnly: true }], onSubmit: () => {} });

  return (
    <div className="refresh-box">
      <button className="btn ai" onClick={() => start()} disabled={job.status === "running"}>
        {refreshing ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
        {refreshing ? "Updating with AI…" : "Update with AI"}
      </button>
      <div className="refresh-meta">
        {refreshing && "Live in Agents"}
        {job.status !== "running" && task.refreshedAt && `Updated ${timeAgo(task.refreshedAt)}`}
        {(job.status === "done" || job.status === "failed") && (
          <button className={`link-btn ${job.status === "failed" ? "err" : ""}`} onClick={showOutput}>
            {job.status === "failed" ? "View error" : "View output"}
          </button>
        )}
      </div>
      <label className="auto-refresh" title="Only while the app is open">
        <input type="checkbox" checked={Boolean(task.autoRefresh)} onChange={(e) => void onAuto(e.target.checked)} /> Auto-update when agents finish
      </label>
    </div>
  );
}

export function TaskOverview({ task, onChange }: { task: Task; onChange: () => void }) {
  const { updateTask, openDialog, sessions, projects } = useApp();
  const linkedSessions = sessions.filter((s) => s.taskIds?.includes(task.id));
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);

  // Opt-in: when the last working agent of this task stops, refresh the summary once.
  const working = linkedSessions.filter((s) => s.status === "working").length;
  const wasWorking = useRef(working);
  useEffect(() => {
    if (task.autoRefresh && wasWorking.current > 0 && working === 0) void sessionsApi.startRefresh(task.id).catch(() => {});
    wasWorking.current = working;
  }, [working, task.autoRefresh, task.id]);

  const save = async (patch: Partial<Task>) => {
    await updateTask(task.id, patch);
    onChange();
  };

  const createBoard = () =>
    openDialog({
      title: "New board",
      fields: [
        { name: "title", label: "Name" },
        {
          name: "kind",
          label: "Type",
          defaultValue: "free",
          options: (Object.keys(BOARD_KIND) as BoardKind[]).map((k) => ({ value: k, label: BOARD_KIND[k].label, icon: <BoardIcon kind={k} size={13} /> })),
        },
      ],
      onSubmit: async ({ title, kind }) => {
        if (!title.trim()) throw new Error("Name is required");
        const id = slugify(title);
        if (task.boards.some((b) => b.id === id)) throw new Error("A board with that name already exists");
        await api.saveBoard(task.id, { id, title: title.trim(), kind: kind as BoardKind, layout: kind === "storymap" ? "storymap" : "lanes", nodes: [], edges: [] });
        navigate(href.board(task.id, id));
      },
    });

  const addTag = () =>
    openDialog({
      title: "Add tag",
      submitLabel: "Add",
      fields: [{ name: "tag", label: "Tag" }],
      onSubmit: async ({ tag }) => {
        const clean = slugify(tag);
        if (clean && !task.tags?.includes(clean)) await save({ tags: [...(task.tags ?? []), clean] });
      },
    });

  return (
    <div className="issue">
      <div className="issue-main">
        <div className="issue-content">
          <EditableText className="issue-title" value={task.title} placeholder="Title" onSave={(title) => title && save({ title })} />

          <StatusStrip task={task} />

          <ProjectAgents task={task} />

          <div className="tldr">
            {TLDR.map((t) => (
              <div key={t.key} className="tldr-block">
                <div className="tldr-head">
                  {t.icon}
                  {t.label}
                </div>
                <EditableText
                  multiline
                  value={task.tldr?.[t.key]}
                  placeholder={`Add ${t.label.toLowerCase()}…`}
                  onSave={(v) => save({ tldr: { ...task.tldr, [t.key]: v || undefined } })}
                />
              </div>
            ))}
          </div>

          <ProjectActivity task={task} />

          <BoardsPanel task={task} onCreate={createBoard} />

          <div className="issue-summary">
            {editingSummary ? (
              <EditableText
                multiline
                autoFocus
                className="summary-editor"
                value={task.summary}
                placeholder="Markdown notes… (⌘↵ to save)"
                onSave={(summary) => save({ summary })}
                onDone={() => setEditingSummary(false)}
              />
            ) : task.summary ? (
              <div onDoubleClick={() => setEditingSummary(true)} title="Double-click to edit">
                <Markdown taskId={task.id}>{task.summary}</Markdown>
              </div>
            ) : (
              <button className="ghost-add" onClick={() => setEditingSummary(true)}>
                Add notes…
              </button>
            )}
          </div>

          {task.assets.length > 0 && (
            <Section title="Files" count={task.assets.length}>
              <div className="gallery">
                {task.assets.map((a) =>
                  isVideo(a) ? (
                    <figure key={a}>
                      <video src={fileUrl(task.id, `assets/${a}`)} controls muted loop playsInline preload="metadata" />
                      <figcaption>
                        <Film size={11} /> {a}
                      </figcaption>
                    </figure>
                  ) : (
                    <figure key={a} onClick={() => setLightbox(fileUrl(task.id, `assets/${a}`))}>
                      <img src={fileUrl(task.id, `assets/${a}`)} alt={a} loading="lazy" />
                      <figcaption>
                        <ImageIcon size={11} /> {a}
                      </figcaption>
                    </figure>
                  ),
                )}
              </div>
            </Section>
          )}
        </div>
      </div>

      <aside className="properties">
        <RefreshButton task={task} onDone={onChange} onAuto={(autoRefresh) => save({ autoRefresh })} />
        <div className="prop-group">
          <div className="prop-title">Properties</div>
          <Prop label="Icon">
            <button
              className="prop-value"
              onClick={() =>
                openDialog({
                  title: "Project icon",
                  submitLabel: "Save",
                  fields: [{ name: "icon", label: "An emoji (empty for the initial)", defaultValue: task.icon ?? "" }],
                  onSubmit: ({ icon }) => save({ icon: [...icon.trim()].slice(0, 2).join("") || undefined }),
                })
              }
            >
              <ProjectTile task={task} size={18} /> {task.icon ? "Change" : "Add emoji"}
            </button>
          </Prop>
          <Prop label="Status">
            <Menu
              value={task.status}
              options={STATUS_MENU_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, icon: <StatusIcon status={s} />, hint: STATUS_META[s].key }))}
              onChange={(status) => save({ status })}
              className="prop-value"
            >
              <StatusIcon status={task.status} /> {STATUS_META[task.status]?.label}
            </Menu>
          </Prop>
          <Prop label="Risk">
            <Menu
              value={task.risk}
              options={(["alto", "medio", "bajo"] as Risk[]).map((r, i) => ({ value: r, label: RISK_META[r].label, icon: <RiskIcon risk={r} />, hint: String(i + 1) }))}
              onChange={(risk) => save({ risk })}
              className="prop-value"
            >
              <RiskIcon risk={task.risk as Risk | undefined} /> {task.risk ? RISK_META[task.risk as Risk].label : "Not set"}
            </Menu>
          </Prop>
          <Prop label="Repos">
            <div className="prop-tags">
              {(task.projectIds ?? []).map((id) => {
                const project = projects.find((p) => p.id === id);
                return (
                  <span key={id} className="project-chip" title={project?.root}>
                    <ProjectIcon project={project} size={14} /> {project?.title ?? id}
                  </span>
                );
              })}
              <Menu
                options={projects.map((p) => ({ value: p.id, label: p.title, icon: <ProjectIcon project={p} size={14} /> }))}
                placeholder="Add or remove repo…"
                onChange={(id) => {
                  const current = task.projectIds ?? [];
                  save({ projects: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] });
                }}
                className="icon-btn tiny"
              >
                <Plus size={13} />
              </Menu>
            </div>
          </Prop>
          <Prop label="Tags">
            <div className="prop-tags">
              {task.tags?.map((t) => (
                <span key={t} className="label-pill removable">
                  <i />
                  {t}
                  <button onClick={() => save({ tags: task.tags?.filter((x) => x !== t) })} title="Remove">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button className="icon-btn tiny" onClick={addTag} title="Add tag">
                <Plus size={13} />
              </button>
            </div>
          </Prop>
          <Prop label="Updated">
            <span className="prop-static">{formatDate(task.updatedAt)}</span>
          </Prop>
        </div>

        {!!task.repos?.length && (
          <div className="prop-group">
            <div className="prop-title">Repos & PRs</div>
            {task.repos.map((r) => (
              <a key={r.name} className="pr-row" href={r.pr} target="_blank" rel="noreferrer" title={r.branch}>
                <GitPullRequest size={14} />
                <span className="pr-repo">{r.name}</span>
                {r.pr && <span className="pr-number">#{r.pr.split("/").pop()}</span>}
                <span className="spacer" />
                <ExternalLink size={12} className="pr-ext" />
              </a>
            ))}
            {task.repos[0]?.branch && (
              <div className="branch">
                <GitBranch size={12} /> <span className="mono">{task.repos[0].branch}</span>
              </div>
            )}
          </div>
        )}

        {task.linear && (
          <div className="prop-group">
            <div className="prop-title">Links</div>
            <a className="pr-row" href={task.linear} target="_blank" rel="noreferrer">
              <Link2 size={14} />
              <span className="pr-repo">Linear ticket</span>
              <span className="spacer" />
              <ExternalLink size={12} className="pr-ext" />
            </a>
          </div>
        )}
      </aside>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}


function BoardsPanel({ task, onCreate }: { task: Task; onCreate: () => void }) {
  const [selected, setSelected] = useState(() => localStorage.getItem(`ws-board-${task.id}`) ?? "");
  const board = task.boards.find((b) => b.id === selected) ?? task.boards[0];
  const [visible, setVisible] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [board?.id]);

  const choose = (id: string) => {
    localStorage.setItem(`ws-board-${task.id}`, id);
    setSelected(id);
  };

  return (
    <section className="boards-panel">
      <div className="boards-head">
        <div className="board-switch">
          {task.boards.map((b) => (
            <button key={b.id} className={b.id === board?.id ? "active" : ""} onClick={() => choose(b.id)}>
              <BoardIcon kind={b.kind} size={13} /> {b.title}
              <span className="tab-count">{b.nodeCount}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        {board && (
          <a className="tool" href={href.board(task.id, board.id)} title="Full screen">
            <Maximize2 size={13} /> Open
          </a>
        )}
        <button className="icon-btn" onClick={onCreate} title="New board">
          <Plus size={14} />
        </button>
      </div>
      <div className="boards-body" ref={holder}>
        {board ? visible && <BoardView key={board.id} task={task} boardId={board.id} embedded /> : <EmptyRow onClick={onCreate}>New board</EmptyRow>}
      </div>
    </section>
  );
}

function Section({ title, count, onAdd, children }: { title: string; count?: number; onAdd?: () => void; children: ReactNode }) {
  return (
    <section className="issue-section">
      <div className="issue-section-head">
        <span>{title}</span>
        {count ? <span className="group-count">{count}</span> : null}
        <span className="spacer" />
        {onAdd && (
          <button className="icon-btn" onClick={onAdd} title="Add">
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="sub-list">{children}</div>
    </section>
  );
}

function EmptyRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="sub-row empty-row" onClick={onClick}>
      <Plus size={14} /> {children}
    </button>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      {children}
    </div>
  );
}
