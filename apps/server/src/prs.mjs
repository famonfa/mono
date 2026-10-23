import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PATH = [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].join(":");
const TTL = 60_000;
const cache = new Map();

function gh(url) {
  return new Promise((resolve) => {
    execFile("gh", ["pr", "view", url, "--json", "state,isDraft,title,statusCheckRollup,reviewDecision"], { env: { ...process.env, PATH }, timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve({ url, error: true });
      try {
        const pr = JSON.parse(stdout);
        const checks = pr.statusCheckRollup ?? [];
        const failing = checks.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(c.conclusion ?? c.state)).length;
        const pending = checks.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING").length;
        resolve({ url, state: pr.isDraft ? "DRAFT" : pr.state, title: pr.title, review: pr.reviewDecision || null, checks: { total: checks.length, failing, pending } });
      } catch {
        resolve({ url, error: true });
      }
    });
  });
}

/** State and CI of each PR of a task, cached for a minute so the Resumen can poll without hammering GitHub. */
export async function prStatus(urls) {
  const now = Date.now();
  return Promise.all(
    urls.map(async (url) => {
      const hit = cache.get(url);
      if (hit && now - hit.at < TTL) return hit.value;
      const value = await gh(url);
      cache.set(url, { at: now, value });
      return value;
    }),
  );
}
