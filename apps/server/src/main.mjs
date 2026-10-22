import http from "node:http";
import { createApi, serveStatic } from "./api.mjs";
import { startRemote } from "./remote.mjs";
import { WEB_DIST as DIST } from "./paths.mjs";

const PORT = Number(process.env.PORT ?? 4600);
const HOST = "127.0.0.1";

const clients = new Set();
const relay = startRemote({ port: PORT });

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
  relay.forward(frame);
}

const api = createApi(broadcast);

const server = http.createServer((req, res) => {
  if (req.url === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  api(req, res, () => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    if (rel && serveStatic(res, DIST, rel)) return;
    if (!serveStatic(res, DIST, "index.html")) {
      res.statusCode = 503;
      res.end("Falta compilar la app: npm run build");
    }
  });
});

server.listen(PORT, HOST, () => console.log(`Mono en http://localhost:${PORT}`));
