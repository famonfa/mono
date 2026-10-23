import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_DIR } from "./paths.mjs";

const SKILLS_DIR = path.join(PKG_DIR, "skills");
const PREFIX = "capture-";

/** Reads the flat `key: value` frontmatter of a SKILL.md (all the bundled skills use that shape). */
function frontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const out = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const csv = (value) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** The capture skills Mono ships: what each one targets, what it produces and whether it has been run for real. */
export function listCaptureSkills() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(SKILLS_DIR).filter((d) => d.startsWith(PREFIX));
  } catch {}
  return dirs.flatMap((dir) => {
    try {
      const meta = frontmatter(fs.readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8"));
      return [
        {
          id: dir,
          name: meta.name ?? dir,
          description: meta.description ?? "",
          targets: csv(meta.targets),
          outputs: csv(meta.outputs),
          needs: csv(meta.needs),
          verified: meta.verified && meta.verified !== "false" ? meta.verified : null,
        },
      ];
    } catch {
      return [];
    }
  });
}

export const captureSkillDir = (id) => (listCaptureSkills().some((s) => s.id === id) ? path.join(SKILLS_DIR, id) : null);

/**
 * adb is rarely on PATH; the Android skill needs its real location both in the prompt and in the
 * permission allowlist (a command only matches a rule when it starts with the same path).
 */
export function adbPath() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library", "Android", "sdk")].filter(Boolean);
  for (const root of candidates) {
    const file = path.join(root, "platform-tools", "adb");
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Permission rules for one capture skill, taken from its own `allowed-tools`, with the adb and emulator wildcards resolved to their real paths. */
export function captureAllowedTools(id) {
  const dir = captureSkillDir(id);
  if (!dir) return [];
  const meta = frontmatter(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"));
  const adb = adbPath();
  const tools = [];
  // The skill may list rules containing commas inside parentheses; split only on top-level commas.
  let depth = 0;
  let current = "";
  for (const ch of meta["allowed-tools"] ?? "") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      tools.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) tools.push(current.trim());
  const emulator = adb ? path.join(path.dirname(path.dirname(adb)), "emulator", "emulator") : null;
  return tools.flatMap((rule) => {
    if (rule === "Bash(*/platform-tools/adb:*)") return adb ? [`Bash(${adb}:*)`] : [];
    if (rule === "Bash(*/emulator/emulator:*)") return emulator ? [`Bash(${emulator}:*)`] : [];
    return [rule];
  });
}

/** Copies the chosen capture skill into the headless session's own project so it loads without touching ~/.claude. */
export function installCaptureSkill(id, cwd) {
  const src = captureSkillDir(id);
  if (!src) throw new Error(`Unknown capture skill: ${id}`);
  fs.cpSync(src, path.join(cwd, ".claude", "skills", id), { recursive: true });
}
