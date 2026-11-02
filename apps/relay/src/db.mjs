import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Who can use the relay. Admins come from ADMIN_EMAILS; any other Google account becomes a user the
 * first time it signs in. Blocking a user locks them out for good and disconnects their machines.
 */

const DB_PATH = process.env.DB_PATH ?? path.resolve("data", "relay.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  create table if not exists users (
    email text primary key,
    invited_by text,
    created_at text not null
  );
  create table if not exists invites (
    token text primary key,
    email text not null,
    invited_by text not null,
    created_at text not null,
    accepted_at text
  );
  create index if not exists invites_email on invites (email);
  create table if not exists blocked (
    email text primary key,
    blocked_by text,
    created_at text not null
  );
  create table if not exists shares (
    id text primary key,
    owner text not null,
    host_id text not null,
    project_id text not null,
    page_id text,
    session_id text,
    title text,
    general_domain text,
    general_role text,
    created_at text not null
  );
  create index if not exists shares_owner on shares (owner, host_id, project_id);
  create table if not exists share_grants (
    share_id text not null,
    email text not null,
    role text not null,
    created_at text not null,
    primary key (share_id, email)
  );
  create index if not exists share_grants_email on share_grants (email);
  create table if not exists share_opens (
    share_id text not null,
    email text not null,
    opened_at text not null,
    primary key (share_id, email)
  );
