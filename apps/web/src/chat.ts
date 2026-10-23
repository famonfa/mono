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
export type ChatConfig = { model?: string; effort?: string; permissionMode?: PermissionMode; attachments?: Attachment[] };

export type SlashCommand = { name: string; description: string; source: "project" | "user" | "plugin" | "builtin"; kind: "skill" | "command"; path?: string };
export type SkillDetail = SlashCommand & { path: string; body: string; files: string[] };

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
  configure: (sessionId: string, config: { model?: string; effort?: string; permissionMode?: PermissionMode }) => call<ChatState>(`/api/chats/${enc(sessionId)}/config`, config),
  models: () => call<ModelOption[]>("/api/models"),
  commands: (cwd?: string) => call<SlashCommand[]>(`/api/commands${cwd ? `?cwd=${enc(cwd)}` : ""}`),
  skill: (name: string, cwd?: string) => call<SkillDetail>(`/api/commands?name=${enc(name)}${cwd ? `&cwd=${enc(cwd)}` : ""}`),
  upload: async (file: File): Promise<Attachment> => {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return call<Attachment>("/api/uploads", { name: file.name || "pasted.png", type: file.type, data });
  },
  setCwd: (sessionId: string, cwd: string) => call<{ sessionId: string; cwd: string }>(`/api/chats/${enc(sessionId)}/cwd`, { cwd }),
  interrupt: (sessionId: string) => call<ChatState>(`/api/chats/${enc(sessionId)}/interrupt`, {}),
  answer: (sessionId: string, requestId: string, decision: { allow: boolean; always?: boolean; message?: string; answers?: Record<string, string> }) =>
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
const MODE_KEY = "ws-chat-mode";

export const PERMISSION_MODES: { id: PermissionMode; label: string; description: string }[] = [
  { id: "bypassPermissions", label: "Full access", description: "Never asks" },
  { id: "acceptEdits", label: "Accept edits", description: "Edits freely; asks before commands" },
  { id: "default", label: "Ask first", description: "Asks before editing or running" },
  { id: "plan", label: "Plan only", description: "Proposes, changes nothing" },
];

/** Last model/effort picked in a composer, reused as the default for new sessions. */
export function useChatDefaults() {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    chatApi.models().then(setModels, () => {});
  }, []);
  const stored = {
    model: localStorage.getItem(MODEL_KEY) ?? undefined,
    effort: localStorage.getItem(EFFORT_KEY) ?? undefined,
    permissionMode: (localStorage.getItem(MODE_KEY) as PermissionMode | null) ?? "bypassPermissions",
  };
  const remember = (config: { model?: string; effort?: string; permissionMode?: PermissionMode }) => {
    if (config.model) localStorage.setItem(MODEL_KEY, config.model);
    if (config.effort) localStorage.setItem(EFFORT_KEY, config.effort);
    if (config.permissionMode) localStorage.setItem(MODE_KEY, config.permissionMode);
  };
  return { models, stored, remember };
}
