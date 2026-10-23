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

function childContext({ group, title, total, cwd, worktree }) {
  return [
    `Sos una de ${total} sesiones lanzadas en paralelo en el grupo "${group.name}". Tu parte: ${title}.`,
    `- Trabajá solo en ${cwd}. Las otras sesiones trabajan al mismo tiempo en otras carpetas: no toques las suyas.`,
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
        groups.addSession(item.groupId, sessionId, item.title);
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
export function spawnSessions({ group: groupId, sessions = [], taskId, model, effort }) {
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

  for (const s of specs) {
    const isolate = s.top && (s.worktree ?? shared.get(s.top) > 1);
    const cwd = isolate ? makeWorktree(s.top, s.cwd, `${slug(group.name)}-${slug(s.title)}`) : s.cwd;
    const context = childContext({ group, title: s.title, total: specs.length, cwd, worktree: Boolean(isolate) });
    queue.push({ groupId: group.id, title: s.title, prompt: s.prompt, cwd, taskId: s.taskId, model, effort, context });
  }
  pump();
  setQueued(group.id);
  return { group: groups.findGroup(group.id), queued: queue.filter((item) => item.groupId === group.id).length, limit: MAX_RUNNING };
}
