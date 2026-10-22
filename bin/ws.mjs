#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../server/store.mjs";
import * as sessions from "../server/sessions.mjs";

const USAGE = `mono (alias: ws) — CLI de Mono (http://localhost:4600)

  ws list                                  Lista las tareas
  ws show <task>                           Muestra task.json + boards/docs/assets
  ws get <task> <board>                    Imprime un board (nodos y conexiones) para editarlo
  ws task <task> <file.json|->             Crea/actualiza metadatos (merge superficial)
  ws board <task> <board> <file.json|-> [--relayout | --patch]
                                           Crea/actualiza un board conservando lo que movió el usuario.
                                           --patch solo agrega/actualiza nodos, nunca borra.
  ws undo <task> <board>                   Vuelve el board a la versión anterior a la última escritura
  ws doc <task> <name.md> <file.md|->      Escribe un documento
  ws asset <task> <image...>               Copia imágenes a assets/
  ws sessions [task] [--since ISO]         Actividad reciente de los agentes (de una tarea o todos)
  ws open [task]                           Abre la app en el navegador
  ws path [task]                           Imprime la carpeta de datos`;

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

switch (command) {
  case "list": {
    for (const t of store.listTasks()) {
      console.log(`${t.id.padEnd(14)} ${String(t.status).padEnd(10)} ${t.title}  [${t.boards.map((b) => b.id).join(", ")}]`);
    }
    break;
  }
  case "show": {
    requireArgs(1);
    const task = store.getTask(args[0]);
    if (!task) fail(`No existe la tarea ${args[0]}`);
    console.log(JSON.stringify(task, null, 2));
    break;
  }
  case "get": {
    requireArgs(2);
    const board = store.getBoard(args[0], args[1]);
    if (!board) fail(`No existe el board ${args[0]}/${args[1]}`);
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
    console.log(`✓ tarea ${task.id} actualizada`);
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
    console.log(`✓ board ${id}/${boardId}: ${merged.nodes.length} nodos, ${merged.edges.length} conexiones${kept ? ` (${kept} conservaron su posición)` : ""}`);
    break;
  }
  case "undo": {
    requireArgs(2);
    const restored = store.restoreBoard(args[0], args[1]);
    console.log(`✓ board ${args[0]}/${args[1]} restaurado a ${restored.replace(".json", "")}`);
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
    if (id && !task) fail(`No existe la tarea ${id}`);
    const list = task ? sessions.sessionsForTask(task, all) : all.filter((x) => x.status !== "inactive");
    if (!list.length) console.log("Sin sesiones vinculadas.");
    for (const session of list) printSessionDigest(session, since);
    break;
  }
  case "open": {
    const url = `http://localhost:4600/${args[0] ? `#/t/${args[0]}` : ""}`;
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
  console.log(`${session.project} · ${session.gitBranch ?? "-"} · última actividad ${session.lastTs}${session.prLinks.length ? ` · PRs ${session.prLinks.map((u) => "#" + u.split("/").pop()).join(" ")}` : ""}`);
  const detail = sessions.readSessionEvents(session.id);
  const events = detail.events.filter((e) => !since || e.ts > since);
  const results = new Map(events.filter((e) => e.kind === "result").map((e) => [e.toolUseId, e]));
  console.log("\n### Línea de tiempo (más reciente al final)");
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
    console.log(`\n### Subagente: ${agent.description}  [${agent.status}]`);
    console.log(short(finalTexts.join("\n\n"), 2500) || "(sin texto todavía)");
  }
}
