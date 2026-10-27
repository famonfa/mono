import { useCallback, useEffect, useRef, useState } from "react";
import { desktop } from "./desktop";
import { href, navigate } from "./router";

/** A tab is just a remembered route; the active one is whatever the URL hash says. */
export type Tab = { id: string; hash: string };
type State = { tabs: Tab[]; active: string };

const KEY = "ws-tabs";
const current = () => window.location.hash || href.home();
const newId = () => Math.random().toString(36).slice(2, 9);

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "") as State;
    if (saved.tabs?.length && saved.tabs.some((t) => t.id === saved.active)) {
      // The URL wins over what was saved: it is what the app opened on.
      return { ...saved, tabs: saved.tabs.map((t) => (t.id === saved.active ? { ...t, hash: current() } : t)) };
    }
  } catch {}
  const id = newId();
  return { tabs: [{ id, hash: current() }], active: id };
}

export function useTabs() {
  const [state, setState] = useState(load);
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(state)), [state]);

  // Navigating anywhere moves the active tab along.
  useEffect(() => {
    const sync = () => setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === s.active && t.hash !== current() ? { ...t, hash: current() } : t)) }));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const select = useCallback((id: string) => {
    const tab = ref.current.tabs.find((t) => t.id === id);
    if (!tab) return;
    setState((s) => ({ ...s, active: id }));
    navigate(tab.hash);
  }, []);

  /** Opens `hash` in a new tab next to the active one; an already open route just gets focused. */
  const open = useCallback(
    (hash: string = href.home(), { background = false } = {}) => {
      const existing = ref.current.tabs.find((t) => t.hash === hash);
      if (existing) return background ? undefined : select(existing.id);
      const tab = { id: newId(), hash };
      setState((s) => {
        const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
        return { tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], active: background ? s.active : tab.id };
      });
      if (!background) navigate(hash);
    },
    [select],
  );

  const close = useCallback(
    (id: string) => {
      const { tabs, active } = ref.current;
      if (tabs.length === 1) return desktop ? window.close() : undefined;
      const index = tabs.findIndex((t) => t.id === id);
      const rest = tabs.filter((t) => t.id !== id);
      setState((s) => ({ ...s, tabs: s.tabs.filter((t) => t.id !== id) }));
      if (id === active) select(rest[Math.min(index, rest.length - 1)].id);
    },
    [select],
  );

  const cycle = useCallback(
    (step: number) => {
      const { tabs, active } = ref.current;
      const index = tabs.findIndex((t) => t.id === active);
      select(tabs[(index + step + tabs.length) % tabs.length].id);
    },
    [select],
  );

  const move = useCallback((id: string, to: number) => {
    setState((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const rest = s.tabs.filter((t) => t.id !== id);
      return { ...s, tabs: [...rest.slice(0, to), tab, ...rest.slice(to)] };
    });
  }, []);

  // ⌘T new tab, ⌘W close, ⌘1–9 jump, ⌃Tab / ⌘⇧[ ] cycle; ⌘-click or middle-click a link opens it in a tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      let handled = true;
      if (e.key === "Tab" && e.ctrlKey) cycle(e.shiftKey ? -1 : 1);
      else if (e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) cycle(e.code === "BracketLeft" ? -1 : 1);
      else if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") open();
      else if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") close(ref.current.active);
      else if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const { tabs } = ref.current;
        select((e.key === "9" ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1])?.id ?? ref.current.active);
      } else handled = false;
      if (handled) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey || e.button === 1)) return;
      const link = (e.target as Element | null)?.closest?.("a[href^='#/']");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      open(link.getAttribute("href")!, { background: !e.shiftKey });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    const offDesktop = desktop?.onTabCommand?.((command) => (command === "new" ? open() : close(ref.current.active)));
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      offDesktop?.();
    };
  }, [open, close, select, cycle]);

  return { ...state, open, close, select, move };
}
