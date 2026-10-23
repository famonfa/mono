import { useEffect, useSyncExternalStore } from "react";
import type { SessionSummary } from "./sessions";

const SEEN_KEY = "ws-seen";
const SINCE_KEY = "ws-seen-since";
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

function firstRun() {
  const now = new Date().toISOString();
  localStorage.setItem(SINCE_KEY, now);
  return now;
}

// Sessions that finished before this existed shouldn't all light up at once.
const since = localStorage.getItem(SINCE_KEY) ?? firstRun();

const readSeen = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
};

let seen = readSeen();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

window.addEventListener("storage", (e) => {
  if (e.key !== SEEN_KEY) return;
  seen = readSeen();
  notify();
});

function save(next: Record<string, string>) {
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
  seen = Object.fromEntries(Object.entries(next).filter(([, ts]) => ts >= cutoff));
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  notify();
}

export function markSeen(sessions: Pick<SessionSummary, "id" | "lastTs">[]) {
  const changed = sessions.filter((s) => s.lastTs && s.lastTs > (seen[s.id] ?? ""));
  if (changed.length) save({ ...seen, ...Object.fromEntries(changed.map((s) => [s.id, s.lastTs!])) });
}

// AI refresh runs land in the task's boards; nobody opens those transcripts.
// The server labels them "Refresco IA · …" (older) or "AI refresh · …".
const isBackgroundRefresh = (session: SessionSummary) => /^(Refresco IA|AI refresh)\b/.test(session.project);

/** A session is unread when it stopped working after the last time it was on screen. */
export function isUnread(session: SessionSummary, map = seen) {
  if (session.status === "working" || !session.lastTs || isBackgroundRefresh(session)) return false;
  return session.lastTs > (map[session.id] ?? since);
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
}

export function useUnread() {
  const map = useSyncExternalStore(subscribe, () => seen);
  return (session?: SessionSummary) => Boolean(session && isUnread(session, map));
}

/** Marks the session as seen while it's on screen, including whatever it writes until you leave. */
export function useMarkSeen(session?: SessionSummary) {
  const id = session?.id;
  const lastTs = session?.lastTs;
  useEffect(() => {
    if (!id || !lastTs) return;
    const mark = () => document.visibilityState === "visible" && markSeen([{ id, lastTs }]);
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [id, lastTs]);
}
