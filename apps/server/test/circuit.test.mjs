import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metroLink } from "../src/metro.mjs";
import { blockedBy, classify, conflictHunks, deviceTest, expoPreview, nextSweep, promptFor, publishes, todayList, worktreeFor } from "../src/circuit.mjs";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const pr = (over = {}) => ({ updatedAt: "2026-11-03T12:00:00Z", conflict: false, conflictFiles: [], failing: [], foreignCi: false, commitCount: 3, nonConventional: 0, threads: 0, reviews: 1, isDraft: false, baseRef: "develop", ...over });
const station = (over) => classify(pr(over), NOW).station;

test("a PR stops at the first station it doesn't pass", () => {
  assert.equal(station({ conflict: true, failing: ["e2e"], threads: 2 }), "base");
  assert.equal(station({ failing: ["e2e"], threads: 2 }), "ci");
  assert.equal(station({ commitCount: 13, threads: 2 }), "commits");
  assert.equal(station({ nonConventional: 1 }), "commits");
  assert.equal(station({ threads: 2 }), "review");
  assert.equal(station({ reviews: 0 }), "review");
  assert.equal(station({}), "ready");
});

test("only GitHub says a PR can merge: a bot's review isn't enough", () => {
  assert.equal(classify(pr({ reviewDecision: "REVIEW_REQUIRED" }), NOW).action, "approval");
  assert.equal(classify(pr({ mergeState: "BLOCKED" }), NOW).action, "approval");
  assert.equal(classify(pr({ reviewDecision: "REVIEW_REQUIRED" }), NOW).station, "review");
  assert.equal(classify(pr({ reviewDecision: "CHANGES_REQUESTED" }), NOW).action, "resolve");
  assert.equal(classify(pr({ reviewDecision: "APPROVED", mergeState: "CLEAN" }), NOW).action, "land");
  assert.equal(classify(pr({ reviewDecision: "REVIEW_REQUIRED", isDraft: true }), NOW).action, "mark-ready");
});

test("dormant PRs are set apart first, past 90 days", () => {
  assert.equal(station({ updatedAt: "2026-07-01T00:00:00Z", conflict: true }), "dormant");
  assert.equal(station({ updatedAt: "2026-08-10T00:00:00Z" }), "ready");
});

test("the next step says what the PR needs", () => {
  assert.equal(classify(pr({ isDraft: true }), NOW).action, "mark-ready");
  assert.equal(classify(pr(), NOW).action, "land");
  assert.equal(classify(pr({ failing: ["e2e"], foreignCi: true }), NOW).action, "wait");
  assert.equal(classify(pr({ failing: ["e2e"] }), NOW).action, "fix");
  assert.equal(classify(pr({ threads: 2 }), NOW).action, "resolve");
});

test("today goes closest to production first and leaves out what can't move", () => {
  const item = (key, action, over = {}) => ({ key, action, station: "review", updatedAt: "2026-11-03", groupSize: 0, ...over });
  const list = todayList([item("wait", "wait"), item("chain", "rebase", { groupSize: 3 }), item("rebase", "rebase"), item("resolve", "resolve"), item("ready", "mark-ready"), item("old", "decide", { station: "dormant" }), item("blocked", "resolve", { manualTag: "blocked: env var" })]);
  assert.deepEqual(list, ["ready", "resolve", "rebase", "chain", "wait"]);
});

test("the sweep runs at 8:00 in Buenos Aires", () => {
  assert.equal(new Date(nextSweep(Date.parse("2026-11-04T10:59:00Z"))).toISOString(), "2026-11-04T11:00:00.000Z");
  assert.equal(new Date(nextSweep(Date.parse("2026-11-04T11:00:00Z"))).toISOString(), "2026-11-05T11:00:00.000Z");
  assert.equal(new Date(nextSweep(Date.parse("2026-11-05T02:30:00Z"))).toISOString(), "2026-11-05T11:00:00.000Z");
});

const COMMENT = `<!-- projectId:abc --> Runtime Version → **exposdk:54.0.0** [More info](https://expo.dev/projects/p/updates/9e513916-a93f-406c-8ffe-e6c4ab2dfe10) <a href="https://qr.expo.dev/eas-update?appScheme=KDS&projectId=ce6b&branchId=01a1"><img/></a>`;

test("the Expo QR uses a scheme the app registers, so a camera can open it", () => {
  const expo = expoPreview(COMMENT, ["myapp", "exp+myapp"]);
  assert.equal(expo.link, "exp+myapp://expo-development-client/?url=https%3A%2F%2Fu.expo.dev%2Fce6b%2Fbranch%2F01a1");
  assert.equal(expo.update, "9e513916");
  assert.equal(expo.runtime, "exposdk:54.0.0");
  assert.equal(expo.production, false);
  assert.equal(expoPreview("no qr here"), null);
});

