import { useCallback, useEffect, useState } from "react";
import { request } from "./api";
import { onServerEvent } from "./events";

export type Station = "base" | "ci" | "commits" | "review" | "ready" | "dormant";

export type DeviceTest = { ok: boolean; at: string; path: string | null; video: string | null; url: string };

export type PrRun = { id: string; command: string; at: string };

export type Pr = {
  key: string;
  repo: string;
  slug: string;
  number: number;
  title: string;
  url: string;
  author: string;
  mine: boolean;
  branch: string;
  baseRef: string;
  updatedAt: string;
  ticket: string | null;
  project: { id: string; title: string } | null;
  manualTag: string | null;
  labels: string[];
  device: DeviceTest | null;
  blockedBy: { number: number; title: string; author?: string; url: string } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  behind: number | null;
  conflict: boolean;
  conflictFiles: string[];
  failing: string[];
  foreignCi: boolean;
  commitCount: number;
  threads: number;
  isDraft: boolean;
  station: Station;
  reason: string;
  action: string;
  group: string | null;
  groupSize: number;
  runs: PrRun[];
  command: string | null;
  branchOnly?: boolean;
};

export type RepoState = { name: string; slug: string; branch: string; dirty: number; lastCommit: string; branches: string[]; vercel: boolean };

export type OtherPr = { key: string; repo: string; number: number; title: string; author: string; isDraft: boolean; updatedAt: string };

export type Tracked = { authors: string[]; prs: string[]; branches: string[] };

export type MetroState = { status: "stopped" | "installing" | "generating" | "starting" | "running" | "failed"; stale?: boolean; port?: number; host?: string; link?: string; tunnel?: boolean; error?: string; log?: string[] };

export type Circuit = {
  projectId: string;
  at: string | null;
  repos: RepoState[];
  prs: Pr[];
  others: OtherPr[];
  today: string[];
  errors: { repo: string; message: string }[];
  running: boolean;
  daily: boolean;
  tracked: Tracked;
};

export type TimelineEvent = { kind: string; at: string; who: string; text: string; url?: string; sessionId?: string; subagents?: number };

export type PrCommand = { name: string; description: string; uses: number };

export type PrDetail = {
  key: string;
  metro: MetroState | null;
  commands: { recommended: string | null; device: boolean; wanted: string | null; top: PrCommand[]; more: PrCommand[] } | null;
  timeline: TimelineEvent[];
  conflicts: { file: string; hunks: { line: number; base: string[]; head: string[] }[] }[];
  previews: { name: string; url: string; state: string; at: string }[];
  device: DeviceTest | null;
  expo: { link: string; update: string | null; runtime: string | null; production: boolean; at: string; prodTest: boolean; labeled: boolean } | null;
};

const enc = encodeURIComponent;

const post = <T>(action: string, body: unknown) => request<T>(`/api/prs/all/${action}`, { method: "POST", body: JSON.stringify(body) });

export const circuitApi = {
  get: (id: string) => request<Circuit>(`/api/prs/${enc(id)}`),
  sweep: (id: string) => request<{ running: boolean }>(`/api/prs/${enc(id)}/sweep`, { method: "POST", body: "{}" }),
  save: (id: string, patch: { daily?: boolean; tracked?: Partial<Tracked> }) => request<Circuit>(`/api/prs/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  run: (repo: string, number: number, command: string) => post<{ sessionId: string }>("run", { repo, number, command }),
  github: (action: "test" | "ready" | "close", repo: string, number: number) => post<{ ok: boolean }>("github", { action, repo, number }),
  metro: (repo: string, number: number) => request<MetroState>(`/api/prs/all/metro?repo=${enc(repo)}&number=${number}`),
  metroAction: (action: "start" | "stop", repo: string, number: number, tunnel = false) => post<MetroState>("metro", { action, repo, number, tunnel }),
  trackBranch: (id: string, repo: string, branch: string) => request<Circuit>(`/api/prs/${enc(id)}/branches`, { method: "POST", body: JSON.stringify({ repo, branch }) }),
  openPr: (repo: string, branch: string) => post<{ ok: boolean }>("open-pr", { repo, branch }),
  detail: (repo: string, number: number) => request<PrDetail>(`/api/prs/all/detail?repo=${enc(repo)}&number=${number}`),
};

const RELOAD_MS = 15_000;

/** The folder's last sweep, refreshed when a new one ends, and now and then in case that event never arrived. */
export function useCircuit(projectId: string) {
  const [data, setData] = useState<Circuit | null>(null);
  const reload = useCallback(() => {
    circuitApi.get(projectId).then(setData, () => setData(null));
  }, [projectId]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, RELOAD_MS);
    const off = onServerEvent("ws:prs", reload);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [reload]);
  return { data, reload };
}
