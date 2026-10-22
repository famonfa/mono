import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, ExternalLink, GitBranch, GitPullRequest, Image as ImageIcon, LayoutDashboard, Link2, Plus, Target, Wrench, X } from "lucide-react";
import { api, fileUrl } from "../api";
import { useApp } from "../app-context";
import { BoardIcon, DocIcon, RISK_META, RiskIcon, STATUS_META, STATUS_MENU_ORDER, STATUS_ORDER, StatusIcon, type Risk } from "../icons";
import { href, navigate } from "../router";
import { BOARD_KIND, type BoardKind, type Task } from "../types";
import { formatDate, Menu, slugify } from "../ui";
import { Markdown } from "./Markdown";

export function TaskTopBar({ task, active }: { task: Task; active: string }) {
  return (
    <header className="topbar task-topbar">
      <nav className="breadcrumb">
        <a href={href.home()}>Tareas</a>
        <ChevronRight size={13} />
        <a href={href.task(task.id)} className="crumb-task">
          <StatusIcon status={task.status} size={13} />
          <span className="mono">{task.id}</span>
        </a>
      </nav>
      <nav className="view-tabs">
        <a className={active === "overview" ? "active" : ""} href={href.task(task.id)}>
          <LayoutDashboard size={13} /> Resumen
        </a>
        {task.boards.map((b) => (
          <a key={b.id} className={active === `b:${b.id}` ? "active" : ""} href={href.board(task.id, b.id)}>
            <BoardIcon kind={b.kind} size={13} /> {b.title}
          </a>
        ))}
        {task.docs.map((d) => (
          <a key={d} className={active === `d:${d}` ? "active" : ""} href={href.doc(task.id, d)}>
            <DocIcon size={13} /> {d.replace(/\.md$/, "")}
          </a>
        ))}
      </nav>
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
  { key: "problema", label: "Problema", icon: <AlertTriangle size={14} />, tone: "red" },
  { key: "solucion", label: "Solución", icon: <Wrench size={14} />, tone: "blue" },
  { key: "impacto", label: "Impacto", icon: <Target size={14} />, tone: "green" },
] as const;

export function TaskOverview({ task, onChange }: { task: Task; onChange: () => void }) {
  const { updateTask, openDialog } = useApp();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);

  const save = async (patch: Partial<Task>) => {
    await updateTask(task.id, patch);
    onChange();
  };

  const createBoard = () =>
    openDialog({
      title: "Nuevo board",
      fields: [
        { name: "title", label: "Nombre del board" },
        {
          name: "kind",
          label: "Tipo",
          defaultValue: "free",
          options: (Object.keys(BOARD_KIND) as BoardKind[]).map((k) => ({ value: k, label: BOARD_KIND[k].label, icon: <BoardIcon kind={k} size={13} /> })),
        },
      ],
      onSubmit: async ({ title, kind }) => {
        if (!title.trim()) throw new Error("Poné un nombre");
        const id = slugify(title);
        if (task.boards.some((b) => b.id === id)) throw new Error("Ya existe un board con ese nombre");
        await api.saveBoard(task.id, { id, title: title.trim(), kind: kind as BoardKind, layout: kind === "storymap" ? "storymap" : "lanes", nodes: [], edges: [] });
        navigate(href.board(task.id, id));
      },
    });

  const createDoc = () =>
    openDialog({
      title: "Nuevo documento",
      fields: [{ name: "name", label: "Nombre del documento" }],
      onSubmit: async ({ name }) => {
        if (!name.trim()) throw new Error("Poné un nombre");
        const file = `${slugify(name.replace(/\.md$/, ""))}.md`;
        await api.saveDoc(task.id, file, `# ${name.replace(/\.md$/, "")}\n\n`);
        navigate(href.doc(task.id, file));
      },
    });

  const addTag = () =>
    openDialog({
      title: "Agregar etiqueta",
      submitLabel: "Agregar",
      fields: [{ name: "tag", label: "Etiqueta" }],
      onSubmit: async ({ tag }) => {
        const clean = slugify(tag);
        if (clean && !task.tags?.includes(clean)) await save({ tags: [...(task.tags ?? []), clean] });
      },
    });

  return (
    <div className="issue">
      <div className="issue-main">
        <div className="issue-content">
          <EditableText className="issue-title" value={task.title} placeholder="Título" onSave={(title) => title && save({ title })} />

          <div className="tldr">
            {TLDR.map((t) => (
              <div key={t.key} className={`tldr-block ${t.tone}`}>
                <div className="tldr-head">
                  {t.icon}
                  {t.label}
                </div>
                <EditableText
                  multiline
                  value={task.tldr?.[t.key]}
                  placeholder={`Agregar ${t.label.toLowerCase()}…`}
                  onSave={(v) => save({ tldr: { ...task.tldr, [t.key]: v || undefined } })}
                />
              </div>
            ))}
          </div>

          <div className="issue-summary">
            {editingSummary ? (
              <EditableText
                multiline
                autoFocus
                className="summary-editor"
                value={task.summary}
                placeholder="Notas en markdown… (⌘↵ para guardar)"
                onSave={(summary) => save({ summary })}
                onDone={() => setEditingSummary(false)}
              />
            ) : task.summary ? (
              <div onDoubleClick={() => setEditingSummary(true)} title="Doble click para editar">
                <Markdown taskId={task.id}>{task.summary}</Markdown>
              </div>
            ) : (
              <button className="ghost-add" onClick={() => setEditingSummary(true)}>
                Agregar notas…
              </button>
            )}
          </div>

          <Section title="Boards" count={task.boards.length} onAdd={createBoard}>
            {task.boards.map((b) => (
              <a key={b.id} className="sub-row" href={href.board(task.id, b.id)}>
                <span className={`sub-icon kind-${b.kind}`}>
                  <BoardIcon kind={b.kind} size={14} />
                </span>
                <span className="sub-title">{b.title}</span>
                <span className="sub-kind">{BOARD_KIND[b.kind]?.label}</span>
                <span className="spacer" />
                <span className="sub-count">{b.nodeCount} nodos</span>
                <ChevronRight size={14} className="sub-chevron" />
              </a>
            ))}
            {!task.boards.length && <EmptyRow onClick={createBoard}>Crear el primer board</EmptyRow>}
          </Section>

          <Section title="Documentos" count={task.docs.length} onAdd={createDoc}>
            {task.docs.map((d) => (
              <a key={d} className="sub-row" href={href.doc(task.id, d)}>
                <span className="sub-icon">
                  <DocIcon size={14} />
                </span>
                <span className="sub-title">{d.replace(/\.md$/, "")}</span>
                <span className="spacer" />
                <ChevronRight size={14} className="sub-chevron" />
              </a>
            ))}
            {!task.docs.length && <EmptyRow onClick={createDoc}>Crear un documento</EmptyRow>}
          </Section>

          {task.assets.length > 0 && (
            <Section title="Capturas" count={task.assets.length}>
              <div className="gallery">
                {task.assets.map((a) => (
                  <figure key={a} onClick={() => setLightbox(fileUrl(task.id, `assets/${a}`))}>
                    <img src={fileUrl(task.id, `assets/${a}`)} alt={a} loading="lazy" />
                    <figcaption>
                      <ImageIcon size={11} /> {a}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      <aside className="properties">
        <div className="prop-group">
          <div className="prop-title">Propiedades</div>
          <Prop label="Estado">
            <Menu
              value={task.status}
              options={STATUS_MENU_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, icon: <StatusIcon status={s} />, hint: STATUS_META[s].key }))}
              onChange={(status) => save({ status })}
              className="prop-value"
            >
              <StatusIcon status={task.status} /> {STATUS_META[task.status]?.label}
            </Menu>
          </Prop>
          <Prop label="Riesgo">
            <Menu
              value={task.risk}
              options={(["alto", "medio", "bajo"] as Risk[]).map((r, i) => ({ value: r, label: RISK_META[r].label, icon: <RiskIcon risk={r} />, hint: String(i + 1) }))}
              onChange={(risk) => save({ risk })}
              className="prop-value"
            >
              <RiskIcon risk={task.risk as Risk | undefined} /> {task.risk ? RISK_META[task.risk as Risk].label : "Sin definir"}
            </Menu>
          </Prop>
          <Prop label="Etiquetas">
            <div className="prop-tags">
              {task.tags?.map((t) => (
                <span key={t} className="label-pill removable">
                  <i />
                  {t}
                  <button onClick={() => save({ tags: task.tags?.filter((x) => x !== t) })} title="Quitar">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button className="icon-btn tiny" onClick={addTag} title="Agregar etiqueta">
                <Plus size={13} />
              </button>
            </div>
          </Prop>
          <Prop label="Actualizado">
            <span className="prop-static">{formatDate(task.updatedAt)}</span>
          </Prop>
        </div>

        {!!task.repos?.length && (
          <div className="prop-group">
            <div className="prop-title">Repos y PRs</div>
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
              <span className="pr-repo">Ticket en Linear</span>
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

function Section({ title, count, onAdd, children }: { title: string; count?: number; onAdd?: () => void; children: ReactNode }) {
  return (
    <section className="issue-section">
      <div className="issue-section-head">
        <span>{title}</span>
        {count ? <span className="group-count">{count}</span> : null}
        <span className="spacer" />
        {onAdd && (
          <button className="icon-btn" onClick={onAdd} title={`Agregar ${title.toLowerCase()}`}>
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
