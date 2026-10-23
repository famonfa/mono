/** What the desktop app's preload exposes (apps/desktop/src/preload.cjs); undefined in a browser. */
type DesktopBridge = {
  platform: string;
  availableUpdate: () => Promise<string | null>;
  onUpdate: (fn: (version: string) => void) => () => void;
  installUpdate: () => Promise<void>;
  connectPhone: () => Promise<void>;
};

export const desktop = (window as unknown as { monoDesktop?: DesktopBridge }).monoDesktop;
