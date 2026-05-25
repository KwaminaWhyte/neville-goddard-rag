// Authentication: scrypt password hashing + opaque session tokens stored in
// Postgres. Works for both the web app (httpOnly cookie) and the Expo app
// (Authorization: Bearer <token>). No external crypto deps — Node's built-ins.
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db.server";

const scrypt = promisify(_scrypt);

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "neville_session";

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  created_at: string;
};

// --- password hashing (salt:hash, both hex) ---
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const buf = (await scrypt(password, salt, 64)) as Buffer;
  const keyBuf = Buffer.from(key, "hex");
  return keyBuf.length === buf.length && timingSafeEqual(keyBuf, buf);
}

// --- users ---
const PUBLIC = "id, email, name, avatar, created_at";

export async function getUserByEmail(
  email: string
): Promise<(User & { password_hash: string }) | undefined> {
  const r = await query<User & { password_hash: string }>(
    "SELECT id, email, name, avatar, created_at, password_hash FROM neville_users WHERE lower(email) = lower($1)",
    [email]
  );
  return r[0];
}

export async function getUserById(id: number): Promise<User | undefined> {
  const r = await query<User>(`SELECT ${PUBLIC} FROM neville_users WHERE id = $1`, [id]);
  return r[0];
}

export async function createUser(email: string, password: string, name?: string): Promise<User> {
  const hash = await hashPassword(password);
  const r = await query<User>(
    `INSERT INTO neville_users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING ${PUBLIC}`,
    [email.trim(), hash, name?.trim() || null]
  );
  return r[0];
}

export async function updateProfile(
  id: number,
  fields: { name?: string | null; avatar?: string | null }
): Promise<User | undefined> {
  const r = await query<User>(
    `UPDATE neville_users SET name = COALESCE($2, name), avatar = COALESCE($3, avatar)
       WHERE id = $1 RETURNING ${PUBLIC}`,
    [id, fields.name ?? null, fields.avatar ?? null]
  );
  return r[0];
}

export async function changePassword(
  id: number,
  current: string,
  next: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ password_hash: string }>(
    "SELECT password_hash FROM neville_users WHERE id = $1",
    [id]
  );
  if (!r[0]) return { ok: false, error: "User not found." };
  if (!(await verifyPassword(current, r[0].password_hash)))
    return { ok: false, error: "Current password is incorrect." };
  await query("UPDATE neville_users SET password_hash = $2 WHERE id = $1", [
    id,
    await hashPassword(next),
  ]);
  return { ok: true };
}

// --- sessions ---
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(
    "INSERT INTO neville_sessions (token, user_id, expires_at) VALUES ($1,$2,$3)",
    [token, userId, expires]
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query("DELETE FROM neville_sessions WHERE token = $1", [token]);
}

export async function userForToken(token: string): Promise<User | undefined> {
  if (!token) return undefined;
  const r = await query<User>(
    `SELECT u.id, u.email, u.name, u.avatar, u.created_at
       FROM neville_sessions s JOIN neville_users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return r[0];
}

// --- request → user (cookie OR bearer) ---
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return readCookie(request, SESSION_COOKIE);
}

export async function getUser(request: Request): Promise<User | undefined> {
  const token = tokenFromRequest(request);
  return token ? userForToken(token) : undefined;
}

// Throws a Response (redirect for browsers, 401 for API) when not signed in.
export async function requireUser(request: Request, opts?: { api?: boolean }): Promise<User> {
  const user = await getUser(request);
  if (user) return user;
  if (opts?.api) throw new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const url = new URL(request.url);
  throw new Response(null, {
    status: 302,
    headers: { Location: `/login?next=${encodeURIComponent(url.pathname)}` },
  });
}

// --- cookie header builders ---
export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
