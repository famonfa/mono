import fs from "node:fs";
import path from "node:path";
import { GUEST_HEADER } from "./remote.mjs";
import { readSessionEvents } from "./sessions.mjs";
import * as store from "./store.mjs";

/**
 * Someone the owner shared a scope with: a whole project, a folder of its pages, or one session.
 * The relay checks the share and attaches who the guest is to every request it tunnels here; without
 * that header the request is the owner's, as always. Roles: viewer < editor < agents.
 */

export function guestFrom(req) {
  const raw = req.headers[GUEST_HEADER];
  if (!raw) return null;
  try {
    const guest = JSON.parse(Buffer.from(String(raw), "base64url").toString());
    return guest?.email && guest.shareId ? guest : { email: "unknown", shareId: "-", role: "none" };
  } catch {
    // A garbled header must never fall back to the owner's full access.
    return { email: "unknown", shareId: "-", role: "none" };
  }
}

export const canEdit = (guest) => !guest.sessionId && (guest.role === "editor" || guest.role === "agents");
/** On a shared session, "agents" means continuing it in their own confined agent, never messaging the owner's. */
export const canRunAgents = (guest) => guest.role === "agents";

/** True for the shared page itself and anything inside it (any page, for a whole-project share). */
export function pageInScope(guest, pageId) {
  if (guest.sessionId || !guest.projectId) return false;
  if (!guest.pageId) return true;
  const id = String(pageId ?? "").replace(/\.md$/, "");
  return id === guest.pageId || id.startsWith(`${guest.pageId}/`);
}

export const projectInScope = (guest, projectId) => Boolean(guest.projectId) && !guest.sessionId && projectId === guest.projectId;

function findPage(pages, id) {
  for (const page of pages) {
    if (page.id === id) return page;
    const inside = findPage(page.children ?? [], id);
    if (inside) return inside;
  }
  return null;
}

/** The project as a guest sees it: for a folder share, only that folder's branch of the page tree. */
export function scopedProject(guest, project) {
  if (!project || !projectInScope(guest, project.id)) return null;
  const shared = { role: guest.role, pageId: guest.pageId ?? null, owner: guest.owner };
  if (!guest.pageId) return { ...project, shared };
  const root = findPage(project.pages ?? [], guest.pageId);
  const pages = root ? [root] : [];
  const flat = store.flattenPages(pages);
  const ids = new Set(flat.map((p) => p.id));
  return {
    ...project,
    shared,
    pages,
    boards: (project.boards ?? []).filter((b) => ids.has(b.id)),
    docs: (project.docs ?? []).filter((d) => ids.has(d.replace(/\.md$/, ""))),
    // Like a shared Drive folder: nothing from the rest of the project (its summary, sessions, PRs, links).
    sessionIds: [],
    repos: [],
    relatedPrs: [],
    tests: undefined,
    tldr: undefined,
    summary: undefined,
    linear: undefined,
    tags: [],
  };
}

/**
 * Files under /files/<project>/…: the project's uploads, and for a folder share only the files
 * stored inside the shared page's folder.
 */
export function fileInScope(guest, rel) {
  const [projectId, area, ...rest] = String(rel).split("/");
  if (!projectInScope(guest, projectId) || rest.some((p) => p === ".." || p === "")) return false;
  if (area === "assets") return true;
  return area === "pages" && pageInScope(guest, rest.join("/").replace(/\.(board\.json|md)$/, ""));
}

// ---------- sessions launched by guests ----------

const GUEST_SESSIONS_FILE = path.join(store.DATA_DIR, "guest-sessions.json");

/** sessionId → { email, name, shareId, projectId, pageId, at } */
export const readGuestSessions = () => store.readJson(GUEST_SESSIONS_FILE, {});

export function recordGuestSession(sessionId, guest) {
  const all = readGuestSessions();
  all[sessionId] = { email: guest.email, name: guest.name ?? null, shareId: guest.shareId, projectId: guest.projectId, pageId: guest.pageId ?? null, at: new Date().toISOString() };
  store.writeJson(GUEST_SESSIONS_FILE, all);
}