`);

// Name and picture from the last Google sign-in, so a shared item can show who it comes from.
for (const column of ["name", "picture"]) {
  try {
    db.exec(`alter table users add column ${column} text`);
  } catch {
    // Already there.
  }
}

const ADMINS = new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
const now = () => new Date().toISOString();
const norm = (email) => String(email ?? "").trim().toLowerCase();

export const hasAdmins = () => ADMINS.size > 0;
export const isAdmin = (email) => ADMINS.has(norm(email));

/** Cached briefly: it's checked on every proxied request. */
const allowedCache = new Map();
export function isAllowed(email) {
  const key = norm(email);
  if (!key) return false;
  if (ADMINS.has(key)) return true;
  const hit = allowedCache.get(key);
  if (hit && hit.at > Date.now() - 10_000) return hit.ok;
  const ok = Boolean(db.prepare("select 1 from users where email = ?").get(key));
  allowedCache.set(key, { ok, at: Date.now() });
  return ok;
}

export const isBlocked = (email) => Boolean(db.prepare("select 1 from blocked where email = ?").get(norm(email)));

export function saveProfile(email, { name, picture } = {}) {
  if (!name && !picture) return;
  db.prepare("update users set name = coalesce(?, name), picture = coalesce(?, picture) where email = ?").run(name ?? null, picture ?? null, norm(email));
}

/** First sign-in of a Google account: it becomes a user (a pending invite still records who sent it). */
export function signUp(email) {
  const key = norm(email);
  if (!key || isBlocked(key)) return false;
  const invite = db.prepare("select * from invites where email = ? and accepted_at is null order by created_at desc").get(key);
  db.prepare("insert or ignore into users (email, invited_by, created_at) values (?, ?, ?)").run(key, invite?.invited_by ?? null, now());
  if (invite) db.prepare("update invites set accepted_at = ? where email = ? and accepted_at is null").run(now(), key);
  allowedCache.delete(key);
  return true;
}

export const getInvite = (token) => db.prepare("select * from invites where token = ?").get(String(token ?? ""));

export function blockUser(email, blockedBy) {
  const key = norm(email);
  db.prepare("insert or ignore into blocked (email, blocked_by, created_at) values (?, ?, ?)").run(key, norm(blockedBy), now());
  db.prepare("delete from share_grants where email = ?").run(key);
  db.prepare("delete from users where email = ?").run(key);
  db.prepare("delete from invites where email = ?").run(key);
  allowedCache.delete(key);
}

export function unblockUser(email) {
  db.prepare("delete from blocked where email = ?").run(norm(email));
}

export function listAccess() {
  return {
    admins: [...ADMINS],
    users: db.prepare("select * from users order by created_at").all(),
    invites: db.prepare("select * from invites where accepted_at is null order by created_at desc").all(),
    blocked: db.prepare("select * from blocked order by created_at desc").all(),
  };
}

// ---------- shares ----------

/**
 * A share is one scope of an owner's Mac (a project, a folder of its pages, or one session) plus who
 * can open it: people by email, and optionally anyone with the link from one email domain.
 * Roles grow: viewer (read), editor (also edits pages and canvases), agents (also runs agents there).
 */
export const ROLES = ["viewer", "editor", "agents"];
const rank = (role) => ROLES.indexOf(role);
const validRole = (role) => {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  return role;
};
/** A session can only be watched: messaging it would run the owner's own unrestricted agent. */
const capRole = (share, role) => (share.session_id ? "viewer" : role);
const domainOf = (email) => norm(email).split("@")[1] ?? "";

const shareRow = (id) => db.prepare("select * from shares where id = ?").get(String(id ?? ""));

function shareView(share) {
  if (!share) return null;
  const owner = db.prepare("select name, picture from users where email = ?").get(share.owner) ?? {};
  return {
    id: share.id,
    owner: share.owner,
    ownerName: owner.name ?? null,
    ownerPicture: owner.picture ?? null,
    hostId: share.host_id,
    projectId: share.project_id,
    pageId: share.page_id ?? null,
    sessionId: share.session_id ?? null,
    title: share.title ?? share.project_id,
    general: share.general_domain ? { domain: share.general_domain, role: share.general_role } : null,
    people: db.prepare("select email, role, created_at as createdAt from share_grants where share_id = ? order by created_at").all(share.id),
    createdAt: share.created_at,
  };
}

export const getShare = (id) => shareView(shareRow(id));

/** The owner's shares of one project on one Mac (every scope inside it). */
export function sharesFor(owner, hostId, projectId) {
  const rows = projectId
    ? db.prepare("select * from shares where owner = ? and host_id = ? and project_id = ? order by created_at").all(norm(owner), hostId, projectId)
    : db.prepare("select * from shares where owner = ? and host_id = ? order by created_at").all(norm(owner), hostId);
  return rows.map(shareView);
}

/** Finds or creates the share of exactly this scope, so a folder always has one link. */
export function ensureShare({ owner, hostId, projectId, pageId = null, sessionId = null, title }) {
  if (!projectId && !sessionId) throw new Error("Nothing to share");
  const existing = db
    .prepare("select * from shares where owner = ? and host_id = ? and project_id = ? and coalesce(page_id, '') = ? and coalesce(session_id, '') = ?")
    .get(norm(owner), hostId, projectId ?? "", pageId ?? "", sessionId ?? "");
  if (existing) {
    if (title && title !== existing.title) db.prepare("update shares set title = ? where id = ?").run(String(title).slice(0, 200), existing.id);
    return getShare(existing.id);
  }
  const id = crypto.randomBytes(9).toString("base64url");
  db.prepare("insert into shares (id, owner, host_id, project_id, page_id, session_id, title, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    norm(owner),
    hostId,
    projectId ?? "",
    pageId || null,
    sessionId || null,
    String(title ?? projectId ?? "").slice(0, 200),
    now(),
  );
  return getShare(id);
}

const ownShare = (id, owner) => {
  const share = shareRow(id);
  if (!share || share.owner !== norm(owner)) throw new Error("Share not found");
  return share;
};

export function grant(id, owner, email, role) {
  const share = ownShare(id, owner);
  const key = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw new Error(`Not an email: ${email}`);
  if (key === share.owner) throw new Error("That's you: you already have access");
  db.prepare("insert into share_grants (share_id, email, role, created_at) values (?, ?, ?, ?) on conflict (share_id, email) do update set role = excluded.role").run(
    share.id,
    key,
    capRole(share, validRole(role)),
    now(),
  );
  return getShare(share.id);
}

export function revoke(id, owner, email) {
  const share = ownShare(id, owner);
  db.prepare("delete from share_grants where share_id = ? and email = ?").run(share.id, norm(email));
  db.prepare("delete from share_opens where share_id = ? and email = ?").run(share.id, norm(email));
  return getShare(share.id);
}

/** General access: null keeps it restricted to the people listed; otherwise anyone at `domain` with the link. */
export function setGeneral(id, owner, general) {
  const share = ownShare(id, owner);
  const domain = general?.domain ? String(general.domain).trim().toLowerCase().replace(/^@/, "") : null;
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error(`Not a domain: ${general.domain}`);
  db.prepare("update shares set general_domain = ?, general_role = ? where id = ?").run(domain, domain ? capRole(share, validRole(general.role ?? "viewer")) : null, share.id);
  return getShare(share.id);
}

export function deleteShare(id, owner) {
  const share = ownShare(id, owner);
  for (const table of ["share_grants", "share_opens"]) db.prepare(`delete from ${table} where share_id = ?`).run(share.id);
  db.prepare("delete from shares where id = ?").run(share.id);
}

/** The role `email` has on a share (the higher of their own grant and the domain link), or null. */
export function roleOn(id, email) {
  const share = shareRow(id);
  const key = norm(email);
  if (!share || !key || key === share.owner) return null;
  const own = db.prepare("select role from share_grants where share_id = ? and email = ?").get(share.id, key)?.role ?? null;
  const general = share.general_domain && domainOf(key) === share.general_domain ? share.general_role : null;
  const best = [own, general].filter(Boolean).sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return best && capRole(share, best);
}

export function markOpened(id, email) {
  db.prepare("insert or ignore into share_opens (share_id, email, opened_at) values (?, ?, ?)").run(id, norm(email), now());
}

/** "Shared with me": what people shared with `email` directly, plus domain links they already opened. */
export function sharedWith(email) {
  const key = norm(email);
  const ids = db
    .prepare(
      `select share_id as id from share_grants where email = ?
       union select o.share_id from share_opens o join shares s on s.id = o.share_id where o.email = ? and s.general_domain = ?`,
    )
    .all(key, key, domainOf(key))
    .map((r) => r.id);
  return ids
    .map((id) => ({ ...getShare(id), role: roleOn(id, key) }))
    .filter((s) => s.id && s.role)
    .map(({ people, general, ...share }) => share)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
