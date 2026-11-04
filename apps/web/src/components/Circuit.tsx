import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Bot, Check, ChevronDown, Copy, ExternalLink, FileCode, Folder, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Globe, MessageSquare, Play, Plus, QrCode, RefreshCw, Search, Smartphone, Sparkles, Square, TriangleAlert, User, X } from "lucide-react";
import QRCode from "qrcode";
import { api } from "../api";
import { useApp } from "../app-context";
import { chatApi, type ChatState } from "../chat";
import { circuitApi, useCircuit, type Circuit, type MetroState, type OtherPr, type Pr, type PrDetail, type Station, type TimelineEvent } from "../circuit";
import { onServerEvent } from "../events";
import { Markdown } from "./Markdown";
import { PermissionCard, QuestionCard } from "./Chat";
import { href } from "../router";
import type { SessionSummary } from "../sessions";
import { Menu, timeAgo } from "../ui";

const STATIONS: { id: Station; label: string; hint: string }[] = [
  { id: "base", label: "Base", hint: "with conflicts" },
  { id: "ci", label: "CI", hint: "failing" },
  { id: "commits", label: "Commits", hint: "to clean" },
  { id: "review", label: "Review", hint: "to review" },
  { id: "ready", label: "Ready", hint: "to ship" },
];

const NEXT_STEP: Record<string, string> = { rebase: "Rebase", fix: "Fix", wait: "Waiting", "clean-commits": "Clean", resolve: "Resolve", review: "Review", "mark-ready": "Ready", land: "Land", "open-pr": "Open PR", approval: "Approval" };

const CHIP_WIDTH = 280;
const LANE = 50;
const GROUP_HEAD = 24;
const GROUP_GAP = 8;
const TOP = 96;
const MIN_WIDTH = 1120;
const PORT_GAP = 14;
const TRACK_GAP = 7;
/** One per repo, so a wire can be followed by eye. Red, orange and violet already mean conflict, CI and review. */
const WIRE_COLORS = ["#4ea7fc", "#4cb782", "#e15a97", "#d9c14a", "#26b5ce", "#9aa5f5", "#a3c95a", "#f0a6ca"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fileName = (file: string) => file.split("/").pop();

const commandLabel = (name: string) => (name === "rebase" ? "Rebase" : name === "resume" ? "Resume" : `/${name}`);

/** Commands on their way to a session: starting one takes a few seconds and the PR should show it right away. */
const launching = new Map<string, string>();
const launchListeners = new Set<() => void>();
let launchVersion = 0;
const setLaunching = (key: string, command: string | null) => {
  if (command) launching.set(key, command);
  else launching.delete(key);
  launchVersion++;
  launchListeners.forEach((fn) => fn());
};
const onLaunching = (fn: () => void) => {
  launchListeners.add(fn);
  return () => void launchListeners.delete(fn);
};

const SEEN_KEY = "ws-pr-runs-seen";
const readSeen = () => new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));

type RunPhase = "starting" | "working" | "needs-you" | "finished";
type Run = { pr: Pr; id?: string; ids: string[]; others: number; command: string; phase: RunPhase; chat?: ChatState; session?: SessionSummary };

const URGENCY: RunPhase[] = ["needs-you", "starting", "working", "finished"];
const STATE_POLL_MS = 10_000;
const ORPHAN_MS = 2 * 60_000;
const WHILE_OPEN_MS = 2 * 60_000;
const ON_FOCUS_MS = 30_000;

/**
 * The agents on each PR, until you've read how they ended. A PR can have several, and the most urgent one speaks for
 * it. The transcript counts too: a server restart forgets its chats, not the agents that are still writing.
 */
function useRuns(prs: Pr[], onSettled?: () => void) {
  const { sessions } = useApp();
  useSyncExternalStore(onLaunching, () => launchVersion);
  const [states, setStates] = useState<Record<string, ChatState>>({});
  const [seen, setSeen] = useState(readSeen);
  const open = prs.map((pr) => ({ pr, list: (pr.runs ?? []).filter((r) => !seen.has(r.id)) })).filter((p) => p.list.length);
  const ids = open.flatMap((p) => p.list.map((r) => r.id)).join(",");
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    const load = () => void Promise.all(list.map((id) => chatApi.state(id).catch(() => null))).then((found) => setStates((all) => ({ ...all, ...Object.fromEntries(found.filter((s): s is ChatState => Boolean(s)).map((s) => [s.sessionId, s])) })));
    load();
    // Events sent while the connection was down are gone, and a stale "working" misleads more than a late one.
    const timer = setInterval(load, STATE_POLL_MS);
    const off = onServerEvent("ws:chat", (e: { sessionId: string; state: ChatState }) => {
      if (list.includes(e.sessionId)) setStates((all) => ({ ...all, [e.sessionId]: e.state }));
    });
    return () => {
      clearInterval(timer);
      off();
    };
  }, [ids]);
  const dismiss = useCallback((list: string[]) => {
    const next = readSeen();
    list.forEach((id) => next.add(id));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-200)));
    setSeen(next);
  }, []);
  const runs = new Map<string, Run>();
  for (const { pr, list } of open) {
    const each = list.map((r) => {
      const chat = states[r.id];
      const session = sessions.find((s) => s.id === r.id);
      // Without a live chat the transcript is all there is, and only while it keeps growing: a cut agent looks mid-task forever.
      const writing = session?.status === "working" && Date.now() - Date.parse(session.lastTs ?? "") < ORPHAN_MS;
      const phase: RunPhase = chat?.pending.length ? "needs-you" : chat?.state === "running" || (!chat?.live && writing) ? "working" : "finished";
      return { r, chat, session, phase };
    });
    const lead = [...each].reverse().sort((a, b) => URGENCY.indexOf(a.phase) - URGENCY.indexOf(b.phase))[0];
    const others = each.filter((e) => e !== lead && e.phase !== "finished").length;
    runs.set(pr.key, { pr, id: lead.r.id, ids: list.map((r) => r.id), others, command: lead.r.command, phase: lead.phase, chat: lead.chat, session: lead.session });
  }
  for (const pr of prs) {
    const command = launching.get(pr.key);
    if (command) runs.set(pr.key, { pr, ids: [], others: 0, command, phase: "starting" });
  }
  // An agent that stops may have just pushed, so what the circuit shows can be out of date.
  const phases = useRef(new Map<string, RunPhase>());
  const signature = [...runs].map(([key, r]) => `${key}:${r.phase}`).join();
  useEffect(() => {
    const settled = [...runs].some(([key, r]) => r.phase === "finished" && phases.current.has(key) && phases.current.get(key) !== "finished");
    phases.current = new Map([...runs].map(([key, r]) => [key, r.phase]));
    if (settled) onSettled?.();
  }, [signature]);
  return { runs, dismiss, setChat: (s: ChatState) => setStates((all) => ({ ...all, [s.sessionId]: s })) };
}

