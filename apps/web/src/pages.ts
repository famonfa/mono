import { href } from "./router";
import type { Page } from "./types";

export function flattenPages(pages: Page[]): Page[] {
  return pages.flatMap((p) => [p, ...flattenPages(p.children)]);
}

/** Docs keep the `.md` name in their route, as they did when they lived in docs/. */
export function pageHref(taskId: string, page: Page) {
  if (page.kind === "board") return href.board(taskId, page.id);
  if (page.kind === "doc") return href.doc(taskId, `${page.id}.md`);
  return href.folder(taskId, page.id);
}

/** "a/b/c" → ["a", "a/b"]: the pages that must be open for "a/b/c" to show in the tree. */
export function ancestors(pageId: string) {
  const parts = pageId.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
