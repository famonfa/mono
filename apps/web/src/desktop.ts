/** What the desktop app's preload exposes (apps/desktop/src/preload.cjs); undefined in a browser. */
type DesktopBridge = {
  platform: string;
  availableUpdate: () => Promise<string | null>;
  onUpdate: (fn: (version: string) => void) => () => void;
  installUpdate: () => Promise<void>;
  connectPhone: () => Promise<void>;
  /** File menu's New Tab (⌘T) and Close Tab (⌘W); missing in builds before tabs. */
  onTabCommand?: (fn: (command: "new" | "close") => void) => () => void;
};

export const desktop = (window as unknown as { monoDesktop?: DesktopBridge }).monoDesktop;
