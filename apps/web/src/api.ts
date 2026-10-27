import { useCallback, useEffect, useState } from "react";
import { onServerEvent } from "./events";
import type { Activity, Board, FigmaFrame, FolderListing, PageContent, Project, SearchHit, Task } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error ?? res.statusText), { code: body?.code as string | undefined });
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  listTasks: () => request<Task[]>("/api/tasks"),
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${enc(q)}`),
  // A server started before the rename only knows /api/projects (the web build is served live, the server isn't).
  listProjects: () => request<Project[]>("/api/repos").catch(() => request<Project[]>("/api/projects")),
  saveProject: (id: string, patch: { title?: string; color?: string }) => request<Project>(`/api/repos/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  addProject: (path: string) => request<Project>("/api/repos", { method: "POST", body: JSON.stringify({ path }) }),
  removeProject: (id: string) => request(`/api/repos/${enc(id)}`, { method: "DELETE" }),
  listFolder: (dir: string) => request<FolderListing>(`/api/folders?dir=${enc(dir)}`),
  suggestedRepos: () => request<{ name: string; path: string }[]>("/api/folders/suggested"),
  getTask: (id: string) => request<Task>(`/api/tasks/${enc(id)}`),
  activity: (id: string) => request<Activity>(`/api/tasks/${enc(id)}/activity`),
  createTask: (task: Partial<Task> & { id: string }) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(task) }),
  saveTask: (id: string, patch: Partial<Task>) => request<Task>(`/api/tasks/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  trashTask: (id: string) => request(`/api/tasks/${enc(id)}`, { method: "DELETE" }),
  getBoard: (id: string, boardId: string) => request<Board>(`/api/tasks/${enc(id)}/boards/${enc(boardId)}`),
  saveBoard: (id: string, board: Board) => request<Board>(`/api/tasks/${enc(id)}/boards/${enc(board.id)}`, { method: "PUT", body: JSON.stringify(board) }),
  undoDoc: (id: string, pageId: string) => request<{ restored: string; remaining: number }>(`/api/tasks/${enc(id)}/docs/${enc(pageId)}/undo`, { method: "POST", body: "{}" }),
  undoBoard: (id: string, boardId: string) => request<{ restored: string; remaining: number }>(`/api/tasks/${enc(id)}/boards/${enc(boardId)}/undo`, { method: "POST", body: "{}" }),
  deleteBoard: (id: string, boardId: string) => request(`/api/tasks/${enc(id)}/boards/${enc(boardId)}`, { method: "DELETE" }),
  figmaStatus: (id: string) => request<{ hasToken: boolean }>(`/api/tasks/${enc(id)}/designs/figma`),
  importFigma: (id: string, url: string, token?: string) => request<FigmaFrame[]>(`/api/tasks/${enc(id)}/designs/figma`, { method: "POST", body: JSON.stringify({ url, token }) }),
  getPage: (id: string, pageId: string) => request<PageContent>(`/api/tasks/${enc(id)}/pages/${enc(pageId)}`),
  saveFolder: (id: string, pageId: string, title?: string) => request<PageContent>(`/api/tasks/${enc(id)}/pages/${enc(pageId)}`, { method: "PUT", body: JSON.stringify({ title }) }),
  movePage: (id: string, pageId: string, to: string) => request<{ id: string }>(`/api/tasks/${enc(id)}/pages/${enc(pageId)}/move`, { method: "POST", body: JSON.stringify({ to }) }),
  trashPage: (id: string, pageId: string) => request(`/api/tasks/${enc(id)}/pages/${enc(pageId)}`, { method: "DELETE" }),
  setPageOrder: (id: string, parent: string | null, order: string[]) => request(`/api/tasks/${enc(id)}/order`, { method: "PUT", body: JSON.stringify({ parent, order }) }),
  saveAsset: (id: string, name: string, data: string) => request<{ path: string }>(`/api/tasks/${enc(id)}/assets`, { method: "POST", body: JSON.stringify({ name, data }) }),
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

onServerEvent("ws:data", (payload: { tasks: string[] }) => notifyDataChange(payload.tasks));
