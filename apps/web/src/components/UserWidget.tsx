import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ChevronsUpDown, LogOut, Monitor, Smartphone, UserPlus } from "lucide-react";
import { useAccount, type Account } from "../account";
import { PhonePanel } from "./PhonePanel";

const initials = (text: string) =>
  text
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

function Avatar({ account }: { account: Account }) {
  const [broken, setBroken] = useState(false);
  if (account.mode === "remote" && account.picture && !broken) {
    return <img className="user-avatar" src={account.picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  if (account.mode === "local") {
    return (
      <span className="user-avatar local">
        <Monitor size={13} />
      </span>
    );
  }
  return <span className="user-avatar">{initials(account.name ?? account.email)}</span>;
}

function Item({ icon, children, href, onClick, external }: { icon: ReactNode; children: ReactNode; href?: string; onClick?: () => void; external?: boolean }) {
  const content = (
    <>
      <span className="user-menu-icon">{icon}</span>
      <span className="user-menu-label">{children}</span>
    </>
  );
  return href ? (
    <a className="user-menu-item" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
      {content}
    </a>
  ) : (
    <button className="user-menu-item" onClick={onClick}>
      {content}
    </button>
  );
}

/** Mono runs the Claude Code installed on the Mac; say so, or how to fix it when it's missing. */
function ClaudeStatus({ account }: { account: Account }) {
  if (account.claude === undefined) return null;
  return (
    <div className="user-menu-section">
      <div className="user-menu-caption">Agentes</div>
      {account.claude ? (
        <div className="user-menu-host">
          <span className="user-dot" />
          Claude Code {account.claude.version ?? ""}
        </div>
      ) : (
        <p className="user-menu-text">
          <span className="user-warn">No encontré Claude Code en esta Mac.</span>{" "}
          <a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">
            Instalalo
          </a>{" "}
          y reiniciá Mono.
        </p>
      )}
    </div>
  );
}

function MenuContent({ account, onPhone }: { account: Account; onPhone: () => void }) {
  if (account.mode === "remote") {
    return (
      <>
        <div className="user-menu-head">
          <Avatar account={account} />
          <div>
            <div className="user-menu-name">{account.name ?? account.email}</div>
            {account.name && <div className="user-menu-sub">{account.email}</div>}
          </div>
        </div>
        <div className="user-menu-section">
          <div className="user-menu-caption">Mac</div>
          <div className="user-menu-host">
            <span className="user-dot" />
            {account.host?.name ?? "Ninguna conectada"}
          </div>
        </div>
        <ClaudeStatus account={account} />
        <div className="user-menu-divider" />
        {account.hosts.length > 1 && (
          <Item icon={<ArrowLeftRight size={14} />} href="/_mono/hosts">
            Cambiar de Mac
          </Item>
        )}
        {account.admin && (
          <Item icon={<UserPlus size={14} />} href="/_mono/admin">
            Invitar gente
          </Item>
        )}
        <Item icon={<LogOut size={14} />} href="/_mono/logout">
          Salir
        </Item>
      </>
    );
  }
  return (
    <>
      <div className="user-menu-head">
        <Avatar account={account} />
        <div>
          <div className="user-menu-name">{account.hostname}</div>
          <div className="user-menu-sub">Esta Mac · {account.user}</div>
        </div>
      </div>
      <ClaudeStatus account={account} />
      <div className="user-menu-divider" />
      {account.remote && (
        <div className="user-menu-section">
          <div className="user-menu-caption">Celular y web</div>
          <div className="user-menu-host">
            <span className="user-dot" />
            Conectada como {account.remote.email}
          </div>
        </div>
      )}
      <Item icon={<Smartphone size={14} />} onClick={onPhone}>
        {account.remote ? "Abrir en el celular" : "Usar desde el celular"}
      </Item>
      <div className="user-menu-foot">Mono {account.version}</div>
    </>
  );
}

/** Who's using Mono and from where, at the bottom of the sidebar. */
export function UserWidget() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number }>({ left: 0, bottom: 0, width: 0 });

  // Sits at the bottom of the sidebar, so the menu always opens upward, as wide as the trigger.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6, width: Math.max(rect.width, 240) });
  }, [open]);

  if (!account) return null;
  const title = account.mode === "remote" ? (account.name ?? account.email) : account.hostname;
  const subtitle = account.mode === "remote" ? (account.host?.name ?? "Sin Mac") : account.remote ? "Conectada al celu" : "Solo en esta Mac";

  return (
    <>
      <button ref={trigger} className={`user-widget ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <Avatar account={account} />
        <span className="user-widget-text">
          <span className="user-widget-title">{title}</span>
          <span className="user-widget-sub">
            {(account.mode === "remote" ? account.host : account.remote) && <span className="user-dot" />}
            {subtitle}
          </span>
        </span>
        <ChevronsUpDown size={14} className="user-widget-chevron" />
      </button>
      {open &&
        createPortal(
          <div className="menu-backdrop" onMouseDown={() => setOpen(false)}>
            <div className="user-menu" ref={menu} style={pos} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
              <MenuContent
                account={account}
                onPhone={() => {
                  setOpen(false);
                  setPhone(true);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
      {phone && account.mode === "local" && <PhonePanel account={account} onClose={() => setPhone(false)} />}
    </>
  );
}
