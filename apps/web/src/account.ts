import { useEffect, useState } from "react";

export type Host = { id: string; name: string };

/** Signed in through the relay (phone/web): who you are and which Mac you're driving. */
export type RemoteAccount = { mode: "remote"; email: string; name: string | null; picture: string | null; admin: boolean; host: Host | null; hosts: Host[] };

/** Opened on the Mac itself: this machine and whether it's reachable from the phone. */
export type LocalAccount = { mode: "local"; hostname: string; user: string; version: string; remote: { email: string; relay: string } | null; connectCommand: string };

export type Account = RemoteAccount | LocalAccount;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  // Locally the server answers unknown paths with the app's index.html, so check it's really JSON.
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
  return res.json();
}

/** The relay answers /_mono/me when the app is opened through it; otherwise it's the local server. */
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const value = (await getJson<RemoteAccount>("/_mono/me").catch(() => null)) ?? (await getJson<LocalAccount>("/api/me").catch(() => null));
      if (!cancelled) setAccount(value);
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return account;
}
