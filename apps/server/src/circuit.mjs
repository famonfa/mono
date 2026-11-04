import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { listCommands } from "./commands.mjs";
import { metroState, startMetro, stopMetro } from "./metro.mjs";
import * as projects from "./projects.mjs";
import * as sessions from "./sessions.mjs";
import * as store from "./store.mjs";
import { PATH } from "./prs.mjs";

/**
 * The PR circuit: every open PR of a folder's repos, stopped at the first station it doesn't pass.
 * Everything here only reads: GitHub, `git fetch` and `git merge-tree`, which never touch a working tree.
 */

const exec = promisify(execFile);
const DAY_MS = 24 * 60 * 60_000;
const DORMANT_DAYS = 90;
const MAX_COMMITS = 12;
const SWEEP_TIME = { hour: 8, minute: 0, timeZone: "America/Argentina/Buenos_Aires" };
const DETAIL_TTL = 60_000;
const SEARCH_DEPTH = 2;
const SKIP_DIRS = new Set(["Applications", "Desktop", "Documents", "Downloads", "Library", "Movies", "Music", "Pictures", "Public", "node_modules", "dist", "build"]);
const CONVENTIONAL = /^(feat|fix|chore|refactor|docs|test|perf|style|ci|build|revert)(\(.+\))?!?: /;
const MANUAL_TAG = /^\[(blocked[^\]]*|needs work[^\]]*)\]\s*/i;
const TICKET = /\b([A-Z]{2,6}-\d+)\b/i;
const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"];
/** Skills that make sense on a PR, shown first, most used first. Everything else stays under More. */
const PR_SKILLS = ["workspace", "clean-commits", "pr-review", "pr-review-resolve", "pr-full", "browse", "ui-captures", "handoff", "pr-test", "pr-qa", "pr-commit", "pr-pull", "qa", "code-review", "investigate", "land-and-deploy", "ship"];
const SKILL_FOR_ACTION = { rebase: "rebase", resolve: "pr-review-resolve", review: "pr-review", "clean-commits": "clean-commits", land: "land-and-deploy", fix: "investigate" };
const TOP_COMMANDS = 7;

const dir = () => path.join(store.DATA_DIR, "prs");
const settingsFile = () => path.join(dir(), "settings.json");
const indexFile = () => path.join(dir(), "session-index.json");
const runsFile = () => path.join(dir(), "runs.json");
const snapshotFile = (projectId) => path.join(dir(), `${projectId}.json`);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

async function run(cmd, args, opts = {}) {
  const { stdout } = await exec(cmd, args, { env: { ...process.env, PATH }, maxBuffer: 32 * 1024 * 1024, timeout: 60_000, ...opts });
  return stdout;
}

const gh = async (args) => JSON.parse(await run("gh", args));

/** Runs `fn` over `items`, a few at a time, so a sweep doesn't open dozens of GitHub connections at once. */
async function pool(items, size, fn) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where a PR stops and what it needs. Dormant ones are set apart first: they never close by themselves. */
export function classify(pr, now = Date.now()) {
  if ((now - Date.parse(pr.updatedAt)) / DAY_MS > DORMANT_DAYS) return { station: "dormant", reason: `${plural(pr.behind ?? 0, "commit")} behind`, action: "decide" };
  if (pr.conflict) return { station: "base", reason: pr.conflictFiles?.length ? plural(pr.conflictFiles.length, "file") : "Merge conflict", action: "rebase" };
  if (pr.failing.length) return pr.foreignCi ? { station: "ci", reason: `${pr.baseRef} fails the same way`, action: "wait" } : { station: "ci", reason: plural(pr.failing.length, "failing check"), action: "fix" };
  if (pr.commitCount > MAX_COMMITS || pr.nonConventional) return { station: "commits", reason: pr.nonConventional ? plural(pr.nonConventional, "non-conventional commit") : plural(pr.commitCount, "commit"), action: "clean-commits" };
  if (pr.threads) return { station: "review", reason: plural(pr.threads, "open thread"), action: "resolve" };
  if (!pr.reviews) return { station: "review", reason: "No review yet", action: "review" };
  if (pr.isDraft) return { station: "ready", reason: "Clean, still a draft", action: "mark-ready" };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { station: "review", reason: "Changes requested", action: "resolve" };
  // A bot's review doesn't unblock a merge: only GitHub knows if the branch rules are met.
  if (pr.reviewDecision === "REVIEW_REQUIRED" || pr.mergeState === "BLOCKED") return { station: "review", reason: "Needs an approval", action: "approval" };
  return { station: "ready", reason: "Ready to merge", action: "land" };
}

const ACTION_RANK = { land: 0, "mark-ready": 1, resolve: 2, rebase: 3, review: 4, "clean-commits": 5, fix: 6 };

