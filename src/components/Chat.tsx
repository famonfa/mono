import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, FolderGit2, Plus, ShieldCheck, Square, Zap } from "lucide-react";
import { useApp } from "../app-context";
import { chatApi, useChatState, type ChatState, type PendingPermission, type Worktree } from "../chat";
import { href, navigate } from "../router";
import { useSessionFeed, type SessionSummary } from "../sessions";
import type { Task } from "../types";
import { formatDate, Menu } from "../ui";
import { Feed, StatusDot, ToolIcon } from "./Agents";

function FullAccessBadge() {
  return (
    <span className="full-access" title="Las sesiones lanzadas desde el workspace no piden permisos">
      <Zap size={12} /> Full access
    </span>
  );
}

function Composer({
  placeholder,
  disabled,
  disabledReason,
  running,
  onSend,
  onStop,
  footer,
  autoFocus,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  running?: boolean;
  onSend: (text: string) => Promise<void> | void;
  onStop?: () => void;
  footer?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if (!value || sending || disabled) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  return (
    <div className={`composer ${disabled ? "disabled" : ""}`}>
      {disabledReason && <div className="composer-notice">{disabledReason}</div>}
      {error && <div className="composer-error">{error}</div>}
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && running && onStop) onStop();
        }}
      />
      <div className="composer-bar">
        {footer}
        <span className="spacer" />
        {running && onStop && (
          <button className="composer-stop" onClick={onStop} title="Interrumpir (Esc)">
            <Square size={11} fill="currentColor" />
          </button>
        )}
        <button className="composer-send" onClick={submit} disabled={!text.trim() || sending || disabled} title="Enviar (Enter)">
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}

function describePermission(p: PendingPermission) {
  const input = p.input as Record<string, string | undefined>;
  const title = input.description ?? input.file_path ?? input.url ?? input.pattern ?? p.toolName;
  const detail = input.command ?? (input.file_path && (input.new_string ?? input.content) ? `${input.file_path}\n\n${input.new_string ?? input.content}` : JSON.stringify(p.input, null, 2));
  return { title, detail };
}

