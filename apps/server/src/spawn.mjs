import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as chats from "./chats.mjs";
import * as groups from "./groups.mjs";

/**
 * Batch launch from a group canvas: several sessions at once (one per PR, repo, etc.), each a pane.
 * At most MAX_RUNNING children work at once; the rest wait in line and start as others finish their
 * turn. A spec with `after` (another spec's title, e.g. the PR its branch is based on) waits until that
 * session finishes its first turn and hangs below it, so stacked PRs form a tree. The line lives in
 * memory, so restarting Mono drops whatever hadn't started yet.
 */
const MAX_RUNNING = 6;
const MAX_PER_CALL = 30;

const queue = [];
const running = new Set();
let starting = 0;
let calls = 0;
/** Every launched or waiting item by key: `state` is queued | running | done | failed. */
const items = new Map();
const itemBySession = new Map();

chats.onChatChange((sessionId) => {
  if (!running.has(sessionId)) return;
  const { live, state } = chats.chatState(sessionId);
  if (live && state !== "idle") return;
  running.delete(sessionId);
  // Closed without ever reporting a result: whatever waits on it can't start.
  const item = itemBySession.get(sessionId);
  if (!live && item?.state === "running") finish(item, { error: "Session closed before finishing" });
  pump();
});

/** First finished turn of a child: unblocks (or, on error, fails) the sessions waiting on it. */
function finish(item, { result, error }) {
  if (item.state !== "running") return;
  item.state = error ? "failed" : "done";
  item.result = result;
  if (error) failDependents(item, `"${item.title}" ended with an error (${error})`);
  setQueued(item.groupId);
  pump();
}

function failDependents(item, reason) {
  const failed = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const waiting = queue[i];
    if (waiting.after !== item.key) continue;
    queue.splice(i, 1);
    waiting.state = "failed";
    failed.push({ title: waiting.title, error: `Didn't start: ${reason}` });
    failDependents(waiting, `depends on "${waiting.title}", which didn't start`);
  }
  if (failed.length) groups.setSpawnState(item.groupId, { failed });
}

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