/** What to do today: closest to production first. PRs that depend on someone else go last. */
export function todayList(prs) {
  const open = prs.filter((p) => p.station !== "dormant" && !p.manualTag && !p.branchOnly);
  const rank = (p) => (p.action === "wait" ? 9 : (ACTION_RANK[p.action] ?? 8)) + (p.action === "rebase" && p.groupSize > 1 ? 1.5 : 0) + (p.isDraft ? 0.5 : 0);
  return [...open].sort((a, b) => rank(a) - rank(b) || (a.conflictFiles?.length ?? 0) - (b.conflictFiles?.length ?? 0) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map((p) => p.key);
}

/** Next time `hour:minute` comes around in `timeZone`, as epoch ms. */
export function nextSweep(now = Date.now(), { hour, minute, timeZone } = SWEEP_TIME) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(now)).map((p) => [p.type, Number(p.value)]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(now / 1000) * 1000;
  const today = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute) - offset;
  return today > now ? today : today + DAY_MS;
}

/** The QR GitHub publishes uses the Expo slug as its scheme; a phone's camera only opens the schemes the app registers. */
export function expoPreview(body, schemes = []) {
  const qr = body.match(/https:\/\/qr\.expo\.dev\/eas-update\?[^"'\s)]+/)?.[0];
  if (!qr) return null;
  const params = new URL(qr.replaceAll("&amp;", "&")).searchParams;
  const projectId = params.get("projectId");
  const branchId = params.get("branchId");
  if (!projectId || !branchId) return null;
  const scheme = schemes.find((s) => s.startsWith("exp+")) ?? `exp+${params.get("appScheme")}`;
  return {
    link: `${scheme}://expo-development-client/?url=${encodeURIComponent(`https://u.expo.dev/${projectId}/branch/${branchId}`)}`,
    update: body.match(/updates\/([0-9a-f]{8})/)?.[1] ?? null,
    runtime: body.match(/Runtime(?: Version)?\W+([\w.:-]+)/i)?.[1] ?? null,
    production: /live production data/i.test(body),
  };
}

const httpsOnly = (url) => (url?.startsWith("https://") ? url : null);

/** Only CI's own comment counts: anyone who can comment could write a look-alike with another link. */
export function deviceTest(comments) {
  const last = comments.filter((c) => c.bot !== false && /agent-device test (failed|passed|succeeded)/i.test(c.body)).at(-1);
  if (!last) return null;
  return {
    ok: !/agent-device test failed/i.test(last.body),
    at: last.createdAt,
    path: last.body.match(/Selected path:\s*([^\n]+)/)?.[1]?.trim() ?? null,
    video: httpsOnly(last.body.match(/Video\/artifacts:\s*(\S+)/)?.[1]),
    url: last.url,
  };
}

/** The other open PR a human said this one waits on: by "blocked by #123", or by naming its branch. */
export function blockedBy(pr, open) {
  const said = pr.comments.filter((c) => c.author && !c.bot).map((c) => c.body).join("\n");
  const number = Number(said.match(/(?:blocked by|depends on|waiting on|fixed by)\s+#(\d+)/i)?.[1]);
  return open.find((o) => o.number !== pr.number && (o.number === number || (o.headRefName.length > 7 && said.includes(o.headRefName)))) ?? null;
}

export function conflictHunks(text) {
  const hunks = [];
  let hunk = null;
  let side = "base";
  text.split("\n").forEach((line, i) => {
    if (line.startsWith("<<<<<<< ")) {
      hunk = { line: i + 1, base: [], head: [] };
      side = "base";
    } else if (hunk && line.startsWith("=======")) side = "head";
    else if (hunk && line.startsWith(">>>>>>> ")) {
      hunks.push(hunk);
      hunk = null;
    } else if (hunk) hunk[side].push(line);
  });
  return hunks;
}

/** A worktree's `.git` is a file: it's the same repo as its main checkout, not another one. */
function isRepo(p) {
  return fs.statSync(path.join(p, ".git"), { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Git repos under a folder. Other Mono folders inside it keep their own repos. */
function findRepos(root) {
  const others = new Set(projects.listProjects().map((p) => fs.realpathSync.native(p.root)).filter((p) => p !== fs.realpathSync.native(root)));
  const seen = new Set();
  const found = isRepo(root) ? [root] : [];
  const walk = (folder, depth) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const child = path.join(folder, entry.name);
      let real;
      try {
        real = fs.realpathSync.native(child);
      } catch {
        continue;
      }
      if (seen.has(real) || others.has(real)) continue;
      seen.add(real);
      if (isRepo(child)) found.push(child);
      else if (depth < SEARCH_DEPTH) walk(child, depth + 1);
    }
  };
  walk(root, 1);
  return found;
}

async function describeRepo(repoPath) {
  const git = (...args) => run("git", ["-C", repoPath, ...args], { timeout: 15_000 }).then((s) => s.trim(), () => "");
  const [remote, branch, changes, lastCommit, branches] = await Promise.all([
    git("remote", "get-url", "origin"),
    git("branch", "--show-current"),
    git("status", "--porcelain"),
    git("log", "-1", "--format=%cI"),
    git("branch", "--format=%(refname:short)"),
  ]);
  const slug = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  const extra = branches.split("\n").filter((b) => b && b !== branch && !/^(main|master|develop|backup\/)/.test(b));
  return { name: path.basename(repoPath), path: repoPath, slug, branch, dirty: changes ? changes.split("\n").length : 0, lastCommit, branches: extra, vercel: fs.existsSync(path.join(repoPath, "vercel.json")) };
}

const PR_FIELDS = `
  number title url isDraft mergeable mergeStateStatus reviewDecision createdAt updatedAt headRefName baseRefName headRefOid additions deletions changedFiles isCrossRepository
  author { login } labels(first: 20) { nodes { name } }
  reviewThreads(first: 100) { nodes { isResolved } }
  reviews(last: 50) { nodes { author { login } state submittedAt url body } }
  comments(last: 40) { nodes { author { login __typename } createdAt url body } }
  commits(last: 60) { totalCount nodes { commit { oid messageHeadline committedDate author { name } } } }
  head: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name conclusion detailsUrl } ... on StatusContext { context state targetUrl }
  } } } } } }`;

async function fetchPr(slug, number) {
  const [owner, name] = slug.split("/");
  const query = `query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { ${PR_FIELDS} } } }`;
  const res = await gh(["api", "graphql", "-f", `query=${query}`, "-F", `o=${owner}`, "-F", `r=${name}`, "-F", `n=${number}`]);
  const pr = res.data.repository.pullRequest;
  const checks = pr.head.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  return {
    ...pr,
    author: pr.author?.login ?? "ghost",
    labels: pr.labels.nodes.map((l) => l.name),
    threads: pr.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    allReviews: pr.reviews.nodes,
    reviews: pr.reviews.nodes.filter((r) => r.author?.login !== pr.author?.login).length,
    comments: pr.comments.nodes.map((c) => ({ author: c.author?.login ?? null, bot: c.author?.__typename === "Bot", createdAt: c.createdAt, url: c.url, body: c.body })),
    commitCount: pr.commits.totalCount,
    commits: pr.commits.nodes.map((n) => n.commit),
    nonConventional: pr.commits.nodes.filter((n) => !CONVENTIONAL.test(n.commit.messageHeadline) && !n.commit.messageHeadline.startsWith("Merge ")).length,
    failing: [...new Set(checks.filter((c) => FAILED.includes(c.conclusion ?? c.state)).map((c) => c.name ?? c.context))],
    head: undefined,
    reviewThreads: undefined,
  };
}

async function failingOnBase(slug, base, cache) {
  const key = `${slug}:${base}`;
  cache.set(key, cache.get(key) ?? gh(["api", `repos/${slug}/commits/${encodeURIComponent(base)}/check-runs?per_page=100`]).then((r) => new Set(r.check_runs.filter((c) => FAILED.includes(c.conclusion?.toUpperCase())).map((c) => c.name)), () => new Set()));
  return cache.get(key);
}

/** Files a merge would conflict on, worked out without touching any checkout. */
async function mergeState(repoPath, pr) {
  if ([pr.baseRefName, pr.headRefName].some((ref) => ref.startsWith("-"))) throw new Error("Unexpected branch name");
  const git = (...args) => run("git", ["-C", repoPath, ...args]);
  await git("fetch", "-q", "origin", pr.baseRefName, pr.headRefName);
  const base = `origin/${pr.baseRefName}`;
  const head = `origin/${pr.headRefName}`;
  const behind = Number((await git("rev-list", "--count", `${head}..${base}`)).trim());
  // merge-tree exits 1 when there are conflicts, with the same output.
  const out = await git("merge-tree", "--write-tree", "--name-only", base, head).catch((e) => e.stdout ?? "");
  const [tree, ...rest] = out.split("\n");
  const end = rest.indexOf("");
  return { behind, tree, files: (end < 0 ? rest : rest.slice(0, end)).filter(Boolean) };
}

/** A branch being pushed ("HEAD -> name") or committed to ("[name abc1234]"), as git prints it. */
const BRANCH_TRACE = /-> ([\w./-]{3,})(?:\\n|\\"|")|\[([\w./-]{3,})(?: \(root-commit\))? [0-9a-f]{7,12}\]/g;

const SKILL_USE = /<command-name>\/?([\w:-]+)<\/command-name>|"name":"Skill","input":\{"skill":"([^"]+)"/g;

async function tracesIn(file, start) {
  const branches = new Set();
  const skills = {};
  for await (const line of readline.createInterface({ input: fs.createReadStream(file, { start }) })) {
    if (line.includes('"tool_result"')) {
      for (const m of line.matchAll(BRANCH_TRACE)) branches.add(m[1] ?? m[2]);
    } else {
      for (const m of line.matchAll(SKILL_USE)) skills[m[1] ?? m[2]] = (skills[m[1] ?? m[2]] ?? 0) + 1;
    }
  }
  return { branches, skills };
}

/**
 * Which sessions committed or pushed to which branch. Merely mentioning a PR doesn't count: most transcripts do.
 * Transcripts only grow, so each sweep reads just what was added since the last one.
 */
async function sessionsByBranch() {
  const saved = readJson(indexFile(), {});
  const files = fs.existsSync(sessions.PROJECTS_DIR) ? fs.readdirSync(sessions.PROJECTS_DIR, { recursive: true }).filter((f) => f.endsWith(".jsonl")) : [];
  const index = {};
  await pool(files, 4, async (rel) => {
    const file = path.join(sessions.PROJECTS_DIR, rel);
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    const known = saved[rel]?.size <= size ? saved[rel] : { size: 0, branches: [], skills: {} };
    if (known.size === size) {
      index[rel] = known;
      return;
    }
    const added = await tracesIn(file, known.size);
    const skills = { ...known.skills };
    for (const [name, n] of Object.entries(added.skills)) skills[name] = (skills[name] ?? 0) + n;
    index[rel] = { size, branches: [...new Set([...known.branches, ...added.branches])], skills };
  });
  writeJson(indexFile(), index);
  const found = new Map();
  for (const [rel, { branches }] of Object.entries(index)) {
    const id = sessions.sessionIdFromPath(rel);
    if (id) for (const b of branches) found.set(b, (found.get(b) ?? new Set()).add(id));
  }
  return found;
}

function skillUse() {
  const use = {};
  for (const { skills } of Object.values(readJson(indexFile(), {}))) for (const [name, n] of Object.entries(skills ?? {})) use[name] = (use[name] ?? 0) + n;
  return use;
}

const ticketOf = (pr) => pr.title.match(TICKET)?.[1]?.toUpperCase() ?? pr.headRefName.match(TICKET)?.[1]?.toUpperCase() ?? null;

function projectFor(pr, repo, tasks) {
  const task = tasks.find((t) => t.repos?.some((r) => r.pr === pr.url) || (t.relatedPrs?.includes(pr.number) && (!t.repos?.length || t.repos.some((r) => r.name === repo.name))));
  return task ? { id: task.id, title: task.title } : null;
}

async function summarize(repo, number, ctx) {
  const pr = await fetchPr(repo.slug, number);
  const key = `${repo.slug}#${number}`;
  const merge = repo.path && !pr.isCrossRepository ? await mergeState(repo.path, pr).catch(() => null) : null;
  const conflictFiles = merge?.files ?? [];
  const onBase = pr.failing.length ? await failingOnBase(repo.slug, pr.baseRefName, ctx.baseChecks) : new Set();
  const facts = {
    updatedAt: pr.updatedAt,
    behind: merge?.behind ?? null,
    conflict: pr.mergeable === "CONFLICTING" || conflictFiles.length > 0,
    conflictFiles,
    failing: pr.failing,
    foreignCi: pr.failing.length > 0 && pr.failing.every((c) => onBase.has(c)),
    commitCount: pr.commitCount,
    nonConventional: pr.nonConventional,
    threads: pr.threads,
    reviews: pr.reviews,
    isDraft: pr.isDraft,
    baseRef: pr.baseRefName,
    reviewDecision: pr.reviewDecision,
    mergeState: pr.mergeStateStatus,
  };
  const blocker = blockedBy(pr, ctx.open.get(repo.slug) ?? []);
  return {
    key,
    repo: repo.name,
    slug: repo.slug,
    number,
    title: pr.title.replace(MANUAL_TAG, ""),
    url: pr.url,
    author: pr.author,
    mine: pr.author === ctx.me,
    branch: pr.headRefName,
    createdAt: pr.createdAt,
    ticket: ticketOf(pr),
    project: projectFor(pr, repo, ctx.tasks),
    manualTag: pr.title.match(MANUAL_TAG)?.[1] ?? null,
    labels: pr.labels,
    device: deviceTest(pr.comments),
    blockedBy: blocker && { number: blocker.number, title: blocker.title, author: blocker.author?.login, url: blocker.url },
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    ...facts,
    ...withCommand(classify(facts)),
  };
}

const withCommand = (place) => ({ ...place, command: SKILL_FOR_ACTION[place.action] ?? null });

/** A branch someone added by hand before it has a PR: a wire with no number, stopped before the first station. */
async function summarizeBranch(repo, branch) {
  const git = (...args) => run("git", ["-C", repo.path, ...args]);
  await git("fetch", "-q", "origin", branch);
  const [author, subject, at] = (await git("log", "-1", "--format=%an%x09%s%x09%cI", `origin/${branch}`)).trim().split("\t");
  return { key: `${repo.slug}@${branch}`, branchOnly: true, repo: repo.name, slug: repo.slug, number: 0, title: branch, subject, url: `https://github.com/${repo.slug}/tree/${branch}`, author, mine: false, branch, baseRef: null, updatedAt: at, ticket: null, project: null, manualTag: null, labels: [], device: null, blockedBy: null, behind: null, conflict: false, conflictFiles: [], failing: [], threads: 0, isDraft: false, station: "base", reason: "No PR yet", action: "open-pr", command: null, group: null, groupSize: 0 };
}

/** PRs of one ticket or project go together. The API is merged first; the rest in any order. */
function group(prs) {
  const keyOf = (p) => p.project?.id ?? p.ticket;
  const counts = new Map();
  for (const p of prs) if (keyOf(p) && p.station !== "dormant") counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1);
  return prs.map((p) => {
    const size = counts.get(keyOf(p)) ?? 0;
    return { ...p, group: size > 1 ? keyOf(p) : null, groupSize: size };
  });
}

export function settings() {
  return readJson(settingsFile(), { daily: {}, tracked: {} });
}

export function snapshot(projectId) {
  if (projectId === "all") {
    const all = projects.listProjects().map((p) => readJson(snapshotFile(p.id), null)).filter(Boolean);
    const prs = withRuns(all.flatMap((s) => s.prs));
    return { projectId, at: all.map((s) => s.at).sort().at(-1) ?? null, repos: all.flatMap((s) => s.repos), prs, others: all.flatMap((s) => s.others), today: todayList(prs), errors: all.flatMap((s) => s.errors), running: running.size > 0, daily: false, tracked: { authors: [], prs: [], branches: [] } };
  }
  const saved = readJson(snapshotFile(projectId), { projectId, at: null, repos: [], prs: [], others: [], today: [], errors: [] });
  return { ...saved, prs: withRuns(saved.prs), running: running.has(projectId), daily: dailyEnabled(projectId, saved), tracked: trackedFor(projectId) };
}

const readRuns = () => readJson(runsFile(), {});

function withRuns(prs) {
  const runs = readRuns();
  return prs.map((p) => ({ ...p, runs: runs[p.key] ?? [] }));
}

/** Resuming a session that ran on a PR keeps the same limits. */
export const hooksFor = (sessionId) => (Object.values(readRuns()).flat().some((r) => r.id === sessionId) ? askBeforePublishing : undefined);

const trackedFor = (projectId) => ({ authors: [], prs: [], branches: [], ...settings().tracked?.[projectId] });

/** A folder is swept every morning once it has PRs, unless turned off. */
function dailyEnabled(projectId, saved = readJson(snapshotFile(projectId), null)) {
  return settings().daily?.[projectId] ?? Boolean(saved?.prs?.length);
}

export function saveSettings(projectId, { daily, tracked }) {
  const current = settings();
  if (daily !== undefined) current.daily = { ...current.daily, [projectId]: Boolean(daily) };
  if (tracked) current.tracked = { ...current.tracked, [projectId]: { ...trackedFor(projectId), ...tracked } };
  writeJson(settingsFile(), current);
  return snapshot(projectId);
}

async function collect(project) {
  const repos = (await pool(findRepos(project.root), 6, describeRepo)).filter((r) => r.slug);
  // A repo cloned in two folders belongs to the most specific one: home gives way to the folders inside it.
  const nested = projects.listProjects().filter((p) => p.root.startsWith(project.root + path.sep));
  const taken = new Set((await pool(nested.flatMap((p) => findRepos(p.root)), 6, describeRepo)).map((r) => r.slug?.toLowerCase()));
  const unique = [...new Map(repos.filter((r) => !taken.has(r.slug.toLowerCase())).map((r) => [r.slug.toLowerCase(), r])).values()];
  const tracked = trackedFor(project.id);
  const me = (await gh(["api", "user"])).login;
  const errors = [];
  const open = new Map();
  await pool(unique, 4, async (repo) => {
    try {
      open.set(repo.slug, await gh(["pr", "list", "-R", repo.slug, "--state", "open", "--limit", "100", "--json", "number,title,author,isDraft,updatedAt,headRefName,url"]));
    } catch (e) {
      errors.push({ repo: repo.slug, message: e.stderr?.trim() || e.message });
    }
  });
  const follows = (pr) => pr.author?.login === me || tracked.authors.includes(pr.author?.login);
  const wanted = unique.flatMap((repo) => (open.get(repo.slug) ?? []).filter((pr) => follows(pr) || tracked.prs.includes(`${repo.slug}#${pr.number}`)).map((pr) => ({ repo, number: pr.number })));
  const ctx = { me, open, tasks: store.listTasks(), baseChecks: new Map() };
  const [prs, byBranch] = await Promise.all([
    pool(wanted, 4, ({ repo, number }) =>
      summarize(repo, number, ctx).catch((e) => {
        errors.push({ repo: `${repo.slug}#${number}`, message: e.stderr?.trim() || e.message });
        return null;
      }),
    ),
    sessionsByBranch(),
  ]);
  // A branch that got its PR moves on to being that PR.
  const pending = tracked.branches.map((b) => ({ repo: unique.find((r) => b.startsWith(`${r.slug}@`)), branch: b.slice(b.indexOf("@") + 1) })).filter(({ repo, branch }) => repo && !open.get(repo.slug)?.some((pr) => pr.headRefName === branch));
  const branches = await pool(pending, 4, ({ repo, branch }) => summarizeBranch(repo, branch).catch(() => null));
  const grouped = [...group(prs.filter(Boolean)), ...branches.filter(Boolean)].map((p) => ({ ...p, sessions: [...(byBranch.get(p.branch) ?? [])] }));
  const keys = new Set(grouped.map((p) => p.key));
  const others = unique.flatMap((repo) => (open.get(repo.slug) ?? []).filter((pr) => !keys.has(`${repo.slug}#${pr.number}`)).map((pr) => ({ key: `${repo.slug}#${pr.number}`, repo: repo.name, number: pr.number, title: pr.title, author: pr.author?.login ?? "ghost", isDraft: pr.isDraft, updatedAt: pr.updatedAt })));
  return { projectId: project.id, at: new Date().toISOString(), me, repos: unique, prs: grouped, others, today: todayList(grouped), errors };
}

const running = new Map();

/** Sweeps a folder. A second call while one runs joins it; a failed sweep keeps the last good result. */
export function sweep(projectId, notify = () => {}) {
  if (running.has(projectId)) return running.get(projectId);
  const project = projects.listProjects().find((p) => p.id === projectId);
  if (!project) throw new Error("Folder not found");
  const job = collect(project)
    .then((result) => writeJson(snapshotFile(projectId), result))
    .catch((e) => {
      const saved = readJson(snapshotFile(projectId), { projectId, at: null, repos: [], prs: [], others: [], today: [] });
      writeJson(snapshotFile(projectId), { ...saved, errors: [{ repo: "GitHub", message: e.code === "ENOENT" ? "GitHub CLI (gh) isn't installed" : e.stderr?.trim() || e.message }] });
    })
    .finally(() => {
      running.delete(projectId);
      notify("ws:prs", { projectId, running: false });
    });
  running.set(projectId, job);
  notify("ws:prs", { projectId, running: true });
  return job;
}

/** Every morning at 8:00 in Buenos Aires, and on start if this morning's sweep was missed. */
export function startSweeps(notify) {
  const due = () => projects.listProjects().filter((p) => dailyEnabled(p.id));
  const missed = nextSweep() - DAY_MS;
  for (const p of due()) if (Date.parse(readJson(snapshotFile(p.id), {}).at ?? 0) < missed) void sweep(p.id, notify);
  const schedule = () =>
    setTimeout(() => {
      for (const p of due()) void sweep(p.id, notify);
      schedule();
    }, nextSweep() - Date.now());
  schedule();
}

function appSchemes(repoPath) {
  const scheme = readJson(path.join(repoPath, "app.json"), {}).expo?.scheme;
  return [scheme].flat().filter(Boolean);
}

const usesExpo = (repoPath) => Boolean(readJson(path.join(repoPath, "package.json"), {}).dependencies?.["expo-dev-client"]);

function usesProdTest(repoPath) {
  const folder = path.join(repoPath, ".github", "workflows");
  if (!fs.existsSync(folder)) return false;
  return fs.readdirSync(folder).some((f) => fs.readFileSync(path.join(folder, f), "utf8").includes("prod-test"));
}

async function previews(slug, pr) {
  const list = await gh(["api", `repos/${slug}/deployments?ref=${encodeURIComponent(pr.headRefName)}&per_page=20`]).catch(() => []);
  const latest = new Map();
  for (const d of list) if (d.environment.includes(`PR #${pr.number}`) && !latest.has(d.environment)) latest.set(d.environment, d);
  const found = await pool([...latest.values()], 4, async (d) => {
    const [status] = await gh(["api", `repos/${slug}/deployments/${d.id}/statuses?per_page=1`]).catch(() => []);
    return httpsOnly(status?.environment_url) ? { name: d.environment.replace(/^.* - /, "").replace(/ PR #\d+$/, ""), url: status.environment_url, state: status.state, at: d.created_at } : null;
  });
  return found.filter(Boolean);
}

const excerpt = (body) => (body.match(/Verdict:[^\n]*/i)?.[0] ?? body).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*#`>_]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

function timeline(pr, linked) {
  const events = [];
  for (const c of pr.commits) events.push({ kind: "commit", at: c.committedDate, who: c.author?.name ?? "Commit", text: c.messageHeadline, url: `${pr.url}/commits/${c.oid}` });
  for (const r of pr.allReviews) if (r.state !== "PENDING" && (r.body || r.state !== "COMMENTED")) events.push({ kind: "review", at: r.submittedAt, who: r.author?.login ?? "Reviewer", text: excerpt(r.body) || r.state.toLowerCase().replace("_", " "), url: r.url });
  for (const c of pr.comments) {
    const kind = /agent-device test (failed|passed|succeeded)/i.test(c.body) ? "test" : /qr\.expo\.dev/.test(c.body) ? "preview" : c.bot ? "agent" : "comment";
    const test = kind === "test" ? deviceTest([c]) : null;
    events.push({ kind, at: c.createdAt, who: c.author ?? "Comment", text: test ? `Device test ${test.ok ? "passed" : "failed"}: ${test.path}` : kind === "preview" ? "Published the Expo preview" : excerpt(c.body), url: c.url });
  }
  for (const s of linked) events.push({ kind: "session", at: s.lastTs ?? s.firstTs, who: "Claude session", text: s.title, sessionId: s.id, subagents: s.subagents?.length ?? 0 });
  return events.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at));
}

async function conflicts(repoPath, pr) {
  const { tree, files } = await mergeState(repoPath, pr);
  return pool(files.slice(0, 8), 4, async (file) => {
    const text = await run("git", ["-C", repoPath, "show", `${tree}:${file}`]).catch(() => "");
    return { file, hunks: conflictHunks(text).slice(0, 6).map((h) => ({ line: h.line, base: h.base.slice(0, 40), head: h.head.slice(0, 40) })) };
  });
}

const details = new Map();

/** Everything shown when entering a PR. Heavier than the sweep, so it's fetched on demand. */
export async function prDetail(slug, number) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug ?? "") || !Number.isInteger(number)) throw new Error("Unknown PR");
  const key = `${slug}#${number}`;
  const hit = details.get(key);
  if (hit && Date.now() - hit.at < DETAIL_TTL) return { ...hit.value, metro: hit.value.metro && metroState(key) };
  const saved = projects.listProjects().map((p) => readJson(snapshotFile(p.id), null)).filter(Boolean);
  const known = saved.flatMap((s) => s.repos).find((r) => r.slug === slug);
  const indexed = new Set(saved.flatMap((s) => s.prs).find((p) => p.key === key)?.sessions);
  const pr = await fetchPr(slug, number);
  const repoPath = known?.path && fs.existsSync(known.path) ? known.path : null;
  const [deployments, conflicted] = await Promise.all([
    previews(slug, pr),
    repoPath && !pr.isCrossRepository && pr.mergeable !== "MERGEABLE" ? conflicts(repoPath, pr).catch(() => []) : [],
  ]);
  const runs = new Set(readRuns()[key]?.map((r) => r.id));
  const linked = sessions.listSessions({}).filter((s) => runs.has(s.id) || indexed.has(s.id) || s.gitBranch === pr.headRefName || s.prLinks.includes(pr.url));
  const expoComment = pr.comments.filter((c) => c.bot && /qr\.expo\.dev/.test(c.body)).at(-1);
  const expo = expoComment ? expoPreview(expoComment.body, repoPath ? appSchemes(repoPath) : []) : null;
  const value = {
    key,
    timeline: timeline(pr, linked),
    conflicts: conflicted,
    previews: deployments,
    device: deviceTest(pr.comments),
    metro: repoPath && !pr.isCrossRepository && usesExpo(repoPath) ? metroState(key) : null,
    commands: repoPath && !pr.isCrossRepository ? commandsFor(repoPath, saved.flatMap((s) => s.prs).find((p) => p.key === key)) : null,
    expo: expo && { ...expo, at: expoComment.createdAt, prodTest: repoPath ? usesProdTest(repoPath) : false, labeled: pr.labels.includes("prod-test") },
  };
  details.set(key, { at: Date.now(), value });
  return value;
}

