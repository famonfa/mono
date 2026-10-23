import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { desktop } from "../desktop";

/** The desktop app checks for new versions in the background; this is where they show up. */
export function UpdateToast() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop?.onUpdate) return;
    void desktop.availableUpdate().then(setVersion);
    return desktop.onUpdate(setVersion);
  }, []);

  if (!version || version === dismissed) return null;

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop!.installUpdate();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="toast" role="status">
      <span className="toast-icon">
        <Download size={15} />
      </span>
      <div className="toast-body">
        <div className="toast-title">Mono {version} está lista</div>
        <div className="toast-sub">{error ?? (busy ? "Bajando… Mono se cierra y se vuelve a abrir solo." : "Se instala en segundos y Mono se vuelve a abrir.")}</div>
      </div>
      <button className="btn primary" onClick={() => void install()} disabled={busy}>
        {busy ? <Loader2 size={13} className="spin" /> : null}
        {error ? "Reintentar" : "Actualizar"}
      </button>
      {!busy && (
        <button className="icon-btn tiny" onClick={() => setDismissed(version)} title="Más tarde">
          <X size={13} />
        </button>
      )}
    </div>
  );
}
