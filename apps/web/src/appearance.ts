import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
/** How much of the accent bleeds into the surfaces: none, subtle, strong. */
export type TintLevel = 0 | 1 | 2;
export type Appearance = { theme: Theme; palette: string; custom: string; tint: TintLevel };

export const PALETTES = [
  { id: "indigo", label: "Indigo", accent: "#5e6ad2" },
  { id: "avocado", label: "Avocado", accent: "#5fb85a" },
  { id: "ocean", label: "Ocean", accent: "#1fa8c9" },
  { id: "violet", label: "Violet", accent: "#9b6bf2" },
  { id: "rose", label: "Rose", accent: "#e15a97" },
  { id: "ember", label: "Ember", accent: "#e8743b" },
  { id: "amber", label: "Amber", accent: "#d9a23b" },
  { id: "graphite", label: "Graphite", accent: "#8a8f98" },
];

export const CUSTOM_PALETTE = "custom";
export const TINT_LABELS: Record<TintLevel, string> = { 0: "Neutral", 1: "Tinted", 2: "Rich" };

const DEFAULT: Appearance = { theme: "dark", palette: "indigo", custom: "#5e6ad2", tint: 0 };
const THEME_KEY = "ws-theme";
const KEY = "ws-appearance";

export function accentOf(a: Appearance) {
  return a.palette === CUSTOM_PALETTE ? a.custom : (PALETTES.find((p) => p.id === a.palette) ?? PALETTES[0]).accent;
}

function load(): Appearance {
  let stored: Partial<Appearance> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {}
  const theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  return { ...DEFAULT, ...stored, theme };
}

/** Relative luminance, to pick readable text on accent-filled buttons. */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function apply(a: Appearance) {
  const root = document.documentElement;
  const accent = accentOf(a);
  root.dataset.theme = a.theme;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--tint", accent);
  root.style.setProperty("--tint-level", String(a.tint));
  root.style.setProperty("--on-accent", luminance(accent) > 0.32 ? "#111113" : "#ffffff");
}

// Applied before the first render so the app never flashes the default palette.
apply(load());

export function useAppearance() {
  const [appearance, setState] = useState(load);
  useEffect(() => {
    apply(appearance);
    localStorage.setItem(THEME_KEY, appearance.theme);
    localStorage.setItem(KEY, JSON.stringify({ palette: appearance.palette, custom: appearance.custom, tint: appearance.tint }));
  }, [appearance]);
  // Other windows (desktop app, other tabs) follow along.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === THEME_KEY) setState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const setAppearance = (patch: Partial<Appearance>) => setState((a) => ({ ...a, ...patch }));
  return {
    appearance,
    setAppearance,
    theme: appearance.theme,
    toggleTheme: () => setState((a) => ({ ...a, theme: a.theme === "dark" ? "light" : "dark" })),
  };
}
