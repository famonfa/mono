import { useEffect, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { FileDown, Loader2, MoreHorizontal } from "lucide-react";
import { api, fileUrl, useLiveData } from "../api";
import { downloadBlob, printToPdf } from "../doc-export";
import { Menu } from "../ui";
import { useApp } from "../app-context";
import type { Task } from "../types";
import { PageAssistant } from "./CanvasAssistant";

const SAVE_DELAY = 600;

/** "# Title\n\nbody" → its parts. The title is the doc's first heading, which is also its name in the page tree. */
function splitTitle(markdown: string) {
  const match = /^#\s+(.+)\n*/.exec(markdown);
  return match ? { title: match[1].trim(), body: markdown.slice(match[0].length) } : { title: "", body: markdown };
}

/** Files live as `assets/x.png` in the markdown (what agents write); the editor needs a URL it can load. */
const toEditor = (taskId: string, markdown: string) => markdown.replace(/\]\((?:\.\/)?assets\//g, `](${fileUrl(taskId, "assets/")}`);
const toDisk = (taskId: string, markdown: string) => markdown.split(`](${fileUrl(taskId, "assets/")}`).join("](assets/");

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * A doc page, edited in place like Notion: blocks, `/` commands, drag handles, a toolbar on selection.
 * It is still a markdown file on disk, so agents read and write it as before; saves happen as you type.
 */
export function DocView({ task, doc }: { task: Task; doc: string }) {
  const { theme, openDialog } = useApp();
  const [exporting, setExporting] = useState(false);
  const { data, error } = useLiveData(() => api.getDoc(task.id, doc), [task.id, doc], task.id);
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [selection, setSelection] = useState("");
  // What's on disk as far as this view knows: our own saves come back through the live reload and must not reset the editor.
  const synced = useRef<string | null>(null);
  const titleRef = useRef("");
  const timer = useRef<number>(0);
  const loading = useRef(false);

  const editor = useCreateBlockNote(
    {
      uploadFile: async (file) => {
        const { path } = await api.saveAsset(task.id, file.name, await readFile(file));
        return fileUrl(task.id, path);
      },
    },
    [task.id],
  );

  const serialize = () => {
    const body = toDisk(task.id, editor.blocksToMarkdownLossy(editor.document)).trim();
    const heading = titleRef.current.trim();
    return `${heading ? `# ${heading}\n\n` : ""}${body}\n`;
  };

  const save = async () => {
    window.clearTimeout(timer.current);
    const markdown = serialize();
    if (markdown === synced.current) return setState("saved");
    setState("saving");
    try {
      synced.current = markdown;
      await api.saveDoc(task.id, doc, markdown);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const scheduleSave = () => {
    if (loading.current) return;
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY);
  };

  // Load the file, and reload it when someone else (an agent) changes it while we have nothing pending.
  useEffect(() => {
    if (!data || data.content === synced.current) return;
    if (synced.current !== null && (state === "saving" || editor.isFocused())) return;
    const parts = splitTitle(data.content);
    loading.current = true;
    titleRef.current = parts.title;
    setTitle(parts.title);
    editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(toEditor(task.id, parts.body)));
    synced.current = data.content;
    // replaceBlocks fires onChange synchronously; only edits after this point are the user's.
    loading.current = false;
  }, [data, editor]);

  // Leaving the page (or the app) flushes a pending save.
  useEffect(
    () => () => {
      if (timer.current) void save();
    },
    [task.id, doc],
  );

  const exportAs = async (format: "docx" | "pdf") => {
    const docTitle = titleRef.current.trim() || doc.replace(/\.md$/, "").split("/").pop()!;
    if (format === "pdf") return printToPdf(docTitle, editor.blocksToHTMLLossy(editor.document));
    setExporting(true);
    try {
      const { toDocx } = await import("../doc-docx");
      downloadBlob(`${docTitle}.docx`, await toDocx(docTitle, editor.document));
    } catch (e) {
      openDialog({ title: "Couldn't export", submitLabel: "OK", fields: [{ name: "info", label: "", defaultValue: (e as Error).message, multiline: true, readOnly: true }], onSubmit: () => {} });
    } finally {
      setExporting(false);
    }
  };

  if (error) return <div className="empty">Couldn't open {doc}: {error}</div>;

  return (
    <div className="doc notion-doc">
      <div className="doc-page">
        <div className="doc-corner">
          <span className={`doc-state ${state}`}>{exporting ? "Exporting…" : state === "saving" ? "Saving…" : state === "error" ? "Couldn't save" : "Saved"}</span>
          <Menu
            placeholder="Export…"
            options={[
              { value: "docx", label: "Export as Word (.docx)", icon: <FileDown size={13} /> },
              { value: "pdf", label: "Export as PDF", icon: <FileDown size={13} /> },
            ]}
            onChange={(format) => void exportAs(format)}
            className="icon-btn"
          >
            {exporting ? <Loader2 size={14} className="spin" /> : <MoreHorizontal size={15} />}
          </Menu>
        </div>
        <textarea
          className="doc-title"
          rows={1}
          placeholder="Untitled"
          value={title}
          onChange={(e) => {
            titleRef.current = e.target.value.replace(/\n/g, " ");
            setTitle(titleRef.current);
            scheduleSave();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.focus();
            }
          }}
          ref={(el) => {
            if (!el) return;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
        <BlockNoteView
          editor={editor}
          theme={theme === "dark" ? "dark" : "light"}
          onChange={scheduleSave}
          // Kept when focus moves to the AI bar, so "rewrite this" knows what "this" is.
          onSelectionChange={() => editor.isFocused() && setSelection(editor.getSelectedText())}
          className="doc-editor-blocks"
        />
      </div>
      <div className="doc-assistant">
        <PageAssistant task={task} target={{ kind: "doc", id: doc.replace(/\.md$/, ""), selection }} onSent={() => setSelection("")} />
      </div>
    </div>
  );
}
