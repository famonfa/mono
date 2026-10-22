import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where things live. Mono runs either from the monorepo checkout (`~/mono`, during development) or
 * from the npm package (`npm i -g @famonfa/mono`); both resolve here so nothing else cares which.
 */

const HOME = os.homedir();
export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(PKG_DIR, "../..");
/** The monorepo root when running from a checkout, otherwise null. */
export const REPO_ROOT = fs.existsSync(path.join(repo, "apps", "web", "package.json")) ? repo : null;

export const CONFIG_DIR = path.join(HOME, ".mono");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}

/** The built UI: bundled into the package, or the web app's build output in a checkout. */
export const WEB_DIST = [path.join(PKG_DIR, "web"), REPO_ROOT && path.join(REPO_ROOT, "apps", "web", "dist")].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? path.join(PKG_DIR, "web");

/** Tasks, boards and uploads. A checkout keeps its historical `data/` folder; installs use ~/.mono/data. */
export const DATA_DIR =
  process.env.MONO_DATA_DIR ?? readConfig().dataDir ?? (REPO_ROOT && fs.existsSync(path.join(REPO_ROOT, "data")) ? path.join(REPO_ROOT, "data") : path.join(CONFIG_DIR, "data"));

/** Where chats start when no folder is picked (`defaultCwd` in ~/.mono/config.json; home otherwise). */
export function defaultCwd() {
  const dir = readConfig().defaultCwd;
  return dir && fs.existsSync(dir) ? dir : HOME;
}