/** What can be run on a PR: what its state asks for first, then what gets used the most. */
export function commandsFor(repoPath, pr, use = skillUse()) {
  const all = listCommands(repoPath).filter((c) => c.source !== "builtin");
  const usesOf = (c) => ({ name: c.name, description: c.description ?? "", uses: use[c.name] ?? 0 });
  const prSkills = all.filter((c) => PR_SKILLS.includes(c.name)).map(usesOf).sort((a, b) => b.uses - a.uses);
  const device = fs.existsSync(path.join(repoPath, ".github", "workflows", "agent-device-test.yml"));
  const wanted = pr?.device && !pr.device.ok && device ? "@test" : null;
  const recommended = SKILL_FOR_ACTION[pr?.action] ?? null;
  const top = prSkills.filter((c) => c.name !== recommended).slice(0, TOP_COMMANDS);
  const topNames = new Set(top.map((c) => c.name));
  return { recommended, device, wanted, top, more: all.filter((c) => !topNames.has(c.name) && c.name !== recommended).map(usesOf).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)) };
}

/** The prompt that runs a command on a PR. Rebasing has no skill: it stops before pushing, the rest bring their own rules. */
export function promptFor(command, pr) {
  if (command === "resume") return `Catch me up on PR #${pr.number}: what it does, where it stopped and what's left before merging. Don't change anything yet.`;
  if (command === "rebase") return `Rebase ${pr.headRefName} onto origin/${pr.baseRefName}. Resolve the conflicts, run the tests they touch, and ask me before pushing.`;
  return command.startsWith("pr-") || command === "code-review" ? `/${command} ${pr.number}` : `/${command}`;
}

