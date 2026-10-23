import { useEffect, useMemo, useState } from "react";
import { Camera, CircleAlert, Film, FlaskConical, GitPullRequest, Loader2, Bot } from "lucide-react";
import { api, fileUrl, useLiveData } from "../api";
import { useApp } from "../app-context";
import { href } from "../router";
import { sessionsApi, useRefreshJob, type SessionSummary } from "../sessions";
import { CHANGE_STATUS, type CaptureSkill, type PrStatus, type Task, type WsNode } from "../types";
import { formatDate, Menu } from "../ui";

const VIDEO = /\.(mp4|webm)$/i;
export const isVideo = (file: string) => VIDEO.test(file);

/** formatDate says "ahora" for the last minute, which doesn't take a "hace" in front. */
const ago = (iso: string) => (formatDate(iso) === "ahora" ? "ahora" : `hace ${formatDate(iso)}`);

function lastActivity(sessions: SessionSummary[]) {
  return sessions.reduce<string | undefined>((latest, s) => (s.lastTs && (!latest || s.lastTs > latest) ? s.lastTs : latest), undefined);
}

function prLabel(pr: PrStatus) {
  if (pr.error) return { text: "sin datos", tone: "muted" };
  if (pr.state === "MERGED") return { text: "mergeado", tone: "done" };
  if (pr.state === "CLOSED") return { text: "cerrado", tone: "muted" };
  if (pr.checks?.failing) return { text: `CI: ${pr.checks.failing} fallan`, tone: "bad" };
  if (pr.checks?.pending) return { text: "CI en curso", tone: "warn" };
  if (pr.checks?.total) return { text: pr.state === "DRAFT" ? "borrador · CI ok" : "CI ok", tone: "ok" };
  return { text: pr.state === "DRAFT" ? "borrador" : "abierto", tone: "muted" };
}

/** Four live signals at a glance: who is working, PRs + CI, tests, and how much of the UI has evidence. */
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
  const evidence = task.evidence;

  return (
    <div className="status-strip">
      <div className="status-tile">
        <div className="status-tile-head">
          <Bot size={13} /> Agentes
        </div>
        <div className="status-tile-value">{working ? `${working} trabajando` : linked.length ? "Quietos" : "Sin sesiones"}</div>
        <div className="status-tile-sub">{last ? `Último movimiento ${ago(last)}` : "Sin actividad registrada"}</div>
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
          <div className="status-tile-value muted">Sin PRs</div>
        )}
      </div>

      <a className="status-tile link" href={testsBoard ? href.board(task.id, testsBoard.id) : undefined}>
        <div className="status-tile-head">
          <FlaskConical size={13} /> Tests
        </div>
        {tests?.total ? (
          <>
            <div className="status-tile-value">
              {tests.pass}/{tests.total} pasaron{tests.fail ? <span className="bad"> · {tests.fail} fallan</span> : null}
            </div>
            <div className="test-bar" title={`${tests.pass} pasaron · ${tests.fail} fallan · ${tests.todo} sin probar`}>
              <i className="pass" style={{ flex: tests.pass }} />
              <i className="fail" style={{ flex: tests.fail }} />
              <i className="todo" style={{ flex: tests.todo + tests.skip }} />
            </div>
          </>
        ) : (
          <div className="status-tile-value muted">Sin casos de test</div>
        )}
      </a>

      <div className="status-tile">
        <div className="status-tile-head">
          <Camera size={13} /> Evidencia
        </div>
        {evidence?.total ? (
          <>
            <div className="status-tile-value">
              {evidence.withMedia}/{evidence.total} pantallas
              {evidence.withMedia < evidence.total ? <span className="warn"> · faltan {evidence.total - evidence.withMedia}</span> : null}
            </div>
            <div className="test-bar">
              <i className="pass" style={{ flex: evidence.withMedia }} />
              <i className="todo" style={{ flex: evidence.total - evidence.withMedia }} />
            </div>
          </>
        ) : (
          <div className="status-tile-value muted">Sin pantallas registradas</div>
        )}
      </div>
    </div>
  );
}

function Media({ taskId, node, onOpen }: { taskId: string; node: WsNode; onOpen: (url: string) => void }) {
  const { image, label } = node.data;
  const video = node.data.video as string | undefined;
  if (video) return <video src={fileUrl(taskId, video)} poster={image ? fileUrl(taskId, image) : undefined} controls muted loop playsInline preload="metadata" />;
  if (image) return <img src={fileUrl(taskId, image)} alt={label} loading="lazy" onClick={() => onOpen(fileUrl(taskId, image))} />;
  return (
    <div className="evidence-missing">
      <CircleAlert size={15} /> Falta captura
    </div>
  );
}

