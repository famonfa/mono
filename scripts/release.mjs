// Cuts a release: bumps the server (npm package) and desktop app to the same version, commits,
// tags vX.Y.Z and pushes. GitHub Actions (.github/workflows/release.yml) builds and publishes it.
// Usage: npm run release -- 0.4.0   (or patch | minor)
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = ["apps/server/package.json", "apps/desktop/package.json"];
const current = JSON.parse(fs.readFileSync(files[0], "utf8")).version;
const arg = process.argv[2] ?? "patch";
const [major, minor, patch] = current.split(".").map(Number);
const version = arg === "patch" ? `${major}.${minor}.${patch + 1}` : arg === "minor" ? `${major}.${minor + 1}.0` : arg;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("Uncommitted changes");
for (const file of files) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}
git("add", ...files);
git("commit", "-m", `chore: release v${version}`);
git("tag", `v${version}`);
git("push", "origin", "HEAD", `v${version}`);
console.log(`\n✓ v${version} on its way: https://github.com/famonfa/mono/actions`);
