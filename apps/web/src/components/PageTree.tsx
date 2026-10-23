import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, PenLine, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import { BoardIcon, DocIcon } from "../icons";
import { ancestors, flattenPages, pageHref } from "../pages";
import { href, navigate } from "../router";
import { BOARD_KIND, type BoardKind, type Page, type Task } from "../types";
import { Menu, slugify } from "../ui";

export function PageIcon({ page, open = false, size = 14 }: { page: Page; open?: boolean; size?: number }) {
  if (page.kind === "board") return <BoardIcon kind={page.boardKind ?? "free"} size={size} />;
  if (page.kind === "doc") return <DocIcon size={size} />;
  return open ? <FolderOpen size={size} strokeWidth={1.8} /> : <Folder size={size} strokeWidth={1.8} />;
}

const PAGE_TYPES = [
  { value: "doc", label: "Doc", icon: <DocIcon size={13} /> },
  { value: "folder", label: "Folder", icon: <Folder size={13} strokeWidth={1.8} /> },
  ...(Object.keys(BOARD_KIND) as BoardKind[]).map((k) => ({ value: k, label: `Canvas · ${BOARD_KIND[k].label}`, icon: <BoardIcon kind={k} size={13} /> })),
];

/** The page on screen if it is `page` or sits inside it. */
const viewedWithin = (taskId: string, page: Page) => {
  const here = decodeURIComponent(window.location.hash);
  return [page, ...flattenPages(page.children)].find((p) => here === decodeURIComponent(pageHref(taskId, p)));
};

const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null);
const slugOf = (id: string) => id.slice(id.lastIndexOf("/") + 1);

type Drop = "before" | "after" | "inside";

/** The page being dragged in the sidebar. Native drag data can't be read while hovering, so it's kept here. */
let dragged: { taskId: string; page: Page } | null = null;

export const draggedPage = (taskId: string) => (dragged?.taskId === taskId ? dragged.page : null);

/** Whether `page` can land on `target`: not on itself or anything inside it. */
const canDrop = (page: Page, target: Page) => target.id !== page.id && !target.id.startsWith(`${page.id}/`);