test("without a local repo it falls back to the scheme in the comment", () => {
  assert.match(expoPreview(COMMENT).link, /^exp\+KDS:\/\//);
});

test("device test reads the last result", () => {
  const comments = [{ body: "KDS agent-device test passed.", createdAt: "a" }, { body: "KDS agent-device test failed.\nSelected path: quick_order - Verify\nVideo/artifacts: https://x/y\n", createdAt: "b", url: "u" }];
  assert.deepEqual(deviceTest(comments), { ok: false, at: "b", path: "quick_order - Verify", video: "https://x/y", url: "u" });
  assert.equal(deviceTest([{ body: "nothing" }]), null);
});

test("a comment by a person can't pose as CI's device test", () => {
  assert.equal(deviceTest([{ body: "KDS agent-device test failed.", bot: false }]), null);
  assert.equal(deviceTest([{ body: "KDS agent-device test failed.\nVideo/artifacts: javascript:alert(1)\n", bot: true }]).video, null);
});

test("blocked by another PR comes from what a human said", () => {
  const open = [{ number: 1515, headRefName: "playwright-ubuntu-26" }, { number: 7, headRefName: "fix" }];
  const of = (body, bot = false) => blockedBy({ number: 1, comments: [{ author: "a", bot, body }] }, open)?.number;
  assert.equal(of("the playwright-ubuntu-26 branch is fixing it"), 1515);
  assert.equal(of("blocked by #7"), 7);
  assert.equal(of("the playwright-ubuntu-26 branch", true), undefined);
  assert.equal(of("nothing about it"), undefined);
});

test("conflict hunks split both sides", () => {
  const hunks = conflictHunks("a\n<<<<<<< origin/develop\nours\n=======\ntheirs\ntwo\n>>>>>>> origin/x\nb");
  assert.deepEqual(hunks, [{ line: 2, base: ["ours"], head: ["theirs", "two"] }]);
});

test("commands get the PR number when they take one, and rebasing asks before pushing", () => {
  const target = { number: 1281, headRefName: "feat", baseRefName: "develop" };
  assert.equal(promptFor("pr-review-resolve", target), "/pr-review-resolve 1281");
  assert.equal(promptFor("clean-commits", target), "/clean-commits");
  assert.match(promptFor("rebase", target), /onto origin\/develop.*ask me before pushing/);
});

test("a PR runs in its own worktree and never moves the main checkout", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-"));
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  const origin = path.join(root, "origin");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "commit", "-q", "--allow-empty", "-m", "first");
  git(origin, "branch", "feat");
  git(root, "clone", "-q", origin, "repo");
  const repo = path.join(root, "repo");

  const made = await worktreeFor(repo, root, { number: 7, headRefName: "feat" });
  assert.equal(made, path.join(root, ".worktrees", "pr-7", "repo"));
  assert.equal(git(made, "branch", "--show-current"), "feat");
  assert.equal(git(repo, "branch", "--show-current"), "main");

  assert.equal(fs.realpathSync(await worktreeFor(repo, root, { number: 7, headRefName: "feat" })), fs.realpathSync(made));
  await assert.rejects(worktreeFor(repo, root, { number: 8, headRefName: "--upload-pack=x" }));
  fs.rmSync(root, { recursive: true, force: true });
});

test("the Metro QR is the link expo prints for a development build", () => {
  assert.equal(metroLink(["myapp", "exp+myapp"], "192.168.0.10", 8099), "exp+myapp://expo-development-client/?url=http%3A%2F%2F192.168.0.10%3A8099");
});

test("whatever reaches GitHub needs an OK, reading it doesn't", () => {
  for (const c of ["git push origin main", "cd x; git push --force-with-lease", "gh pr merge 1", "gh pr close 1", "gh pr ready 1", "gh pr comment 1 --body x", "gh pr review 1 --approve", "gh api repos/a/b/pulls/1/comments -X POST -f body=x", "gh api --method PATCH repos/a/b", "gh api graphql -f query='mutation { resolveReviewThread(input: {}) { thread { id } } }'"]) assert.ok(publishes(c), c);
  for (const c of ["git status", "git fetch origin", "git rebase origin/develop", "gh pr view 1", "gh pr list", "gh api repos/a/b/pulls/1", "gh api graphql -f query='query { viewer { login } }'"]) assert.ok(!publishes(c), c);
});
