import { useEffect, useState } from "react";
import { onServerEvent } from "./events";

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export type PendingPermission = {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  blockedPath?: string;
  canAlwaysAllow: boolean;
};

export type ChatState = {
  sessionId: string;
  live: boolean;
  state: "idle" | "running" | "requires_action";
  permissionMode?: PermissionMode;
  cwd?: string;
  taskId?: string;
  pending: PendingPermission[];
  error?: string;
  model?: string;
  effort?: string;
};

export type Attachment = { path: string; name: string; type: string; size: number };
export type ModelOption = { id: string; name: string; efforts: { id: string; label: string; isDefault: boolean }[] };
export type ChatConfig = { model?: string; effort?: string; attachments?: Attachment[] };

export type Worktree = { path: string; repo: string; branch: string | null; root?: boolean };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? res.statusText);
  return json as T;
}

const enc = encodeURIComponent;

export const chatApi = {
  start: (input: { taskId?: string; cwd?: string; prompt: string } & ChatConfig) => call<ChatState>("/api/chats", input),
  send: (sessionId: string, text: string, config: ChatConfig = {}) => call<ChatState>(`/api/chats/${enc(sessionId)}/messages`, { text, ...config }),
  configure: (sessionId: string, config: { model?: string; effort?: string }) => call<ChatState>(`/api/chats/${enc(sessionId)}/config`, config),
  models: () => call<ModelOption[]>("/api/models"),
  upload: async (file: File): Promise<Attachment> => {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return call<Attachment>("/api/uploads", { name: file.name || "pegado.png", type: file.type, data });
  },
  interrupt: (sessionId: string) => call<ChatState>(`/api/chats/${enc(sessionId)}/interrupt`, {}),
  answer: (sessionId: string, requestId: string, decision: { allow: boolean; always?: boolean; message?: string }) =>
    call<ChatState>(`/api/chats/${enc(sessionId)}/permissions/${enc(requestId)}`, decision),
  state: (sessionId: string) => call<ChatState>(`/api/chats/${enc(sessionId)}`),
  worktrees: (taskId: string) => call<Worktree[]>(`/api/tasks/${enc(taskId)}/worktrees`),
  projectWorktrees: (projectId: string) => call<Worktree[]>(`/api/projects/${enc(projectId)}/worktrees`),
};

export function useChatState(sessionId: string) {
  const [state, setState] = useState<ChatState | null>(null);
  useEffect(() => {
    let cancelled = false;
    chatApi.state(sessionId).then((s) => !cancelled && setState(s), () => {});
    const off = onServerEvent("ws:chat", (payload: { sessionId: string; state: ChatState }) => {
      if (payload.sessionId === sessionId) setState(payload.state);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);
  return [state, setState] as const;
}


export const uploadUrl = (path: string) => `/api/uploads/file?path=${encodeURIComponent(path)}`;

const MODEL_KEY = "ws-chat-model";
const EFFORT_KEY = "ws-chat-effort";

/** Last model/effort picked in a composer, reused as the default for new sessions. */
export function useChatDefaults() {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    chatApi.models().then(setModels, () => {});
  }, []);
  const stored = { model: localStorage.getItem(MODEL_KEY) ?? undefined, effort: localStorage.getItem(EFFORT_KEY) ?? undefined };
  const remember = (config: { model?: string; effort?: string }) => {
    if (config.model) localStorage.setItem(MODEL_KEY, config.model);
    if (config.effort) localStorage.setItem(EFFORT_KEY, config.effort);
  };
  return { models, stored, remember };
}