/** The PR's own checkout, so an agent never switches the branch of the one you're working in. */
export async function worktreeFor(repoPath, root, pr) {
  if (pr.headRefName.startsWith("-")) throw new Error("Unexpected branch name");
  const git = (...args) => run("git", ["-C", repoPath, ...args]);
  await git("fetch", "-q", "origin", pr.headRefName);
  const list = await git("worktree", "list", "--porcelain");
  const existing = list.split("\n\n").find((block) => block.split("\n").includes(`branch refs/heads/${pr.headRefName}`));
  if (existing) return existing.match(/^worktree (.+)$/m)[1];
  const target = path.join(root, ".worktrees", `pr-${pr.number}`, path.basename(repoPath));
  const local = await git("rev-parse", "--verify", "-q", `refs/heads/${pr.headRefName}`).then(() => true, () => false);
  await git("worktree", "add", ...(local ? [target, pr.headRefName] : ["--track", "-b", pr.headRefName, target, `origin/${pr.headRefName}`]));
  return target;
}

const PUBLISHES = /\bgit\s+push\b|\bgh\s+pr\s+(merge|close|ready|review|comment|edit)\b|\bgh\s+api\b[\s\S]*(--method|-X)\s*(POST|PATCH|PUT|DELETE)|\bgh\s+api\s+graphql\b[\s\S]*\bmutation\b/;

