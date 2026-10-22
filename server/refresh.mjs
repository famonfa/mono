import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./store.mjs";

const HOME = os.homedir();
const RUN_DIR = path.join(os.tmpdir(), "ws-refresh");
const JOBS_DIR = path.join(store.DATA_DIR, ".jobs");
const PATH = [path.join(HOME, ".local/bin"), path.join(HOME, ".npm-global/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].join(":");

/**
 * Read-mostly allowlist: the headless session can inspect PRs and load workspace data through `ws`,
 * but cannot change repos. acceptEdits limits file writes to its own temp working directory.
 */
const ALLOWED_TOOLS = [
  "Bash(ws:*)",
  "Bash(gh pr view:*)",
  "Bash(gh pr checks:*)",
  "Bash(gh pr diff:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Read",
  "Glob",
  "Grep",
  "Skill",
];

function prompt(task, since) {
  return [
    `Actualizá la tarea ${task.id} ("${task.title}") del Avocado Workspace usando el skill workspace en modo actualización.`,
    `1. Corré \`ws show ${task.id}\` y \`ws get ${task.id} <board>\` para ver cada board; reusá los ids de nodos existentes.`,
    `2. La fuente principal es lo que hicieron los agentes: corré \`ws sessions ${task.id}${since ? ` --since ${since}` : ""}\` para ver la actividad reciente de las sesiones y subagentes vinculados.`,
    "3. Actualizá sobre todo el board de testeo con resultados reales que aparezcan ahí (pass/fail solo con evidencia; lo demás queda todo). Si aparecen bugs o hallazgos nuevos, agregalos como notas o tarjetas con status risk. Actualizá estado, TL;DR o resumen solo si cambiaron de verdad.",
    "4. Escribí los JSON en el directorio actual y cargalos SIEMPRE con `ws board <tarea> <board> <archivo> --patch` (agrega/actualiza, nunca borra nodos existentes; mandá solo los nodos nuevos o cambiados). No toques repos, no publiques nada en GitHub ni en ningún otro servicio.",
    "5. Terminá con 2 líneas: qué cambiaste y qué requiere atención.",
  ].join("\n");
}

const jobFile = (taskId) => (store.assertSafe(taskId), path.join(JOBS_DIR, `${taskId}.json`));

function readJob(taskId) {
  try {
    return JSON.parse(fs.readFileSync(jobFile(taskId), "utf8"));
  } catch {
    return null;
  }
}

function writeJob(job) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.writeFileSync(jobFile(job.taskId), JSON.stringify(job, null, 2));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const tail = (file) => {
  try {
    return fs.readFileSync(file, "utf8").slice(-4000);
  } catch {
    return "";
  }
};

/**
 * Job state lives on disk (pid, log, exit-code file) so it survives dev-server restarts,
 * which happen whenever a server module changes or the launchd service restarts.
 */
function resolveJob(job) {
  if (job.status !== "running") return job;
  if (fs.existsSync(job.exitFile)) {
    const code = Number(fs.readFileSync(job.exitFile, "utf8").trim());
    const finished = { ...job, status: code === 0 ? "done" : "failed", exitCode: code, finishedAt: fs.statSync(job.exitFile).mtime.toISOString() };
    writeJob(finished);
    if (code === 0) store.saveTask(job.taskId, { refreshedAt: job.startedAt });
    return finished;
  }
  if (!isAlive(job.pid)) {
    const lost = { ...job, status: "failed", exitCode: null, finishedAt: new Date().toISOString() };
    writeJob(lost);
    return lost;
  }
  return job;
}

export function startRefresh(taskId) {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`No existe la tarea ${taskId}`);
  const current = readJob(taskId);
  if (current && resolveJob(current).status === "running") return refreshStatus(taskId);

  const cwd = path.join(RUN_DIR, `${taskId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });
  const logFile = path.join(cwd, "refresh.log");
  const exitFile = path.join(cwd, "exit-code");
  const log = fs.openSync(logFile, "a");
  const args = ["-p", prompt(task, task.refreshedAt), "--permission-mode", "acceptEdits", "--allowedTools", ...ALLOWED_TOOLS];
  const child = spawn("/bin/sh", ["-c", 'claude "$@"; echo $? > "$0"', exitFile, ...args], {
    cwd,
    env: { ...process.env, PATH },
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();
  const job = { taskId, status: "running", startedAt: new Date().toISOString(), pid: child.pid, cwd, logFile, exitFile };
  writeJob(job);
  return refreshStatus(taskId);
}

export function refreshStatus(taskId) {
  const job = readJob(taskId);
  if (!job) return { status: "never" };
  const resolved = resolveJob(job);
  return { status: resolved.status, startedAt: resolved.startedAt, finishedAt: resolved.finishedAt, exitCode: resolved.exitCode, output: tail(resolved.logFile) };
}
