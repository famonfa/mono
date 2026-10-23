import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, FileText, Folder, Search, Sparkles } from "lucide-react";
import { useApp } from "../app-context";
import { chatApi, type SkillDetail, type SlashCommand } from "../chat";
import { href, navigate } from "../router";
import { ALL_PROJECTS } from "./Projects";
import { Markdown } from "./Markdown";

type Source = SlashCommand["source"];
type Tab = "all" | Exclude<Source, "builtin">;

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "project", label: "This folder" },
  { value: "user", label: "Personal" },
  { value: "plugin", label: "Plugins" },
];
const SOURCE_LABEL: Record<Source, string> = { project: "This folder", user: "Personal", plugin: "Plugin", builtin: "Built-in" };
const NO_FOLDER = "";

/** Skills and custom slash commands a session started in `cwd` can use (built-ins left out). */
export function useSkillList(cwd?: string) {
  const [list, setList] = useState<SlashCommand[] | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    chatApi.commands(cwd).then(
      (l) => live && setList(l.filter((c) => c.source !== "builtin")),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [cwd]);
  return list;
}

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const stripFrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/<!--[\s\S]*?-->/g, "");

/** Sections of the list: this folder, personal, then one per plugin. */
function sectionsOf(items: SlashCommand[]) {
  const out: { key: string; label: string; items: SlashCommand[] }[] = [];
  const push = (key: string, label: string, list: SlashCommand[]) => list.length && out.push({ key, label, items: list });
  push("project", "This folder", items.filter((c) => c.source === "project"));
  push("user", "Personal", items.filter((c) => c.source === "user"));
  const plugins = items.filter((c) => c.source === "plugin");
  for (const name of [...new Set(plugins.map((c) => c.name.split(":")[0]))]) push(`plugin:${name}`, `Plugin · ${name}`, plugins.filter((c) => c.name.startsWith(`${name}:`)));
  return out;
}

export function SkillsPage({ name }: { name?: string }) {
  const { projects, project } = useApp();
  const [folder, setFolder] = useState(() => projects.find((p) => p.id === project)?.root ?? NO_FOLDER);
  useEffect(() => {
    if (project !== ALL_PROJECTS) setFolder(projects.find((p) => p.id === project)?.root ?? NO_FOLDER);
  }, [project, projects]);
  const list = useSkillList(folder || undefined);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const matching = useMemo(() => (list ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)), [list, q]);
  const counts = Object.fromEntries(TABS.map((t) => [t.value, matching.filter((c) => t.value === "all" || c.source === t.value).length])) as Record<Tab, number>;
  const sections = sectionsOf(matching.filter((c) => tab === "all" || c.source === tab));
  const flat = sections.flatMap((s) => s.items);
  const select = (n: string) => navigate(href.skill(n));

  useEffect(() => {
    listRef.current?.querySelector(".skill-row.active")?.scrollIntoView({ block: "nearest" });
  }, [name]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setQuery("");
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = flat.findIndex((c) => c.name === name);
    const next = flat[e.key === "ArrowDown" ? Math.min(flat.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) select(next.name);
  };

  return (
    <div className="home skills-page">
      <header className="topbar">
        <div className="topbar-title">Skills</div>
        <div className="skills-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tab === t.value ? "active" : ""} onClick={() => setTab(t.value)}>
              {t.label}
              {counts[t.value] > 0 && <span className="skills-tab-count">{counts[t.value]}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="skills-folder" title={folder || "No folder: only personal and plugin skills"}>
          <Folder size={13} />
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value={NO_FOLDER}>No folder (personal + plugins)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.root}>
                {p.title} — {tilde(p.root)}
              </option>
            ))}
          </select>
        </label>
        <label className="skills-search">
          <Search size={13} />
          <input autoFocus placeholder="Search skills…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
        </label>
      </header>
      <div className="skills-split">
        <div className="skills-list" ref={listRef}>
          {!list && <div className="empty">Loading…</div>}
          {list && !flat.length && <div className="empty">{q ? "No skills match" : tab === "project" ? "This folder has no skills of its own" : "No skills"}</div>}
          {sections.map((s) => (
            <section key={s.key}>
              <div className="group-header">
                <span className="group-label">{s.label}</span>
                <span className="group-count">{s.items.length}</span>
              </div>
              {s.items.map((c) => (
                <a key={c.name} href={href.skill(c.name)} className={`skill-row ${c.name === name ? "active" : ""}`}>
                  <span className="skill-row-name" title={`/${c.name}`}>/{c.name}</span>
                  <span className="skill-row-desc">{c.description}</span>
                  {c.kind === "command" && <span className="skill-kind">command</span>}
                </a>
              ))}
            </section>
          ))}
        </div>
        <div className="skills-detail">{name ? <SkillDetailView key={`${folder}/${name}`} cwd={folder || undefined} name={name} /> : <div className="empty">Pick a skill to read what it does</div>}</div>
      </div>
    </div>
  );
}

function SkillDetailView({ cwd, name }: { cwd?: string; name: string }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    chatApi.skill(name, cwd).then(setSkill, (e: Error) => setError(e.message));
  }, [cwd, name]);

  if (error) return <div className="empty">{error === "Skill not found" ? `/${name} isn't available in this folder` : error}</div>;
  if (!skill) return <div className="empty">Loading…</div>;

  const copy = () => {
    navigator.clipboard.writeText(`/${skill.name} `).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <article className="skill-detail">
      <header className="skill-detail-head">
        <Sparkles size={16} />
        <h1>/{skill.name}</h1>
        <span className={`skill-source ${skill.source}`}>{SOURCE_LABEL[skill.source]}</span>
        {skill.kind === "command" && <span className="skill-kind">command</span>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={copy} title="Copy to paste in a session">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : `Copy /${skill.name}`}
        </button>
      </header>
      {skill.description && <p className="skill-detail-desc">{skill.description}</p>}
      <div className="skill-detail-meta">
        <span title={skill.path}>
          <FileText size={12} /> {tilde(skill.path)}
        </span>
        {skill.files.length > 0 && <span>Also bundles: {skill.files.join(", ")}</span>}
      </div>
      <div className="skill-detail-body">
        <Markdown taskId="">{stripFrontmatter(skill.body)}</Markdown>
      </div>
    </article>
  );
}
