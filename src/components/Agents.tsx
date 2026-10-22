import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Bot,
  Check,
  ChevronRight,
  FilePen,
  FolderGit2,
  FileText,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  ListTodo,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useApp } from "../app-context";
import { StatusIcon } from "../icons";
import { href, navigate } from "../router";
import { uploadUrl } from "../chat";
import { useSessionFeed, type SessionEvent, type SessionStatus, type SessionSummary, type SubagentSummary } from "../sessions";
import { formatDate, Menu } from "../ui";
import { SessionChat } from "./Chat";
import { Markdown } from "./Markdown";

const STATUS_LABEL: Record<SessionStatus, string> = { working: "Trabajando", idle: "En pausa", inactive: "Inactiva" };

export function StatusDot({ status, size = 8 }: { status: SessionStatus; size?: number }) {
  return <span className={`live-dot ${status}`} style={{ width: size, height: size }} />;
}

export function ToolIcon({ name, size = 13 }: { name?: string; size?: number }) {
  const props = { size, strokeWidth: 1.9 };
  if (!name) return <Wrench {...props} />;
  if (name === "Bash" || name === "BashOutput") return <Terminal {...props} />;
  if (name === "Read") return <FileText {...props} />;
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)) return <FilePen {...props} />;
  if (["Grep", "Glob", "ToolSearch"].includes(name)) return <Search {...props} />;
  if (["Agent", "Task", "SendMessage"].includes(name)) return <Bot {...props} />;
  if (name.startsWith("Web") || name.includes("preview") || name.includes("browser")) return <Globe {...props} />;
  if (name === "Skill") return <Sparkles {...props} />;
  if (name.startsWith("Task") || name === "TodoWrite") return <ListTodo {...props} />;
  return <Wrench {...props} />;
}

const shortTool = (name?: string) => (name?.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name);

export function SessionRow({ session, compact = false }: { session: SessionSummary; compact?: boolean }) {
  const { tasks } = useApp();
  const activeSubs = session.subagents.filter((s) => s.status === "working").length;
  return (
    <a className={`agent-row ${compact ? "compact" : ""}`} href={href.session(session.id)}>
      <StatusDot status={session.status} />
      <span className="agent-title">{session.title}</span>
      {!compact && <span className="agent-project">{session.project}</span>}
      <span className="agent-action">
        {session.lastAction && (
          <>
            <ToolIcon name={session.lastAction.tool} />
            <span>{session.lastAction.title || shortTool(session.lastAction.tool)}</span>
          </>
        )}
      </span>
      <span className="agent-meta">
        {!compact &&
          session.taskIds?.map((id) => {
            const task = tasks.find((t) => t.id === id);
            return (
              <span key={id} className="task-chip" onClick={(e) => (e.preventDefault(), navigate(href.task(id)))}>
                {task && <StatusIcon status={task.status} size={11} />}
                {id}
              </span>
            );
          })}
        {session.subagents.length > 0 && (
          <span className={`meta-repos ${activeSubs ? "active" : ""}`} title="Subagentes activos / total">
            <Bot size={12} />
            {activeSubs ? `${activeSubs}/` : ""}
            {session.subagents.length}
          </span>
        )}
      </span>
      <span className="row-date">{formatDate(session.lastTs)}</span>
    </a>
  );
}