/** Keeps what's on screen close to GitHub while you're looking at it. Sweeping only reads, and takes seconds. */
function useFreshSweep(project: string, circuit: Circuit | null) {
  const latest = useRef(circuit);
  latest.current = circuit;
  const sweepNow = useCallback(() => {
    if (project !== "all") void circuitApi.sweep(project);
  }, [project]);
  useEffect(() => {
    const ifOlderThan = (ms: number) => {
      const at = latest.current?.at;
      if (at && !latest.current?.running && !document.hidden && Date.now() - Date.parse(at) > ms) sweepNow();
    };
    const onFocus = () => ifOlderThan(ON_FOCUS_MS);
    ifOlderThan(ON_FOCUS_MS);
    const timer = setInterval(() => ifOlderThan(WHILE_OPEN_MS), 15_000);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [sweepNow, circuit?.at === undefined]);
  return sweepNow;
}

const PHASE_LABEL: Record<RunPhase, string> = { starting: "starting…", working: "working", "needs-you": "needs you", finished: "finished" };

/** Says what the agent is doing. With little room the state goes first: the command is on the chip's button anyway. */
function RunPill({ run, left, top, room, onOpen }: { run: Run; left: number; top: number; room: number; onOpen: () => void }) {
  const full = `${commandLabel(run.command)} · ${PHASE_LABEL[run.phase]}`;
  if (room < 84) {
    return <button className={`pr-run dot ${run.phase}`} style={{ left: left - 18, top: top - 16 }} onClick={onOpen} title={full} aria-label={full}><i /></button>;
  }
  return (
    <button className={`pr-run ${run.phase}`} style={{ left, top, maxWidth: room }} onClick={onOpen} title={full}>
      <i /> {room < 190 ? PHASE_LABEL[run.phase] : full}
      {run.others > 0 && ` +${run.others}`}
    </button>
  );
}

function RunPending({ run, setChat }: { run: Run; setChat: (s: ChatState) => void }) {
  return (
    <>
      {run.chat?.pending.map((p) => (p.toolName === "AskUserQuestion" ? <QuestionCard key={p.id} sessionId={run.id!} request={p} onAnswered={setChat} /> : <PermissionCard key={p.id} sessionId={run.id!} request={p} onAnswered={setChat} />))}
    </>
  );
}

/** How an agent is doing, and everything you can answer it, without leaving the PRs. */
function RunBody({ run, setChat, dismiss }: { run: Run; setChat: (s: ChatState) => void; dismiss: (ids: string[]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = () => {
    if (!text.trim() || !run.id) return;
    setSending(true);
    setError(null);
    chatApi.send(run.id, text.trim()).then(
      (s) => {
        setChat(s);
        setText("");
        setSending(false);
      },
      (e) => {
        setError((e as Error).message);
        setSending(false);
      },
    );
  };
  const last = run.session?.lastText;
  return (
    <div className={`run-body ${run.phase}`}>
      <div className="run-status">
        <i />
        <b>{run.phase === "needs-you" ? "Needs your OK" : run.phase === "working" ? "Working" : run.phase === "starting" ? "Starting…" : "Finished"}</b>
        {run.phase === "working" && run.session?.lastAction && <span>{run.session.lastAction.title}</span>}
      </div>
      <RunPending run={run} setChat={setChat} />
      {last && run.phase !== "starting" && (
        <div className="run-text doc-content">
          <Markdown taskId="">{last}</Markdown>
        </div>
      )}
      {run.id && (
        <>
          <label className="run-reply">
            <input value={text} disabled={sending} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Answer this agent…" />
            <button className="btn primary" disabled={sending || !text.trim()} onClick={send}>
              Send
            </button>
          </label>
          {error && <div className="dialog-error">{error}</div>}
          <div className="run-actions">
            <a className="btn ghost" href={href.session(run.id)}>
              Open full session
            </a>
            {run.phase === "working" && (
              <button className="btn ghost" onClick={() => void chatApi.interrupt(run.id!).then(setChat)}>
                <Square size={12} /> Stop
              </button>
            )}
            <span className="spacer" />
            {run.phase === "finished" && (
              <button className="btn ghost" onClick={() => dismiss(run.ids)}>
                Done
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RunDrawer({ run, setChat, dismiss, onClose }: { run: Run; setChat: (s: ChatState) => void; dismiss: (ids: string[]) => void; onClose: () => void }) {
  return (
    <aside className="run-drawer">
      <header>
        <div>
          <strong>{commandLabel(run.command)}</strong>
          <a href={href.pr(run.pr.slug, run.pr.number)}>
            {run.pr.repo} #{run.pr.number}
          </a>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={15} />
        </button>
      </header>
      <RunBody run={run} setChat={setChat} dismiss={dismiss} />
    </aside>
  );
}

/** What agents are asking for, answerable right here. */
function NeedsYou({ runs, setChat, dismiss, onOpen }: { runs: Run[]; setChat: (s: ChatState) => void; dismiss: (ids: string[]) => void; onOpen: (key: string) => void }) {
  const [all, setAll] = useState(false);
  const waiting = runs.filter((r) => r.phase === "needs-you");
  const working = runs.filter((r) => r.phase === "working" || r.phase === "starting");
  const finished = runs.filter((r) => r.phase === "finished");
  if (!waiting.length && !finished.length && !working.length) return null;
  return (
    <section className="circuit-asks">
      {waiting.map((r) => (
        <div key={r.pr.key} className="needs-you-card">
          <button className="needs-you-title" onClick={() => onOpen(r.pr.key)}>
            <TriangleAlert size={13} /> {r.pr.repo} #{r.pr.number} · {commandLabel(r.command)} needs your OK
          </button>
          <RunPending run={r} setChat={setChat} />
        </div>
      ))}
      <div className="needs-you-summary">
        {working.length > 0 && (
          <span className="live">
            <i /> {plural(working.length, "agent")} working
          </span>
        )}
        {finished.length > 0 && (
          <>
            <button onClick={() => setAll(!all)}>
              <Check size={12} /> {finished.length} finished, to read
              <ChevronDown size={12} />
            </button>
            {all && (
              <button className="link-btn" onClick={() => dismiss(finished.flatMap((r) => r.ids))}>
                Mark all read
              </button>
            )}
          </>
        )}
      </div>
      {all &&
        finished.map((r) => (
          <button key={r.pr.key} className="needs-you-row" onClick={() => onOpen(r.pr.key)}>
            <Check size={13} />
            <b>
              {r.pr.repo} #{r.pr.number} · {commandLabel(r.command)}
            </b>
            <span>{r.session?.lastText?.replace(/[*`#]/g, "").split("\n")[0] ?? "Finished"}</span>
            <em>Read and answer</em>
          </button>
        ))}
    </section>
  );
}

/** Everything that changes GitHub or starts an agent goes through here, and asks first when it reaches beyond your own PRs. */
function usePrActions() {
  const { project, openDialog, tasks, reloadTasks } = useApp();
  const sweep = () => (project === "all" ? Promise.resolve() : circuitApi.sweep(project).then(() => undefined));
  const confirm = (title: string, submitLabel: string, onSubmit: () => Promise<unknown>) => openDialog({ title, fields: [], submitLabel, onSubmit: () => onSubmit().then(() => undefined) });
  // You stay where you are: the PR shows the agent's state and lets you answer it.
  const start = async (pr: Pr, command: string) => {
    setLaunching(pr.key, command);
    await circuitApi.run(pr.slug, pr.number, command).catch((e: Error) => openDialog({ title: e.message, fields: [], submitLabel: "OK", onSubmit: () => undefined }));
    setLaunching(pr.key, null);
  };
  const run = (pr: Pr, command: string) => (pr.mine ? start(pr, command) : confirm(`Run ${commandLabel(command)} on ${pr.author}'s PR? The agent works with that code on your Mac.`, "Run", () => start(pr, command)));
  const attach = async (taskId: string, prs: Pr[]) => {
    const task = await api.getTask(taskId);
    const known = new Set(task.repos?.map((r) => r.pr));
    await api.saveTask(taskId, { repos: [...(task.repos ?? []), ...prs.filter((p) => !known.has(p.url)).map((p) => ({ name: p.repo, branch: p.branch, pr: p.url }))] });
    await sweep();
  };
  return {
    run,
    next: (pr: Pr) => {
      if (pr.branchOnly) return confirm(`Open a draft PR for ${pr.branch}?`, "Open draft PR", () => circuitApi.openPr(pr.slug, pr.branch).then(sweep));
      if (pr.action === "mark-ready") return confirm(`Mark #${pr.number} ready for review?`, "Mark ready", () => circuitApi.github("ready", pr.slug, pr.number).then(sweep));
      if (pr.command) return run(pr, pr.command);
    },
    close: (pr: Pr) => confirm(`Close #${pr.number} on GitHub?`, "Close PR", () => circuitApi.github("close", pr.slug, pr.number).then(sweep)),
    deviceTest: (pr: Pr) => confirm(`Post @test on #${pr.number}? It asks CI for a device test.`, "Post @test", () => circuitApi.github("test", pr.slug, pr.number)),
    all: (prs: Pr[], command: string) =>
      confirm(`Start ${plural(prs.length, "agent")} with ${commandLabel(command)}? Each one works on its PR's own worktree.`, `Start ${prs.length}`, async () => {
        for (const p of prs) await start(p, command);
      }),
    connect: (prs: Pr[], value: string) => {
      if (value !== "new") return void attach(value, prs);
      openDialog({
        title: "New project for these PRs",
        fields: [{ name: "title", label: "Title", defaultValue: prs[0].ticket ?? "" }],
        submitLabel: "Create and connect",
        onSubmit: async ({ title }) => {
          if (!title.trim()) throw new Error("Title is required");
          const id = `T-${Date.now().toString(36).toUpperCase()}`;
          await api.createTask({ id, title: title.trim(), status: "en-curso", ...(project !== "all" ? { projects: [project] } : {}) });
          reloadTasks();
          await attach(id, prs);
        },
      });
    },
    projectOptions: [{ value: "new", label: "New project…" }, ...tasks.map((t) => ({ value: t.id, label: t.title }))],
  };
}

function ConnectProject({ prs, label = "Connect project" }: { prs: Pr[]; label?: string }) {
  const { connect, projectOptions } = usePrActions();
  return (
    <Menu value={undefined as string | undefined} options={projectOptions} onChange={(v) => connect(prs, v)} placeholder="Search projects…">
      <span className="circuit-project">
        <Plus size={11} /> {label}
      </span>
    </Menu>
  );
}

type Group = { key: string; label: string; note?: string; project?: Pr["project"]; author?: string; prs: Pr[] };

/** PRs of one ticket or project stay together, the API first since it's merged first. Followed authors go last. */
function groupsOf(prs: Pr[]): Group[] {
  const groups = new Map<string, Group>();
  for (const p of prs) {
    const key = p.branchOnly ? "branches" : !p.mine ? `author:${p.author}` : (p.group ?? "other");
    const group = groups.get(key) ?? { key, label: p.branchOnly ? "Branches without a PR" : !p.mine ? p.author : p.group ? (p.project?.title ?? p.ticket ?? p.group) : "Other", author: p.mine || p.branchOnly ? undefined : p.author, project: p.group ? p.project : undefined, prs: [] };
    group.prs.push(p);
    groups.set(key, group);
  }
  const rank = (g: Group) => (g.key === "branches" ? 3 : g.author ? 2 : g.key === "other" ? 1 : 0);
  const apiFirst = (p: Pr) => (/api/i.test(p.repo) ? 0 : 1);
  return [...groups.values()]
    .sort((a, b) => rank(a) - rank(b))
    .map((g) => {
      const sorted = [...g.prs].sort((a, b) => apiFirst(a) - apiFirst(b));
      const together = rank(g) === 0 && sorted.some((p) => apiFirst(p) === 0) && new Set(sorted.map((p) => p.repo)).size > 1;
      return { ...g, prs: sorted, note: together ? "together, API first" : undefined };
    });
}

function layout(prs: Pr[], width: number) {
  const prod = width - 89;
  const ready = prod - 95;
  const review = ready - 300;
  const commits = review - 84;
  const base = 282;
  const gates: Record<string, number> = { base, ci: base + (commits - base) * 0.51, commits, review, ready };
  const groups = groupsOf(prs);
  const lanes: { pr: Pr; y: number; x: number; right: number; passed: number[]; ahead: number[] }[] = [];
  const heads: { group: Group; y: number; lanes: [number, number] }[] = [];
  let y = TOP;
  for (const group of groups) {
    const head = y;
    y += GROUP_HEAD;
    const start = y;
    for (const pr of group.prs) {
      const at = Math.min(gates[pr.station] - 14, prod - CHIP_WIDTH - 15);
      const index = STATIONS.findIndex((s) => s.id === pr.station);
      lanes.push({ pr, y: y + 22, x: at, right: at + CHIP_WIDTH, passed: STATIONS.slice(0, index).map((s) => gates[s.id]), ahead: STATIONS.slice(index + 1).map((s) => gates[s.id]).filter((x) => x > at + CHIP_WIDTH) });
      y += LANE;
    }
    heads.push({ group, y: head, lanes: [start, y - 6] });
    y += GROUP_GAP;
  }
  const height = y + 16;
  const lanesOf = (repo: string) => lanes.filter((l) => l.pr.repo === repo);
  const heightOf = (repo: string) => 42 + lanesOf(repo).length * 16;
  const middle = (repo: string) => lanesOf(repo).reduce((sum, l) => sum + l.y, 0) / lanesOf(repo).length;
  // Each repo sits next to its own PRs: the less a wire has to travel, the fewer it crosses.
  const repos = [...new Set(prs.map((p) => p.repo))].sort((a, b) => middle(a) - middle(b));
  const ports = repos.map((repo) => ({ repo, y: middle(repo) - heightOf(repo) / 2, height: heightOf(repo), count: lanesOf(repo).length }));
  ports.forEach((p, i) => (p.y = Math.max(p.y, i ? ports[i - 1].y + ports[i - 1].height + PORT_GAP : TOP)));
  for (let i = ports.length - 1, limit = height - 12; i >= 0; limit = ports[i].y - PORT_GAP, i--) ports[i].y = Math.min(ports[i].y, limit - ports[i].height);
  const runs = lanes.map((lane) => {
    const port = ports.find((p) => p.repo === lane.pr.repo)!;
    return { lane, pinY: port.y + 32 + lanesOf(lane.pr.repo).indexOf(lane) * 16 };
  });
  // Wires going the same way take channels in pin order, or they'd cut through each other's way out.
  const tracks: { lo: number; hi: number }[][] = [];
  const trackOf = new Map<string, number>();
  const going = (down: boolean) => runs.filter((r) => Math.abs(r.lane.y - r.pinY) >= 1 && r.lane.y > r.pinY === down).sort((a, b) => (down ? b.pinY - a.pinY : a.pinY - b.pinY));
  for (const r of [...going(true), ...going(false)]) {
    const span = { lo: Math.min(r.pinY, r.lane.y) - TRACK_GAP, hi: Math.max(r.pinY, r.lane.y) + TRACK_GAP };
    let track = tracks.findIndex((t) => t.every((o) => span.hi < o.lo || span.lo > o.hi));
    if (track < 0) track = tracks.push([]) - 1;
    tracks[track].push(span);
    trackOf.set(r.lane.pr.key, track);
  }
  const pitch = Math.min(14, 100 / Math.max(1, tracks.length - 1));
  const wires = runs.map(({ lane, pinY }) => {
    const channel = 146 + (trackOf.get(lane.pr.key) ?? 0) * pitch;
    const dy = lane.y - pinY;
    const r = Math.min(6, Math.abs(dy) / 2);
    const s = Math.sign(dy) || 1;
    const d = Math.abs(dy) < 1 ? `M128 ${pinY}H${lane.x}` : `M128 ${pinY}H${channel - r}L${channel} ${pinY + s * r}V${lane.y - s * r}L${channel + r} ${lane.y}H${lane.x}`;
    return { key: lane.pr.key, repo: lane.pr.repo, d, pinY };
  });
  return { gates, prod, lanes, heads, ports, wires, height };
}

/** Tickets and commit types repeat what the wire already says; on a chip the words that differ have to fit. */
const shortTitle = (title: string) => title.replace(/^\[?[A-Z]{2,6}-\d+\]?:?\s*/i, "").replace(/^\w+(\([^)]*\))?!?:\s*/, "").replace(/\s*\([A-Z]{2,6}-\d+\)$/i, "");

function chipDetail(p: Pr) {
  const parts = [p.repo];
  if (p.branchOnly) return [...parts, p.author, "no PR yet"].join(" · ");
  if (p.manualTag) return [...parts, p.manualTag].join(" · ");
  if (p.isDraft) parts.push("draft");
  if (p.blockedBy) parts.push(`waiting on #${p.blockedBy.number}`);
  else if (p.device && !p.device.ok) parts.push(p.reason.replace(" open", ""), "device test failed");
  else parts.push(p.reason);
  if (p.station === "base" && p.behind && !p.isDraft) parts.push(`${p.behind} behind`);
  return parts.join(" · ");
}

function agentsOn(p: Pr, sessions: SessionSummary[]) {
  return sessions.filter((s) => s.status === "working" && (p.runs?.some((r) => r.id === s.id) || s.gitBranch === p.branch || s.prLinks.includes(p.url)));
}

function Board({ prs, counts, tracked, folder, runs, onOpenRun }: { prs: Pr[]; counts: Record<string, number>; tracked: Circuit["tracked"]; folder: string; runs: Map<string, Run>; onOpenRun: (key: string) => void }) {
  const { sessions } = useApp();
  const actions = usePrActions();
  const rebases = prs.filter((p) => p.command === "rebase");
  const unreviewed = prs.filter((p) => p.action === "review");
  const unfollow = (author: string) => void circuitApi.save(folder, { tracked: { authors: tracked.authors.filter((a) => !a.endsWith(author)) } }).then(() => circuitApi.sweep(folder));
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(MIN_WIDTH);
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => setWidth(Math.max(MIN_WIDTH, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const map = useMemo(() => layout(prs, width), [prs, width]);
  const colors = useMemo(() => new Map([...new Set(prs.map((p) => p.repo))].sort().map((repo, i) => [repo, WIRE_COLORS[i % WIRE_COLORS.length]])), [prs]);
  // Hovering a chip follows its wire; hovering a repo, all of them.
  const [focus, setFocus] = useState<{ repo?: string; key?: string } | null>(null);
  const dim = (repo: string, key: string) => (focus && !(focus.key ? focus.key === key : focus.repo === repo) ? "dim" : "");
  return (
    <div className="circuit-scroll" ref={box}>
      <div className="circuit-board" style={{ width, height: map.height }}>
        <svg className="circuit-wires" width={width} height={map.height}>
          {STATIONS.map((s) => (
            <line key={s.id} className={`circuit-gate ${counts[s.id] ? s.id : ""}`} x1={map.gates[s.id]} x2={map.gates[s.id]} y1={84} y2={map.height - 12} />
          ))}
          <line className="circuit-prod" x1={map.prod} x2={map.prod} y1={84} y2={map.height - 12} />
          {map.lanes.map((l) => (
            <line key={l.pr.key} className="circuit-pending" x1={l.right + 6} x2={map.prod - 6} y1={l.y} y2={l.y} />
          ))}
          {map.wires.map((w) => {
            const phase = runs.get(w.key)?.phase;
            const live = phase === "working" || phase === "starting" || agentsOn(prs.find((p) => p.key === w.key)!, sessions).length > 0;
            return (
              <g key={w.key}>
                {live && <path d={w.d} className="energy-glow" style={{ stroke: colors.get(w.repo) }} />}
                <path d={w.d} className={`circuit-wire ${live ? "flowing" : ""} ${focus && !dim(w.repo, w.key) ? "focused" : ""} ${dim(w.repo, w.key)}`} style={{ stroke: colors.get(w.repo) }} />
                {live && <path d={w.d} className="energy-current" pathLength={100} />}
                <rect className={`circuit-pin ${dim(w.repo, w.key)}`} x={125} y={w.pinY - 3} width={6} height={6} rx={1} style={{ fill: colors.get(w.repo) }} />
              </g>
            );
          })}
          {map.lanes.map((l) => (
            <g key={l.pr.key} className={dim(l.pr.repo, l.pr.key)}>
              {l.passed.map((x) => (
                <circle key={x} className="circuit-pad passed" cx={x} cy={l.y} r={3.5} style={{ fill: colors.get(l.pr.repo) }} />
              ))}
              {l.ahead.map((x) => (
                <circle key={x} className="circuit-pad" cx={x} cy={l.y} r={3} />
              ))}
              <circle className="circuit-end" cx={map.prod} cy={l.y} r={4} />
            </g>
          ))}
        </svg>

        <div className="circuit-head" style={{ left: 16 }}>
          <span className="circuit-label">Repos</span>
          <span className="circuit-count">
            <b>{prs.length}</b> active
          </span>
        </div>
        {STATIONS.map((s) => (
          <div key={s.id} className="circuit-head" style={{ left: map.gates[s.id] }}>
            <span className="circuit-label">{s.label}</span>
            <span className={`circuit-count ${counts[s.id] ? s.id : "none"}`}>
              <b>{counts[s.id] ?? 0}</b> {counts[s.id] ? s.hint : ""}
            </span>
            {s.id === "base" && rebases.length > 1 && (
              <button className="circuit-bulk" onClick={() => actions.all(rebases, "rebase")}>
                Rebase all {rebases.length}
              </button>
            )}
            {s.id === "review" && unreviewed.length > 1 && (
              <button className="circuit-bulk" onClick={() => actions.all(unreviewed, "pr-review")}>
                /pr-review {unreviewed.length}
              </button>
            )}
          </div>
        ))}
        <div className="circuit-head" style={{ left: map.prod - 2 }}>
          <span className="circuit-label">Production</span>
        </div>

        {map.ports.map((p) => (
          <div key={p.repo} className={`circuit-port ${focus && focus.repo !== p.repo && !prs.some((x) => x.key === focus.key && x.repo === p.repo) ? "dim" : ""}`} style={{ top: p.y, height: p.height, borderLeftColor: colors.get(p.repo) }} onMouseEnter={() => setFocus({ repo: p.repo })} onMouseLeave={() => setFocus(null)}>
            <strong>{p.repo}</strong>
            <span>{plural(p.count, "PR")}</span>
          </div>
        ))}

        {map.heads.map(({ group, y, lanes }) => (
          <div key={group.key}>
            <div className="circuit-group" style={{ top: y }}>
              <strong>{group.author ? `Following ${group.label}` : group.label}</strong>
              {group.note && <span>{group.note}</span>}
              {group.project && !group.author && (
                <a className="circuit-project" href={href.task(group.project.id)}>
                  <Folder size={11} /> {group.project.title}
                </a>
              )}
              {!group.project && !group.author && !["other", "branches"].includes(group.key) && <ConnectProject prs={group.prs} />}
              {group.author && (
                <button className="circuit-project" onClick={() => unfollow(group.author!)}>
                  Stop following
                </button>
              )}
            </div>
            {group.note && <div className="circuit-tie" style={{ top: lanes[0], height: lanes[1] - lanes[0] }} />}
          </div>
        ))}

        {map.lanes.map(({ pr, x, y, right }) => {
          const agents = agentsOn(pr, sessions);
          const subagents = agents.reduce((n, s) => n + s.subagents.filter((a) => a.status === "working").length, 0);
          return (
            <div key={pr.key}>
              <a className={`pr-chip ${pr.branchOnly ? "branch" : pr.manualTag || pr.action === "wait" ? "held" : pr.station} ${dim(pr.repo, pr.key)}`} style={{ left: x, top: y - 21, width: CHIP_WIDTH }} onMouseEnter={() => setFocus({ key: pr.key })} onMouseLeave={() => setFocus(null)} href={pr.branchOnly ? pr.url : href.pr(pr.slug, pr.number)} target={pr.branchOnly ? "_blank" : undefined} rel="noreferrer" title={`${pr.title}\n${chipDetail(pr)}`}>
                <span className="pr-chip-text">
                  <span className="pr-chip-title">
                    {pr.branchOnly ? <GitBranch size={12} /> : <code>#{pr.number}</code>}
                    <span>{shortTitle(pr.title)}</span>
                    {pr.project && <Folder size={11} className="pr-chip-project" />}
                  </span>
                  <span className="pr-chip-detail">
                    <i style={{ background: colors.get(pr.repo) }} /> {chipDetail(pr)}
                  </span>
                </span>
                {NEXT_STEP[pr.action] && !pr.manualTag && !(runs.get(pr.key) && runs.get(pr.key)!.phase !== "finished") && <NextStep pr={pr} />}
                {pr.branchOnly && (
                  <button
                    className="pr-chip-remove"
                    title="Stop tracking this branch"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void circuitApi.save(folder, { tracked: { branches: tracked.branches.filter((b) => b !== pr.key) } }).then(() => circuitApi.sweep(folder));
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </a>
              {runs.has(pr.key) ? (
                <RunPill run={runs.get(pr.key)!} left={right + 10} top={y - 11} room={map.prod - right - 16} onOpen={() => onOpenRun(pr.key)} />
              ) : agents.length > 0 && (
                <a className="pr-chip-agent" style={{ left: right + 10, top: y - 11 }} href={href.session(agents[0].id)}>
                  <i /> {plural(agents.length, "agent")}
                  {subagents > 0 && ` · ${plural(subagents, "subagent")}`}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The chip's and the Today list's button. Sits inside a link, so it must not follow it. */
function NextStep({ pr }: { pr: Pr }) {
  const { next } = usePrActions();
  if (pr.action === "wait" || pr.action === "approval") return <span className="pr-chip-next idle">{NEXT_STEP[pr.action]}</span>;
  return (
    <button
      className="pr-chip-next"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        next(pr);
      }}
    >
      {NEXT_STEP[pr.action]}
    </button>
  );
}

function nextStepText(p: Pr) {
  if (p.action === "wait") return p.blockedBy ? `${p.baseRef} fails the same way. #${p.blockedBy.number} by ${p.blockedBy.author} fixes it` : `${p.baseRef} fails the same way`;
  if (p.action === "rebase") return p.conflictFiles.length ? `Conflict in ${p.conflictFiles.slice(0, 2).map(fileName).join(" and ")}${p.conflictFiles.length > 2 ? ` and ${p.conflictFiles.length - 2} more` : ""}` : "Merge conflict";
  if (p.action === "mark-ready") return "Clean: it only has to leave draft";
  if (p.action === "approval") return "Up to date: waiting for someone to approve it";
  const step = p.action === "resolve" ? `Resolve ${p.reason.replace(" open", "")}` : p.reason;
  return p.device && !p.device.ok ? `${step}, then repeat the device test` : step;
}

function Today({ circuit }: { circuit: Circuit }) {
  const prs = circuit.today.map((key) => circuit.prs.find((p) => p.key === key)).filter((p): p is Pr => Boolean(p));
  return (
    <section className="circuit-today">
      <header>
        <strong>Today</strong>
        <span>closest to production first</span>
      </header>
      {prs.map((p, i) => (
        <a key={p.key} href={href.pr(p.slug, p.number)} className="circuit-today-row">
          <code>{i + 1}</code>
          <i className={`dot ${p.action === "wait" ? "held" : p.station}`} />
          <b>
            {p.repo} #{p.number}
          </b>
          <span>{nextStepText(p)}</span>
          {NEXT_STEP[p.action] && <NextStep pr={p} />}
        </a>
      ))}
      {!prs.length && <div className="circuit-note">Nothing to do today.</div>}
    </section>
  );
}

function Dormant({ prs }: { prs: Pr[] }) {
  const { run, close } = usePrActions();
  if (!prs.length) return null;
  const on = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return (
    <section className="circuit-dormant">
      <header>
        <strong>Dormant</strong>
        <span>{prs.length} · over 90 days idle. They never close by themselves.</span>
      </header>
      {prs.map((p) => (
        <a key={p.key} href={href.pr(p.slug, p.number)} className="circuit-dormant-row">
          <code>#{p.number}</code>
          <em>{p.repo}</em>
          <span>{p.title}</span>
          <small>{timeAgo(p.updatedAt)}</small>
          <button className="pr-chip-next" onClick={on(() => run(p, "resume"))}>
            Resume
          </button>
          <button className="pr-chip-next" onClick={on(() => close(p))}>
            Close
          </button>
        </a>
      ))}
    </section>
  );
}

function Repos({ circuit }: { circuit: Circuit }) {
  return (
    <section className="circuit-repos">
      <header>
        <strong>Repos</strong>
        <span>{circuit.prs.length ? "" : "No open PRs here"}</span>
      </header>
      {[...circuit.repos]
        .sort((a, b) => b.lastCommit.localeCompare(a.lastCommit))
        .map((r) => (
          <a key={r.slug} className="circuit-repo" href={`https://github.com/${r.slug}`} target="_blank" rel="noreferrer">
            <strong>{[r.name, r.slug.split("/")[1]].sort((x, y) => x.length - y.length)[0]}</strong>
            <span>
              {r.branch} · {r.dirty ? plural(r.dirty, "change") : "clean"} · {timeAgo(r.lastCommit)}
            </span>
            {r.branches.slice(0, 2).map((b) => (
              <code key={b}>{b}</code>
            ))}
            {r.vercel && <em>Vercel</em>}
          </a>
        ))}
    </section>
  );
}

function AddPrs({ circuit, onClose, onSaved }: { circuit: Circuit; onClose: () => void; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState(circuit.repos[0]?.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const addBranch = async () => {
    setBusy(true);
    setError(null);
    try {
      await circuitApi.trackBranch(circuit.projectId, repo, query.trim());
      await circuitApi.sweep(circuit.projectId);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const authors = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of circuit.others) count.set(p.author, (count.get(p.author) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]);
  }, [circuit.others]);
  const q = query.trim().toLowerCase();
  const matches = (p: OtherPr) => (!author || p.author === author) && (!q || `${p.title} ${p.author} ${p.repo} #${p.number} ${p.key}`.toLowerCase().includes(q.replace(/^https:\/\/github.com\//, "").replace("/pull/", "#")));
  const results = circuit.others.filter(matches).slice(0, 40);
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (!next.delete(key)) next.add(key);
    setPicked(next);
  };
  const save = async () => {
    setBusy(true);
    await circuitApi.save(circuit.projectId, {
      tracked: {
        authors: follow && author ? [...new Set([...circuit.tracked.authors, author])] : circuit.tracked.authors,
        prs: [...new Set([...circuit.tracked.prs, ...picked])],
      },
    });
    await circuitApi.sweep(circuit.projectId);
    onSaved();
    onClose();
  };
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="add-prs" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header>
          <strong>Add PRs</strong>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </header>
        <label className="add-prs-search">
          <Search size={14} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by author or title, or paste a PR link or a branch" />
        </label>
        <div className="add-prs-body">
          <nav>
            <small>Other authors · {circuit.others.length} PRs</small>
            {authors.map(([name, n]) => (
              <button key={name} className={author === name ? "active" : ""} onClick={() => setAuthor(author === name ? null : name)}>
                <span>{name}</span>
                <em>{n}</em>
              </button>
            ))}
          </nav>
          <div className="add-prs-results">
            {results.map((p) => (
              <button key={p.key} onClick={() => toggle(p.key)}>
                <i className={picked.has(p.key) ? "checked" : ""}>{picked.has(p.key) && <Check size={12} />}</i>
                <span>
                  <b>{p.title}</b>
                  <small>
                    #{p.number} · {p.repo} · {p.author}
                    {p.isDraft ? " · draft" : ""}
                  </small>
                </span>
              </button>
            ))}
            {!results.length && (
              <div className="add-prs-branch">
                <span>No open PRs match. Is it a branch without a PR?</span>
                <div>
                  <select value={repo} onChange={(e) => setRepo(e.target.value)}>
                    {circuit.repos.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost" disabled={busy || !query.trim()} onClick={() => void addBranch()}>
                    <GitBranch size={13} /> Track “{query.trim()}”
                  </button>
                </div>
                {error && <div className="dialog-error">{error}</div>}
              </div>
            )}
          </div>
        </div>
        {author && (
          <label className="add-prs-follow">
            <span>
              <b>Follow {author}</b>
              <small>Their new PRs join the 8:00 sweep by themselves</small>
            </span>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          </label>
        )}
        <footer>
          <span>Removing them from this list doesn't close or change anything.</span>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (!picked.size && !follow)} onClick={() => void save()}>
            {follow ? "Follow" : `Add ${plural(picked.size, "PR")}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Which agents work on which PR, and which of them wait for you. */
function AgentsTree({ prs }: { prs: Pr[] }) {
  const { sessions } = useApp();
  const recent = Date.now() - 24 * 60 * 60_000;
  const rows = prs
    .map((pr) => ({ pr, agents: sessions.filter((s) => (pr.runs?.some((r) => r.id === s.id) || s.gitBranch === pr.branch || s.prLinks.includes(pr.url)) && (s.status === "working" || Date.parse(s.lastTs ?? "") > recent)) }))
    .filter((r) => r.agents.length);
  const ids = rows.flatMap((r) => r.agents.map((a) => a.id)).join(",");
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    void Promise.all(list.map((id) => chatApi.state(id).then((c) => (c.state === "requires_action" ? id : null), () => null))).then((found) => setWaiting(new Set(found.filter((id): id is string => Boolean(id)))));
  }, [ids, sessions]);
  if (!rows.length) return <div className="empty-state">No agents on these PRs in the last day.</div>;
  return (
    <div className="agents-tree">
      {rows.map(({ pr, agents }) => (
        <section key={pr.key}>
          <a className={`pr-chip static ${pr.station}`} href={href.pr(pr.slug, pr.number)}>
            <span className="pr-chip-text">
              <span className="pr-chip-title">
                <code>#{pr.number}</code>
                <span>{shortTitle(pr.title)}</span>
              </span>
              <span className="pr-chip-detail">{chipDetail(pr)}</span>
            </span>
          </a>
          <div className="agents-branches">
            {agents.map((s) => {
              const state = waiting.has(s.id) ? "waiting" : s.status === "working" ? "flowing" : "charged";
              return (
                <div key={s.id} className={`agents-branch ${state}`}>
                  <a className="agent-card" href={href.session(s.id)}>
                    <b>
                      <Bot size={14} /> {s.title}
                    </b>
                    <span>{state === "waiting" ? "Waiting for you" : (s.lastAction?.title ?? (s.status === "working" ? "Working" : `Done ${timeAgo(s.lastTs)}`))}</span>
                    {Boolean(s.contextTokens && s.contextWindow) && (
                      <i>
                        <em style={{ width: `${Math.min(100, (s.contextTokens! / s.contextWindow!) * 100)}%` }} />
                      </i>
                    )}
                  </a>
                  {s.subagents.length > 0 && (
                    <div className="agent-subs">
                      {s.subagents.slice(-6).map((a) => (
                        <a key={a.id} className={`agent-sub ${a.status}`} href={href.session(s.id, a.id)}>
                          {a.status === "working" ? <i /> : <Check size={12} />}
                          <span>{a.description}</span>
                          <small>{a.lastAction?.title ?? a.agentType ?? ""}</small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function PrsPage() {
  const { project, projects } = useApp();
  const { data, reload } = useCircuit(project);
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<"circuit" | "agents">("circuit");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const refresh = useFreshSweep(project, data);
  const { runs, dismiss, setChat } = useRuns(data?.prs ?? [], refresh);
  const run = openRun ? runs.get(openRun) : undefined;
  const folder = projects.find((p) => p.id === project);
  const sweepNow = () => {
    if (project === "all") return;
    setStarting(true);
    void circuitApi.sweep(project).finally(() => {
      setStarting(false);
      reload();
    });
  };
  // A folder nobody swept yet has nothing to show.
  const never = data && !data.at && !data.running;
  useEffect(() => {
    if (never && project !== "all") sweepNow();
  }, [never, project]);
  const running = starting || data?.running;
  const active = data?.prs.filter((p) => p.station !== "dormant") ?? [];
  const dormant = data?.prs.filter((p) => p.station === "dormant") ?? [];
  const counts = active.filter((p) => !p.branchOnly).reduce<Record<string, number>>((all, p) => ({ ...all, [p.station]: (all[p.station] ?? 0) + 1 }), {});
  return (
    <div className="home circuit">
      <header className="topbar">
        <div className="topbar-title">PRs</div>
        <span className="circuit-folder">{folder?.title ?? "All folders"}</span>
        <div className="pr-history-filter">
          {(["circuit", "agents"] as const).map((v) => (
            <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {v === "circuit" ? "Circuit" : "Agents"}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {data?.at && (
          <span className="circuit-swept" title={new Date(data.at).toLocaleString()}>
            Swept {timeAgo(data.at)} · {plural(data.prs.length, "PR")} in {plural(data.repos.length, "repo")}
          </span>
        )}
        {project !== "all" && data && (
          <label className="circuit-daily" title="Sweep this folder every day at 8:00, Buenos Aires time">
            <input type="checkbox" checked={data.daily} onChange={(e) => void circuitApi.save(project, { daily: e.target.checked }).then(reload)} /> Daily 8:00
          </label>
        )}
        {project !== "all" && (
          <>
            <button className="btn ghost" disabled={!data?.at} onClick={() => setAdding(true)}>
              <Plus size={14} /> Add PRs
            </button>
            <button className="btn ghost" disabled={running} onClick={sweepNow}>
              <RefreshCw size={14} className={running ? "spin" : ""} /> {running ? "Sweeping…" : "Sweep now"}
            </button>
          </>
        )}
      </header>
      {data?.errors.map((e) => (
        <div key={e.repo} className="circuit-error">
          <TriangleAlert size={13} /> {e.repo}: {e.message}
        </div>
      ))}
      {!data ? null : !data.at ? (
        <div className="empty-state">{running ? "Sweeping this folder's PRs…" : project === "all" ? "Pick a folder to sweep its PRs." : "No sweep yet."}</div>
      ) : view === "agents" ? (
        <AgentsTree prs={active.filter((p) => !p.branchOnly)} />
      ) : (
        <div className="circuit-page">
          <NeedsYou runs={[...runs.values()]} setChat={setChat} dismiss={dismiss} onOpen={setOpenRun} />
          {active.length > 0 && <Board prs={active} counts={counts} tracked={data.tracked} folder={project} runs={runs} onOpenRun={setOpenRun} />}
          {active.length > 0 || dormant.length > 0 ? (
            <div className="circuit-band">
              <Today circuit={data} />
              <Dormant prs={dormant} />
            </div>
          ) : null}
          {!active.length && <Repos circuit={data} />}
        </div>
      )}
      {run && <RunDrawer run={run} setChat={setChat} dismiss={dismiss} onClose={() => setOpenRun(null)} />}
      {adding && data && <AddPrs circuit={data} onClose={() => setAdding(false)} onSaved={reload} />}
    </div>
  );
}

function MiniCircuit({ pr }: { pr: Pr }) {
  const stops = [...STATIONS, { id: "prod" as const, label: "Production", hint: "" }];
  const index = stops.findIndex((s) => s.id === pr.station);
  return (
    <div className="mini-circuit">
      {stops.map((s, i) => {
        const state = pr.station === "dormant" ? "ahead" : i < index ? "passed" : i === index ? "stopped" : "ahead";
        return (
          <div key={s.id} className={`mini-stop ${state} ${s.id}`}>
            <i />
            <b>{s.label}</b>
            <span>{state === "stopped" ? pr.reason : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function standing(pr: Pr) {
  const lines = [];
  if (pr.station === "dormant") lines.push(`Idle since ${new Date(pr.updatedAt).toLocaleDateString()}.`);
  else if (pr.action === "wait") lines.push(`CI is red, but ${pr.baseRef} fails the same way.`);
  else if (pr.station === "base") lines.push(`Stopped at Base: ${pr.conflictFiles.length ? plural(pr.conflictFiles.length, "file") : "something"} in conflict with ${pr.baseRef}.`);
  else lines.push(`Stopped at ${STATIONS.find((s) => s.id === pr.station)?.label}: ${pr.reason.toLowerCase()}.`);
  if (pr.device && !pr.device.ok) lines.push("The device test failed and nobody repeated it.");
  return lines.join(" ");
}

function nextLine(pr: Pr) {
  if (pr.blockedBy) return `Waiting on #${pr.blockedBy.number} by ${pr.blockedBy.author}: ${pr.blockedBy.title}`;
  if (pr.manualTag) return `Marked by hand: ${pr.manualTag}`;
  return nextStepText(pr);
}

const WHO: Record<string, string> = { "chatgpt-codex-connector": "Codex", claude: "Claude on GitHub", "github-actions": "GitHub Actions" };
const KIND_ICON: Record<string, typeof Bot> = { session: Bot, agent: Sparkles, review: Sparkles, comment: User, commit: GitCommitHorizontal, test: Smartphone, preview: QrCode };

function History({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState<"all" | "agents" | "github">("all");
  const isAgent = (e: TimelineEvent) => ["session", "agent", "review"].includes(e.kind);
  const shown = events.filter((e) => filter === "all" || (filter === "agents") === isAgent(e));
  const agents = events.filter(isAgent).length;
  return (
    <section className="pr-history">
      <header>
        <strong>History</strong>
        <span>
          {plural(agents, "agent run")} and {plural(events.length - agents, "event")}
        </span>
        <span className="spacer" />
        <div className="pr-history-filter">
          {(["all", "agents", "github"] as const).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "agents" ? "Agents" : "GitHub"}
            </button>
          ))}
        </div>
      </header>
      {shown.map((e, i) => {
        const Icon = KIND_ICON[e.kind] ?? MessageSquare;
        return (
          <div key={i} className={`pr-event ${e.kind}`}>
            <time title={new Date(e.at).toLocaleString()}>{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            <Icon size={14} />
            <b>{WHO[e.who] ?? e.who}</b>
            <span>{e.text}</span>
            {e.sessionId ? (
              <a className="btn ghost" href={href.session(e.sessionId)}>
                Open session
              </a>
            ) : (
              e.url && (
                <a className="icon-btn" href={e.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                  <ExternalLink size={13} />
                </a>
              )
            )}
          </div>
        );
      })}
    </section>
  );
}

function Conflicts({ detail, pr }: { detail: PrDetail; pr: Pr }) {
  if (!detail.conflicts.length) return null;
  return (
    <section className="pr-conflicts">
      <header>
        <GitMerge size={15} />
        <strong>{plural(detail.conflicts.length, "file")} in conflict</strong>
        <span>with {pr.baseRef}</span>
      </header>
      {detail.conflicts.map((c) => (
        <div key={c.file} className="pr-conflict">
          <div className="pr-conflict-file">
            <FileCode size={13} /> <code>{c.file}</code>
          </div>
          {c.hunks.map((h) => (
            <div key={h.line} className="pr-hunk">
              <div>
                <small>{pr.baseRef}</small>
                <pre>{h.base.join("\n") || " "}</pre>
              </div>
              <div>
                <small>{pr.branch}</small>
                <pre>{h.head.join("\n") || " "}</pre>
              </div>
            </div>
          ))}
          {!c.hunks.length && <div className="circuit-note">Both sides changed this file; there's no text to compare.</div>}
        </div>
      ))}
    </section>
  );
}

/** Each command opens a session on the PR's own worktree, so this PR's work never touches your checkout. */
function Commands({ pr, detail, busy }: { pr: Pr; detail: PrDetail; busy: boolean }) {
  const { run, next, close, deviceTest } = usePrActions();
  const commands = detail.commands;
  if (!commands) return null;
  const button = (name: string, primary = false, title?: string) => (
    <button key={name} className={`btn ${primary ? "primary" : "ghost"}`} title={title} disabled={busy} onClick={() => run(pr, name)}>
      {primary && <Play size={12} />} {commandLabel(name)}
    </button>
  );
  return (
    <section className="pr-commands">
      <header>
        <strong>Run on this PR</strong>
        <span>what it needs first, then what you use the most</span>
      </header>
      <div>
        {pr.action === "mark-ready" && (
          <button className="btn primary" onClick={() => next(pr)}>
            Mark ready
          </button>
        )}
        {pr.station === "dormant" && button("resume", true, "Catches you up without changing anything")}
        {commands.recommended && button(commands.recommended, true, commands.recommended === "rebase" ? "Rebases and asks you before pushing" : undefined)}
        {commands.device && (
          <button className={`btn ${commands.wanted === "@test" ? "attention" : "ghost"}`} title="Asks CI for a device test" onClick={() => deviceTest(pr)}>
            @test
          </button>
        )}
        {commands.top.map((c) => button(c.name, false, c.description))}
        <Menu value={undefined as string | undefined} options={commands.more.map((c) => ({ value: c.name, label: commandLabel(c.name), hint: c.uses ? `used ${c.uses}×` : undefined }))} onChange={(name) => run(pr, name)} placeholder="Search skills…">
          <span className="btn ghost">
            More <ChevronDown size={12} />
          </span>
        </Menu>
        {pr.station === "dormant" && (
          <button className="btn ghost" onClick={() => close(pr)}>
            Close PR
          </button>
        )}
      </div>
    </section>
  );
}

function useQr(link?: string) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (link) void QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then(setQr);
    else setQr("");
  }, [link]);
  return qr;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost"
      onClick={() => {
        void navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy size={13} /> {copied ? "Copied" : "Copy link"}
    </button>
  );
}

const METRO_WAIT: Record<string, string> = { installing: "Installing this PR's dependencies. The first time takes a few minutes.", generating: "Generating this PR's code…", starting: "Starting Metro…" };

function MetroPanel({ pr, repo, number, initial }: { pr?: Pr; repo: string; number: number; initial: MetroState }) {
  const { openDialog } = useApp();
  const [metro, setMetro] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const qr = useQr(metro.status === "running" ? metro.link : undefined);
  useEffect(() => onServerEvent("ws:metro", (e: { key: string }) => e.key === `${repo}#${number}` && void circuitApi.metro(repo, number).then(setMetro)), [repo, number]);
  const start = (tunnel = false) => {
    setError(null);
    const go = () => circuitApi.metroAction("start", repo, number, tunnel).then(setMetro, (e) => setError((e as Error).message));
    if (pr && !pr.mine) openDialog({ title: `Run ${pr.author}'s code with Metro? It installs and runs this PR on your Mac.`, fields: [], submitLabel: "Start Metro", onSubmit: () => go().then(() => undefined) });
    else void go();
  };
  const stop = () => void circuitApi.metroAction("stop", repo, number).then(setMetro);
  if (METRO_WAIT[metro.status]) {
    return (
      <div className="pr-metro-wait">
        <RefreshCw size={14} className="spin" /> {METRO_WAIT[metro.status]}
      </div>
    );
  }
  if (metro.status === "running" && metro.link) {
    return (
      <>
        <div className="pr-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <dl>
          <div>
            <dt>Metro</dt>
            <dd className="live">running</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{metro.tunnel ? "tunnel" : `${metro.host}:${metro.port}`}</dd>
          </div>
          <div>
            <dt>Needs</dt>
            <dd>a development build</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>API_HOST in .env.local</dd>
          </div>
        </dl>
        <div className="pr-rail-buttons">
          <CopyLink link={metro.link} />
          <button className="btn ghost" onClick={stop}>
            <Square size={12} /> Stop
          </button>
        </div>
        {!metro.tunnel && <div className="circuit-note">The POS has to be on the same network as this Mac.</div>}
        {metro.stale && <div className="pr-warning"><b>Generated code comes from your main checkout.</b><span>Codegen couldn't run here, so GraphQL types may lag behind this PR.</span></div>}
      </>
    );
  }
  return (
    <>
      <div className="circuit-note">Metro serves this PR's code live to a POS with a development build. Starting it shows the QR here.</div>
      {metro.status === "failed" && <div className="pr-warning"><b>{metro.error}</b>{metro.log?.slice(-3).map((l, i) => <span key={i}>{l}</span>)}</div>}
      {error && <div className="dialog-error">{error}</div>}
      <div className="pr-rail-buttons">
        <button className="btn primary" onClick={() => start()}>
          <Play size={12} /> Start Metro
        </button>
        <button className="btn ghost" title="For a POS on another network" onClick={() => start(true)}>
          <Globe size={13} /> Tunnel
        </button>
      </div>
    </>
  );
}

function ExpoPanel({ expo }: { expo: NonNullable<PrDetail["expo"]> }) {
  const qr = useQr(expo.link);
  const rows = [
    ["Update", expo.update],
    ["Published", new Date(expo.at).toLocaleDateString()],
    ["Runtime", expo.runtime],
    ["Follows", "the branch, not a commit"],
    ["Needs", "a development build"],
  ];
  return (
    <>
      <div className="pr-qr" dangerouslySetInnerHTML={{ __html: qr }} />
      <dl>
        {rows.map(([k, v]) => v && (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <CopyLink link={expo.link} />
      {expo.prodTest && (
        <div className="pr-warning">
          <b>{expo.labeled ? "Uses live production data and services." : "With prod-test it uses live production data and services."}</b>
          {!expo.labeled && <span>Without the label, this preview doesn't update.</span>}
        </div>
      )}
    </>
  );
}

function TryOnPos({ pr, repo, number, detail }: { pr?: Pr; repo: string; number: number; detail: PrDetail }) {
  const { expo, metro } = detail;
  const [tab, setTab] = useState<"expo" | "metro">(metro && (!expo || metro.status !== "stopped") ? "metro" : "expo");
  return (
    <section className="pr-rail-block">
      <strong>Try on the POS</strong>
      {expo && metro && (
        <div className="pr-history-filter pr-tabs">
          <button className={tab === "expo" ? "active" : ""} onClick={() => setTab("expo")}>
            Expo preview
          </button>
          <button className={tab === "metro" ? "active" : ""} onClick={() => setTab("metro")}>
            Metro local
          </button>
        </div>
      )}
      {tab === "expo" && expo && <ExpoPanel expo={expo} />}
      {tab === "metro" && metro && <MetroPanel pr={pr} repo={repo} number={number} initial={metro} />}
    </section>
  );
}

export function PrDetailPage({ repo, number }: { repo: string; number: number }) {
  const { project } = useApp();
  const { data, reload } = useCircuit("all");
  const { data: folder } = useCircuit(project);
  const pr = data?.prs.find((p) => p.key === `${repo}#${number}`);
  const refresh = useFreshSweep(project, folder);
  const { runs, dismiss, setChat } = useRuns(pr ? [pr] : [], refresh);
  const run = pr ? runs.get(pr.key) : undefined;
  const added = folder?.tracked.prs.includes(`${repo}#${number}`);
  const remove = () => void circuitApi.save(project, { tracked: { prs: folder!.tracked.prs.filter((k) => k !== `${repo}#${number}`) } }).then(() => circuitApi.sweep(project)).then(reload);
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    circuitApi.detail(repo, number).then(setDetail, (e) => setError((e as Error).message));
  }, [repo, number, folder?.at]);
  useEffect(() => {
    document.title = `${repo.split("/")[1]} #${number}`;
  }, [repo, number]);
  return (
    <div className="home pr-detail">
      <header className="topbar">
        <a className="icon-btn" href={href.prs()} title="Back to PRs">
          <ArrowLeft size={15} />
        </a>
        <div className="topbar-title">
          {repo.split("/")[1]} #{number}
        </div>
        <span className="spacer" />
        {pr?.project && (
          <a className="btn ghost" href={href.task(pr.project.id)}>
            <Folder size={13} /> {pr.project.title}
          </a>
        )}
        {pr && !pr.project && <ConnectProject prs={[pr]} />}
        {added && (
          <button className="btn ghost" onClick={remove}>
            Remove from list
          </button>
        )}
        {pr && (
          <a className="btn ghost" href={pr.url} target="_blank" rel="noreferrer">
            <GitPullRequest size={13} /> GitHub
          </a>
        )}
      </header>
      <div className="pr-detail-body">
        <main>
          {pr ? (
            <>
              <h1>{pr.title}</h1>
              <div className="pr-meta">
                <code>
                  {pr.branch} → {pr.baseRef}
                </code>
                <span>
                  {pr.behind !== null && `${pr.behind} behind · `}
                  {plural(pr.changedFiles, "file")} · +{pr.additions} −{pr.deletions}
                  {pr.mine ? "" : ` · by ${pr.author}`}
                </span>
              </div>
              <MiniCircuit pr={pr} />
              <div className="pr-standing">
                <Sparkles size={16} />
                <div>
                  <b>{standing(pr)}</b>
                  <span>Next: {nextLine(pr)}</span>
                </div>
              </div>
            </>
          ) : (
            data && <div className="circuit-note">This PR isn't in the last sweep.</div>
          )}
          {error && <div className="circuit-error">{error}</div>}
          {!detail && !error && <div className="circuit-note">Loading history…</div>}
          {run && (
            <section className="pr-run-section">
              <strong>{commandLabel(run.command)}</strong>
              <RunBody run={run} setChat={setChat} dismiss={dismiss} />
            </section>
          )}
          {detail && pr && <Commands pr={pr} detail={detail} busy={Boolean(run && run.phase !== "finished")} />}
          {detail && pr && <Conflicts detail={detail} pr={pr} />}
          {detail && <History events={detail.timeline} />}
        </main>
        {detail && (detail.expo || detail.metro || detail.previews.length > 0 || detail.device || pr?.blockedBy) && (
          <aside>
            {(detail.expo || detail.metro) && <TryOnPos pr={pr} repo={repo} number={number} detail={detail} />}
            {detail.previews.length > 0 && (
              <section className="pr-rail-block">
                <strong>Previews</strong>
                {detail.previews.map((p) => (
                  <a key={p.url} className="pr-preview" href={p.url} target="_blank" rel="noreferrer">
                    <span>{p.name}</span>
                    <ExternalLink size={12} />
                  </a>
                ))}
              </section>
            )}
            {pr?.blockedBy && (
              <section className="pr-rail-block">
                <strong>Waiting on</strong>
                <a className="pr-preview" href={pr.blockedBy.url} target="_blank" rel="noreferrer">
                  <span>
                    #{pr.blockedBy.number} · {pr.blockedBy.title}
                  </span>
                  <ExternalLink size={12} />
                </a>
              </section>
            )}
            {detail.device && (
              <section className={`pr-rail-block device ${detail.device.ok ? "ok" : "failed"}`}>
                <strong>
                  <Smartphone size={14} /> {detail.device.ok ? "Device test passed" : "Device test failed"}
                </strong>
                <span>
                  {detail.device.path} · {timeAgo(detail.device.at)}
                </span>
                {detail.device.video && (
                  <a className="btn ghost" href={detail.device.video} target="_blank" rel="noreferrer">
                    Video and artifacts
                  </a>
                )}
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
