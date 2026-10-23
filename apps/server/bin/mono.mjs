#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../src/store.mjs";
import * as sessions from "../src/sessions.mjs";
import * as groups from "../src/groups.mjs";
import * as launcher from "../src/launcher.mjs";

launcher.runFromRuntime();

const USAGE = `mono (alias: ws) — Mono CLI (http://localhost:4600)

  mono [--web]                             Start the server if needed and open the desktop app (or the browser)
  mono serve                               Run the server in the foreground
  mono status                              Server, service and remote connection status
  mono connect <relay-url>                 Connect this machine to the relay (Google) for phone/web access
  mono disconnect                          Drop the remote connection
  mono service install|uninstall           Start Mono at login (launchd) and put mono/ws on PATH

  ws list                                  List tasks
  ws show <task>                           Show task.json + boards/docs/assets
  ws get <task> <board>                    Print a board (nodes and edges) for editing
  ws task <task> <file.json|->             Create/update metadata (shallow merge)
  ws board <task> <board> <file.json|-> [--relayout | --patch]
                                           Create/update a board, keeping the user's layout.
                                           --patch only adds/updates nodes, never deletes.
  ws undo <task> <board>                   Revert the board to before its last write
  ws doc <task> <name.md> <file.md|->      Write a doc
  ws asset <task> <image...>               Copy images to assets/
  ws sessions [task] [--since ISO]         Recent agent activity (one task or all)
  ws groups                                List session groups (chat canvases)
  ws group <group> <session-id...>         Add sessions to a group's canvas (creates it if missing)
  ws open [task]                           Open the app in the browser
  ws path [task]                           Print the data folder`;

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
    for (const t of store.listTasks()) {
      console.log(`${t.id.padEnd(14)} ${String(t.status).padEnd(10)} ${t.title}  [${t.boards.map((b) => b.id).join(", ")}]`);
    }
    break;
  }
  case "show": {
    requireArgs(1);
    const task = store.getTask(args[0]);
    if (!task) fail(`Task not found: ${args[0]}`);
    console.log(JSON.stringify(task, null, 2));
    break;
  }
  case "get": {
    requireArgs(2);
    const board = store.getBoard(args[0], args[1]);
    if (!board) fail(`Board not found: ${args[0]}/${args[1]}`);
    const compact = {
      ...board,
      // Lanes, parents and positions are the app's layout; agents place nodes with the \`lane\` name.
      nodes: board.nodes.filter((n) => n.type !== "lane").map(({ id, type, data }) => ({ id, type, ...data })),
    };
    console.log(JSON.stringify(compact, null, 2));
    break;
  }
  case "task": {
    requireArgs(2);
    const [id, source] = args;
    store.assertSafe(id);
    const task = store.saveTask(id, JSON.parse(readInput(source)));
    console.log(`✓ task ${task.id} updated`);
    break;
  }
  case "board": {
    requireArgs(3);
    const [id, boardId, source] = args.filter((a) => !a.startsWith("--"));
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
    const restored = store.restoreBoard(args[0], args[1]);
    console.log(`✓ board ${args[0]}/${args[1]} restored to ${restored.replace(".json", "")}`);
    break;
  }
  case "doc": {
    requireArgs(3);
    const [id, name, source] = args;
    store.saveDoc(id, name, readInput(source));
    console.log(`✓ doc ${id}/docs/${name}`);
    break;
  }
  case "asset": {
    requireArgs(2);
    const [id, ...files] = args;
    store.assertSafe(id);
    const dir = path.join(store.TASKS_DIR, id, "assets");
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) {
      const name = path.basename(file).replace(/[^A-Za-z0-9._-]/g, "-");
      fs.copyFileSync(file, path.join(dir, name));
      console.log(`✓ assets/${name}`);
    }
    break;
  }
  case "sessions": {
    const [id] = args.filter((a) => !a.startsWith("--"));
    const sinceArg = args.indexOf("--since");
    const since = sinceArg >= 0 ? args[sinceArg + 1] : undefined;
    const all = sessions.listSessions({ days: 7 });
    const task = id ? store.getTask(id) : null;
    if (id && !task) fail(`Task not found: ${id}`);
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
    console.log(args[0] ? path.join(store.TASKS_DIR, args[0]) : store.TASKS_DIR);
    break;
  }
  default:
    console.log(USAGE);
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
