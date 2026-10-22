import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./store.mjs";

const HOME = os.homedir();
const RUN_DIR = path.join(os.tmpdir(), "ws-refresh");
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

const jobs = new Map();

function prompt(task, since) {
  return [
    `Actualizá la tarea ${task.id} ("${task.title}") del Avocado Workspace usando el skill workspace en modo actualización.`,
    `1. Corré \`ws show ${task.id}\` y reusá los ids de nodos existentes.`,
    `2. La fuente principal es lo que hicieron los agentes: corré \`ws sessions ${task.id}${since ? ` --since ${since}` : ""}\` para ver la actividad reciente de las sesiones y subagentes vinculados.`,
    "3. Actualizá sobre todo el board de testeo con resultados reales que aparezcan ahí (pass/fail solo con evidencia; lo demás queda todo). Si aparecen bugs o hallazgos nuevos, agregalos como notas o tarjetas con status risk. Actualizá estado, TL;DR o resumen solo si cambiaron de verdad.",
    "4. Escribí los JSON en el directorio actual y cargalos con `ws`. No toques repos, no publiques nada en GitHub ni en ningún otro servicio.",
    "5. Terminá con 2 líneas: qué cambiaste y qué requiere atención.",
  ].join("\n");
}

export function startRefresh(taskId) {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`No existe la tarea ${taskId}`);
  const current = jobs.get(taskId);
  if (current?.status === "running") return current;

  const cwd = path.join(RUN_DIR, `${taskId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });
  const logFile = path.join(cwd, "refresh.log");
  const log = fs.openSync(logFile, "a");
  const startedAt = new Date().toISOString();
  const child = spawn("claude", ["-p", prompt(task, task.refreshedAt), "--permission-mode", "acceptEdits", "--allowedTools", ...ALLOWED_TOOLS], {
    cwd,
    env: { ...process.env, PATH },
    stdio: ["ignore", log, log],
    detached: true,
  });
  const job = { taskId, status: "running", startedAt, pid: child.pid, cwd, logFile };
  jobs.set(taskId, job);
  child.on("exit", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    job.output = fs.readFileSync(logFile, "utf8").slice(-4000);
    if (code === 0) store.saveTask(taskId, { refreshedAt: startedAt });
  });
  child.on("error", (error) => {
    job.status = "failed";
    job.output = String(error);
  });
  child.unref();
  return job;
}

export function refreshStatus(taskId) {
  const job = jobs.get(taskId);
  if (!job) return { status: "never" };
  const output = job.status === "running" ? fs.readFileSync(job.logFile, "utf8").slice(-4000) : job.output;
  return { ...job, output };
}
