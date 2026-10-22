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
};

export type Worktree = { path: string; repo: string; branch: string | null; root?: boolean };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? res.statusText);
  return json as T;
}

const enc = encodeURIComponent;

export const chatApi = {
  start: (input: { taskId?: string; cwd?: string; prompt: string; permissionMode: PermissionMode }) => call<ChatState>("/api/chats", input),
  send: (sessionId: string, text: string, permissionMode?: PermissionMode) => call<ChatState>(`/api/chats/${enc(sessionId)}/messages`, { text, permissionMode }),
  interrupt: (sessionId: string) => call<ChatState>(`/api/chats/${enc(sessionId)}/interrupt`, {}),
  setMode: (sessionId: string, permissionMode: PermissionMode) => call<ChatState>(`/api/chats/${enc(sessionId)}/mode`, { permissionMode }),
  answer: (sessionId: string, requestId: string, decision: { allow: boolean; always?: boolean; message?: string }) =>
    call<ChatState>(`/api/chats/${enc(sessionId)}/permissions/${enc(requestId)}`, decision),
  state: (sessionId: string) => call<ChatState>(`/api/chats/${enc(sessionId)}`),
  worktrees: (taskId: string) => call<Worktree[]>(`/api/tasks/${enc(taskId)}/worktrees`),
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

export const MODE_LABEL: Record<PermissionMode, string> = {
  acceptEdits: "Pedir permiso",
  bypassPermissions: "Automático",
  default: "Pedir todo",
  plan: "Solo planear",
};
