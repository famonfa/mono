import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, Moon, Palette, Pipette, Sun } from "lucide-react";
import { useApp } from "../app-context";
import { accentOf, CUSTOM_PALETTE, PALETTES, TINT_LABELS, type TintLevel } from "../appearance";

/** Sidebar popover: dark/light, accent palette (or any color) and how much it tints the surfaces. */
export function AppearancePicker() {
  const { appearance, setAppearance } = useApp();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPos({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const accent = accentOf(appearance);
  const isCustom = appearance.palette === CUSTOM_PALETTE;

  return (
    <>
      <button ref={trigger} className={`icon-btn${open ? " on" : ""}`} onClick={() => setOpen((o) => !o)} title="Appearance">
        <Palette size={15} />
      </button>
      {open &&
        createPortal(
          <div className="menu-backdrop" onMouseDown={() => setOpen(false)}>
            <div className="menu appearance" style={pos} onMouseDown={(e) => e.stopPropagation()}>
              <div className="appearance-section">Mode</div>
              <div className="appearance-segment">
                {(["dark", "light"] as const).map((t) => (
                  <button key={t} className={appearance.theme === t ? "on" : ""} onClick={() => setAppearance({ theme: t })}>
                    {t === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                    {t === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>

              <div className="appearance-section">Accent</div>
              <div className="appearance-swatches">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    className={`appearance-swatch${appearance.palette === p.id ? " on" : ""}`}
                    style={{ "--swatch": p.accent } as CSSProperties}
                    onClick={() => setAppearance({ palette: p.id })}
                    title={p.label}
                  >
                    {appearance.palette === p.id && <Check size={12} />}
                  </button>
                ))}
                <label className={`appearance-swatch custom${isCustom ? " on" : ""}`} style={{ "--swatch": appearance.custom } as CSSProperties} title="Custom color">
                  {isCustom ? <Check size={12} /> : <Pipette size={12} />}
                  <input type="color" value={appearance.custom} onChange={(e) => setAppearance({ palette: CUSTOM_PALETTE, custom: e.target.value })} />
                </label>
              </div>
              <div className="appearance-current">
                <span className="appearance-dot" style={{ background: accent }} />
                {isCustom ? "Custom" : PALETTES.find((p) => p.id === appearance.palette)?.label}
                <code>{accent}</code>
              </div>

              <div className="appearance-section">Background</div>
              <div className="appearance-segment">
                {([0, 1, 2] as TintLevel[]).map((level) => (
                  <button key={level} className={appearance.tint === level ? "on" : ""} onClick={() => setAppearance({ tint: level })}>
                    {TINT_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
