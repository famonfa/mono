import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Who can use the relay. Admins come from ADMIN_EMAILS; everyone else needs an invite, which turns into
 * a user the first time they sign in with that Google account. Removing a user locks them out and
 * disconnects their machines.
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
`);

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

/** First sign-in of an invited email: the pending invite becomes a user. */
export function acceptInvite(email) {
  const key = norm(email);
  const invite = db.prepare("select * from invites where email = ? and accepted_at is null order by created_at desc").get(key);
  if (!invite) return false;
  db.prepare("insert or ignore into users (email, invited_by, created_at) values (?, ?, ?)").run(key, invite.invited_by, now());
  db.prepare("update invites set accepted_at = ? where email = ? and accepted_at is null").run(now(), key);
  allowedCache.delete(key);
  return true;
}

export function createInvite(email, invitedBy) {
  const key = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw new Error("Invalid email");
  if (isAllowed(key)) throw new Error(`${key} already has access`);
  const pending = db.prepare("select token from invites where email = ? and accepted_at is null").get(key);
  if (pending) return { token: pending.token, email: key };
  const token = crypto.randomBytes(18).toString("base64url");
  db.prepare("insert into invites (token, email, invited_by, created_at) values (?, ?, ?, ?)").run(token, key, norm(invitedBy), now());
  return { token, email: key };
}

export const getInvite = (token) => db.prepare("select * from invites where token = ?").get(String(token ?? ""));

export function revokeInvite(token) {
  db.prepare("delete from invites where token = ? and accepted_at is null").run(String(token ?? ""));
}

export function removeUser(email) {
  const key = norm(email);
  db.prepare("delete from users where email = ?").run(key);
  db.prepare("delete from invites where email = ?").run(key);
  allowedCache.delete(key);
}

export function listAccess() {
  return {
    admins: [...ADMINS],
    users: db.prepare("select * from users order by created_at").all(),
    invites: db.prepare("select * from invites where accepted_at is null order by created_at desc").all(),
  };
}