/**
 * Agents on a PR work freely, but whatever reaches GitHub stops for your OK, even in Full access. A line in the
 * prompt can't promise that: it has to be enforced outside the model.
 */
export const publishes = (command) => PUBLISHES.test(command);

export const askBeforePublishing = {
  PreToolUse: [
    {
      matcher: "Bash",
      hooks: [
        async (input) =>
          publishes(input.tool_input?.command ?? "")
            ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "This changes the PR on GitHub" } }
            : {},
      ],
    },
  ],
};

/** Works out where and what to run. Starting the agent is up to the caller. */
export async function prepareRun(slug, number, command) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug ?? "") || !Number.isInteger(number)) throw new Error("Unknown PR");
  const folders = projects.listProjects().map((p) => ({ root: p.root, repo: readJson(snapshotFile(p.id), null)?.repos?.find((r) => r.slug === slug) }));
  const folder = folders.find((f) => f.repo);
  if (!folder) throw new Error("This repo isn't in any folder");
  if (!["rebase", "resume"].includes(command) && !listCommands(folder.repo.path).some((c) => c.name === command)) throw new Error(`Unknown skill: ${command}`);
  const pr = await fetchPr(slug, number);
  if (pr.isCrossRepository) throw new Error("PRs from forks can't run here yet");
  return { cwd: await worktreeFor(folder.repo.path, folder.root, pr), prompt: promptFor(command, pr) };
}

