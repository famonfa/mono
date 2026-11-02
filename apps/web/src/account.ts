import { useEffect, useState } from "react";

export type Host = { id: string; name: string };

/** The Claude Code that Mono drives on the Mac (null when it isn't installed). */
export type ClaudeInfo = { path: string; version: string | null } | null;

export type ShareRole = "viewer" | "editor" | "agents";

/** Something another person shared with you: a project, a folder of its pages, or one session. */
export type SharedItem = {
  id: string;
  owner: string;
  ownerName: string | null;
  ownerPicture: string | null;
  hostId: string;
  hostName?: string | null;
  projectId: string | null;
  pageId: string | null;
  sessionId: string | null;
  title: string;
  role: ShareRole;
  link: string;
  online?: boolean;
  createdAt: string;
};

/** Signed in through the relay (phone/web): who you are and which Mac you're driving. */
export type RemoteAccount = {
  mode: "remote";
  email: string;
  name: string | null;
  picture: string | null;
  admin: boolean;
  host: Host | null;
  hosts: Host[];
  claude?: ClaudeInfo;
  /** Set while you're inside something shared with you: the app is limited to it. */
  share?: SharedItem | null;
  shared?: SharedItem[];
};

/** Opened on the Mac itself: this machine and whether it's reachable from the phone. */
export type LocalAccount = { mode: "local"; hostname: string; user: string; version: string; remote: { email: string; relay: string } | null; connectCommand: string; claude: ClaudeInfo };

export type Account = RemoteAccount | LocalAccount;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  // Locally the server answers unknown paths with the app's index.html, so check it's really JSON.
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
  return res.json();
}

// One poll for the whole app: the sidebar, the user widget and guest mode all read the same account.
let current: Account | null = null;
const subscribers = new Set<(account: Account | null) => void>();
let timer: number | undefined;

async function loadAccount() {
  const [remote, local] = await Promise.all([getJson<RemoteAccount>("/_mono/me").catch(() => null), getJson<LocalAccount>("/api/me").catch(() => null)]);
  // Through the relay, /api/me comes from the Mac being driven: it still knows its Claude Code.
  current = remote ? { ...remote, claude: local?.claude ?? null } : local;
  for (const fn of subscribers) fn(current);
}

/** The relay answers /_mono/me when the app is opened through it; otherwise it's the local server. */
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(current);
  useEffect(() => {
    subscribers.add(setAccount);
    if (subscribers.size === 1) {
      void loadAccount();
      timer = window.setInterval(loadAccount, 30_000);
    }
    return () => {
      subscribers.delete(setAccount);
      if (!subscribers.size) window.clearInterval(timer);
    };
  }, []);
  return account;
}

/** The share you're visiting through the relay, if any (null on your own Mac). */
export const guestShare = (account: Account | null) => (account?.mode === "remote" ? (account.share ?? null) : null);
