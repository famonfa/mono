import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ExternalLink, Loader2, MousePointer2, RotateCcw, Sparkles, Square, Undo2 } from "lucide-react";
import { api } from "../api";
import { chatApi, useChatDefaults, useChatState } from "../chat";
import { href } from "../router";
import { useSessionFeed } from "../sessions";
import type { Task } from "../types";

type SelectedNode = { id: string; label: string };

function canvasPrompt(task: Task, boardId: string, request: string, selected: SelectedNode[]) {
  return [
    request,
    "",
    "---",
    `Context: you're editing board \`${boardId}\` of task ${task.id} ("${task.title}") in Mono. The user is watching it live.`,
    `- Read it with \`ws get ${task.id} ${boardId}\`.`,
    `- Apply the request by writing a JSON file with the new or changed nodes and loading it with \`ws board ${task.id} ${boardId} <file> --patch\` (reuse existing ids; the canvas updates itself).`,
    "- To delete nodes, send the full board without --patch (nodes created or edited by hand are kept anyway).",
    "- Use the workspace skill format (short labels, status, test, etc.). To put a node in a lane, set its name in `lane`; don't create lane nodes or set parentId or position (the app handles layout). Don't touch repos.",
    selected.length ? `- Nodes selected by the user: ${selected.map((n) => `\`${n.id}\` ("${n.label}")`).join(", ")}.` : null,
    "- End with a single line saying what you changed.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Chat bar over the canvas: requests go to one Claude session per board, which edits it through `ws`. */
export function CanvasAssistant({ task, boardId, selected }: { task: Task; boardId: string; selected: SelectedNode[] }) {
  const storageKey = `ws-canvas-session:${task.id}/${boardId}`;
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { stored } = useChatDefaults();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionId) localStorage.setItem(storageKey, sessionId);
    else localStorage.removeItem(storageKey);
  }, [sessionId, storageKey]);

  const submit = async () => {
    const request = text.trim();
    if (!request || sending) return;
    setSending(true);
    setError(null);
    try {
      const prompt = canvasPrompt(task, boardId, request, selected);
      if (sessionId) {
        await chatApi.send(sessionId, prompt, stored);
      } else {
        const state = await chatApi.start({ taskId: task.id, prompt, ...stored });
        setSessionId(state.sessionId);
      }
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  return (
    <div className="canvas-assistant" onDoubleClick={(e) => e.stopPropagation()}>
      {sessionId && <AssistantStatus sessionId={sessionId} taskId={task.id} boardId={boardId} onReset={() => setSessionId(null)} />}
      {error && <div className="canvas-assistant-error">{error}</div>}
      <div className="canvas-assistant-bar">
        <Sparkles size={15} className="canvas-assistant-icon" />
        {selected.length > 0 && (
          <span className="canvas-assistant-chip" title={selected.map((n) => n.label).join("\n")}>
            <MousePointer2 size={11} /> {selected.length === 1 ? selected[0].label.slice(0, 24) : `${selected.length} nodes`}
          </span>
        )}
        <input
          ref={input}
          value={text}
          placeholder={selected.length ? "What should change in the selection?" : "Ask Claude to edit this canvas…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
          }}
        />
        <button className="composer-send" onClick={submit} disabled={!text.trim() || sending} title="Send (Enter)">
          {sending ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}

function AssistantStatus({ sessionId, taskId, boardId, onReset }: { sessionId: string; taskId: string; boardId: string; onReset: () => void }) {
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const undo = async () => {
    try {
      const { remaining } = await api.undoBoard(taskId, boardId);
      setUndoNote(remaining ? `Undone · ${remaining} ${remaining === 1 ? "version" : "versions"} left` : "Undone");
    } catch (e) {
      setUndoNote((e as Error).message);
    }
  };
  const [chat] = useChatState(sessionId);
  const feed = useSessionFeed(sessionId);
  const running = chat?.live ? chat.state !== "idle" : false;
  const lastTool = useMemo(() => [...feed.events].reverse().find((e) => e.kind === "tool"), [feed.events]);
  const lastText = useMemo(() => [...feed.events].reverse().find((e) => e.kind === "text"), [feed.events]);

  return (
    <div className="canvas-assistant-status">
      {running ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} className="done" />}
      <span className="canvas-assistant-msg">{undoNote ?? (running ? lastTool?.title || "Thinking…" : lastText?.text?.split("\n").filter(Boolean).pop() ?? "Done")}</span>
      {running && (
        <button className="icon-btn tiny" onClick={() => void chatApi.interrupt(sessionId)} title="Stop">
          <Square size={10} fill="currentColor" />
        </button>
      )}
      {!running && (
        <button className="icon-btn tiny" onClick={undo} title="Undo AI edit">
          <Undo2 size={12} />
        </button>
      )}
      <a className="icon-btn tiny" href={href.session(sessionId)} title="Open session">
        <ExternalLink size={12} />
      </a>
      <button className="icon-btn tiny" onClick={onReset} title="New conversation">
        <RotateCcw size={12} />
      </button>
    </div>
  );
}