export function recordRun(slug, number, id, command) {
  const key = `${slug}#${number}`;
  const runs = readRuns();
  writeJson(runsFile(), { ...runs, [key]: [...(runs[key] ?? []), { id, command, at: new Date().toISOString() }] });
  details.delete(key);
}

const assertPr = (slug, number) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug ?? "") || !Number.isInteger(number) || number < 1) throw new Error("Unknown PR");
};

/** These change GitHub, so the UI always confirms before calling them. */
export async function githubAction(action, slug, number) {
  assertPr(slug, number);
  const args = { test: ["comment", String(number), "--body", "@test"], ready: ["ready", String(number)], close: ["close", String(number)] }[action];
  if (!args) throw new Error("Unknown action");
  await run("gh", ["pr", ...args, "-R", slug]);
  details.delete(`${slug}#${number}`);
}

function repoInFolders(slug) {
  const repo = projects.listProjects().map((p) => readJson(snapshotFile(p.id), null)?.repos?.find((r) => r.slug === slug)).find(Boolean);
  if (!repo) throw new Error("This repo isn't in any folder");
  return repo;
}

export async function trackBranch(projectId, slug, branch) {
  if (!branch || branch.startsWith("-")) throw new Error("Unknown branch");
  const repo = repoInFolders(slug);
  await run("git", ["-C", repo.path, "ls-remote", "--exit-code", "--heads", "origin", branch]).catch(() => {
    throw new Error(`${branch} isn't on GitHub`);
  });
  const tracked = trackedFor(projectId);
  return saveSettings(projectId, { tracked: { ...tracked, branches: [...new Set([...tracked.branches, `${slug}@${branch}`])] } });
}

/** Opens a draft, so nothing asks for review until someone decides it's ready. */
export async function openPr(slug, branch) {
  const repo = repoInFolders(slug);
  const subject = (await run("git", ["-C", repo.path, "log", "-1", "--format=%s", `origin/${branch}`])).trim();
  await run("gh", ["pr", "create", "-R", slug, "--head", branch, "--draft", "--title", subject || branch, "--body", ""]);
}

export async function metro(action, slug, number, { tunnel, notify } = {}) {
  assertPr(slug, number);
  const key = `${slug}#${number}`;
  if (action === "stop") return stopMetro(key);
  const folders = projects.listProjects().map((p) => ({ root: p.root, repo: readJson(snapshotFile(p.id), null)?.repos?.find((r) => r.slug === slug) }));
  const folder = folders.find((f) => f.repo);
  if (!folder) throw new Error("This repo isn't in any folder");
  if (action === "state") return metroState(key);
  const pr = await fetchPr(slug, number);
  if (pr.isCrossRepository) throw new Error("PRs from forks can't run here yet");
  const cwd = await worktreeFor(folder.repo.path, folder.root, pr);
  return startMetro(key, { cwd, mainRepo: folder.repo.path, schemes: appSchemes(folder.repo.path), tunnel, notify });
}
