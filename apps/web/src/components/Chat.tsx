import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Check, ChevronLeft, CircleHelp, ClipboardList, Cpu, File as FileIcon, Folder, FolderGit2, Gauge, Loader2, Paperclip, Plus, ShieldCheck, Square, X, Zap } from "lucide-react";
import { useApp } from "../app-context";
import { chatApi, PERMISSION_MODES, useChatDefaults, useChatState, type Attachment, type ChatState, type ModelOption, type PendingPermission, type PermissionMode, type SlashCommand, type Worktree } from "../chat";
import { href, navigate } from "../router";
import { rememberSession, useSessionFeed, type SessionSummary } from "../sessions";
import type { Task } from "../types";
import { formatDate, Menu } from "../ui";
import { useIsMobile } from "../mobile";
import { useMarkSeen, useUnread } from "../unread";
import { Feed, StatusDot, ToolIcon } from "./Agents";
import { SendToGroup } from "./GroupCanvas";
import { ProjectIcon } from "./Projects";

function PermissionMenu({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const current = PERMISSION_MODES.find((m) => m.id === value) ?? PERMISSION_MODES[0];
  const icon = (id: PermissionMode) => (id === "bypassPermissions" ? <Zap size={13} /> : id === "plan" ? <ClipboardList size={13} /> : <ShieldCheck size={13} />);
  return (
    <Menu
      value={current.id}
      options={PERMISSION_MODES.map((m) => ({ value: m.id, label: `${m.label} — ${m.description}`, icon: icon(m.id) }))}
      onChange={onChange}
      className={`mode-trigger ${current.id === "bypassPermissions" ? "full" : ""}`}
    >
      {icon(current.id)} {current.label}
    </Menu>
  );
}

type Draft = { key: string; file: File; preview?: string; uploaded?: Attachment; error?: string };

const shortModel = (name: string) => name.replace(/^Claude /, "");

/** Model + effort pickers; effort options follow the selected model, like T3 Code. */
function ModelPicker({ models, model, effort, onChange }: { models: ModelOption[]; model?: string; effort?: string; onChange: (c: { model: string; effort: string }) => void }) {
  const current = models.find((m) => m.id === model) ?? models[0];
  if (!current) return null;
  const efforts = current.efforts;
  const currentEffort = efforts.find((e) => e.id === effort) ?? efforts.find((e) => e.isDefault) ?? efforts[0];
  return (
    <>
      <Menu
        value={current.id}
        placeholder="Buscar modelo…"
        options={models.map((m) => ({ value: m.id, label: shortModel(m.name), icon: <Cpu size={13} /> }))}
        onChange={(id) => {
          const next = models.find((m) => m.id === id)!;
          const keep = next.efforts.find((e) => e.id === currentEffort?.id) ?? next.efforts.find((e) => e.isDefault) ?? next.efforts[0];
          onChange({ model: id, effort: keep?.id ?? "" });
        }}
        className="mode-trigger"
      >
        <Cpu size={12} /> {shortModel(current.name)}
      </Menu>
      {currentEffort && (
        <Menu
          value={currentEffort.id}
          options={efforts.map((e) => ({ value: e.id, label: e.label, icon: <Gauge size={13} /> }))}
          onChange={(id) => onChange({ model: current.id, effort: id })}
          className={`mode-trigger ${currentEffort.id === "ultracode" ? "ultra" : ""}`}
        >
          <Gauge size={12} /> {currentEffort.label}
        </Menu>
      )}
    </>
  );
}

const commandCache = new Map<string, Promise<SlashCommand[]>>();
const loadCommands = (cwd?: string) => {
  const key = cwd ?? "";
  if (!commandCache.has(key)) commandCache.set(key, chatApi.commands(cwd).catch(() => []));
  return commandCache.get(key)!;
};

const SOURCE_LABEL: Record<SlashCommand["source"], string> = { project: "proyecto", user: "personal", plugin: "plugin", builtin: "Claude Code" };

/** Like the CLI: typing `/` at the start opens the commands and skills this session can run. */
function SlashMenu({ query, commands, active, onPick, onHover }: { query: string; commands: SlashCommand[]; active: number; onPick: (c: SlashCommand) => void; onHover: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(".slash-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="slash-menu" ref={list} onMouseDown={(e) => e.preventDefault()}>
      {commands.length ? (
        commands.map((c, i) => (
          <button key={c.name} className={`slash-item ${i === active ? "active" : ""}`} onMouseEnter={() => onHover(i)} onClick={() => onPick(c)}>
            <span className="slash-name">/{c.name}</span>
            <span className="slash-desc">{c.description}</span>
            <span className="slash-source">{SOURCE_LABEL[c.source]}</span>
          </button>
        ))
      ) : (
        <div className="menu-empty">Ningún comando empieza con “/{query}”</div>
      )}
    </div>
  );
}

function filterCommands(all: SlashCommand[], query: string) {
  const q = query.toLowerCase();
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = all.filter((c) => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)));
  return [...starts, ...contains].slice(0, 60);
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
  commandsCwd,
  draftKey,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  running?: boolean;
  onSend: (text: string, attachments: Attachment[]) => Promise<void> | void;
  onStop?: () => void;
  footer?: React.ReactNode;
  autoFocus?: boolean;
  commandsCwd?: string;
  /** When set, the unsent text survives navigation and reloads (localStorage). */
  draftKey?: string;
}) {
  const [text, setText] = useState(() => (draftKey ? localStorage.getItem(`ws-draft-${draftKey}`) ?? "" : ""));
  useEffect(() => {
    if (!draftKey) return;
    if (text) localStorage.setItem(`ws-draft-${draftKey}`, text);
    else localStorage.removeItem(`ws-draft-${draftKey}`);
  }, [draftKey, text]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [allCommands, setAllCommands] = useState<SlashCommand[]>([]);
  const [slashActive, setSlashActive] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashQuery = text.match(/^\/(\S*)$/)?.[1];
  const slashOpen = slashQuery !== undefined && !slashDismissed && !disabled;
  const slashResults = useMemo(() => (slashQuery !== undefined ? filterCommands(allCommands, slashQuery) : []), [allCommands, slashQuery]);

  useEffect(() => {
    if (slashQuery !== undefined) void loadCommands(commandsCwd).then(setAllCommands);
  }, [slashQuery !== undefined, commandsCwd]);
  useEffect(() => {
    setSlashActive(0);
    if (slashQuery === undefined) setSlashDismissed(false);
  }, [slashQuery]);

  const pickCommand = (c: SlashCommand) => {
    setText(`/${c.name} `);
    ref.current?.focus();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setDrafts((d) => [...d, { key, file, preview }]);
      chatApi.upload(file).then(
        (uploaded) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, uploaded } : x))),
        (e: Error) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, error: e.message } : x))),
      );
    }
  };

  const uploading = drafts.some((d) => !d.uploaded && !d.error);
  const ready = drafts.filter((d) => d.uploaded).map((d) => d.uploaded!);

  const submit = async () => {
    const value = text.trim();
    if ((!value && !ready.length) || sending || disabled || uploading) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value || "Mirá los archivos adjuntos.", ready);
      // onSend may navigate away (new session) and unmount before the effect clears the draft.
      if (draftKey) localStorage.removeItem(`ws-draft-${draftKey}`);
      setText("");
      drafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
      setDrafts([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  return (
    <div
      className={`composer ${disabled ? "disabled" : ""} ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      {disabledReason && <div className="composer-notice">{disabledReason}</div>}
      {error && <div className="composer-error">{error}</div>}
      {slashOpen && <SlashMenu query={slashQuery!} commands={slashResults} active={slashActive} onPick={pickCommand} onHover={setSlashActive} />}
      {drafts.length > 0 && (
        <div className="attachments">
          {drafts.map((d) => (
            <span key={d.key} className={`attachment ${d.error ? "error" : ""}`} title={d.error ?? d.file.name}>
              {d.preview ? <img src={d.preview} alt="" /> : <FileIcon size={14} />}
              <span className="attachment-name">{d.file.name || "imagen pegada"}</span>
              {!d.uploaded && !d.error && <Loader2 size={12} className="spin" />}
              <button onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))} title="Quitar">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (slashOpen && slashResults.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSlashActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + slashResults.length) % slashResults.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
              e.preventDefault();
              pickCommand(slashResults[slashActive]);
              return;
            }
          }
          if (slashOpen && e.key === "Escape") {
            e.preventDefault();
            setSlashDismissed(true);
            return;
          }
          // On phones Enter is a new line (there's no Shift); the send button sends.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !TOUCH) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && running && onStop) onStop();
        }}
      />
      <div className="composer-bar">
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
        <button className="icon-btn tiny" onClick={() => fileInput.current?.click()} title="Adjuntar archivos (también podés pegar o arrastrar)" disabled={disabled}>
          <Paperclip size={14} />
        </button>
        {footer}
        <span className="spacer" />
        {running && onStop && (
          <button className="composer-stop" onClick={onStop} title="Interrumpir (Esc)">
            <Square size={11} fill="currentColor" />
          </button>
        )}
        <button className="composer-send" onClick={submit} disabled={(!text.trim() && !ready.length) || sending || disabled || uploading} title="Enviar (Enter)">
          {sending ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}

const TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

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

type Question = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] };

const RECOMMENDED = /\s*\((recommended|recomendad[ao])\)\s*$/i;

/** AskUserQuestion as clickable options (one question per step) instead of a raw permission prompt. */
function QuestionCard({ sessionId, request, onAnswered }: { sessionId: string; request: PendingPermission; onAnswered: (s: ChatState) => void }) {
  const questions = ((request.input as { questions?: Question[] }).questions ?? []).filter((q) => q?.question && Array.isArray(q.options));
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answerFor = (q: Question) => [...(picked[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question].trim()] : [])].join(", ");
  const done = questions.every((q) => answerFor(q));
  const q = questions[step];

  const send = async (allow: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const answers = Object.fromEntries(questions.map((x) => [x.question, answerFor(x)]));
      onAnswered(await chatApi.answer(sessionId, request.id, allow ? { allow, answers } : { allow, message: "El usuario prefirió no responder estas preguntas" }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const pick = (label: string) => {
    if (q.multiSelect) {
      setPicked((p) => {
        const cur = p[q.question] ?? [];
        return { ...p, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      });
      return;
    }
    setPicked((p) => ({ ...p, [q.question]: [label] }));
    setOther((o) => ({ ...o, [q.question]: "" }));
    if (step < questions.length - 1) setStep(step + 1);
  };

  if (!q) return <PermissionCard sessionId={sessionId} request={request} onAnswered={onAnswered} />;
  const selected = picked[q.question] ?? [];
  const last = step === questions.length - 1;

  return (
    <div className="question-card">
      <div className="question-head">
        <CircleHelp size={14} />
        <span>Claude te pregunta</span>
        {questions.length > 1 && (
          <span className="question-steps">
            {questions.map((x, i) => (
              <button key={x.question} className={`question-step ${i === step ? "active" : ""} ${answerFor(x) ? "done" : ""}`} onClick={() => setStep(i)} title={x.question}>
                {answerFor(x) && <Check size={11} />}
                {x.header || `${i + 1}`}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="question-text">{q.question}</div>
      {q.multiSelect && <div className="question-hint">Podés elegir varias</div>}
      <div className="question-options">
        {q.options.map((o, i) => {
          const on = selected.includes(o.label);
          return (
            <button key={o.label} className={`question-option ${on ? "on" : ""}`} disabled={busy} onClick={() => pick(o.label)}>
              <span className={`question-mark ${q.multiSelect ? "multi" : ""}`}>{on ? <Check size={11} /> : i + 1}</span>
              <span className="question-option-body">
                <span className="question-option-label">
                  {o.label.replace(RECOMMENDED, "")}
                  {RECOMMENDED.test(o.label) && <span className="question-badge">Recomendada</span>}
                </span>
                {o.description && <span className="question-option-desc">{o.description}</span>}
              </span>
            </button>
          );
        })}
        <input
          className="question-other"
          placeholder="Otra respuesta…"
          value={other[q.question] ?? ""}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            setOther((o) => ({ ...o, [q.question]: value }));
            if (!q.multiSelect && value) setPicked((p) => ({ ...p, [q.question]: [] }));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !answerFor(q)) return;
            if (!last) setStep(step + 1);
            else if (done) void send(true);
          }}
        />
      </div>
      {error && <div className="composer-error">{error}</div>}
      <div className="permission-actions">
        <button className="btn ghost" disabled={busy} onClick={() => send(false)}>
          No responder
        </button>
        <span className="spacer" />
        {!last && (
          <button className="btn ghost" disabled={busy || !answerFor(q)} onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        )}
        {(last || done) && (
          <button className="btn primary" disabled={busy || !done} onClick={() => send(true)}>
            {busy ? <Loader2 size={13} className="spin" /> : "Responder"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Live feed + permission prompts + composer for one session. Used in the task tab and in Agents. */
export function SessionChat({ sessionId, summary }: { sessionId: string; summary?: SessionSummary }) {
  const feed = useSessionFeed(sessionId);
  const [chat, setChat] = useChatState(sessionId);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const { models, stored, remember } = useChatDefaults();
  const [config, setConfig] = useState<{ model?: string; effort?: string; permissionMode?: PermissionMode }>(stored);
  useEffect(() => {
    if (chat?.live) setConfig((c) => ({ model: chat.model ?? c.model, effort: chat.effort ?? c.effort, permissionMode: chat.permissionMode ?? c.permissionMode }));
  }, [chat?.live, chat?.model, chat?.effort, chat?.permissionMode]);

  const changeConfig = async (next: { model?: string; effort?: string; permissionMode?: PermissionMode }) => {
    setConfig((c) => ({ ...c, ...next }));
    remember(next);
    if (chat?.live) setChat(await chatApi.configure(sessionId, next));
  };
  const [cwdOverride, setCwdOverride] = useState<string | null>(null);
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  useEffect(() => {
    if (summary?.projectId) void chatApi.projectWorktrees(summary.projectId).then(setWorktrees, () => setWorktrees([]));
  }, [summary?.projectId]);
  const currentCwd = cwdOverride ?? summary?.focusCwd ?? chat?.cwd ?? summary?.firstCwd ?? summary?.cwd ?? undefined;
  const changeCwd = async (next: string) => {
    setCwdError(null);
    try {
      const res = await chatApi.setCwd(sessionId, next);
      setCwdOverride(res.cwd);
    } catch (e) {
      setCwdError(e instanceof Error ? e.message : String(e));
    }
  };
  const promptCount = feed.events.filter((e) => e.kind === "prompt").length;
  const sentAt = useRef(promptCount);

  useEffect(() => {
    if (pendingText && promptCount > sentAt.current) setPendingText(null);
  }, [promptCount, pendingText]);

  const live = Boolean(chat?.live);
  const running = live ? chat!.state !== "idle" : summary?.status === "working";
  const busyElsewhere = !live && summary?.status === "working";

  const send = async (text: string, attachments: Attachment[]) => {
    sentAt.current = promptCount;
    setPendingText(text);
    try {
      setChat(await chatApi.send(sessionId, text, { ...config, attachments }));
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
        {chat?.pending.map((p) =>
          p.toolName === "AskUserQuestion" ? (
            <QuestionCard key={p.id} sessionId={sessionId} request={p} onAnswered={setChat} />
          ) : (
            <PermissionCard key={p.id} sessionId={sessionId} request={p} onAnswered={setChat} />
          ),
        )}
        {chat?.error && <div className="composer-error">La sesión terminó con un error: {chat.error}</div>}
        <Composer
          draftKey={`session-${sessionId}`}
          placeholder={running ? "Mandale otro mensaje (se encola)…" : "Escribile a esta sesión…"}
          disabled={busyElsewhere}
          disabledReason={busyElsewhere ? "Esta sesión está trabajando en otra app. Cuando quede en pausa, podés seguirla desde acá." : undefined}
          running={running && live}
          commandsCwd={currentCwd}
          onSend={send}
          onStop={() => void chatApi.interrupt(sessionId).then(setChat)}
          footer={
            <>
              <ModelPicker models={models} model={config.model} effort={config.effort} onChange={changeConfig} />
              <PermissionMenu value={config.permissionMode ?? "bypassPermissions"} onChange={(permissionMode) => changeConfig({ permissionMode })} />
              {currentCwd && (
                <Menu
                  value={currentCwd}
                  placeholder="Buscar carpeta o rama, o escribí una ruta (/… o ~/…)"
                  options={worktrees.map((w) => ({ value: w.path, label: worktreeLabel(w), icon: <FolderGit2 size={13} /> }))}
                  custom={(q) => (/^[/~]/.test(q) ? { value: q, label: `Usar carpeta ${q}`, icon: <Folder size={13} /> } : null)}
                  onChange={(next) => void changeCwd(next)}
                  className="mode-trigger"
                >
                  <FolderGit2 size={12} /> <span title={currentCwd}>{currentCwd.split("/").slice(-2).join("/")}</span>
                </Menu>
              )}
              {cwdError && <span className="composer-hint">{cwdError}</span>}
              {!live && <span className="composer-hint">{summary ? "Se retoma al enviar" : ""}</span>}
            </>
          }
        />
      </div>
    </div>
  );
}

const worktreeLabel = (w: Worktree) => (w.root ? `${w.repo} (raíz)` : `${w.repo} · ${w.branch}`);

/** Starts a session for a task (with its context) or a standalone one in any project folder. */
export function NewSession({ task }: { task?: Task }) {
  const { projects, project } = useApp();
  const [projectId, setProjectId] = useState<string>("");
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const { models, stored, remember } = useChatDefaults();
  const [config, setConfig] = useState<{ model?: string; effort?: string; permissionMode?: PermissionMode }>(stored);
  const updateConfig = (next: { model?: string; effort?: string; permissionMode?: PermissionMode }) => {
    setConfig((c) => ({ ...c, ...next }));
    remember(next);
  };

  useEffect(() => {
    if (task || projectId || !projects.length) return;
    setProjectId(projects.some((p) => p.id === project) ? project : projects[0].id);
  }, [task, projectId, projects, project]);

  useEffect(() => {
    const load = task ? chatApi.worktrees(task.id) : projectId ? chatApi.projectWorktrees(projectId) : null;
    load?.then((list) => {
      setWorktrees(list);
      setCwd(list[0]?.path ?? "");
    });
  }, [task, projectId]);

  const selected = worktrees.find((w) => w.path === cwd);
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="new-session">
      <div className="new-session-inner">
        <div className="new-session-icon">
          <Bot size={22} />
        </div>
        <h2>{task ? `Nueva sesión en ${task.id}` : "Nueva sesión"}</h2>
        <p>
          {task
            ? "Claude arranca con el contexto de la tarea (resumen, PRs y boards) y trabaja en la carpeta que elijas. Va a aparecer en vivo en esta pestaña y en Agentes."
            : "Una sesión suelta, sin tarea. Elegí el proyecto y la carpeta; si después querés, la vinculás a una tarea desde la propia sesión."}
        </p>
        <Composer
          autoFocus
          draftKey={`new-${task?.id ?? "free"}`}
          commandsCwd={cwd || undefined}
          placeholder={task ? "¿Qué hacemos? Ej: revisá los 3 must-fix del board de testeo y arreglalos…" : "¿Qué hacemos?"}
          onSend={async (prompt, attachments) => {
            const state = await chatApi.start({ taskId: task?.id, cwd, prompt, ...config, attachments });
            navigate(task ? href.taskSession(task.id, state.sessionId) : href.session(state.sessionId));
          }}
          footer={
            <>
              <ModelPicker
                models={models}
                model={config.model}
                effort={config.effort}
                onChange={updateConfig}
              />
              <PermissionMenu value={config.permissionMode ?? "bypassPermissions"} onChange={(permissionMode) => updateConfig({ permissionMode })} />
              {!task && (
                <Menu
                  value={projectId}
                  placeholder="Buscar proyecto…"
                  options={projects.map((p) => ({ value: p.id, label: p.title, icon: <ProjectIcon project={p} size={14} /> }))}
                  onChange={setProjectId}
                  className="mode-trigger"
                >
                  <ProjectIcon project={selectedProject} size={14} /> {selectedProject?.title ?? "…"}
                </Menu>
              )}
              <Menu
                value={cwd}
                placeholder="Buscar carpeta o rama, o escribí una ruta (/… o ~/…)"
                options={worktrees.map((w) => ({ value: w.path, label: worktreeLabel(w), icon: <FolderGit2 size={13} /> }))}
                custom={(q) => (/^[/~]/.test(q) ? { value: q, label: `Usar carpeta ${q}`, icon: <Folder size={13} /> } : null)}
                onChange={setCwd}
                className="mode-trigger"
              >
                <FolderGit2 size={12} /> {selected ? worktreeLabel(selected) : cwd ? cwd.split("/").slice(-2).join("/") : "…"}
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
  useEffect(() => {
    if (sessionId) rememberSession(sessionId, task.id);
  }, [sessionId, task.id]);
  useMarkSeen(current);
  const isUnread = useUnread();
  // Phones show one side at a time: the list, or the open session / new session with a way back.
  const mobile = useIsMobile();
  const [composing, setComposing] = useState(false);
  useEffect(() => setComposing(false), [sessionId]);
  const showList = !mobile || (!sessionId && !composing);
  const showPane = !mobile || Boolean(sessionId) || composing;
  const back = mobile && (
    <a className="session-back" href={href.taskSession(task.id)} onClick={() => setComposing(false)}>
      <ChevronLeft size={16} /> Sesiones
    </a>
  );

  return (
    <div className="task-sessions">
      {showList && (
      <aside className="session-list">
        <a
          className={`session-new ${!sessionId && !mobile ? "active" : ""}`}
          href={href.taskSession(task.id)}
          onClick={(e) => {
            if (!mobile) return;
            e.preventDefault();
            setComposing(true);
          }}
        >
          <Plus size={14} /> Nueva sesión
        </a>
        <div className="prop-title session-list-title">Sesiones · {linked.length}</div>
        {linked.map((s) => (
          <a key={s.id} className={`session-item ${s.id === sessionId ? "active" : ""} ${isUnread(s) ? "unread" : ""}`} href={href.taskSession(task.id, s.id)}>
            <StatusDot status={isUnread(s) ? "unread" : s.status} size={7} />
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
      )}
      {showPane && (
      <section className="session-pane">
        {sessionId ? (
          <>
            <header className="session-pane-head">
              {back}
              <StatusDot status={current?.status ?? "inactive"} size={7} />
              <span className="session-pane-title">{current?.title ?? "Sesión"}</span>
              <span className="spacer" />
              <SendToGroup sessionId={sessionId} title={current?.title} className="link-btn" />
              <a className="link-btn" href={href.session(sessionId)}>
                Ver en Agentes
              </a>
            </header>
            <SessionChat key={sessionId} sessionId={sessionId} summary={current} />
          </>
        ) : (
          <>
            {back && <header className="session-pane-head">{back}</header>}
            <NewSession task={task} />
          </>
        )}
      </section>
      )}
    </div>
  );
}
