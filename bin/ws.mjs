#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../server/store.mjs";

const USAGE = `ws — CLI del Avocado Workspace (http://localhost:4600)

  ws list                                  Lista las tareas
  ws show <task>                           Muestra task.json + boards/docs/assets
  ws task <task> <file.json|->             Crea/actualiza metadatos (merge superficial)
  ws board <task> <board> <file.json|-> [--relayout]
                                           Crea/actualiza un board conservando lo que movió el usuario
  ws doc <task> <name.md> <file.md|->      Escribe un documento
  ws asset <task> <image...>               Copia imágenes a assets/
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
    const merged = store.mergeBoard(existing, incoming, { relayout: args.includes("--relayout") });
    store.saveBoard(id, boardId, merged);
    const kept = existing ? merged.nodes.filter((n) => n.position).length : 0;
    console.log(`✓ board ${id}/${boardId}: ${merged.nodes.length} nodos, ${merged.edges.length} conexiones${kept ? ` (${kept} conservaron su posición)` : ""}`);
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
