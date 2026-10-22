import { useSyncExternalStore } from "react";
import { onServerEvent } from "./events";

export type GroupPane = { sessionId: string; title?: string; x: number; y: number; w: number; h: number };

export type SessionGroup = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  panes: GroupPane[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? res.statusText);
  return body as T;
}

const enc = encodeURIComponent;

export const groupsApi = {
  list: () => request<SessionGroup[]>("/api/groups"),
  create: (name: string, sessions: { sessionId: string; title?: string }[] = []) =>
    request<SessionGroup>("/api/groups", { method: "POST", body: JSON.stringify({ name, sessions }) }),
  update: (id: string, patch: { name?: string; panes?: GroupPane[] }) =>
    request<SessionGroup>(`/api/groups/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  remove: (id: string) => request(`/api/groups/${enc(id)}`, { method: "DELETE" }),
  addSession: (id: string, sessionId: string, title?: string) =>
    request<SessionGroup>(`/api/groups/${enc(id)}/sessions`, { method: "POST", body: JSON.stringify({ sessionId, title }) }),
  removeSession: (id: string, sessionId: string) => request<SessionGroup>(`/api/groups/${enc(id)}/sessions/${enc(sessionId)}`, { method: "DELETE" }),
};

let snapshot: SessionGroup[] | null = null;
const subscribers = new Set<() => void>();

export function reloadGroups() {
  groupsApi.list().then(
    (groups) => {
      snapshot = groups;
      for (const notify of subscribers) notify();
    },
    () => {},
  );
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (snapshot === null && subscribers.size === 1) reloadGroups();
  return () => void subscribers.delete(notify);
}

onServerEvent("ws:groups", reloadGroups);

/** All session groups, kept fresh by the `ws:groups` event (fired for app and CLI writes alike). */
export function useGroups() {
  return useSyncExternalStore(subscribe, () => snapshot) ?? [];
}
