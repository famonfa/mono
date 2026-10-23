import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export function isTyping(event: KeyboardEvent) {
  const el = event.target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean; enabled?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (opts.meta ? !(e.metaKey || e.ctrlKey) : e.metaKey || e.ctrlKey || e.altKey) return;
      if (!opts.meta && isTyping(e)) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, opts.meta, opts.enabled]);
}

export type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("ws-theme") as Theme) ?? "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ws-theme", theme);
  }, [theme]);
  return { theme, toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export type MenuOption<T extends string> = { value: T; label: string; icon?: ReactNode; hint?: string };

/** Linear-style popover select: filterable, keyboard navigable, number shortcuts. */
export function Menu<T extends string>({
  value,
  options,
  onChange,
  children,
  placeholder = "Filtrar…",
  className = "",
  custom,
}: {
  value?: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  children: ReactNode;
  placeholder?: string;
  className?: string;
  /** Extra option built from what was typed (e.g. a free folder path), shown after the matches. */
  custom?: (query: string) => MenuOption<T> | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; visibility?: "hidden" }>({ top: 0, left: 0, visibility: "hidden" });
  const typed = custom?.(query.trim());
  const filtered = [...options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())), ...(typed && !options.some((o) => o.value === typed.value) ? [typed] : [])];

  // Opens downward when it fits, otherwise upward (composers sit at the bottom of the screen).
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    const width = menu.current.offsetWidth;
    const fitsBelow = rect.bottom + 4 + height <= window.innerHeight - 8;
    const top = fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height);
    setPos({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
  }, [open, filtered.length]);

  // The menu mounts hidden while it measures itself, and hidden inputs can't take focus, so focus once it shows.
  useEffect(() => {
    if (open && !pos.visibility) filter.current?.focus();
  }, [open, pos.visibility]);

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };

  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`menu-trigger ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          setPos((p) => ({ ...p, visibility: "hidden" }));
          setOpen((o) => !o);
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div className="menu-backdrop" onMouseDown={() => setOpen(false)}>
            <div className="menu" ref={menu} style={pos} onMouseDown={(e) => e.stopPropagation()}>
              <input
                ref={filter}
                className="menu-filter"
                placeholder={placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") setActive((a) => Math.min(filtered.length - 1, a + 1));
                  if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
                  if (e.key === "Enter") {
                    // Otherwise the same Enter clicks the trigger (focused again by choose) and reopens the menu.
                    e.preventDefault();
                    if (filtered[active]) choose(filtered[active].value);
                  }
                  const byHint = options.find((o) => o.hint === e.key);
                  if (!query && byHint) {
                    e.preventDefault();
                    choose(byHint.value);
                  }
                }}
              />
              <div className="menu-items">
                {filtered.map((o, i) => (
                  <button key={o.value} className={`menu-item ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(o.value)}>
                    <span className="menu-item-icon">{o.icon}</span>
                    <span className="menu-item-label">{o.label}</span>
                    {o.value === value && <Check size={14} className="menu-check" />}
                    {o.hint && <span className="menu-hint">{o.hint}</span>}
                  </button>
                ))}
                {!filtered.length && <div className="menu-empty">Sin resultados</div>}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export type DialogField = {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string; icon?: ReactNode }[];
  mono?: boolean;
  multiline?: boolean;
  readOnly?: boolean;
};

export type DialogRequest = {
  title: string;
  fields: DialogField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
};

export function Dialog({ request, onClose }: { request: DialogRequest; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.fields.map((f) => [f.name, f.defaultValue ?? f.options?.[0]?.value ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      await request.onSubmit(values);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
      >
        <div className="dialog-title">{request.title}</div>
        {request.fields.map((f, i) =>
          f.options ? (
            <div key={f.name} className="segmented">
              {f.options.map((o) => (
                <button type="button" key={o.value} className={values[f.name] === o.value ? "active" : ""} onClick={() => setValues((v) => ({ ...v, [f.name]: o.value }))}>
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          ) : f.multiline ? (
            <textarea key={f.name} className="dialog-textarea" readOnly={f.readOnly} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          ) : (
            <input
              key={f.name}
              className={`dialog-input ${i === 0 ? "big" : ""} ${f.mono ? "mono" : ""}`}
              placeholder={f.placeholder ?? f.label}
              value={values[f.name]}
              autoFocus={i === 0}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          ),
        )}
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            {request.submitLabel ?? "Crear"} <kbd className="kbd on-primary">⌘↵</kbd>
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return date.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