/** Create, rename/move and trash pages through the app's dialog. */
export function usePageActions(task: Task) {
  const { openDialog } = useApp();
  const all = flattenPages(task.pages ?? []);

  const create = (parent: string | null, onCreated?: () => void) =>
    openDialog({
      title: parent ? `New page in ${all.find((p) => p.id === parent)?.title ?? parent}` : "New page",
      submitLabel: "Create",
      fields: [
        { name: "title", label: "Name" },
        { name: "kind", label: "Type", defaultValue: "doc", options: PAGE_TYPES },
      ],
      onSubmit: async ({ title, kind }) => {
        const name = title.trim();
        if (!name) throw new Error("Name is required");
        const slug = slugify(name);
        if (!slug) throw new Error("Use letters or numbers in the name");
        const id = parent ? `${parent}/${slug}` : slug;
        if (all.some((p) => p.id === id)) throw new Error("A page with that name already exists here");
        if (kind === "doc") await api.saveDoc(task.id, `${id}.md`, `# ${name}\n\n`);
        else if (kind === "folder") await api.saveFolder(task.id, id, name);
        else await api.saveBoard(task.id, { id, title: name, kind: kind as BoardKind, layout: kind === "storymap" ? "storymap" : "lanes", nodes: [], edges: [] });
        onCreated?.();
        navigate(pageHref(task.id, { id, title: name, kind: kind === "doc" || kind === "folder" ? kind : "board", children: [] }));
      },
    });

  const retitle = async (page: Page, title: string) => {
    if (page.kind === "board") {
      const board = await api.getBoard(task.id, page.id);
      await api.saveBoard(task.id, { ...board, title });
    } else if (page.kind === "folder") {
      await api.saveFolder(task.id, page.id, title);
    } else {
      const { content } = await api.getDoc(task.id, `${page.id}.md`);
      await api.saveDoc(task.id, `${page.id}.md`, /^#\s+.+$/m.test(content) ? content.replace(/^#\s+.+$/m, `# ${title}`) : `# ${title}\n\n${content}`);
    }
  };

  const edit = (page: Page) =>
    openDialog({
      title: "Rename or move",
      submitLabel: "Save",
      fields: [
        { name: "title", label: "Name", defaultValue: page.title },
        { name: "path", label: "Path (use / to nest it inside another page)", defaultValue: page.id, mono: true },
      ],
      onSubmit: async ({ title, path }) => {
        const to = path.split("/").map(slugify).filter(Boolean).join("/");
        if (!to) throw new Error("Path is required");
        const name = title.trim();
        if (name && name !== page.title) await retitle(page, name);
        if (to === page.id) return;
        const viewing = viewedWithin(task.id, page);
        const { id } = await api.movePage(task.id, page.id, to);
        if (viewing) navigate(pageHref(task.id, { ...viewing, id: id + viewing.id.slice(page.id.length) }));
      },
    });

  const trash = (page: Page) => {
    const inside = flattenPages(page.children).length;
    openDialog({
      title: `Move "${page.title}" to the trash?`,
      submitLabel: "Move to trash",
      fields: inside ? [{ name: "info", label: "", defaultValue: `The ${inside} ${inside === 1 ? "page" : "pages"} inside it go too.`, multiline: true, readOnly: true }] : [],
      onSubmit: async () => {
        const viewing = viewedWithin(task.id, page);
        await api.trashPage(task.id, page.id);
        if (viewing) navigate(href.task(task.id));
      },
    });
  };

  /** Puts `page` inside `parent` (null: the top level) at `index` among the pages already there. */
  const place = async (page: Page, parent: string | null, index: number) => {
    const slug = slugOf(page.id);
    const siblings = (parent ? all.find((p) => p.id === parent)?.children ?? [] : task.pages ?? []).map((p) => slugOf(p.id)).filter((s) => !(s === slug && parentOf(page.id) === parent));
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, slug);
    const viewing = viewedWithin(task.id, page);
    try {
      let id = page.id;
      if (parentOf(page.id) !== parent) ({ id } = await api.movePage(task.id, page.id, parent ? `${parent}/${slug}` : slug));
      await api.setPageOrder(task.id, parent, siblings);
      if (viewing) navigate(pageHref(task.id, { ...viewing, id: id + viewing.id.slice(page.id.length) }));
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  /** Where a page dropped on `target` lands: inside it, or next to it among its siblings. */
  const dropOn = (page: Page, target: Page, where: Drop) => {
    if (where === "inside") return place(page, target.id, target.children.length);
    const parent = parentOf(target.id);
    const siblings = (parent ? all.find((p) => p.id === parent)?.children ?? [] : task.pages ?? []).filter((p) => p.id !== page.id);
    const at = siblings.findIndex((p) => p.id === target.id);
    return place(page, parent, at + (where === "after" ? 1 : 0));
  };

  return { create, edit, trash, place, dropOn };
}

/** A project's pages as a Notion-style tree, nested `depth` levels into the sidebar; any page can hold pages. */
export function PageList({ task, activeId, depth = 0 }: { task: Task; activeId?: string; depth?: number }) {
  const actions = usePageActions(task);
  const storageKey = `ws-tree-${task.id}`;
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (activeId) setOpen((current) => (ancestors(activeId).every((a) => current.has(a)) ? current : new Set([...current, ...ancestors(activeId)])));
  }, [activeId]);
  useEffect(() => localStorage.setItem(storageKey, JSON.stringify([...open])), [open, storageKey]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const createIn = (parent: string | null) => actions.create(parent, () => parent && setOpen((current) => new Set([...current, parent])));

  return (
    <>
      {(task.pages ?? []).map((p) => (
        <PageNode key={p.id} task={task} page={p} depth={depth} activeId={activeId} open={open} toggle={toggle} onCreate={createIn} actions={actions} />
      ))}
      <button className="page-row page-new" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => createIn(null)}>
        <span className="page-toggle leaf">
          <Plus size={13} />
        </span>
        New page
      </button>
    </>
  );
}

