#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../src/store.mjs";
import * as sessions from "../src/sessions.mjs";
import * as groups from "../src/groups.mjs";
import * as launcher from "../src/launcher.mjs";
import * as designs from "../src/designs.mjs";
import * as brain from "../src/brain.mjs";

launcher.runFromRuntime();

const USAGE = `mono (alias: ws) — Mono CLI (http://localhost:4600)

  mono [--web]                             Start the server if needed and open the desktop app (or the browser)
  mono serve                               Run the server in the foreground
  mono status                              Server, service and remote connection status
  mono connect <relay-url>                 Connect this machine to the relay (Google) for phone/web access
  mono disconnect                          Drop the remote connection
  mono service install|uninstall           Start Mono at login (launchd) and put mono/ws on PATH

  A project holds a tree of pages. A page is a board (canvas) or a doc and can hold child pages;
  its id is its path: \`flujo\`, \`implementacion/tests/e2e\` (letters, digits, . _ -).
  Generated pages (story-map, flujo, testeo, mapa-tecnico, ui, decisiones) live in the project's
  Workspace folder: their bare names resolve to \`workspace/<name>\`.

  ws list                                  List projects
  ws show <project>                        Show project.json + page tree + assets
  ws pages <project>                       Print the page tree
  ws get <project> <page>                  Print a page: a board (nodes and edges), a doc, or a folder
  ws project <project> <file.json|->       Create/update metadata (shallow merge). Alias: ws task
  ws board <project> <page> <file.json|-> [--relayout | --patch]
                                           Create/update a board, keeping the user's layout.
                                           --patch only adds/updates nodes, never deletes.
  ws doc <project> <page> <file.md|->      Write a doc (\`notas\` or \`notas.md\`)
  ws folder <project> <page> [title]       Create a folder page, or retitle it
  ws mv <project> <page> <new-path>        Move or rename a page with its children
  ws rm <project> <page>                   Send a page and its children to the trash
  ws undo <project> <page>                 Revert a board or doc to before its last write
  ws asset <project> <image...>            Copy images to assets/
  ws figma <project> <board> <figma-url> [--lane <name>]
                                           Import Figma frames as design nodes (re-run to refresh).
                                           Token: FIGMA_TOKEN or figmaToken in ~/.mono/config.json
  ws context <project>                     What an agent should know: summary, page tree, files
  ws search <words...> [--project <id>]    Search every project's notes, canvases and summaries
  ws sessions [project] [--since ISO]      Recent agent activity (one project or all)
  ws groups                                List session groups (chat canvases)
  ws group <group> <session-id...>         Add sessions to a group's canvas (creates it if missing)
  ws open [project]                        Open the app in the browser
  ws path [project]                        Print the data folder`;

const [, , command, ...args] = process.argv;

