// Copies the server package (plus the built UI) into server-bundle/, which electron-builder ships as
// Resources/server, so the downloaded app runs Mono without npm. Claude Code itself is not bundled:
// the platform binaries are optional deps, and the server uses the `claude` the user already has.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.resolve(desktop, "../server");
const web = path.resolve(desktop, "../web/dist");
const out = path.join(desktop, "server-bundle");

if (!fs.existsSync(path.join(web, "index.html"))) throw new Error("Falta compilar la web: npm run build");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const dir of ["bin", "src", "skills"]) fs.cpSync(path.join(server, dir), path.join(out, dir), { recursive: true });
fs.cpSync(web, path.join(out, "web"), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", dependencies: pkg.dependencies }, null, 2));
execFileSync("npm", ["install", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: out, stdio: "inherit" });
console.log(`✓ server-bundle listo (${execFileSync("du", ["-sh", out], { encoding: "utf8" }).split("\t")[0]})`);