function PageNode({
  task,
  page,
  depth,
  activeId,
  open,
  toggle,
  onCreate,
  actions,
}: {
  task: Task;
  page: Page;
  depth: number;
  activeId?: string;
  open: Set<string>;
  toggle: (id: string) => void;
  onCreate: (parent: string) => void;
  actions: ReturnType<typeof usePageActions>;
}) {
  const expanded = open.has(page.id);
  const hasChildren = page.children.length > 0;
  const [drop, setDrop] = useState<Drop | null>(null);
  return (
    <>
      <div
        className={`page-row ${page.id === activeId ? "active" : ""} ${drop ? `drop-${drop}` : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          dragged = { taskId: task.id, page };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", page.title);
        }}
        onDragEnd={() => (dragged = null)}
        onDragOver={(e) => {
          const moving = draggedPage(task.id);
          if (!moving || !canDrop(moving, page)) return;
          e.preventDefault();
          e.stopPropagation();
          // Top and bottom quarters: next to this page; the middle: inside it.
          const { top, height } = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - top) / height;
          setDrop(y < 0.25 ? "before" : y > 0.75 ? "after" : "inside");
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          const moving = draggedPage(task.id);
          const where = drop;
          setDrop(null);
          if (!moving || !where || !canDrop(moving, page)) return;
          e.preventDefault();
          e.stopPropagation();
          dragged = null;
          if (where === "inside" && !expanded) toggle(page.id);
          void actions.dropOn(moving, page, where);
        }}
      >
        {/* Like Notion: the icon turns into the expand arrow on hover, so nesting costs no extra column. */}
        {hasChildren ? (
          <button className={`page-toggle ${expanded ? "open" : ""}`} onClick={() => toggle(page.id)} title={expanded ? "Collapse" : "Expand"}>
            <span className="page-toggle-icon">
              <PageIcon page={page} open={expanded} size={14} />
            </span>
            <ChevronRight size={13} className="page-toggle-chevron" />
          </button>
        ) : (
          <span className="page-toggle leaf">
            <PageIcon page={page} size={14} />
          </span>
        )}
        <a className="page-link" href={pageHref(task.id, page)} title={page.id} draggable={false}>
          <span className="page-title">{page.title}</span>
        </a>
        <span className="page-actions">
          <button className="icon-btn tiny" onClick={() => onCreate(page.id)} title="Add a page inside">
            <Plus size={12} />
          </button>
          <Menu
            placeholder="Page…"
            options={[
              { value: "edit", label: "Rename or move", icon: <PenLine size={13} /> },
              { value: "trash", label: "Move to trash", icon: <Trash2 size={13} /> },
            ]}
            onChange={(action) => (action === "edit" ? actions.edit(page) : actions.trash(page))}
            className="icon-btn tiny"
          >
            <MoreHorizontal size={12} />
          </Menu>
        </span>
      </div>
      {expanded && page.children.map((c) => <PageNode key={c.id} task={task} page={c} depth={depth + 1} activeId={activeId} open={open} toggle={toggle} onCreate={onCreate} actions={actions} />)}
    </>
  );
}

/** A folder page: what's inside it, plus a way to add more. */
export function FolderView({ task, path }: { task: Task; path: string }) {
  const actions = usePageActions(task);
  const page = flattenPages(task.pages ?? []).find((p) => p.id === path);
  if (!page) return <div className="empty">Page not found.</div>;
  return (
    <div className="folder-view">
      <h1>
        <PageIcon page={page} open size={20} /> {page.title}
      </h1>
      <div className="sub-list">
        {page.children.map((c) => (
          <a key={c.id} className="sub-row" href={pageHref(task.id, c)}>
            <span className="sub-icon">
              <PageIcon page={c} />
            </span>
            <span className="sub-title">{c.title}</span>
            <span className="spacer" />
            <span className="folder-kind">{c.kind === "board" ? `${BOARD_KIND[c.boardKind ?? "free"].label} · ${c.nodeCount ?? 0} nodes` : c.kind === "doc" ? "Doc" : `${c.children.length} inside`}</span>
            <ChevronRight size={14} className="sub-chevron" />
          </a>
        ))}
        <button className="sub-row empty-row" onClick={() => actions.create(page.id)}>
          <Plus size={14} /> New page
        </button>
      </div>
    </div>
  );
}