function readInput(source) {
  return source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireArgs(count) {
  if (args.filter((a) => !a.startsWith("--")).length < count) fail(USAGE);
}

// `ws` with no args keeps printing usage (the /workspace skill relies on it); `mono` opens the app.
const invokedAs = path.basename(process.argv[1] ?? "");

// `mono --web` is still the launch command, just opened in the browser.
switch (command === "--web" ? "launch" : (command ?? (invokedAs === "ws" ? "help" : "launch"))) {
  case "launch":
    await launcher.launch({ web: process.argv.includes("--web") });
    break;
  case "serve":
    await import("../src/main.mjs");
    break;
  case "status":
    await launcher.status();
    break;
  case "connect":
    await launcher.connect(args[0], args[1]);
    break;
  case "disconnect":
    launcher.disconnect();
    break;
  case "service":
    if (args[0] === "install") launcher.installService({ ifMissing: args.includes("--if-missing") });
    else if (args[0] === "uninstall") launcher.uninstallService();
    else fail(USAGE);
    break;
  case "list": {
    for (const p of store.listProjects()) {
      const count = store.flattenPages(p.pages).length;
      console.log(`${p.id.padEnd(14)} ${String(p.status).padEnd(10)} ${p.title}  [${count} page${count === 1 ? "" : "s"}]`);
    }
    break;
  }
  case "pages": {
    requireArgs(1);
    const project = store.getProject(args[0]);
    if (!project) fail(`Project not found: ${args[0]}`);
    printPages(project.pages);
    break;
  }
  case "show": {
    requireArgs(1);
    const project = store.getProject(args[0]);
    if (!project) fail(`Project not found: ${args[0]}`);
    const { boards, docs, ...rest } = project;
    console.log(JSON.stringify(rest, null, 2));
    break;
  }
  case "get": {
    requireArgs(2);
    const page = store.getPage(args[0], store.resolvePageId(args[0], args[1]));
    if (!page) fail(`Page not found: ${args[0]}/${args[1]}`);
    if (page.kind === "doc") {
      process.stdout.write(page.content);
      break;
    }
    if (page.kind === "folder") {
      console.log(`${page.title} (folder)`);
      printPages(page.children, "  ");
      break;
    }
    const { board } = page;
    const compact = {
      ...board,
      // Lanes, parents and positions are the app's layout; agents place nodes with the \`lane\` name.
      nodes: board.nodes.filter((n) => n.type !== "lane").map(({ id, type, data }) => ({ id, type, ...data })),
    };
    console.log(JSON.stringify(compact, null, 2));
    break;
  }
  case "project":
  case "task": {
    requireArgs(2);
    const [id, source] = args;
    store.assertSafe(id);
    const project = store.saveProject(id, JSON.parse(readInput(source)));
    console.log(`✓ project ${project.id} updated`);
    break;
  }
  case "board": {
    requireArgs(3);
    const [id, name, source] = args.filter((a) => !a.startsWith("--"));
    const boardId = store.resolvePageId(id, name);
    const incoming = JSON.parse(readInput(source));
    const existing = store.getBoard(id, boardId);
    const merged = store.mergeBoard(existing, incoming, { relayout: args.includes("--relayout"), patch: args.includes("--patch") });
    store.snapshotBoard(id, boardId);
    store.saveBoard(id, boardId, merged);
    const kept = existing ? merged.nodes.filter((n) => n.position).length : 0;
    console.log(`✓ board ${id}/${boardId}: ${merged.nodes.length} nodes, ${merged.edges.length} edges${kept ? ` (${kept} kept their position)` : ""}`);
    break;
  }
  case "undo": {
    requireArgs(2);
    const pageId = store.resolvePageId(args[0], args[1]);
    const isDoc = store.getDoc(args[0], pageId) !== null;
    const restored = isDoc ? store.restoreDoc(args[0], pageId) : store.restoreBoard(args[0], pageId);
    console.log(`✓ ${isDoc ? "doc" : "board"} ${args[0]}/${pageId} restored to ${restored.replace(/\.(json|md)$/, "")}`);
    break;
  }
  case "doc": {
    requireArgs(3);
    const [id, name, source] = args;
    const pageId = store.resolvePageId(id, name);
    store.snapshotDoc(id, pageId);
    store.saveDoc(id, pageId, readInput(source));
    console.log(`✓ doc ${id}/${pageId}`);
    break;
  }
  case "folder": {
    requireArgs(2);
    const [id, pageId, ...title] = args;
    store.saveFolder(id, pageId, title.join(" ") || undefined);
    console.log(`✓ folder ${id}/${pageId}`);
    break;
  }
  case "mv": {
    requireArgs(3);
    const [id, from, to] = args;
    console.log(`✓ ${id}/${from} → ${id}/${store.movePage(id, store.resolvePageId(id, from), to)}`);
    break;
  }
  case "rm": {
    requireArgs(2);
    store.trashPage(args[0], store.resolvePageId(args[0], args[1]));
    console.log(`✓ ${args[0]}/${args[1]} moved to the trash`);
    break;
  }
  case "asset": {
    requireArgs(2);
    const [id, ...files] = args;
    store.assertSafe(id);
    const dir = path.join(store.PROJECTS_DIR, id, "assets");
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) {
      const name = path.basename(file).replace(/[^A-Za-z0-9._-]/g, "-");
      fs.copyFileSync(file, path.join(dir, name));
      console.log(`✓ assets/${name}`);
    }
    break;
  }
  case "figma": {
    requireArgs(3);
    const laneAt = args.indexOf("--lane");
    const lane = laneAt >= 0 ? args[laneAt + 1] : undefined;
    const [id, name, url] = args.filter((a, i) => !a.startsWith("--") && i !== laneAt + 1);
    const boardId = store.resolvePageId(id, name);
    const frames = await designs.importFigma(id, url).catch((e) => fail(e.message));
    const existing = store.getBoard(id, boardId);
    // Same frame → same node id, so re-importing refreshes the node in place.
    const nodes = frames.map(({ aspect, ...data }) => ({ id: `figma-${data.design.fileKey.slice(0, 8)}-${data.design.nodeId.replace(/[^A-Za-z0-9]/g, "-")}`, type: "design", ...data, ...(lane ? { lane } : {}) }));
    store.snapshotBoard(id, boardId);
    store.saveBoard(id, boardId, store.mergeBoard(existing, { title: existing?.title ?? boardId, kind: existing?.kind ?? "ui", nodes, edges: [] }, { patch: true }));
    for (const n of nodes) console.log(`✓ ${n.id}  ${n.label}  → ${n.image}`);
    break;
  }
  case "context": {
    requireArgs(1);
    const project = store.getProject(args[0]);
    if (!project) fail(`Project not found: ${args[0]}`);
    console.log(brain.projectContext(project));
    break;
  }
  case "search": {
    const at = args.indexOf("--project");
    const projectId = at >= 0 ? args[at + 1] : undefined;
    const query = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1)).join(" ");
    if (!query) fail(USAGE);
    const hits = brain.search(query, { projectId });
    if (!hits.length) console.log("No matches.");
    for (const h of hits) {
      console.log(`${h.project}${h.page ? ` / ${h.page}` : ""} — ${h.title}${h.page ? "" : " (project summary)"}`);
      if (h.snippet) console.log(`   ${h.snippet}`);
    }
    break;
  }
  case "sessions": {
    const [id] = args.filter((a) => !a.startsWith("--"));
    const sinceArg = args.indexOf("--since");
    const since = sinceArg >= 0 ? args[sinceArg + 1] : undefined;
    const all = sessions.listSessions({ days: 7 });
    const task = id ? store.getProject(id) : null;
    if (id && !task) fail(`Project not found: ${id}`);
    const list = task ? sessions.sessionsForTask(task, all) : all.filter((x) => x.status !== "inactive");
    if (!list.length) console.log("No linked sessions.");
    for (const session of list) printSessionDigest(session, since);
    break;
  }
  case "groups": {
    for (const g of groups.listGroups()) console.log(`${g.id}\t${g.name}\t${g.panes.length} session${g.panes.length === 1 ? "" : "s"}\thttp://localhost:4600/#/g/${g.id}`);
    break;
  }
  case "group": {
    requireArgs(2);
    const [ref, ...ids] = args;
    const titles = new Map(sessions.listSessions({ days: 30 }).map((s) => [s.id, s.title]));
    let group = groups.findGroup(ref) ?? groups.createGroup({ name: ref });
    for (const id of ids) group = groups.addSession(group.id, id, titles.get(id));
    console.log(`${group.name}: ${group.panes.length} session${group.panes.length === 1 ? "" : "s"} · http://localhost:4600/#/g/${group.id}`);
    break;
  }
  case "open": {
    await launcher.ensureServer();
    const url = `${launcher.APP_URL}/${args[0] ? `#/t/${args[0]}` : ""}`;
    execFileSync("open", [url]);
    console.log(url);
    break;
  }
  case "path": {
    console.log(args[0] ? path.join(store.PROJECTS_DIR, args[0]) : store.PROJECTS_DIR);
    break;
  }
  default:
    console.log(USAGE);
}

