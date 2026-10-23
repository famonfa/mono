import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Smartphone } from "lucide-react";
import type { LocalAccount } from "../account";
import { desktop } from "../desktop";

/**
 * Using Mono from the phone, from inside the app: pair this Mac with the relay (Google in the browser),
 * then scan a QR that opens the relay on the phone.
 */
export function PhonePanel({ account, onClose }: { account: LocalAccount; onClose: () => void }) {
  const [remote, setRemote] = useState(account.remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // While pairing, keep asking this Mac whether the relay already accepted it.
  useEffect(() => {
    if (remote) return;
    const timer = setInterval(async () => {
      const me = await fetch("/api/me").then((r) => (r.ok ? (r.json() as Promise<LocalAccount>) : null)).catch(() => null);
      if (me?.remote) setRemote(me.remote);
    }, 2000);
    return () => clearInterval(timer);
  }, [remote]);

  useEffect(() => {
    if (!remote) return;
    void QRCode.toString(remote.relay, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setQr);
  }, [remote]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop!.connectPhone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  return createPortal(
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog phone-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Use Mono on your phone</div>
        {remote ? (
          <div className="phone-connected">
            {qr && <div className="phone-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
            <ol className="phone-steps">
              <li>Scan the code with your phone's camera.</li>
              <li>
                Sign in with Google as <b>{remote.email}</b>.
              </li>
              <li>
                In Safari: <b>Share → Add to Home Screen</b>.
              </li>
            </ol>
            <button className="user-command" onClick={() => copy(remote.relay)} title="Copy">
              <code>{remote.relay}</code>
              {copied === remote.relay ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        ) : (
          <div className="phone-setup">
            <span className="phone-icon">
              <Smartphone size={20} />
            </span>
            <p>Connect this Mac to your Google account. Mono keeps running in the background, even with the window closed.</p>
            {desktop ? (
              busy ? (
                <p className="hint phone-wait">
                  <Loader2 size={13} className="spin" /> Sign in with Google in your browser and approve the code.
                </p>
              ) : null
            ) : (
              <>
                <p className="hint">Run this in a terminal and approve with Google.</p>
                <button className="user-command" onClick={() => copy(account.connectCommand)} title="Copy">
                  <code>{account.connectCommand}</code>
                  {copied === account.connectCommand ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </>
            )}
            {error && <div className="dialog-error">{error}</div>}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {remote ? "Done" : "Cancel"}
          </button>
          {!remote && desktop && (
            <button className="btn primary" onClick={() => void connect()} disabled={busy}>
              {busy ? <Loader2 size={13} className="spin" /> : null}
              Connect with Google
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
