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

export const isBlocked = (email) => Boolean(db.prepare("select 1 from blocked where email = ?").get(norm(email)));

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