/** Capture target + skill picker + run button. Skills are the ones Mono ships; the choice is saved on the task. */
function CapturePanel({ task, skills, onChange }: { task: Task; skills: CaptureSkill[]; onChange: () => void }) {
  const { updateTask } = useApp();
  const { job, start } = useRefreshJob(task.id, onChange);
  const [error, setError] = useState<string | null>(null);
  const chosen = skills.find((s) => s.id === task.capture?.skill);
  const running = job.status === "running";
  const capturing = running && job.mode === "capture";

  const save = async (capture: Task["capture"]) => {
    await updateTask(task.id, { capture: { ...task.capture, ...capture } });
    onChange();
  };

  const run = async () => {
    setError(null);
    try {
      await start("capture");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="capture-panel">
      <Menu
        value={chosen?.id}
        options={skills.map((s) => ({ value: s.id, label: `${s.name.replace(/^capture-/, "")} · ${s.targets.join(", ")}${s.verified ? "" : " (sin verificar)"}` }))}
        onChange={(skill) => save({ skill })}
        className="btn"
      >
        {chosen ? chosen.name.replace(/^capture-/, "") : "Elegir cómo capturar…"}
      </Menu>
      <button className="btn ai" onClick={run} disabled={running || !chosen} title={chosen ? chosen.description : "Elegí primero la skill de captura"}>
        {capturing ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
        {capturing ? "Capturando…" : "Capturar evidencia"}
      </button>
      <textarea
        className="capture-notes"
        rows={2}
        defaultValue={task.capture?.notes ?? ""}
        placeholder="Cómo correr la app y llegar a cada pantalla: URL, bundle id o paquete, deep links, login de prueba…"
        onBlur={(e) => e.target.value.trim() !== (task.capture?.notes ?? "").trim() && save({ notes: e.target.value.trim() })}
      />
      {chosen && !chosen.verified && <div className="capture-hint warn">Esta skill todavía no se probó en una máquina real: puede fallar.</div>}
      {running && job.mode === "refresh" && <div className="capture-hint">Hay una actualización en curso; esperá a que termine para capturar.</div>}
      {job.status === "failed" && job.mode === "capture" && <div className="capture-hint bad">La captura falló. Mirá el resultado en “Actualizar con IA → Ver error”.</div>}
      {error && <div className="capture-hint bad">{error}</div>}
    </div>
  );
}

/** "Qué cambió": one tile per screen of the `ui` board with its screenshot or clip, and an explicit gap where evidence is missing. */
export function EvidenceGallery({ task, onChange, onOpen }: { task: Task; onChange: () => void; onOpen: (url: string) => void }) {
  const uiBoard = task.boards.find((b) => b.kind === "ui");
  const { data: board } = useLiveData(() => (uiBoard ? api.getBoard(task.id, uiBoard.id) : Promise.resolve(null)), [task.id, uiBoard?.id, task.updatedAt], task.id);
  const [skills, setSkills] = useState<CaptureSkill[]>([]);
  useEffect(() => void sessionsApi.captureSkills().then(setSkills, () => {}), []);

  const lanes = useMemo(() => {
    const groups = new Map<string, WsNode[]>();
    for (const node of board?.nodes ?? []) {
      if (node.type !== "card" && node.type !== "image") continue;
      const lane = (node.data.lane as string | undefined) ?? "Sin pantalla";
      groups.set(lane, [...(groups.get(lane) ?? []), node]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }));
  }, [board]);

  return (
    <section className="evidence">
      <div className="evidence-head">
        <div>
          <h3>Qué cambió</h3>
          <p>Capturas y videos de cada pantalla tocada.{task.capturedAt ? ` Última captura ${ago(task.capturedAt)}.` : ""}</p>
        </div>
        <Film size={15} className="evidence-icon" />
      </div>
      <CapturePanel task={task} skills={skills} onChange={onChange} />
      {lanes.length === 0 ? (
        <div className="evidence-empty">Todavía no hay pantallas registradas. Al capturar, o al actualizar con IA, aparecen acá.</div>
      ) : (
        lanes.map(([lane, nodes]) => (
          <div key={lane} className="evidence-lane">
            <div className="evidence-lane-title">{lane}</div>
            <div className="evidence-grid">
              {nodes.map((node) => (
                <figure key={node.id} className={node.data.image || node.data.video ? "" : "missing"}>
                  <Media taskId={task.id} node={node} onOpen={onOpen} />
                  <figcaption>
                    <span className="evidence-label">{node.data.label}</span>
                    {node.data.status && (
                      <span className="evidence-status" style={{ color: CHANGE_STATUS[node.data.status].color }}>
                        {CHANGE_STATUS[node.data.status].label}
                      </span>
                    )}
                    {node.data.detail && <span className="evidence-detail">{node.data.detail}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
