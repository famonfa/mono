import fs from "node:fs";
import path from "node:path";
import { readConfig, writeConfig } from "./paths.mjs";
import { PROJECTS_DIR, assertSafe } from "./store.mjs";

/**
 * Design imports: Figma frames become PNG snapshots in the task's assets/ plus the data a `design`
 * node needs to link back and refresh. Pencil (.pen) files are encrypted and only readable through
 * the Pencil MCP, so agents export those themselves and write a `design` node with source "pen".
 */

const FIGMA_API = "https://api.figma.com/v1";
const MAX_FRAMES = 20;

export class FigmaTokenError extends Error {
  code = "figma-token";
}

/** `figma.com/{design,file,proto,board}/<key>/…?node-id=12-34` → { fileKey, nodeId: "12:34" | null }. */
export function parseFigmaUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error("Paste a Figma link (figma.com/design/…)");
  }
  const match = /^\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (!/(^|\.)figma\.com$/.test(url.hostname) || !match) throw new Error("Paste a Figma link (figma.com/design/…)");
  const nodeId = url.searchParams.get("node-id")?.replace(/-/g, ":") || null;
  return { fileKey: match[1], nodeId };
}

const figmaToken = (token) => token || process.env.FIGMA_TOKEN || readConfig().figmaToken;

async function figma(pathname, token) {
  const res = await fetch(`${FIGMA_API}${pathname}`, { headers: { "X-Figma-Token": token } });
  if (res.status === 403 || res.status === 401) throw new FigmaTokenError("Figma rejected the token (it needs file_content:read)");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Figma: ${body.err ?? body.message ?? res.statusText}`);
  return body;
}

/** The frames to import: the linked node, or the top-level frames of the file's first page. */
async function resolveFrames(fileKey, nodeId, token) {
  if (nodeId) {
    const { nodes } = await figma(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`, token);
    const doc = nodes?.[nodeId]?.document;
    if (!doc) throw new Error(`Node ${nodeId} not found in that file`);
    // A page (canvas) link means "everything on this page".
    if (doc.type === "CANVAS") return (doc.children ?? []).filter((n) => n.absoluteBoundingBox).slice(0, MAX_FRAMES);
    return [doc];
  }
  const file = await figma(`/files/${fileKey}?depth=2`, token);
  const page = file.document?.children?.[0];
  return (page?.children ?? []).filter((n) => n.absoluteBoundingBox).slice(0, MAX_FRAMES);
}

/**
 * Exports Figma frames into `tasks/<id>/assets/` and returns the node data for each one.
 * Re-importing the same link overwrites the PNGs, which is how a design node refreshes.
 */
export async function importFigma(taskId, rawUrl, { token: given } = {}) {
  assertSafe(taskId);
  const token = figmaToken(given);
  if (!token) throw new FigmaTokenError("Add a Figma personal access token to import");
  const { fileKey, nodeId } = parseFigmaUrl(rawUrl);
  const frames = await resolveFrames(fileKey, nodeId, token);
  if (!frames.length) throw new Error("Nothing to import: the page has no frames");
  const ids = frames.map((f) => f.id);
  const { images } = await figma(`/images/${fileKey}?ids=${encodeURIComponent(ids.join(","))}&format=png&scale=2`, token);
  // Only remember a token once Figma has accepted it.
  if (given && given !== readConfig().figmaToken) writeConfig({ figmaToken: given });

  const dir = path.join(PROJECTS_DIR, taskId, "assets");
  fs.mkdirSync(dir, { recursive: true });
  const syncedAt = new Date().toISOString();
  const out = [];
  for (const frame of frames) {
    const src = images?.[frame.id];
    if (!src) continue;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Figma export failed for "${frame.name}"`);
    const name = `figma-${fileKey}-${frame.id.replace(/[^A-Za-z0-9]/g, "-")}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
    const box = frame.absoluteBoundingBox ?? { width: 4, height: 3 };
    out.push({
      label: frame.name,
      image: `assets/${name}`,
      link: `https://www.figma.com/design/${fileKey}/?node-id=${frame.id.replace(/:/g, "-")}`,
      design: { source: "figma", fileKey, nodeId: frame.id, syncedAt },
      aspect: box.width / Math.max(1, box.height),
    });
  }
  return out;
}

export const hasFigmaToken = () => Boolean(figmaToken());
