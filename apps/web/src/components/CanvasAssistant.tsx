import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ExternalLink, Loader2, MousePointer2, RotateCcw, Sparkles, Square, TextCursor, Undo2 } from "lucide-react";
import { api } from "../api";
import { chatApi, useChatDefaults, useChatState } from "../chat";
import { href } from "../router";
import { useSessionFeed } from "../sessions";
import type { Task } from "../types";

type SelectedNode = { id: string; label: string };

/** What the bar edits: a canvas (with the nodes selected on it) or a doc (with the text selected in it). */
export type AssistantTarget = { kind: "board"; id: string; selected: SelectedNode[] } | { kind: "doc"; id: string; selection: string };

function canvasPrompt(task: Task, boardId: string, request: string, selected: SelectedNode[]) {
  return [
    request,
    "",
    "---",
    `Context: you're editing board \`${boardId}\` of project ${task.id} ("${task.title}") in Mono. The user is watching it live.`,
    `- Read it with \`ws get ${task.id} ${boardId}\`.`,
    `- Apply the request by writing a JSON file with the new or changed nodes and loading it with \`ws board ${task.id} ${boardId} <file> --patch\` (reuse existing ids; the canvas updates itself).`,
    "- To delete nodes, send the full board without --patch (nodes created or edited by hand are kept anyway).",
    "- Use the workspace skill format (short labels, status, test, etc.). To put a node in a lane, set its name in `lane`; don't create lane nodes or set parentId or position (the app handles layout). Don't touch repos.",
    `- Design frames: for a Figma link run \`ws figma ${task.id} ${boardId} <url> [--lane <name>]\`. For a .pen file (Pencil), export the frames to PNG with the Pencil MCP, copy them with \`ws asset ${task.id} <png...>\`, and add nodes \`{ "type": "design", "label", "image": "assets/<name>.png", "design": { "source": "pen", "file": "<absolute .pen path>", "nodeId": "<frame id>" } }\`.`,
    selected.length ? `- Nodes selected by the user: ${selected.map((n) => `\`${n.id}\` ("${n.label}")`).join(", ")}.` : null,
    "- End with a single line saying what you changed.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function docPrompt(task: Task, pageId: string, request: string, selection: string) {
  return [
    request,
    "",
    "---",
    `Context: you're editing doc \`${pageId}\` of project ${task.id} ("${task.title}") in Mono. The user is watching it live.`,
    `- Read it with \`ws get ${task.id} ${pageId}\` (markdown).`,
    `- Apply the request by writing the whole updated markdown to a file and saving it with \`ws doc ${task.id} ${pageId} <file>\`; the page updates itself and the user can undo it.`,
    "- Keep the first `# Title` line and everything the request doesn't touch. Plain markdown: headings, lists, `- [ ]` checklists, tables, quotes, code blocks. Write in the doc's language. Don't touch repos.",
    selection ? `- Text the user selected (the request is about it):\n\n${selection.split("\n").map((l) => `> ${l}`).join("\n")}` : null,
    "- End with a single line saying what you changed.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Chat bar over the canvas: requests go to one Claude session per board, which edits it through `ws`. */
export function CanvasAssistant({ task, boardId, selected }: { task: Task; boardId: string; selected: SelectedNode[] }) {
  return <PageAssistant task={task} target={{ kind: "board", id: boardId, selected }} />;
}

/** The same bar for any page: one Claude session per page, which edits it through `ws` while the user watches. */
export function PageAssistant({ task, target, onSent }: { task: Task; target: AssistantTarget; onSent?: () => void }) {
  const boardId = target.id;
  const selected = target.kind === "board" ? target.selected : [];
  const selection = target.kind === "doc" ? target.selection.trim() : "";
  const storageKey = `ws-${target.kind === "board" ? "canvas" : "doc"}-session:${task.id}/${boardId}`;
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
      const prompt = target.kind === "board" ? canvasPrompt(task, boardId, request, selected) : docPrompt(task, boardId, request, selection);
      if (sessionId) {
        await chatApi.send(sessionId, prompt, stored);
      } else {
        const state = await chatApi.start({ taskId: task.id, prompt, ...stored });
        setSessionId(state.sessionId);
      }
      setText("");
      onSent?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  return (
    <div className="canvas-assistant" onDoubleClick={(e) => e.stopPropagation()}>
      {sessionId && <AssistantStatus sessionId={sessionId} taskId={task.id} target={target} onReset={() => setSessionId(null)} />}
      {error && <div className="canvas-assistant-error">{error}</div>}
      <div className="canvas-assistant-bar">
        <Sparkles size={15} className="canvas-assistant-icon" />
        {selected.length > 0 && (
          <span className="canvas-assistant-chip" title={selected.map((n) => n.label).join("\n")}>
            <MousePointer2 size={11} /> {selected.length === 1 ? selected[0].label.slice(0, 24) : `${selected.length} nodes`}
          </span>
        )}
        {selection && (
          <span className="canvas-assistant-chip" title={selection}>
            <TextCursor size={11} /> {selection.length > 24 ? `${selection.slice(0, 24)}…` : selection}
          </span>
        )}
        <input
          ref={input}
          value={text}
          placeholder={selected.length || selection ? "What should change in the selection?" : `Ask Claude to edit this ${target.kind === "board" ? "canvas" : "doc"}…`}
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

function AssistantStatus({ sessionId, taskId, target, onReset }: { sessionId: string; taskId: string; target: AssistantTarget; onReset: () => void }) {
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const undo = async () => {
    try {
      const { remaining } = target.kind === "board" ? await api.undoBoard(taskId, target.id) : await api.undoDoc(taskId, target.id);
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