export function AgentsPage({ sessions }: { sessions: SessionSummary[] }) {
  const groups: { status: SessionStatus; label: string }[] = [
    { status: "working", label: "Trabajando ahora" },
    { status: "idle", label: "En pausa (últimas 2 h)" },
    { status: "inactive", label: "Anteriores" },
  ];
  return (
    <div className="home">
      <header className="topbar">
        <div className="topbar-title">Agentes</div>
        <span className="topbar-sub">Sesiones de Claude Code de los últimos 3 días · en vivo</span>
        <span className="spacer" />
        <a className="btn primary" href={href.newSession()}>
          <Plus size={14} /> Nueva sesión <kbd className="kbd on-primary">S</kbd>
        </a>
      </header>
      <div className="list">
        {groups.map((g) => {
          const items = sessions.filter((s) => s.status === g.status);
          if (!items.length) return null;
          return (
            <section key={g.status}>
              <div className="group-header">
                <StatusDot status={g.status} />
                <span className="group-label">{g.label}</span>
                <span className="group-count">{items.length}</span>
              </div>
              {items.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </section>
          );
        })}
        {!sessions.length && <div className="empty">No hay sesiones recientes.</div>}
      </div>
    </div>
  );
}

type ToolCall = SessionEvent & { result?: SessionEvent };
type FeedItem = { type: "event"; event: SessionEvent } | { type: "tools"; calls: ToolCall[] };

/** Pairs tool calls with their results and folds consecutive calls into one group, like a terminal log. */
function buildFeed(events: SessionEvent[]): FeedItem[] {
  const results = new Map(events.filter((e) => e.kind === "result").map((e) => [e.toolUseId, e]));
  const items: FeedItem[] = [];
  for (const event of events) {
    if (event.kind === "result") continue;
    if (event.kind === "tool") {
      const call = { ...event, result: results.get(event.id) };
      const last = items[items.length - 1];
      if (last?.type === "tools") last.calls.push(call);
      else items.push({ type: "tools", calls: [call] });
    } else {
      items.push({ type: "event", event });
    }
  }
  return items;
}

const ATTACHMENTS_MARK = "\n\nArchivos adjuntos:\n";
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

function PromptBody({ text, images }: { text: string; images: number }) {
  const [body, list] = text.includes(ATTACHMENTS_MARK) ? text.split(ATTACHMENTS_MARK) : [text, ""];
  const files = list
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean);
  return (
    <div className="msg-body plain">
      <Collapsible text={body} />
      {files.length > 0 && (
        <div className="attachments in-feed">
          {files.map((f) => (
            <a key={f} className="attachment" href={uploadUrl(f)} target="_blank" rel="noreferrer" title={f}>
              {IMAGE_FILE.test(f) ? <img src={uploadUrl(f)} alt="" /> : <FileText size={14} />}
              <span className="attachment-name">{f.split("/").pop()}</span>
            </a>
          ))}
        </div>
      )}
      {!files.length && images > 0 && <div className="attachments in-feed">🖼 {images} imagen{images > 1 ? "es" : ""}</div>}
    </div>
  );
}

function Collapsible({ text, limit = 700 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit) return <>{text}</>;
  return (
    <>
      {open ? text : `${text.slice(0, limit)}…`}
      <button className="link-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "Ver menos" : "Ver todo"}
      </button>
    </>
  );
}

