import { useEffect, useState } from "react";

export type HomeFilter = "todas" | "activas" | "hechas";

export type Route =
  | { view: "home"; filter: HomeFilter }
  | { view: "agents" }
  | { view: "newSession" }
  | { view: "session"; sessionId: string; agentId?: string }
  | { view: "task"; taskId: string }
  | { view: "board"; taskId: string; boardId: string }
  | { view: "doc"; taskId: string; doc: string }
  | { view: "sessions"; taskId: string; sessionId?: string };

function parse(hash: string): Route {
  const [kind, taskId, sub, name] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (kind === "activas" || kind === "hechas") return { view: "home", filter: kind };
  if (kind === "nueva-sesion") return { view: "newSession" };
  if (kind === "agentes") return taskId ? { view: "session", sessionId: taskId, agentId: sub || undefined } : { view: "agents" };
  if (kind !== "t" || !taskId) return { view: "home", filter: "todas" };
  if (sub === "b" && name) return { view: "board", taskId, boardId: name };
  if (sub === "d" && name) return { view: "doc", taskId, doc: name };
  if (sub === "s") return { view: "sessions", taskId, sessionId: name || undefined };
  return { view: "task", taskId };
}

export const href = {
  home: (filter: HomeFilter = "todas") => (filter === "todas" ? "#/" : `#/${filter}`),
  task: (id: string) => `#/t/${encodeURIComponent(id)}`,
  agents: () => "#/agentes",
  newSession: () => "#/nueva-sesion",
  session: (id: string, agentId?: string) => `#/agentes/${encodeURIComponent(id)}${agentId ? `/${encodeURIComponent(agentId)}` : ""}`,
  board: (id: string, boardId: string) => `#/t/${encodeURIComponent(id)}/b/${encodeURIComponent(boardId)}`,
  doc: (id: string, doc: string) => `#/t/${encodeURIComponent(id)}/d/${encodeURIComponent(doc)}`,
  taskSession: (id: string, sessionId?: string) => `#/t/${encodeURIComponent(id)}/s${sessionId ? `/${encodeURIComponent(sessionId)}` : ""}`,
};

export function navigate(to: string) {
  window.location.hash = to;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
