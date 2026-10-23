import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { api, useLiveData } from "../api";
import { DocIcon } from "../icons";
import type { Task } from "../types";
import { Markdown } from "./Markdown";

export function DocView({ task, doc }: { task: Task; doc: string }) {
  const { data, error } = useLiveData(() => api.getDoc(task.id, doc), [task.id, doc], task.id);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const save = async () => {
    if (draft === null) return;
    await api.saveDoc(task.id, doc, draft);
    setDraft(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if (e.key === "Escape") setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <div className="empty">Couldn't open {doc}: {error}</div>;
  if (!data) return null;

  return (
    <div className="doc">
      <div className="doc-toolbar">
        <span className="doc-name">
          <DocIcon /> {doc.replace(/\.md$/, "")}
        </span>
        <span className="spacer" />
        {editing ? (
          <>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save <kbd className="kbd on-primary">⌘S</kbd>
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => setDraft(data.content)}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="doc-split">
          <textarea className="doc-editor" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="doc-preview">
            <Markdown taskId={task.id}>{draft}</Markdown>
          </div>
        </div>
      ) : (
        <div className="doc-read" onDoubleClick={() => setDraft(data.content)}>
          <Markdown taskId={task.id}>{data.content}</Markdown>
        </div>
      )}
    </div>
  );
}
