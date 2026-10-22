import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchRootFor } from "./projects.mjs";

const HOME = os.homedir();
const CACHE_MS = 60_000;
const BUILTINS = [
  { name: "compact", description: "Compactar la conversación para liberar contexto", source: "builtin" },
  { name: "context", description: "Ver cuánto contexto está usando la sesión", source: "builtin" },
];

const cache = new Map();

function frontmatter(file) {
  let head = "";
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString("utf8");
  } catch {
    return {};
  }
  const block = head.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const field = (key) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const firstLine = head.replace(/^---[\s\S]*?---\n/, "").split("\n").find((l) => l.trim() && !l.startsWith("#"));
  return { name: field("name"), description: field("description") ?? firstLine?.trim() };
}

const short = (text) => (text && text.length > 160 ? `${text.slice(0, 157)}…` : text ?? "");

function skillsIn(dir, source, prefix = "") {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => path.join(dir, e.name, "SKILL.md"))
    .filter((f) => fs.existsSync(f))
    .map((f) => {
      const meta = frontmatter(f);
      return { name: prefix + (meta.name ?? path.basename(path.dirname(f))), description: short(meta.description), source };
    });
}

function commandsIn(dir, source, prefix = "") {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return files.map((f) => ({ name: prefix + f.replace(/\.md$/, ""), description: short(frontmatter(path.join(dir, f)).description), source }));
}

function pluginEntries() {
  let enabled = {};
  try {
    enabled = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", "settings.json"), "utf8")).enabledPlugins ?? {};
  } catch {}
  const out = [];
  for (const [key, on] of Object.entries(enabled)) {
    if (!on) continue;
    const [plugin, marketplace] = key.split("@");
    const base = path.join(HOME, ".claude", "plugins", "marketplaces", marketplace ?? "");
    for (const root of [path.join(base, "plugins", plugin), base]) {
      const found = [...skillsIn(path.join(root, "skills"), "plugin", `${plugin}:`), ...commandsIn(path.join(root, "commands"), "plugin", `${plugin}:`)];
      if (found.length) {
        out.push(...found);
        break;
      }
    }
  }
  return out;
}

/** Slash commands a session started from `cwd` can use: project skills/commands win over personal ones, then plugins and built-ins. */
export function listCommands(cwd) {
  const root = cwd ? launchRootFor(cwd) : null;
  const key = root ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;

  const all = [
    ...(root ? [...skillsIn(path.join(root, ".claude", "skills"), "project"), ...commandsIn(path.join(root, ".claude", "commands"), "project")] : []),
    ...skillsIn(path.join(HOME, ".claude", "skills"), "user"),
    ...commandsIn(path.join(HOME, ".claude", "commands"), "user"),
    ...pluginEntries(),
    ...BUILTINS,
  ];
  const seen = new Set();
  const list = all.filter((c) => c.name && !seen.has(c.name) && seen.add(c.name));
  cache.set(key, { at: Date.now(), list });
  return list;
}
