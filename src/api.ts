import { useCallback, useEffect, useState } from "react";
import type { Board, Task } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? res.statusText);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  listTasks: () => request<Task[]>("/api/tasks"),
  getTask: (id: string) => request<Task>(`/api/tasks/${enc(id)}`),
  createTask: (task: Partial<Task> & { id: string }) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(task) }),
  saveTask: (id: string, patch: Partial<Task>) => request<Task>(`/api/tasks/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  trashTask: (id: string) => request(`/api/tasks/${enc(id)}`, { method: "DELETE" }),
  getBoard: (id: string, boardId: string) => request<Board>(`/api/tasks/${enc(id)}/boards/${enc(boardId)}`),
  saveBoard: (id: string, board: Board) => request<Board>(`/api/tasks/${enc(id)}/boards/${enc(board.id)}`, { method: "PUT", body: JSON.stringify(board) }),
  deleteBoard: (id: string, boardId: string) => request(`/api/tasks/${enc(id)}/boards/${enc(boardId)}`, { method: "DELETE" }),
  getDoc: (id: string, name: string) => request<{ content: string }>(`/api/tasks/${enc(id)}/docs/${enc(name)}`),
  saveDoc: (id: string, name: string, content: string) => request(`/api/tasks/${enc(id)}/docs/${enc(name)}`, { method: "PUT", body: JSON.stringify({ content }) }),
};

export function fileUrl(taskId: string, relPath: string) {
  if (/^(https?:|data:|\/)/.test(relPath)) return relPath;
  return `/files/${enc(taskId)}/${relPath.replace(/^\.?\//, "")}`;
}

/** Re-runs `load` whenever the AI (or anything else) writes into the given task's folder. */
export function useLiveData<T>(load: () => Promise<T>, deps: unknown[], taskId?: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load().then(
      (value) => {
        setData(value);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, deps);

  useEffect(reload, [reload]);
  useEffect(() => onDataChange((tasks) => (!taskId || tasks.includes(taskId)) && reload()), [reload, taskId]);
  return { data, error, reload, setData };
}

type Listener = (tasks: string[]) => void;
const listeners = new Set<Listener>();

export function onDataChange(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notifyDataChange(tasks: string[]) {
  for (const listener of listeners) listener(tasks);
}

if (import.meta.hot) {
  import.meta.hot.on("ws:data", (payload: { tasks: string[] }) => notifyDataChange(payload.tasks));
}
