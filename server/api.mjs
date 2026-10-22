import fs from "node:fs";
import path from "node:path";
import * as store from "./store.mjs";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body ?? null));
}

function serveFile(req, res, next) {
  const rel = decodeURIComponent(req.url.replace(/^\/files\//, "").split("?")[0]);
  const file = path.resolve(store.TASKS_DIR, rel);
  if (!file.startsWith(store.TASKS_DIR + path.sep) || !fs.existsSync(file)) return next();
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}

/**
 * Vite plugin exposing the workspace data as a tiny REST API, plus a file watcher
 * that pushes a `ws:data` event so the UI refreshes when the AI writes files.
 */
export function workspaceApi() {
  return {
    name: "workspace-api",
    configureServer(server) {
      fs.mkdirSync(store.TASKS_DIR, { recursive: true });

      let timer;
      const pending = new Set();
      fs.watch(store.TASKS_DIR, { recursive: true }, (_event, filename) => {
        if (!filename || filename.endsWith(".tmp")) return;
        const taskId = filename.split(path.sep)[0];
        pending.add(taskId);
        clearTimeout(timer);
        timer = setTimeout(() => {
          server.ws.send({ type: "custom", event: "ws:data", data: { tasks: [...pending] } });
          pending.clear();
        }, 150);
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith("/files/")) return serveFile(req, res, next);
        if (!req.url.startsWith("/api/")) return next();

        const url = new URL(req.url, "http://localhost");
        const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
        const method = req.method;
        try {
          const body = ["PUT", "POST"].includes(method) ? JSON.parse((await readBody(req)) || "{}") : undefined;
          const [resource, id, sub, subId] = parts;
          if (resource !== "tasks") return send(res, 404, { error: "not found" });

          if (!id) {
            if (method === "GET") return send(res, 200, store.listTasks());
            if (method === "POST") {
              store.assertSafe(body.id);
              return send(res, 200, store.saveTask(body.id, body));
            }
          }

          if (id && !sub) {
            if (method === "GET") {
              const task = store.getTask(id);
              return task ? send(res, 200, task) : send(res, 404, { error: "not found" });
            }
            if (method === "PUT") {
              return send(res, 200, store.saveTask(id, body));
            }
            if (method === "DELETE") {
              store.trashTask(id);
              return send(res, 200, { ok: true });
            }
          }

          if (sub === "boards" && subId) {
            if (method === "GET") {
              const board = store.getBoard(id, subId);
              return board ? send(res, 200, board) : send(res, 404, { error: "not found" });
            }
            if (method === "PUT") {
              return send(res, 200, store.saveBoard(id, subId, body));
            }
            if (method === "DELETE") {
              store.deleteBoard(id, subId);
              return send(res, 200, { ok: true });
            }
          }

          if (sub === "docs" && subId) {
            if (method === "GET") {
              const doc = store.getDoc(id, subId);
              return doc === null ? send(res, 404, { error: "not found" }) : send(res, 200, { name: subId, content: doc });
            }
            if (method === "PUT") {
              store.saveDoc(id, subId, body.content ?? "");
              return send(res, 200, { ok: true });
            }
          }

          return send(res, 404, { error: "not found" });
        } catch (error) {
          return send(res, 400, { error: String(error.message ?? error) });
        }
      });
    },
  };
}
