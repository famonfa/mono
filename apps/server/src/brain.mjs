import fs from "node:fs";
import path from "node:path";
import * as store from "./store.mjs";

/**
 * A project is the user's shared brain for a piece of work: notes, decisions, canvases and files.
 * This is what agents get told about it, and how they search across every project.
 */

const MAX_PAGES = 80;
const MAX_FILES = 30;
const MAX_RESULTS = 30;

function outline(pages, depth = 0, out = []) {
  for (const p of pages) {
    if (out.length >= MAX_PAGES) break;
    out.push(`${"  ".repeat(depth)}- ${p.id} — ${p.title} (${p.kind === "board" ? `canvas, ${p.boardKind}` : p.kind})`);
    outline(p.children, depth + 1, out);
  }
  return out;
}

/** Every file the user uploaded, not only the images the UI previews. */
function projectFiles(id) {
  const dir = path.join(store.PROJECTS_DIR, id, "assets");
  try {
    return { dir, files: fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort() };
  } catch {
    return { dir, files: [] };
  }
}

/** The system prompt addition for a session working on `project`, and what `ws context` prints. */
export function projectContext(project) {
  const { id } = project;
  const pages = outline(project.pages ?? []);
  const total = store.flattenPages(project.pages ?? []).length;
  const { dir, files } = projectFiles(id);
  return [
    `You are working on Mono project ${id} — "${project.title}" (http://localhost:4600/#/t/${id}).`,
    project.tldr?.problema && `Problem: ${project.tldr.problema}`,
    project.tldr?.solucion && `Solution: ${project.tldr.solucion}`,
    project.repos?.length && `Repos/PRs: ${project.repos.map((r) => `${r.name}${r.branch ? ` (${r.branch})` : ""}${r.pr ? ` ${r.pr}` : ""}`).join(", ")}`,
    "",
    "This project is the user's brain for this work: their notes, decisions, canvases and files. Before deciding anything about scope, product, design or approach, read the pages that bear on it, and search across all their projects when something may have been decided elsewhere:",
    `- \`ws get ${id} <page>\` prints a page (a doc's markdown, a canvas's nodes, a folder's pages).`,
    "- `ws search <words>` searches every project's notes, canvases and summaries (`--project <id>` for one).",
    "- If what you're about to do contradicts something the user wrote, say so and ask instead of picking silently.",
    pages.length ? `Pages${total > pages.length ? ` (first ${pages.length} of ${total})` : ""}:\n${pages.join("\n")}` : "Pages: none yet.",
    files.length ? `Files the user uploaded (${dir}; open them with Read):\n${files.slice(0, MAX_FILES).map((f) => `- ${f}`).join("\n")}${files.length > MAX_FILES ? `\n- …and ${files.length - MAX_FILES} more` : ""}` : null,
    "",
    `When you finish a meaningful block of work (tests, fixes, findings), update the workspace with the workspace skill using \`ws board ... --patch\`, and add decisions worth remembering to \`ws doc ${id} decisiones <file>\` (keep what's there). Don't rewrite the user's own notes unless they ask.`,
  ]
    .filter((line) => line !== null && line !== undefined && line !== false && line !== 0)
    .join("\n");
}

const fold = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** A board as searchable lines: its title and description, then each node's label and detail. */
function boardLines(board) {
  return [board.title, board.description, ...(board.nodes ?? []).filter((n) => n.type !== "lane").map((n) => [n.data?.label, n.data?.detail].filter(Boolean).join(" — "))].filter(Boolean);
}

/**
 * Pages (and project summaries) containing every word of `query`, accents and case ignored. Each hit
 * carries the line that matched best, so an agent can tell what's worth opening.
 */
export function search(query, { projectId } = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const projects = projectId ? [store.getProject(projectId)].filter(Boolean) : store.listProjects();
  const hits = [];
  const consider = (project, page, title, lines, kind = null) => {
    const haystack = fold([title, ...lines].join("\n"));
    if (!terms.every((t) => haystack.includes(t))) return;
    const scored = lines.map((line) => ({ line, score: terms.filter((t) => fold(line).includes(t)).length })).sort((a, b) => b.score - a.score);
    const best = scored[0]?.score ? scored[0].line.trim() : "";
    const count = terms.reduce((n, t) => n + haystack.split(t).length - 1, 0);
    hits.push({ project: project.id, projectTitle: project.title, page, kind, title, snippet: best.length > 200 ? `${best.slice(0, 200)}…` : best, score: count + (terms.every((t) => fold(title).includes(t)) ? 5 : 0) });
  };
  for (const project of projects) {
    const tldr = project.tldr ?? {};
    consider(project, null, project.title, [tldr.problema, tldr.solucion, tldr.impacto, ...(project.summary ?? "").split("\n")].filter(Boolean));
    for (const page of store.flattenPages(project.pages ?? [])) {
      if (page.kind === "doc") consider(project, page.id, page.title, (store.getDoc(project.id, page.id) ?? "").split("\n").filter((l) => l.trim()), "doc");
      else if (page.kind === "board") consider(project, page.id, page.title, boardLines(store.getBoard(project.id, page.id) ?? {}), "board");
      else consider(project, page.id, page.title, [], "folder");
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