function printPages(pages, indent = "") {
  const icon = { board: "▦", doc: "¶", folder: "▸" };
  for (const p of pages) {
    console.log(`${indent}${icon[p.kind]} ${p.id}${p.title !== p.id.split("/").pop() ? `  — ${p.title}` : ""}${p.kind === "board" ? `  (${p.boardKind}, ${p.nodeCount} nodes)` : ""}`);
    printPages(p.children, indent + "  ");
  }
}

function printSessionDigest(session, since) {
  const short = (text, max) => (text && text.length > max ? `${text.slice(0, max)}…` : text ?? "");
  console.log(`\n## ${session.title}  [${session.status}]  ${session.id}`);
  console.log(`${session.project} · ${session.gitBranch ?? "-"} · last activity ${session.lastTs}${session.prLinks.length ? ` · PRs ${session.prLinks.map((u) => "#" + u.split("/").pop()).join(" ")}` : ""}`);
  const detail = sessions.readSessionEvents(session.id);
  const events = detail.events.filter((e) => !since || e.ts > since);
  const results = new Map(events.filter((e) => e.kind === "result").map((e) => [e.toolUseId, e]));
  console.log("\n### Timeline (most recent last)");
  for (const e of events.slice(-70)) {
    if (e.kind === "prompt") console.log(`\n👤 ${short(e.text, 500)}`);
    if (e.kind === "text") console.log(`\n🤖 ${short(e.text, 700)}`);
    if (e.kind === "notice") console.log(`ℹ️ ${short(e.text, 200)}`);
    if (e.kind === "tool") {
      const r = results.get(e.id);
      console.log(`→ ${e.name}: ${short(e.title, 140)}${r?.isError ? `  ✗ ${short(r.text, 300)}` : ""}`);
    }
  }
  for (const agent of session.subagents.filter((a) => !since || (a.lastTs ?? "") > since)) {
    const agentDetail = sessions.readSessionEvents(session.id, { agent: agent.id });
    const finalTexts = agentDetail?.events.filter((e) => e.kind === "text").slice(-2).map((e) => e.text) ?? [];
    console.log(`\n### Subagent: ${agent.description}  [${agent.status}]`);
    console.log(short(finalTexts.join("\n\n"), 2500) || "(no text yet)");
  }
}
