import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, FileText, GitCommitHorizontal, GitPullRequest, Image as ImageIcon, LayoutDashboard } from "lucide-react";
import type { createAgentStage } from "../agent-stage";
import { api, fileUrl } from "../api";
import { useApp } from "../app-context";
import { href } from "../router";
import type { SessionSummary } from "../sessions";
import type { Activity, ActivityEvent, Task } from "../types";
import { timeAgo } from "../ui";
import { lastVisit } from "../viewed";
import { StatusDot, ToolIcon } from "./Agents";

const MAX_STAGE = 4;
const isRefresh = (s: SessionSummary) => s.project.startsWith("AI refresh");
const shortTool = (name?: string) => (name?.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name);
const firstLine = (text?: string | null) => text?.replace(/[*_`#>]/g, "").split("\n").find((l) => l.trim())?.trim();

/** The project's agents on stage: what each one (and its subagents) is doing right now. */
export function ProjectAgents({ task }: { task: Task }) {
  const { sessions } = useApp();
  const linked = useMemo(() => sessions.filter((s) => s.taskIds?.includes(task.id) && !isRefresh(s)), [sessions, task.id]);
  const live = useMemo(
    () =>
      linked
        .filter((s) => s.status !== "inactive")
        .sort((a, b) => Number(b.status === "working") - Number(a.status === "working") || (b.lastTs ?? "").localeCompare(a.lastTs ?? "")),
    [linked],
  );
  const shown = live.slice(0, MAX_STAGE);

  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<ReturnType<typeof createAgentStage> | null>(null);
  const hasStage = shown.length > 0;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasStage || !canvas.current) return;
    let alive = true;
    // three.js only loads when a project has agents to show.
    void import("../agent-stage").then(({ createAgentStage }) => {
      if (!alive || !canvas.current) return;
      stage.current = createAgentStage(canvas.current);
      setReady(true);
    });
    return () => {
      alive = false;
      stage.current?.dispose();
      stage.current = null;
      setReady(false);
    };
  }, [hasStage]);
  const stageKey = shown.map((s) => `${s.id}:${s.status}:${s.subagents.filter((a) => a.status === "working").length}`).join("|");
  useEffect(() => {
    stage.current?.setAgents(shown.map((s) => ({ id: s.id, status: s.status, subs: s.subagents.filter((a) => a.status === "working").map((a) => ({ status: a.status })) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, ready]);

  const working = live.filter((s) => s.status === "working").length;
  return (
    <section className="project-agents">
      <div className="project-agents-head">
        <Bot size={14} />
        <span>Agents</span>
        <span className="project-agents-count">{working ? `${working} working` : live.length ? `${live.length} waiting for you` : "None running"}</span>
        <span className="spacer" />
        <a className="btn-quiet" href={href.taskSession(task.id)}>
          Sessions {linked.length > 0 && <span className="count">{linked.length}</span>} <ArrowRight size={13} />
        </a>
      </div>
      {hasStage ? (
        <div className="agent-stage" style={{ ["--cols" as string]: shown.length }}>
          <canvas ref={canvas} className="agent-stage-canvas" aria-hidden="true" />
          <div className="agent-stage-cards">
            {shown.map((s) => (
              <AgentCard key={s.id} session={s} />
            ))}
          </div>
          {live.length > shown.length && (
            <a className="agent-stage-more" href={href.taskSession(task.id)}>
              +{live.length - shown.length} more
            </a>
          )}
        </div>
      ) : (
        <div className="project-agents-empty">No agent is running in this project. Start one from Sessions.</div>
      )}
    </section>
  );
}

function AgentCard({ session }: { session: SessionSummary }) {
  const working = session.status === "working";
  const subs = [...session.subagents].sort((a, b) => Number(b.status === "working") - Number(a.status === "working")).slice(0, 3);
  const activeSubs = session.subagents.filter((a) => a.status === "working").length;
  return (
    <div className={`agent-card ${working ? "working" : ""}`}>
      <a className="agent-card-main" href={href.session(session.id)}>
        <span className="agent-card-state">
          <StatusDot status={session.status} size={7} /> {working ? "Working" : "Waiting for you"} · {timeAgo(session.lastTs)}
        </span>
        <span className="agent-card-title">{session.title}</span>
        <span className="agent-card-doing">
          {working && session.lastAction ? (
            <>
              <ToolIcon name={session.lastAction.tool} size={12} />
              <span>{session.lastAction.title || shortTool(session.lastAction.tool)}</span>
            </>
          ) : (
            <span>{firstLine(session.lastText) ?? "—"}</span>
          )}
        </span>
      </a>
      {subs.length > 0 && (
        <div className="agent-card-subs">
          <div className="agent-card-subs-head">
            Subagents {activeSubs ? `· ${activeSubs} working` : ""} {session.subagents.length > subs.length && `· ${session.subagents.length} total`}
          </div>
          {subs.map((a) => (
            <a key={a.id} className={`agent-card-sub ${a.status === "working" ? "working" : ""}`} href={href.session(session.id, a.id)}>
              <StatusDot status={a.status} size={6} />
              <span className="agent-card-sub-title">{a.description}</span>
              {a.status === "working" && a.lastAction && <span className="agent-card-sub-doing">{a.lastAction.title || shortTool(a.lastAction.tool)}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "short" });
function dayLabel(day: string) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return day === today ? "Today" : day === yesterday ? "Yesterday" : DAY_FMT.format(new Date(`${day}T12:00:00`));
}

/** What got done in the project, day by day: agent sessions with their commits and PRs, screenshots, pages edited. */
export function ProjectActivity({ task }: { task: Task }) {
  const { sessions } = useApp();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [since] = useState(() => lastVisit(task.id));
  // Reload when a linked session changes state or writes something new.
  const pulse = sessions
    .filter((s) => s.taskIds?.includes(task.id))
    .map((s) => `${s.status}${s.lastTs}`)
    .join();
  useEffect(() => {
    let alive = true;
    api.activity(task.id).then((a) => alive && setActivity(a), () => {});
    return () => {
      alive = false;
    };
  }, [task.id, task.updatedAt, pulse]);

  const days = useMemo(() => {
    const out = new Map<string, ActivityEvent[]>();
    for (const e of activity?.events ?? []) {
      const day = new Date(e.ts).toLocaleDateString("sv"); // local YYYY-MM-DD
      out.set(day, [...(out.get(day) ?? []), e]);
    }
    return [...out.entries()];
  }, [activity]);

  const fresh = (activity?.events ?? []).filter((e) => since && e.ts > since);
  const count = (kind: ActivityEvent["kind"]) => fresh.filter((e) => e.kind === kind).length;
  const commits = fresh.reduce((n, e) => n + (e.kind === "session" ? e.commits.length : 0), 0);
  const shots = fresh.reduce((n, e) => n + (e.kind === "evidence" ? e.assets.length : 0), 0);
  const recap = [
    count("session") && `${count("session")} session${count("session") > 1 ? "s" : ""}`,
    commits && `${commits} commit${commits > 1 ? "s" : ""}`,
    shots && `${shots} screenshot${shots > 1 ? "s" : ""}`,
    count("pages") && "pages edited",
  ].filter(Boolean);

  if (!activity) return null;
  return (
    <section className="project-activity">
      <div className="project-agents-head">
        <span>Activity</span>
        <span className="project-agents-count">last 14 days</span>
      </div>
      {since && (
        <div className={`activity-recap ${recap.length ? "" : "quiet"}`}>
          {recap.length ? (
            <>
              <strong>Since your last visit</strong> ({timeAgo(since)}): {recap.join(" · ")}
            </>
          ) : (
            <>Nothing new since your last visit ({timeAgo(since)}).</>
          )}
        </div>
      )}
      {days.length === 0 && <div className="project-agents-empty">No activity in the last 14 days.</div>}
      {days.map(([day, events]) => (
        <div key={day} className="activity-day">
          <div className="activity-day-label">{dayLabel(day)}</div>
          {events.map((e) => (
            <ActivityRow key={`${e.kind}-${e.ts}-${e.kind === "session" ? e.sessionId : ""}`} task={task} event={e} isNew={Boolean(since && e.ts > since)} />
          ))}
        </div>
      ))}
    </section>
  );
}

function ActivityRow({ task, event: e, isNew }: { task: Task; event: ActivityEvent; isNew: boolean }) {
  const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (
    <div className={`activity-row ${isNew ? "new" : ""}`}>
      <span className="activity-time">{time}</span>
      <span className="activity-icon">
        {e.kind === "session" ? <StatusDot status={e.status} size={7} /> : e.kind === "evidence" ? <ImageIcon size={13} /> : <FileText size={13} />}
      </span>
      <div className="activity-body">
        {e.kind === "session" && (
          <>
            <a className="activity-title" href={href.session(e.sessionId)}>
              {e.title}
            </a>
            {firstLine(e.lastText) && <div className="activity-text">{firstLine(e.lastText)}</div>}
            {(e.commits.length > 0 || e.prs.length > 0) && (
              <div className="activity-chips">
                {e.prs.map((url) => (
                  <a key={url} className="activity-chip" href={url} target="_blank" rel="noreferrer">
                    <GitPullRequest size={11} /> #{url.split("/").pop()}
                  </a>
                ))}
                {e.commits.map((c) => (
                  <span key={c.sha} className="activity-chip" title={`${c.branch} · ${c.sha}`}>
                    <GitCommitHorizontal size={11} /> {c.subject}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {e.kind === "evidence" && (
          <>
            <div className="activity-title">
              {e.assets.length} screenshot{e.assets.length > 1 ? "s" : ""} added
            </div>
            <div className="activity-thumbs">
              {e.assets.slice(0, 6).map((a) => (
                <img key={a} src={fileUrl(task.id, `assets/${a}`)} alt={a} title={a} loading="lazy" />
              ))}
            </div>
          </>
        )}
        {e.kind === "pages" && (
          <div className="activity-title">
            Edited{" "}
            {e.pages.map((p, i) => {
              const board = task.boards.some((b) => b.id === p.id);
              return (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <a href={board ? href.board(task.id, p.id) : href.doc(task.id, p.id)}>
                    {board && <LayoutDashboard size={11} />} {p.title}
                  </a>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