function PermissionCard({ sessionId, request, onAnswered }: { sessionId: string; request: PendingPermission; onAnswered: (s: ChatState) => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const { title, detail } = describePermission(request);
  const answer = async (allow: boolean, always = false) => {
    setBusy(true);
    try {
      onAnswered(await chatApi.answer(sessionId, request.id, { allow, always, message: reason || undefined }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="permission-card">
      <div className="permission-head">
        <ShieldCheck size={14} />
        <span>Claude quiere usar</span>
        <span className="permission-tool">
          <ToolIcon name={request.toolName} /> {request.toolName}
        </span>
      </div>
      <div className="permission-title">{title}</div>
      {request.decisionReason && <div className="permission-reason">{request.decisionReason}</div>}
      <pre className="code">{detail}</pre>
      <input className="permission-input" placeholder="Motivo si lo rechazás (opcional)…" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="permission-actions">
        <button className="btn ghost" disabled={busy} onClick={() => answer(false)}>
          Rechazar
        </button>
        <span className="spacer" />
        {request.canAlwaysAllow && (
          <button className="btn ghost" disabled={busy} onClick={() => answer(true, true)}>
            Permitir siempre
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={() => answer(true)} autoFocus>
          Permitir
        </button>
      </div>
    </div>
  );
}

/** Live feed + permission prompts + composer for one session. Used in the task tab and in Agents. */
export function SessionChat({ sessionId, summary }: { sessionId: string; summary?: SessionSummary }) {
  const feed = useSessionFeed(sessionId);
  const [chat, setChat] = useChatState(sessionId);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const promptCount = feed.events.filter((e) => e.kind === "prompt").length;
  const sentAt = useRef(promptCount);

  useEffect(() => {
    if (pendingText && promptCount > sentAt.current) setPendingText(null);
  }, [promptCount, pendingText]);

  const live = Boolean(chat?.live);
  const running = live ? chat!.state !== "idle" : summary?.status === "working";
  const busyElsewhere = !live && summary?.status === "working";

  const send = async (text: string) => {
    sentAt.current = promptCount;
    setPendingText(text);
    try {
      setChat(await chatApi.send(sessionId, text));
    } catch (e) {
      setPendingText(null);
      throw e;
    }
  };

  return (
    <div className="session-chat">
      {feed.truncated && <div className="msg-notice top">Mostrando la parte más reciente de la sesión</div>}
      <Feed events={feed.events} sessionId={sessionId} live={running} isSubagent={false} pendingText={pendingText} />
      <div className="chat-dock">
        {chat?.pending.map((p) => (
          <PermissionCard key={p.id} sessionId={sessionId} request={p} onAnswered={setChat} />
        ))}
        {chat?.error && <div className="composer-error">La sesión terminó con un error: {chat.error}</div>}
        <Composer
          placeholder={running ? "Mandale otro mensaje (se encola)…" : "Escribile a esta sesión…"}
          disabled={busyElsewhere}
          disabledReason={busyElsewhere ? "Esta sesión está trabajando en otra app (T3 Code o la terminal). Cuando quede en pausa, podés seguirla desde acá." : undefined}
          running={running && live}
          onSend={send}
          onStop={() => void chatApi.interrupt(sessionId).then(setChat)}
          footer={
            <>
              <FullAccessBadge />
              {chat?.cwd && (
                <span className="composer-cwd" title={chat.cwd}>
                  <FolderGit2 size={12} /> {chat.cwd.split("/").slice(-2).join("/")}
                </span>
              )}
              {!live && <span className="composer-hint">{summary ? "Se retoma al enviar" : ""}</span>}
            </>
          }
        />
      </div>
    </div>
  );
}

function NewSession({ task }: { task: Task }) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [cwd, setCwd] = useState<string>("");
  useEffect(() => {
    chatApi.worktrees(task.id).then((list) => {
      setWorktrees(list);
      setCwd(list[0]?.path ?? "");
    });
  }, [task.id]);

  const selected = worktrees.find((w) => w.path === cwd);

  return (
    <div className="new-session">
      <div className="new-session-inner">
        <div className="new-session-icon">
          <Bot size={22} />
        </div>
        <h2>Nueva sesión en {task.id}</h2>
        <p>Claude arranca con el contexto de la tarea (resumen, PRs y boards) y trabaja en la carpeta que elijas. Va a aparecer en vivo en esta pestaña y en Agentes.</p>
        <Composer
          autoFocus
          placeholder="¿Qué hacemos? Ej: revisá los 3 must-fix del board de testeo y arreglalos…"
          onSend={async (prompt) => {
            const state = await chatApi.start({ taskId: task.id, cwd, prompt });
            navigate(href.taskSession(task.id, state.sessionId));
          }}
          footer={
            <>
              <FullAccessBadge />
              <Menu
                value={cwd}
                options={worktrees.map((w) => ({ value: w.path, label: w.root ? "avocado (raíz)" : `${w.repo} · ${w.branch}`, icon: <FolderGit2 size={13} /> }))}
                onChange={setCwd}
                className="mode-trigger"
              >
                <FolderGit2 size={12} /> {selected ? (selected.root ? "avocado (raíz)" : `${selected.repo} · ${selected.branch}`) : "…"}
              </Menu>
            </>
          }
        />
      </div>
    </div>
  );
}

export function TaskSessions({ task, sessionId }: { task: Task; sessionId?: string }) {
  const { sessions } = useApp();
  const linked = useMemo(() => sessions.filter((s) => s.taskIds?.includes(task.id)), [sessions, task.id]);
  const current = linked.find((s) => s.id === sessionId) ?? sessions.find((s) => s.id === sessionId);

  return (
    <div className="task-sessions">
      <aside className="session-list">
        <a className={`session-new ${!sessionId ? "active" : ""}`} href={href.taskSession(task.id)}>
          <Plus size={14} /> Nueva sesión
        </a>
        <div className="prop-title session-list-title">Sesiones · {linked.length}</div>
        {linked.map((s) => (
          <a key={s.id} className={`session-item ${s.id === sessionId ? "active" : ""}`} href={href.taskSession(task.id, s.id)}>
            <StatusDot status={s.status} size={7} />
            <span className="session-item-body">
              <span className="session-item-title">{s.title}</span>
              <span className="session-item-meta">
                {s.ownedByWorkspace ? "workspace" : s.project} · {formatDate(s.lastTs)}
                {s.subagents.length > 0 && ` · ${s.subagents.length} subagentes`}
              </span>
            </span>
          </a>
        ))}
        {!linked.length && <p className="hint session-empty">Todavía no hay sesiones vinculadas a esta tarea.</p>}
      </aside>
      <section className="session-pane">
        {sessionId ? (
          <>
            <header className="session-pane-head">
              <StatusDot status={current?.status ?? "inactive"} size={7} />
              <span className="session-pane-title">{current?.title ?? "Sesión"}</span>
              <span className="spacer" />
              <a className="link-btn" href={href.session(sessionId)}>
                Ver en Agentes
              </a>
            </header>
            <SessionChat key={sessionId} sessionId={sessionId} summary={current} />
          </>
        ) : (
          <NewSession task={task} />
        )}
      </section>
    </div>
  );
}
