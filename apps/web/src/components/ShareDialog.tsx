import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Globe, Link2, Lock, Users, X } from "lucide-react";
import { useAccount, type ShareRole } from "../account";
import { ROLE_META, sharesApi, sharesChanged, type Share } from "../shares";
import { Menu } from "../ui";

export type ShareScope = { projectId?: string | null; pageId?: string | null; sessionId?: string | null; title: string };

const ROLES = Object.keys(ROLE_META) as ShareRole[];

/** A session can only be watched: messaging it would drive your own agent with your full access. */
const rolesFor = (scope: ShareScope) => (scope.sessionId ? (["viewer"] as ShareRole[]) : ROLES);

function RolePicker({ value, roles, onChange }: { value: ShareRole; roles: ShareRole[]; onChange: (role: ShareRole) => void }) {
  if (roles.length === 1) return <span className="share-role-fixed">{ROLE_META[value].label}</span>;
  return (
    <Menu value={value} placeholder="Role…" options={roles.map((r) => ({ value: r, label: ROLE_META[r].label, hint: ROLE_META[r].hint }))} onChange={onChange} className="mode-trigger share-role">
      {ROLE_META[value].label}
    </Menu>
  );
}

const domainOf = (email?: string | null) => email?.split("@")[1] ?? null;

/**
 * Share like Google Drive: people by email with a role, plus "anyone at your domain with the link".
 * Shares live in the relay, so this Mac has to be connected (`mono connect`).
 */
export function ShareDialog({ scope, onClose }: { scope: ShareScope; onClose: () => void }) {
  const account = useAccount();
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const roles = rolesFor(scope);
  const [role, setRole] = useState<ShareRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = account?.mode === "remote" ? account.email : account?.mode === "local" ? account.remote?.email : null;
  const domain = domainOf(me);

  useEffect(() => {
    sharesApi.ensure(scope).then(setShare, (e: Error) => setError(e.message));
  }, [scope.projectId, scope.pageId, scope.sessionId]);

  const run = async (action: () => Promise<Share | unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next && typeof next === "object" && "id" in next) setShare(next as Share);
      sharesChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const invite = () => {
    const list = email.split(/[\s,;]+/).filter(Boolean);
    if (!share || !list.length) return;
    void run(async () => {
      let last: Share = share;
      for (const one of list) last = await sharesApi.grant(share.id, one, role);
      setEmail("");
      return last;
    });
  };

  const copy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const notConnected = account?.mode === "local" && !account.remote;

  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog share-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="share-head">
          <Users size={15} />
          <span className="share-title">Share “{scope.title}”</span>
          <span className="spacer" />
          <button className="icon-btn tiny" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        {notConnected ? (
          <p className="share-note">
            Sharing goes through your relay. Connect this Mac first: run <code>{account.connectCommand}</code> in a terminal.
          </p>
        ) : (
          <>
            <form
              className="share-invite"
              onSubmit={(e) => {
                e.preventDefault();
                invite();
              }}
            >
              <input className="share-email" autoFocus placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!share} />
              <RolePicker value={role} roles={roles} onChange={setRole} />
              <button className="btn primary" disabled={!share || busy || !email.trim()}>
                Invite
              </button>
            </form>
            {scope.sessionId && <p className="share-note">People you share a session with can watch it, not message it.</p>}

            <div className="share-section">People with access</div>
            <div className="share-people">
              <div className="share-person">
                <span className="share-avatar">{(me ?? "?")[0]?.toUpperCase()}</span>
                <span className="share-email-label">{me ?? "You"} (you)</span>
                <span className="spacer" />
                <span className="share-role-fixed">Owner</span>
              </div>
              {share?.people.map((p) => (
                <div key={p.email} className="share-person">
                  <span className="share-avatar">{p.email[0]?.toUpperCase()}</span>
                  <span className="share-email-label">{p.email}</span>
                  <span className="spacer" />
                  <RolePicker value={p.role} roles={roles} onChange={(next) => void run(() => sharesApi.grant(share.id, p.email, next))} />
                  <button className="icon-btn tiny" title="Remove access" disabled={busy} onClick={() => void run(() => sharesApi.revoke(share.id, p.email))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div className="share-section">General access</div>
            <div className="share-person">
              <span className="share-avatar plain">{share?.general ? <Globe size={14} /> : <Lock size={14} />}</span>
              <Menu
                value={share?.general ? "domain" : "restricted"}
                placeholder="Access…"
                options={[
                  { value: "restricted", label: "Restricted", hint: "Only people added above" },
                  ...(domain ? [{ value: "domain", label: `Anyone at @${domain} with the link` }] : []),
                ]}
                onChange={(v) => share && void run(() => sharesApi.setGeneral(share.id, v === "domain" && domain ? { domain, role: share.general?.role ?? "viewer" } : null))}
                className="mode-trigger"
              >
                {share?.general ? `Anyone at @${share.general.domain} with the link` : "Restricted"}
              </Menu>
              <span className="spacer" />
              {share?.general && <RolePicker value={share.general.role} roles={roles} onChange={(next) => void run(() => sharesApi.setGeneral(share.id, { domain: share.general!.domain, role: next }))} />}
            </div>
            <p className="share-note">It runs on this Mac: while it's off or disconnected, people you share with can't open it.</p>
          </>
        )}

        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          {share && (
            <button className="btn ghost share-copy" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy link"}
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