function childContext({ group, title, total, cwd, worktree, original, after }) {
  return [
    `You are one of ${total} sessions launched in parallel in group "${group.name}". Your part: ${title}.`,
    after &&
      `- You depend on "${after}": your branch is based on its branch (stacked PRs). That session has finished and may have rewritten its branch. First \`git fetch\`; if your branch is based on its branch and it was rewritten, rebase only your commits with \`git rebase --onto origin/<${after}'s branch> <old base>\` (the old base is the commit where your branch split from it before the change). That way you don't drag its old commits along.`,
    `- Work only in ${cwd}. The other sessions work at the same time in other folders: don't touch theirs.`,
    worktree && `- If the request mentions ${original}, use ${cwd} instead: it's a copy of the same repo just for you.`,
    worktree && "- That folder is your own git worktree, on a detached HEAD. Check out the branch you need there (e.g. `gh pr checkout <n>`). Don't delete it when you finish.",
    "- If you need to rewrite a remote branch (rebase, amend), use `git push --force-with-lease`, never plain `--force`.",
    "- Finish with a 2-3 line summary: what you did and what's still pending.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the canvas draws as waiting cards: each one hangs from the session (or waiting card) it follows. */
function setQueued(groupId) {
  const queued = queue
    .filter((item) => item.groupId === groupId)
    .map((item) => {
      const dep = item.after && items.get(item.after);
      return { key: item.key, title: item.title, ...(dep ? { after: dep.title, parent: dep.sessionId ?? `queued:${dep.key}` } : item.child ? { parent: item.child.parent } : {}) };
    });
  try {
    groups.setSpawnState(groupId, { queued });
  } catch {}
}

const ready = (item) => !item.after || items.get(item.after)?.state === "done";

/** Where a started item's pane hangs: below the session it waits on, else below its planner. */
function childFor(item) {
  const dep = item.after && items.get(item.after);
  if (dep?.sessionId) return { parent: dep.sessionId, slot: item.depSlot, total: item.depTotal, link: "after" };
  return item.child;
}

/** The dependency's last answer goes into the waiting session's prompt, so it knows what changed. */
function promptFor(item) {
  const dep = item.after && items.get(item.after);
  if (!dep?.result) return item.prompt;
  return `${item.prompt}\n\n---\nWhat "${dep.title}" reported when it finished:\n${String(dep.result).slice(-2000)}`;
}

function pump() {
  while (running.size + starting < MAX_RUNNING) {
    const index = queue.findIndex(ready);
    if (index < 0) break;
    const [item] = queue.splice(index, 1);
    item.state = "running";
    starting++;
    const onResult = (msg) => finish(item, msg.subtype === "success" ? { result: msg.result } : { error: msg.subtype });
    // startChat throws synchronously on a bad folder; going through a promise keeps the slot accounting right.
    Promise.resolve()
      .then(() => chats.startChat({ cwd: item.cwd, taskId: item.taskId, prompt: promptFor(item), model: item.model, effort: item.effort, context: item.context, onResult }))
      .then(({ sessionId }) => {
        item.sessionId = sessionId;
        itemBySession.set(sessionId, item);
        running.add(sessionId);
        groups.addSession(item.groupId, sessionId, item.title, childFor(item));
      })
      .catch((error) => {
        item.state = "failed";
        groups.setSpawnState(item.groupId, { failed: [{ title: item.title, error: String(error?.message ?? error) }] });
        failDependents(item, `"${item.title}" didn't start`);
      })
      .finally(() => {
        starting--;
        setQueued(item.groupId);
        pump();
      });
  }
}

/**
 * Queues one session per spec (`{ title, prompt, cwd, taskId?, worktree?, after? }`) into the group.
 * Sessions that share a git repo get their own worktree unless the spec says `worktree: false`.
 * `after` names another spec of the same call; that one runs first and this one hangs below it.
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
    return { title, prompt, cwd, top: repoTop(cwd), taskId: s.taskId ?? taskId, worktree: s.worktree, after: s.after == null ? null : String(s.after).trim() || null };
  });

  // `after` points at another spec by title; it must exist and the chain can't loop.
  const byTitle = new Map(specs.map((s, i) => [s.title.toLowerCase(), i]));
  if (byTitle.size !== specs.length && specs.some((s) => s.after)) throw new Error("With `after`, each session needs a unique title");
  const dep = specs.map((s) => {
    if (!s.after) return -1;
    const i = byTitle.get(s.after.toLowerCase());
    if (i === undefined) throw new Error(`"${s.title}" waits on "${s.after}", which isn't in the plan`);
    return i;
  });
  for (let i = 0; i < specs.length; i++) {
    const seen = new Set();
    for (let j = i; j >= 0; j = dep[j]) {
      if (seen.has(j)) throw new Error(`The plan has a dependency cycle at "${specs[i].title}"`);
      seen.add(j);
    }
  }

  const shared = new Map();
  for (const s of specs) if (s.top) shared.set(s.top, (shared.get(s.top) ?? 0) + 1);

  // Siblings share a row: the roots under the planner, each dependency's followers under it.
  const call = ++calls;
  const key = (i) => `${call}:${i}`;
  const siblings = (i) => specs.map((_, j) => j).filter((j) => dep[j] === dep[i]);
  for (const [i, s] of specs.entries()) {
    const isolate = s.top && (s.worktree ?? shared.get(s.top) > 1);
    const cwd = isolate ? makeWorktree(s.top, s.cwd, `${slug(group.name)}-${slug(s.title)}`) : s.cwd;
    const after = dep[i] >= 0 ? specs[dep[i]].title : null;
    const context = childContext({ group, title: s.title, total: specs.length, cwd, worktree: Boolean(isolate), original: s.cwd, after });
    const row = siblings(i);
    const item = {
      key: key(i),
      groupId: group.id,
      title: s.title,
      prompt: s.prompt,
      cwd,
      taskId: s.taskId,
      model,
      effort,
      context,
      state: "queued",
      after: dep[i] >= 0 ? key(dep[i]) : null,
      depSlot: row.indexOf(i),
      depTotal: row.length,
      child: parent && dep[i] < 0 ? { parent, slot: row.indexOf(i), total: row.length } : undefined,
    };
    items.set(item.key, item);
    queue.push(item);
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
    "   If the work touches branches or PRs, always check the branch tree (`gh pr list --json number,title,headRefName,baseRefName`). A PR whose base is another PR's branch is its child (stacked PRs): give it `\"after\": \"<parent title>\"`. Mono starts it only once the parent finishes and hangs it below the parent. In the child's prompt, say which branch is the parent. PRs based on main get no `after` and run in parallel.",
    "3. Each prompt must be self-contained: the session can't see this conversation. Include the goal, the specific PR/branch/files, and what to deliver at the end. Don't write absolute repo paths in the prompt: each session already starts in its folder (or its own worktree) and uses paths relative to it.",
    `4. Finish with the plan as a short list and, at the end, a \`\`\`json block with {"sessions": [{"title": "...", "prompt": "...", "cwd": "/absolute/path", "after": "title of another session (optional)"}]}. title: short and unique (shown on the canvas). cwd: the repo folder; if no other is needed, use ${cwd}.`,
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
