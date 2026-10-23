import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as chats from "./chats.mjs";
import * as groups from "./groups.mjs";

/**
 * Batch launch from a group canvas: several sessions at once (one per PR, repo, etc.), each a pane.
 * At most MAX_RUNNING children work at once; the rest wait in line and start as others finish their
 * turn. The line lives in memory, so restarting Mono drops whatever hadn't started yet.
 */
const MAX_RUNNING = 6;
const MAX_PER_CALL = 30;

const queue = [];
const running = new Set();
let starting = 0;

chats.onChatChange((sessionId) => {
  if (!running.has(sessionId)) return;
  const { live, state } = chats.chatState(sessionId);
  if (live && state !== "idle") return;
  running.delete(sessionId);
  pump();
});

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

function repoTop(dir) {
  try {
    return git(dir, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
}

const slug = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sesion";

/** A detached worktree under `<repo>/.worktrees/` so parallel children never share a checkout. */
function makeWorktree(top, cwd, name) {
  const main = path.dirname(path.resolve(top, git(top, "rev-parse", "--git-common-dir")));
  const exclude = path.join(main, ".git", "info", "exclude");
  if (fs.existsSync(path.dirname(exclude)) && !fs.readFileSync(exclude, "utf8").split("\n").includes(".worktrees/")) fs.appendFileSync(exclude, "\n.worktrees/\n");
  let dir = path.join(main, ".worktrees", name);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(main, ".worktrees", `${name}-${n}`);
  git(top, "worktree", "add", "--detach", dir, "HEAD");
  return path.join(dir, path.relative(top, fs.realpathSync(cwd)));
}

function childContext({ group, title, total, cwd, worktree, original }) {
  return [
    `Sos una de ${total} sesiones lanzadas en paralelo en el grupo "${group.name}". Tu parte: ${title}.`,
    `- Trabajá solo en ${cwd}. Las otras sesiones trabajan al mismo tiempo en otras carpetas: no toques las suyas.`,
    worktree && `- Si el pedido menciona ${original}, usá ${cwd} en su lugar: es una copia del mismo repo solo para vos.`,
    worktree && "- Esa carpeta es un git worktree propio, en HEAD detached. Hacé checkout de la rama que necesites ahí (por ejemplo `gh pr checkout <n>`). No lo borres al terminar.",
    "- Si tenés que reescribir una rama remota (rebase, amend), usá `git push --force-with-lease`, nunca `--force` a secas.",
    "- Terminá con un resumen de 2-3 líneas: qué hiciste y qué quedó pendiente.",
  ]
    .filter(Boolean)
    .join("\n");
}

function setQueued(groupId) {
  const queued = queue.filter((item) => item.groupId === groupId).map((item) => item.title);
  try {
    groups.setSpawnState(groupId, { queued });
  } catch {}
}

function pump() {
  while (queue.length && running.size + starting < MAX_RUNNING) {
    const item = queue.shift();
    starting++;
    // startChat throws synchronously on a bad folder; going through a promise keeps the slot accounting right.
    Promise.resolve()
      .then(() => chats.startChat({ cwd: item.cwd, taskId: item.taskId, prompt: item.prompt, model: item.model, effort: item.effort, context: item.context }))
      .then(({ sessionId }) => {
        running.add(sessionId);
        groups.addSession(item.groupId, sessionId, item.title, item.child);
      })
      .catch((error) => groups.setSpawnState(item.groupId, { failed: [{ title: item.title, error: String(error?.message ?? error) }] }))
      .finally(() => {
        starting--;
        setQueued(item.groupId);
        pump();
      });
  }
}

/**
 * Queues one session per spec (`{ title, prompt, cwd, taskId?, worktree? }`) into the group.
 * Sessions that share a git repo get their own worktree unless the spec says `worktree: false`.
 */
export function spawnSessions({ group: groupId, sessions = [], taskId, model, effort, parent }) {
  const group = groups.findGroup(groupId);
  if (!group) throw new Error(`No existe el grupo ${groupId}`);
  if (!Array.isArray(sessions) || !sessions.length) throw new Error("Pasá al menos una sesión para lanzar");
  if (sessions.length > MAX_PER_CALL) throw new Error(`Máximo ${MAX_PER_CALL} sesiones por pedido`);
  const specs = sessions.map((s, i) => {
    const title = String(s?.title ?? "").trim() || `Sesión ${i + 1}`;
    const prompt = String(s?.prompt ?? "").trim();
    if (!prompt) throw new Error(`Falta el prompt de "${title}"`);
    const cwd = path.resolve(chats.expandHome(String(s.cwd ?? "")));
    if (!s.cwd || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No existe la carpeta de "${title}": ${s.cwd ?? "(vacía)"}`);
    return { title, prompt, cwd, top: repoTop(cwd), taskId: s.taskId ?? taskId, worktree: s.worktree };
  });

  const shared = new Map();
  for (const s of specs) if (s.top) shared.set(s.top, (shared.get(s.top) ?? 0) + 1);

  for (const [slot, s] of specs.entries()) {
    const isolate = s.top && (s.worktree ?? shared.get(s.top) > 1);
    const cwd = isolate ? makeWorktree(s.top, s.cwd, `${slug(group.name)}-${slug(s.title)}`) : s.cwd;
    const context = childContext({ group, title: s.title, total: specs.length, cwd, worktree: Boolean(isolate), original: s.cwd });
    queue.push({ groupId: group.id, title: s.title, prompt: s.prompt, cwd, taskId: s.taskId, model, effort, context, child: parent && { parent, slot, total: specs.length } });
  }
  pump();
  setQueued(group.id);
  return { group: groups.findGroup(group.id), queued: queue.filter((item) => item.groupId === group.id).length, limit: MAX_RUNNING };
}

function plannerContext({ group, cwd }) {
  return [
    `Sos el planificador del grupo "${group.name}" de Mono. Tu trabajo es decidir qué sesiones de Claude Code hay que lanzar en paralelo para cumplir el pedido, no hacerlo vos.`,
    "1. Investigá lo necesario para armar el plan (por ejemplo `gh pr list`, leer el repo). No modifiques archivos, ramas ni PRs.",
    "2. Partí el trabajo en sesiones independientes que puedan correr al mismo tiempo sin pisarse (por ejemplo una por PR). Si es un solo trabajo, una sola sesión está bien. Sin tope: Mono corre hasta 6 a la vez y encola el resto.",
    "3. Cada prompt tiene que ser autosuficiente: la sesión no ve esta conversación. Incluí el objetivo, el PR/rama/archivos concretos y qué entregar al final. No escribas rutas absolutas del repo en el prompt: cada sesión ya arranca parada en su carpeta (o en un worktree propio) y usa rutas relativas a ella.",
    `4. Terminá con el plan en una lista corta y, al final, un bloque \`\`\`json con {"sessions": [{"title": "...", "prompt": "...", "cwd": "/ruta/absoluta"}]}. title: corto (va en el canvas). cwd: la carpeta del repo; si no hace falta otra, usá ${cwd}.`,
    "Mono lanza las sesiones apenas termina tu respuesta. Las que comparten repo trabajan cada una en su propio worktree.",
  ].join("\n");
}

/** The last ```json block of the planner's final message, as a list of session specs. */
function parsePlan(text) {
  const blocks = [...String(text ?? "").matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  try {
    const plan = JSON.parse(blocks.at(-1)[1]);
    const sessions = Array.isArray(plan) ? plan : plan?.sessions;
    return Array.isArray(sessions) && sessions.length ? sessions : null;
  } catch {
    return null;
  }
}

/**
 * Starts a planner session in the group: Claude studies the request, proposes the sessions, and once its
 * answer ends with a valid plan Mono launches them. The plan launches once; later turns don't relaunch it.
 */
export async function planSessions({ group: groupId, goal, cwd, taskId, model, effort }) {
  const group = groups.findGroup(groupId);
  if (!group) throw new Error(`No existe el grupo ${groupId}`);
  const prompt = String(goal ?? "").trim();
  if (!prompt) throw new Error("Escribí qué hay que hacer");
  const dir = path.resolve(chats.expandHome(String(cwd ?? "")));
  if (!cwd || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No existe la carpeta ${cwd ?? ""}`);

  let launched = false;
  const onResult = (msg) => {
    if (launched || msg.subtype !== "success") return;
    const sessions = parsePlan(msg.result);
    if (!sessions) {
      groups.setSpawnState(group.id, { failed: [{ title: "Plan", error: "La respuesta no terminó con un bloque ```json de sesiones. Pedile al planificador que lo agregue." }] });
      return;
    }
    launched = true;
    try {
      spawnSessions({ group: group.id, sessions: sessions.map((s) => ({ ...s, cwd: s.cwd || dir })), taskId, model, effort, parent: msg.session_id });
    } catch (error) {
      launched = false;
      groups.setSpawnState(group.id, { failed: [{ title: "Plan", error: String(error?.message ?? error) }] });
    }
  };

  const state = await chats.startChat({ cwd: dir, taskId, prompt, model, effort, context: plannerContext({ group, cwd: dir }), onResult });
  groups.addSession(group.id, state.sessionId, `Plan · ${prompt.split("\n")[0].slice(0, 60)}`);
  return { group: groups.findGroup(group.id), sessionId: state.sessionId };
}