function ToolCallRow({ call, sessionId, live }: { call: ToolCall; sessionId: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = !call.result && live;
  return (
    <div className={`tool-call ${open ? "open" : ""} ${call.result?.isError ? "error" : ""}`}>
      <button className="tool-call-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-call-icon">
          <ToolIcon name={call.name} />
        </span>
        <span className="tool-call-name">{shortTool(call.name)}</span>
        <span className="tool-call-title">{call.title}</span>
        <span className="spacer" />
        {call.agentId && (
          <span
            className="task-chip"
            onClick={(e) => {
              e.stopPropagation();
              navigate(href.session(sessionId, call.agentId));
            }}
          >
            <Bot size={11} /> Ver subagente
          </span>
        )}
        {running ? <Loader2 size={13} className="spin" /> : call.result?.isError ? <X size={13} className="err" /> : call.result ? <Check size={13} className="ok" /> : null}
        <ChevronRight size={13} className="tool-call-chevron" />
      </button>
      {open && (
        <div className="tool-call-body">
          {call.detail && <pre className="code">{call.detail}</pre>}
          {call.result && <pre className={`code output ${call.result.isError ? "error" : ""}`}>{call.result.text || "(sin salida)"}</pre>}
        </div>
      )}
    </div>
  );
}

export function Feed({ events, sessionId, live, isSubagent, pendingText }: { events: SessionEvent[]; sessionId: string; live: boolean; isSubagent: boolean; pendingText?: string | null }) {
  const items = useMemo(() => buildFeed(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const added = events.length - lastCount.current;
    lastCount.current = events.length;
    if (pinned) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((u) => u + added);
  }, [events, pinned, pendingText]);

  const onScroll = () => {
    const el = scroller.current!;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setPinned(atBottom);
    if (atBottom) setUnseen(0);
  };

  return (
    <div className="feed-wrap">
      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div className="feed-inner">
          {items.map((item, i) =>
            item.type === "tools" ? (
              <div key={i} className="tool-group-feed">
                {item.calls.map((call) => (
                  <ToolCallRow key={call.id} call={call} sessionId={sessionId} live={live} />
                ))}
              </div>
            ) : item.event.kind === "prompt" ? (
              <div key={i} className="msg prompt">
                <div className="msg-author">
                  <MessageSquare size={12} /> {isSubagent && i === 0 ? "Instrucciones del orquestador" : "Vos"} <span className="msg-time">{formatDate(item.event.ts)}</span>
                </div>
                <PromptBody text={item.event.text ?? ""} images={item.event.images ?? 0} />
              </div>
            ) : item.event.kind === "text" ? (
              <div key={i} className="msg assistant">
                <div className="msg-author">
                  <Sparkles size={12} /> Claude <span className="msg-time">{formatDate(item.event.ts)}</span>
                </div>
                <div className="msg-body">
                  <Markdown taskId="">{item.event.text ?? ""}</Markdown>
                </div>
              </div>
            ) : (
              <div key={i} className="msg-notice">
                {item.event.text}
              </div>
            ),
          )}
          {pendingText && (
            <div className="msg prompt pending">
              <div className="msg-author">
                <MessageSquare size={12} /> Vos <span className="msg-time">enviando…</span>
              </div>
              <div className="msg-body plain">{pendingText}</div>
            </div>
          )}
          {live && (
            <div className="typing">
              <span />
              <span />
              <span />
              trabajando…
            </div>
          )}
        </div>
      </div>
      {!pinned && (
        <button
          className="follow-btn"
          onClick={() => {
            scroller.current!.scrollTop = scroller.current!.scrollHeight;
            setPinned(true);
            setUnseen(0);
          }}
        >
          <ArrowDown size={13} /> {unseen ? `${unseen} nuevos` : "Seguir en vivo"}
        </button>
      )}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      <span className="prop-static">{children}</span>
    </div>
  );
}

function SubagentItem({ sessionId, agent, active }: { sessionId: string; agent: SubagentSummary; active: boolean }) {
  return (
    <a className={`sub-agent ${active ? "active" : ""}`} href={href.session(sessionId, agent.id)}>
      <StatusDot status={agent.status} size={7} />
      <span className="sub-agent-body">
        <span className="sub-agent-title">{agent.description}</span>
        {agent.lastAction && (
          <span className="sub-agent-action">
            <ToolIcon name={agent.lastAction.tool} size={11} /> {agent.lastAction.title || shortTool(agent.lastAction.tool)}
          </span>
        )}
      </span>
    </a>
  );
}

export function SessionView({ sessionId, agentId, sessions }: { sessionId: string; agentId?: string; sessions: SessionSummary[] }) {
  const { tasks, updateTask } = useApp();
  const feed = useSessionFeed(sessionId, agentId);
  const summary = sessions.find((s) => s.id === sessionId) ?? feed.session;
  const agent = summary?.subagents.find((a) => a.id === agentId);
  const status = agentId ? agent?.status ?? "inactive" : summary?.status ?? "inactive";

  useEffect(() => {
    if (summary) document.title = `${summary.title} · Agentes`;
    return () => void (document.title = "Avocado Workspace");
  }, [summary]);

  if (feed.error) return <div className="empty">No se pudo abrir la sesión: {feed.error}</div>;

  return (
    <div className="task-shell">
      <header className="topbar task-topbar">
        <nav className="breadcrumb">
          <a href={href.agents()}>Agentes</a>
          <ChevronRight size={13} />
          <a href={href.session(sessionId)} className="crumb-task">
            <StatusDot status={summary?.status ?? "inactive"} size={7} />
            <span className="crumb-title">{summary?.title ?? "…"}</span>
          </a>
          {agent && (
            <>
              <ChevronRight size={13} />
              <span className="crumb-task">
                <Bot size={13} /> <span className="crumb-title">{agent.description}</span>
              </span>
            </>
          )}
        </nav>
        <span className="spacer" />
        <span className={`status-pill-live ${status}`}>
          <StatusDot status={status} size={7} /> {STATUS_LABEL[status]}
        </span>
      </header>
      <div className="task-content">
        <div className="issue">
          <div className="issue-main session-main">
            {agentId && feed.truncated && <div className="msg-notice top">Mostrando la parte más reciente de la sesión</div>}
            {agentId ? (
              <Feed events={feed.events} sessionId={sessionId} live={status === "working"} isSubagent />
            ) : (
              <SessionChat sessionId={sessionId} summary={summary} />
            )}
          </div>
          <aside className="properties">
            {summary && (
              <div className="prop-group">
                <div className="prop-title">Sesión</div>
                <Prop label="Estado">
                  <StatusDot status={summary.status} size={7} /> {STATUS_LABEL[summary.status]}
                </Prop>
                <Prop label="Proyecto">
                  <Folder size={12} /> {summary.project}
                </Prop>
                {summary.focusCwd && (
                  <Prop label="Trabaja en">
                    <FolderGit2 size={12} /> <span className="mono" title={summary.focusCwd}>{summary.focusCwd.split("/").slice(-2).join("/")}</span>
                  </Prop>
                )}
                {summary.gitBranch && (
                  <Prop label="Rama">
                    <GitBranch size={12} /> <span className="mono">{summary.gitBranch}</span>
                  </Prop>
                )}
                {summary.model && <Prop label="Modelo">{summary.model}</Prop>}
                <Prop label="Empezó">{formatDate(summary.firstTs)}</Prop>
                <Prop label="Última">{formatDate(summary.lastTs)}</Prop>
              </div>
            )}
            {summary && (
              <div className="prop-group">
                <div className="prop-title prop-title-row">
                  Tareas
                  <Menu
                    placeholder="Vincular a una tarea…"
                    options={tasks.map((t) => ({ value: t.id, label: `${t.id} · ${t.title}`, icon: <StatusIcon status={t.status} /> }))}
                    onChange={(taskId) => {
                      const task = tasks.find((t) => t.id === taskId);
                      if (task) void updateTask(taskId, { sessionIds: [...new Set([...(task.sessionIds ?? []), sessionId])] });
                    }}
                    className="icon-btn tiny"
                  >
                    <Plus size={13} />
                  </Menu>
                </div>
                {!summary.taskIds?.length && <span className="hint">Sin tarea. Vinculala con +.</span>}
                {summary.taskIds?.map((id) => {
                  const task = tasks.find((t) => t.id === id);
                  return (
                    <a key={id} className="pr-row" href={href.task(id)}>
                      {task && <StatusIcon status={task.status} />}
                      <span className="pr-repo">{task?.title ?? id}</span>
                    </a>
                  );
                })}
              </div>
            )}
            {!!summary?.prLinks.length && (
              <div className="prop-group">
                <div className="prop-title">PRs</div>
                {summary.prLinks.map((url) => (
                  <a key={url} className="pr-row" href={url} target="_blank" rel="noreferrer">
                    <GitPullRequest size={14} />
                    <span className="pr-repo">{url.split("/").slice(-3, -2)[0]}</span>
                    <span className="pr-number">#{url.split("/").pop()}</span>
                  </a>
                ))}
              </div>
            )}
            {!!summary?.subagents.length && (
              <div className="prop-group">
                <div className="prop-title">
                  Subagentes · {summary.subagents.filter((s) => s.status === "working").length} activos de {summary.subagents.length}
                </div>
                <a className={`sub-agent ${!agentId ? "active" : ""}`} href={href.session(sessionId)}>
                  <Sparkles size={12} />
                  <span className="sub-agent-body">
                    <span className="sub-agent-title">Sesión principal</span>
                  </span>
                </a>
                {summary.subagents.map((a) => (
                  <SubagentItem key={a.id} sessionId={sessionId} agent={a} active={a.id === agentId} />
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
