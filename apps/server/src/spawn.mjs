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
    .slice(0, 40) || "session";

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
    `You are one of ${total} sessions launched in parallel in group "${group.name}". Your part: ${title}.`,
    `- Work only in ${cwd}. The other sessions work at the same time in other folders: don't touch theirs.`,
    worktree && `- If the request mentions ${original}, use ${cwd} instead: it's a copy of the same repo just for you.`,
    worktree && "- That folder is your own git worktree, on a detached HEAD. Check out the branch you need there (e.g. `gh pr checkout <n>`). Don't delete it when you finish.",
    "- If you need to rewrite a remote branch (rebase, amend), use `git push --force-with-lease`, never plain `--force`.",
    "- Finish with a 2-3 line summary: what you did and what's still pending.",
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
  if (!group) throw new Error(`Group not found: ${groupId}`);
  if (!Array.isArray(sessions) || !sessions.length) throw new Error("Pass at least one session to launch");
  if (sessions.length > MAX_PER_CALL) throw new Error(`Max ${MAX_PER_CALL} sessions per request`);
  const specs = sessions.map((s, i) => {
    const title = String(s?.title ?? "").trim() || `Session ${i + 1}`;
    const prompt = String(s?.prompt ?? "").trim();
    if (!prompt) throw new Error(`Missing prompt for "${title}"`);
    const cwd = path.resolve(chats.expandHome(String(s.cwd ?? "")));
    if (!s.cwd || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Folder not found for "${title}": ${s.cwd ?? "(empty)"}`);
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
    `You are the planner for Mono group "${group.name}". Your job is to decide which Claude Code sessions to launch in parallel to fulfill the request, not to do it yourself.`,
    "1. Investigate what you need to build the plan (e.g. `gh pr list`, reading the repo). Don't modify files, branches or PRs.",
    "2. Split the work into independent sessions that can run at the same time without stepping on each other (e.g. one per PR). If it's a single job, one session is fine. No cap: Mono runs up to 6 at a time and queues the rest.",
    "3. Each prompt must be self-contained: the session can't see this conversation. Include the goal, the specific PR/branch/files, and what to deliver at the end. Don't write absolute repo paths in the prompt: each session already starts in its folder (or its own worktree) and uses paths relative to it.",
    `4. Finish with the plan as a short list and, at the end, a \`\`\`json block with {"sessions": [{"title": "...", "prompt": "...", "cwd": "/absolute/path"}]}. title: short (shown on the canvas). cwd: the repo folder; if no other is needed, use ${cwd}.`,
    "Mono launches the sessions as soon as your answer ends. Sessions sharing a repo each work in their own worktree.",
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
  if (!group) throw new Error(`Group not found: ${groupId}`);
  const prompt = String(goal ?? "").trim();
  if (!prompt) throw new Error("Describe what needs doing");
  const dir = path.resolve(chats.expandHome(String(cwd ?? "")));
  if (!cwd || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Folder not found: ${cwd ?? ""}`);

  let launched = false;
  const onResult = (msg) => {
    if (launched || msg.subtype !== "success") return;
    const sessions = parsePlan(msg.result);
    if (!sessions) {
      groups.setSpawnState(group.id, { failed: [{ title: "Plan", error: "The answer didn't end with a ```json block of sessions. Ask the planner to add it." }] });
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
