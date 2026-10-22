import { useCallback, useEffect, useRef, useState } from "react";
import { onServerEvent } from "./events";

export type SessionStatus = "working" | "idle" | "inactive";

export type ToolAction = { tool: string; title: string; ts?: string };

export type SubagentSummary = {
  id: string;
  description: string;
  agentType?: string;
  status: SessionStatus;
  lastTs?: string;
  lastAction?: ToolAction | null;
  lastText?: string | null;
};

export type SessionSummary = {
  id: string;
  title: string;
  project: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  prLinks: string[];
  mentions: string[];
  firstTs?: string;
  lastTs?: string;
  status: SessionStatus;
  lastAction?: ToolAction | null;
  lastText?: string | null;
  lastPrompt?: string | null;
  turns: number;
  subagents: SubagentSummary[];
  taskIds?: string[];
  ownedByWorkspace?: boolean;
  projectId?: string | null;
  focusCwd?: string | null;
};

export type SessionEvent = {
  kind: "prompt" | "text" | "tool" | "result" | "notice";
  ts?: string;
  text?: string;
  id?: string;
  name?: string;
  title?: string;
  detail?: string;
  toolUseId?: string;
  isError?: boolean;
  agentId?: string;
  images?: number;
};

type SessionDetail = { session: SessionSummary; events: SessionEvent[]; cursor: number; truncated: boolean };

export type RefreshJob = { status: "never" | "running" | "done" | "failed"; startedAt?: string; finishedAt?: string; output?: string };

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  return res.json();
}

export const sessionsApi = {
  list: (days = 3) => get<SessionSummary[]>(`/api/sessions?days=${days}`),
  detail: (id: string, opts: { since?: number; agent?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.since !== undefined) params.set("since", String(opts.since));
    if (opts.agent) params.set("agent", opts.agent);
    return get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}?${params}`);
  },
  refreshStatus: (taskId: string) => get<RefreshJob>(`/api/tasks/${encodeURIComponent(taskId)}/refresh`),
  startRefresh: async (taskId: string) => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error((await res.json())?.error ?? res.statusText);
    return (await res.json()) as RefreshJob;
  },
};

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

export function onSessionsChange(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

onServerEvent("ws:sessions", (payload: { ids: string[] }) => {
  for (const listener of listeners) listener(payload.ids);
});

/** Session list that refreshes on transcript writes (throttled) and every 30s so statuses age out. */
export function useSessions(days = 3) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const lastLoad = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(() => {
    lastLoad.current = Date.now();
    sessionsApi.list(days).then(setSessions, () => {});
  }, [days]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    const off = onSessionsChange(() => {
      clearTimeout(timer.current);
      const wait = Math.max(0, 2000 - (Date.now() - lastLoad.current));
      timer.current = setTimeout(load, wait);
    });
    return () => {
      clearInterval(interval);
      off();
      clearTimeout(timer.current);
    };
  }, [load]);

  return sessions;
}

/** Live timeline of one session (or one of its subagents): appends only what was written since the last read. */
export function useSessionFeed(id: string, agent?: string) {
  const [state, setState] = useState<{ session?: SessionSummary; events: SessionEvent[]; truncated: boolean; error?: string }>({ events: [], truncated: false });
  useEffect(() => {
    let cancelled = false;
    let cursor: number | undefined;
    let inFlight = false;
    let pending = false;
    setState({ events: [], truncated: false });

    const pull = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const since = cursor;
        const detail = await sessionsApi.detail(id, { since, agent });
        if (cancelled) return;
        cursor = detail.cursor;
        setState((prev) => ({
          session: detail.session,
          events: since === undefined ? detail.events : [...prev.events, ...detail.events],
          truncated: since === undefined ? detail.truncated : prev.truncated,
        }));
      } catch (e) {
        if (!cancelled) setState((prev) => ({ ...prev, error: (e as Error).message }));
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void pull();
        }
      }
    };

    void pull();
    const off = onSessionsChange((ids) => ids.includes(id) && void pull());
    const interval = setInterval(pull, 20_000);
    return () => {
      cancelled = true;
      off();
      clearInterval(interval);
    };
  }, [id, agent]);

  return state;
}