/** Which sessions a guest can see: the shared one, the project's (whole-project shares) and those launched under their share. */
export function sessionVisible(guest, session, launched = readGuestSessions()) {
  if (!session) return false;
  if (launched[session.id]?.shareId === guest.shareId) return true;
  if (guest.sessionId) return session.id === guest.sessionId;
  return !guest.pageId && projectInScope(guest, guest.projectId) && (session.taskIds ?? []).includes(guest.projectId);
}

/** Only agents launched under this share take messages from its guests: everything else is the owner's. */
export const sessionDrivable = (guest, sessionId, launched = readGuestSessions()) => canRunAgents(guest) && launched[sessionId]?.shareId === guest.shareId;

/**
 * Where a guest's agent may read and write: the project folder, or just the shared page (its doc or
 * canvas file plus its folder of children). `cwd` is where it starts.
 */
export function agentScope(guest) {
  if (guest.sessionId) {
    // A shared session has no pages to work on: its guests' agents get a folder of their own.
    if (!/^[A-Za-z0-9_-]+$/.test(guest.shareId)) throw new Error("Invalid share");
    const dir = path.join(store.DATA_DIR, "shares", guest.shareId);
    fs.mkdirSync(dir, { recursive: true });
    return { cwd: dir, roots: [dir], files: [] };
  }
  const projectDir = path.join(store.PROJECTS_DIR, guest.projectId);
  if (!guest.pageId) return { cwd: projectDir, roots: [projectDir], files: [] };
  const base = path.join(projectDir, "pages", ...store.pageSegments(guest.pageId));
  const folderExists = fs.statSync(base, { throwIfNoEntry: false })?.isDirectory();
  return { cwd: folderExists ? base : null, roots: [base], files: [`${base}.md`, `${base}.board.json`], parent: path.dirname(base) };
}

const realish = (p) => {
  // A file that doesn't exist yet: resolve its closest existing parent so a symlink can't lead outside.
  let dir = p;
  const tail = [];
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    tail.unshift(path.basename(dir));
    dir = path.dirname(dir);
  }
  try {
    return path.join(fs.realpathSync(dir), ...tail);
  } catch {
    return p;
  }
};

export function pathInScope(scope, target) {
  const real = realish(path.resolve(target));
  const roots = scope.roots.map((r) => realish(r));
  return roots.some((r) => real === r || real.startsWith(r + path.sep)) || scope.files.map((f) => realish(f)).includes(real);
}

// ---------- continuing a shared session ----------

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}… [cut]` : text);
const MAX_DIGEST = 150_000;

/** A session's events (from readSessionEvents) as markdown: prompts and answers in full, tool calls as one line, results clipped; newest last. */
export function sessionMarkdown(detail, { owner, title }) {
  const lines = [];
  for (const e of detail.events) {
    if (e.kind === "prompt") lines.push(`\n## ${owner} (${e.ts ?? ""})\n\n${e.text ?? ""}`);
    else if (e.kind === "text") lines.push(`\n## Agent\n\n${e.text ?? ""}`);
    else if (e.kind === "tool") lines.push(`- → ${e.name}: ${clip(String(e.title ?? ""), 200)}`);
    else if (e.kind === "result" && e.text) lines.push(`  - ${e.isError ? "error" : "result"}: ${clip(String(e.text).replace(/\n+/g, " "), 300)}`);
  }
  let body = lines.join("\n");
  if (body.length > MAX_DIGEST) body = `[…earlier part cut]\n${body.slice(-MAX_DIGEST)}`;
  return `# Session: ${title}\n\nBy ${owner}. Newest at the end.${detail.truncated ? " Only the most recent part of the session is here." : ""}\n${body}\n`;
}

/** The shared session as markdown next to the guest's confined agent, so it can read the conversation it continues. */
export function writeSessionDigest(guest, dir) {
  const detail = readSessionEvents(guest.sessionId);
  if (!detail) throw new Error("The shared session is gone");
  const file = path.join(dir, "shared-session.md");
  const title = detail.session?.title ?? guest.title;
  fs.writeFileSync(file, sessionMarkdown(detail, { owner: guest.owner, title }));
  return { file, title };
}
