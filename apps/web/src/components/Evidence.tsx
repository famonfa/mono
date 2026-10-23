import { useEffect, useMemo, useState } from "react";
import { Bot, FlaskConical, GitPullRequest, Loader2 } from "lucide-react";
import { useApp } from "../app-context";
import { href } from "../router";
import { sessionsApi, type SessionSummary } from "../sessions";
import type { PrStatus, Task } from "../types";
import { timeAgo } from "../ui";

const VIDEO = /\.(mp4|webm)$/i;
export const isVideo = (file: string) => VIDEO.test(file);


function lastActivity(sessions: SessionSummary[]) {
  return sessions.reduce<string | undefined>((latest, s) => (s.lastTs && (!latest || s.lastTs > latest) ? s.lastTs : latest), undefined);
}

function prLabel(pr: PrStatus) {
  if (pr.error) return { text: "no data", tone: "muted" };
  if (pr.state === "MERGED") return { text: "merged", tone: "done" };
  if (pr.state === "CLOSED") return { text: "closed", tone: "muted" };
  if (pr.checks?.failing) return { text: `CI: ${pr.checks.failing} failing`, tone: "bad" };
  if (pr.checks?.pending) return { text: "CI running", tone: "warn" };
  if (pr.checks?.total) return { text: pr.state === "DRAFT" ? "draft · CI ok" : "CI ok", tone: "ok" };
  return { text: pr.state === "DRAFT" ? "draft" : "open", tone: "muted" };
}

/** Three live signals at a glance: who is working, PRs + CI, and tests. */
export function StatusStrip({ task }: { task: Task }) {
  const { sessions } = useApp();
  const linked = useMemo(() => sessions.filter((s) => s.taskIds?.includes(task.id)), [sessions, task.id]);
  const working = linked.filter((s) => s.status === "working").length;
  const last = lastActivity(linked);

  const [prs, setPrs] = useState<PrStatus[]>([]);
  const hasPrs = Boolean(task.repos?.some((r) => r.pr));
  useEffect(() => {
    if (!hasPrs) return setPrs([]);
    let alive = true;
    const load = () => sessionsApi.prStatus(task.id).then((list) => alive && setPrs(list), () => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [task.id, hasPrs, task.updatedAt]);

  const tests = task.tests;
  const testsBoard = task.boards.find((b) => b.kind === "tests");

  return (
    <div className="status-strip">
      <div className="status-tile">
        <div className="status-tile-head">
          <Bot size={13} /> Agents
        </div>
        <div className="status-tile-value">{working ? `${working} working` : linked.length ? "Idle" : "No sessions"}</div>
        <div className="status-tile-sub">{last ? `Last active ${timeAgo(last)}` : "No activity"}</div>
      </div>

      <div className="status-tile">
        <div className="status-tile-head">
          <GitPullRequest size={13} /> PRs
        </div>
        {hasPrs ? (
          <div className="status-prs">
            {(task.repos ?? [])
              .filter((r) => r.pr)
              .map((r) => {
                const pr = prs.find((p) => p.url === r.pr);
                const label = pr ? prLabel(pr) : null;
                return (
                  <a key={r.pr} href={r.pr} target="_blank" rel="noreferrer" title={pr?.title ?? r.name}>
                    <span className="mono">#{r.pr!.split("/").pop()}</span>
                    {label ? <span className={`pill ${label.tone}`}>{label.text}</span> : <Loader2 size={11} className="spin" />}
                  </a>
                );
              })}
          </div>
        ) : (
          <div className="status-tile-value muted">No PRs</div>
        )}
      </div>

      <a className="status-tile link" href={testsBoard ? href.board(task.id, testsBoard.id) : undefined}>
        <div className="status-tile-head">
          <FlaskConical size={13} /> Tests
        </div>
        {tests?.total ? (
          <>
            <div className="status-tile-value">
              {tests.pass}/{tests.total} passed{tests.fail ? <span className="bad"> · {tests.fail} failing</span> : null}
            </div>
            <div className="test-bar" title={`${tests.pass} passed · ${tests.fail} failing · ${tests.todo} untested`}>
              <i className="pass" style={{ flex: tests.pass }} />
              <i className="fail" style={{ flex: tests.fail }} />
              <i className="todo" style={{ flex: tests.todo + tests.skip }} />
            </div>
          </>
        ) : (
          <div className="status-tile-value muted">No test cases</div>
        )}
      </a>
    </div>
  );
}
