import { useCallback, useEffect, useState } from "react";
import type { ShareRole, SharedItem } from "./account";

/** One shared scope of this Mac: a project, a folder of its pages, or one session, and who can open it. */
export type Share = Omit<SharedItem, "role" | "online" | "hostName"> & {
  general: { domain: string; role: ShareRole } | null;
  people: { email: string; role: ShareRole; createdAt: string }[];
};

export const ROLE_META: Record<ShareRole, { label: string; hint: string }> = {
  viewer: { label: "Viewer", hint: "Sees pages, canvases and sessions" },
  editor: { label: "Editor", hint: "Also edits pages and canvases" },
  agents: { label: "Editor + agents", hint: "Also runs agents on your Mac, only inside what you shared" },
};

/** On a shared session nobody edits: they watch it, or also continue it in a confined agent of their own. */
export const SESSION_ROLE_META: Partial<Record<ShareRole, { label: string; hint: string }>> = {
  viewer: { label: "Viewer", hint: "Watches the session live" },
  agents: { label: "Viewer + own agent", hint: "Can also continue it in an agent of their own, in a separate folder on your Mac" },
};

export const roleLabel = (role: ShareRole, session = false) => ((session ? SESSION_ROLE_META[role] : null) ?? ROLE_META[role]).label;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? res.statusText);
  return body as T;
}

const enc = encodeURIComponent;

export const sharesApi = {
  list: (projectId: string) => request<Share[]>(`/api/shares?project=${enc(projectId)}`),
  /** Finds or creates the share of exactly this scope (one link per project, folder or session). */
  ensure: (scope: { projectId?: string | null; pageId?: string | null; sessionId?: string | null }) => request<Share>("/api/shares", { method: "POST", body: JSON.stringify(scope) }),
  grant: (id: string, email: string, role: ShareRole) => request<Share>(`/api/shares/${enc(id)}/people`, { method: "POST", body: JSON.stringify({ email, role }) }),
  revoke: (id: string, email: string) => request<Share>(`/api/shares/${enc(id)}/people/${enc(email)}`, { method: "DELETE" }),
  setGeneral: (id: string, general: { domain: string; role: ShareRole } | null) => request<Share>(`/api/shares/${enc(id)}/general`, { method: "PUT", body: JSON.stringify({ general }) }),
  remove: (id: string) => request(`/api/shares/${enc(id)}`, { method: "DELETE" }),
  sharedWithMe: () => request<SharedItem[]>("/api/shared"),
};

/** A share counts as shared once someone besides you can open it. */
export const isShared = (share: Share) => share.people.length > 0 || Boolean(share.general);

const listeners = new Set<() => void>();
export const sharesChanged = () => listeners.forEach((fn) => fn());

/** The project's shares, for the tree's "shared" marks and the Share button; refreshed after any change. */
export function useProjectShares(projectId: string | undefined, enabled = true) {
  const [shares, setShares] = useState<Share[]>([]);
  const load = useCallback(() => {
    if (!projectId || !enabled) return setShares([]);
    sharesApi.list(projectId).then(setShares, () => setShares([]));
  }, [projectId, enabled]);
  useEffect(() => {
    load();
    listeners.add(load);
    return () => void listeners.delete(load);
  }, [load]);
  return shares;
}
