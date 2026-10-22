// Stages the publishable package in .pack/: server code, the built UI, and its dependencies bundled
// inside the tarball WITHOUT the Agent SDK's per-platform Claude binaries (~260 MB). Mono runs the
// `claude` the user already has, so `npx @famonfa/mono` stays a small download.
// Usage: node scripts/stage.mjs [pack|publish]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.resolve(server, "../web/dist");
const out = path.join(server, ".pack");
const run = (cmd, args, cwd = out) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run("npm", ["run", "build", "-w", "@mono/web"], path.resolve(server, "../.."));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const dir of ["bin", "src", "skills"]) fs.cpSync(path.join(server, dir), path.join(out, dir), { recursive: true });
fs.cpSync(web, path.join(out, "web"), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
delete pkg.scripts;
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2));
run("npm", ["install", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund", "--no-package-lock"]);
// Bundle every installed module so npm never resolves (and downloads) the optional platform binaries.
pkg.bundleDependencies = fs.readdirSync(path.join(out, "node_modules")).flatMap((name) =>
  name.startsWith("@") ? fs.readdirSync(path.join(out, "node_modules", name)).map((n) => `${name}/${n}`) : name.startsWith(".") ? [] : [name],
);
pkg.files = ["bin", "src", "skills", "web"];
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2));

const action = process.argv[2];
if (action === "pack") run("npm", ["pack", "--pack-destination", server]);
if (action === "publish") run("npm", ["publish", "--access", "public"]);
