import fs from "node:fs";
import path from "node:path";
import { relayApi } from "./remote.mjs";
import { sessionMarkdown } from "./guest.mjs";
import * as store from "./store.mjs";

/**
 * The other side of sharing: what someone shared with this Mac's user, pulled through the relay so
 * their own agents (their Claude Code, on this Mac) can use it as context. It's a read-only copy in
 * data/shared/<shareId>, refreshed whenever one of those sessions gets a message.
 */

const SHARED_DIR = path.join(store.DATA_DIR, "shared");
const LINKS_FILE = path.join(store.DATA_DIR, "shared-sessions.json");
const MAX_SESSIONS = 40;
const enc = encodeURIComponent;

const slug = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";

function boardMarkdown(board) {
  const nodes = (board.nodes ?? []).filter((n) => n.type !== "lane");
  const label = new Map(nodes.map((n) => [n.id, n.data?.label ?? n.id]));
  return [
    `# ${board.title ?? board.id} (canvas${board.kind ? ` · ${board.kind}` : ""})`,
    board.description ?? "",
    "",
    ...nodes.map((n) => `- ${n.data?.label ?? n.id}${n.data?.detail ? ` — ${n.data.detail}` : ""}${n.data?.test ? ` [${n.data.test}]` : ""}`),
    (board.edges ?? []).length ? "\nConnections:" : "",
    ...(board.edges ?? []).map((e) => `- ${label.get(e.source) ?? e.source} → ${label.get(e.target) ?? e.target}${e.label ? ` (${e.label})` : ""}`),
  ].join("\n");
}

const outline = (pages, depth = 0) => pages.flatMap((p) => [`${"  ".repeat(depth)}- ${p.id} — ${p.title} (${p.kind === "board" ? "canvas" : p.kind})`, ...outline(p.children ?? [], depth + 1)]);
const flatten = (pages) => pages.flatMap((p) => [p, ...flatten(p.children ?? [])]);

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Pulls a fresh copy of the share and returns where it is plus the system prompt that explains it. */
export async function syncShared(shareId) {
  if (!/^[A-Za-z0-9_-]+$/.test(shareId)) throw new Error("Invalid share");
  const share = (await relayApi("GET", "/shared")).find((s) => s.id === shareId);
  if (!share) throw new Error("This isn't shared with you (anymore)");
  const owner = share.ownerName ?? share.owner;
  const get = (route) => relayApi("GET", `/shares/${enc(shareId)}/proxy${route}`, undefined, { timeout: 60_000 });

  const dir = path.join(SHARED_DIR, shareId);
  const tmp = `${dir}.sync-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "sessions"), { recursive: true });
  const write = (rel, text) => {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  if (share.projectId && !share.sessionId) {
    const project = await get(`/api/tasks/${enc(share.projectId)}`);
    write(
      "project.md",
      [
        `# ${project.title}`,
        project.tldr?.problema && `Problem: ${project.tldr.problema}`,
        project.tldr?.solucion && `Solution: ${project.tldr.solucion}`,
        project.tldr?.impacto && `Impact: ${project.tldr.impacto}`,
        project.summary ? `\n${project.summary}` : null,
        `\nPages (files under pages/):\n${outline(project.pages ?? []).join("\n") || "none"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    await inBatches(flatten(project.pages ?? []), 6, async (page) => {
      if (page.kind === "doc") write(`pages/${page.id}.md`, (await get(`/api/tasks/${enc(share.projectId)}/docs/${enc(page.id)}`)).content ?? "");
      if (page.kind === "board") write(`pages/${page.id}.board.md`, boardMarkdown(await get(`/api/tasks/${enc(share.projectId)}/boards/${enc(page.id)}`)));
    });
  }

  const sessions = (await get("/api/sessions").catch(() => [])).sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? "")).slice(0, MAX_SESSIONS);
  await inBatches(sessions, 4, async (s) => {
    const detail = await get(`/api/sessions/${enc(s.id)}`).catch(() => null);
    if (detail) write(`sessions/${(s.lastTs ?? "").slice(0, 10)}-${slug(s.title)}-${s.id.slice(0, 8)}.md`, sessionMarkdown(detail, { owner, title: s.title }));
  });

  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);

  const what = share.sessionId ? `the Claude Code session "${share.title}"` : share.pageId ? `the folder "${share.title}" of a Mono project` : `the Mono project "${share.title}"`;
  const context = [
    `${owner} shared ${what} with the user. A read-only copy of it is in ${dir} (taken ${new Date().toISOString()}):`,
    share.projectId && !share.sessionId ? "- project.md: summary and page tree; pages/: its docs and canvases" : null,
    sessions.length ? `- sessions/: the conversations of ${sessions.length === 1 ? "its agent session" : `its ${sessions.length} agent sessions`}, newest last` : null,
    `Read what bears on the task before deciding anything, and say so if you're about to contradict something ${owner} decided there. It's a copy: changing it doesn't reach ${owner}. It refreshes each time the user sends a message.`,
  ]
    .filter(Boolean)
    .join("\n");
  return { dir, share, context };
}

/** sessionId → shareId, so a session started from a share refreshes that share before each message. */
export const readSharedLinks = () => store.readJson(LINKS_FILE, {});

export function linkSharedSession(sessionId, shareId) {
  store.writeJson(LINKS_FILE, { ...readSharedLinks(), [sessionId]: shareId });
}
