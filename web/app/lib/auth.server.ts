// Authentication: scrypt password hashing + opaque session tokens stored in
// Postgres. Works for both the web app (httpOnly cookie) and the Expo app
// (Authorization: Bearer <token>). No external crypto deps — Node's built-ins.
import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import {
  query,
  deleteUserSessions,
  pruneExpiredSessions,
  isValidTimezone,
  DEFAULT_TZ,
} from "./db.server";
import { bestEffort, log } from "./logger.server";

// promisify() infers the 3-arg overload, so spell out the options-bearing shape.
const scrypt = promisify(_scrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options?: ScryptOptions
) => Promise<Buffer>;

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "neville_session";

// Env flags are read lazily: module evaluation order vs. `dotenv/config` is not
// something to bet a login flow on.
function envFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] || "");
}

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  timezone: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
// Format: `scrypt$n=<N>,r=<r>,p=<p>$<saltHex>$<keyHex>`. The cost lives in the
// string, so these numbers can be raised later and old hashes still verify —
// the previous format (`saltHex:keyHex` at Node's defaults) could not.
const SCRYPT = { N: 1 << 17, r: 8, p: 1 };
const KEYLEN = 64;

// Node rejects scrypt when 128*N*r exceeds maxmem (default 32 MiB). At N=2^17,
// r=8 that is 128 MiB, so ask for double and leave headroom for its internals.
function maxmemFor(N: number, r: number): number {
  return Math.max(32 * 1024 * 1024, 128 * N * r * 2);
}

type Params = { N: number; r: number; p: number };
// Legacy hashes fed scrypt the *hex string* as the salt; new ones use the raw
// bytes. Verification must reproduce whichever was used at write time.
type Parsed = { params: Params; salt: Buffer | string; key: Buffer; legacy: boolean };

// Ceilings on stored parameters so a corrupt row can't ask for gigabytes.
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

function derive(password: string, salt: Buffer | string, params: Params): Promise<Buffer> {
  return scrypt(password, salt, KEYLEN, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params.N, params.r),
  });
}

function parseStored(stored: string): Parsed | null {
  if (!stored) return null;
  if (!stored.includes("$")) {
    // Legacy `saltHex:keyHex` at Node's scrypt defaults (N=16384, r=8, p=1).
    const [salt, key] = stored.split(":");
    if (!salt || !key) return null;
    return { params: { N: 16384, r: 8, p: 1 }, salt, key: Buffer.from(key, "hex"), legacy: true };
  }
  const [algo, paramStr, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !paramStr || !saltHex || !keyHex) return null;
  const params: Params = { N: 0, r: 0, p: 0 };
  for (const part of paramStr.split(",")) {
    const [k, v] = part.split("=");
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    if (k === "n" || k === "N") params.N = n;
    else if (k === "r") params.r = n;
    else if (k === "p") params.p = n;
  }
  if (!params.N || !params.r || !params.p) return null;
  if (params.N > MAX_N || params.r > MAX_R || params.p > MAX_P) return null;
  return { params, salt: Buffer.from(saltHex, "hex"), key: Buffer.from(keyHex, "hex"), legacy: false };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return `scrypt$n=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt.toString("hex")}$${key.toString(
    "hex"
  )}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  let key: Buffer;
  try {
    key = await derive(password, parsed.salt, parsed.params);
  } catch (e) {
    // Unusable stored parameters — treat as a failed login, but make it visible.
    log.error("auth", "password derivation failed", { error: (e as Error).message });
    return false;
  }
  return parsed.key.length === key.length && timingSafeEqual(parsed.key, key);
}

// True when a stored hash is legacy-format or below the current cost.
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return false; // unparseable: rehashing can't fix it, and login failed anyway
  if (parsed.legacy) return true;
  return parsed.params.N < SCRYPT.N || parsed.params.r !== SCRYPT.r || parsed.params.p !== SCRYPT.p;
}

// Rewrite a user's hash at the current parameters. Only ever called with a
// plaintext that just verified. Best-effort: a failed upgrade must not fail the
// login — the next successful login retries it.
export async function upgradePasswordHash(userId: number, password: string): Promise<boolean> {
  return bestEffort(
    "auth",
    "password rehash",
    (async () => {
      const hash = await hashPassword(password);
      await query("UPDATE neville_users SET password_hash = $2 WHERE id = $1", [userId, hash]);
      log.info("auth", "password rehashed at current scrypt params", { userId, n: SCRYPT.N });
      return true;
    })(),
    false
  );
}

// The one entry point both login paths use: verify, then transparently upgrade
// an old hash while the plaintext is still in hand.
export async function verifyAndUpgrade(
  user: { id: number; password_hash: string },
  password: string
): Promise<boolean> {
  if (!(await verifyPassword(password, user.password_hash))) return false;
  if (needsRehash(user.password_hash)) await upgradePasswordHash(user.id, password);
  return true;
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------
// Neither `react-router dev` (Vite) nor `react-router-serve` (express, no
// getLoadContext) hands a loader/action the socket address — a route only ever
// sees headers. So this is header-derived by construction:
//   * TRUST_PROXY=1 → take the *rightmost* X-Forwarded-For hop, the address the
//     trusted proxy itself observed; anything to its left is client-supplied.
//   * otherwise → keep the claimed value but tag it `u:` (unverified) so it can
//     never be confused with a vouched-for address.
// What this can honestly guarantee: nothing about the value's truth. It is safe
// only because `loginBackoff` ORs the per-email and per-IP axes, so a forged or
// rotated header can add failures but never clear an email's count. The
// per-email axis is the authoritative one; the IP axis is a bonus that a
// determined attacker rotating the header simply forfeits.
function normalizeIp(raw: string): string | null {
  let v = raw.trim().replace(/^\[|\]$/g, "");
  // "1.2.3.4:5678" → "1.2.3.4" (IPv6 has many colons; leave it alone).
  const m = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (m) v = m[1];
  if (!v || v.length > 64 || /[^0-9a-fA-F.:%]/.test(v)) return null;
  return v;
}

export function clientIp(request: Request): string | null {
  const trusted = envFlag("TRUST_PROXY");
  const hops = (request.headers.get("X-Forwarded-For") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const claimed = trusted
    ? hops[hops.length - 1] || request.headers.get("X-Real-IP") || ""
    : hops[0] || request.headers.get("X-Real-IP") || "";
  const ip = claimed ? normalizeIp(claimed) : null;
  if (!ip) return null;
  return trusted ? ip : `u:${ip}`;
}

// Shared wording so the web form and the JSON API say the same thing.
export function retryAfterMessage(sec: number): string {
  const s = Math.max(1, Math.ceil(sec));
  const mins = Math.ceil(s / 60);
  const wait =
    s >= 60 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${s} second${s === 1 ? "" : "s"}`;
  return `Too many failed sign-in attempts. Try again in ${wait}.`;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const PUBLIC = "id, email, name, avatar, timezone, created_at";

export async function getUserByEmail(
  email: string
): Promise<(User & { password_hash: string }) | undefined> {
  const r = await query<User & { password_hash: string }>(
    `SELECT ${PUBLIC}, password_hash FROM neville_users WHERE lower(email) = lower($1)`,
    [email]
  );
  return r[0];
}

export async function getUserById(id: number): Promise<User | undefined> {
  const r = await query<User>(`SELECT ${PUBLIC} FROM neville_users WHERE id = $1`, [id]);
  return r[0];
}

export async function createUser(
  email: string,
  password: string,
  name?: string,
  timezone?: string
): Promise<User> {
  const hash = await hashPassword(password);
  // The zone comes from the browser, so never trust it into the column.
  const tz = timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TZ;
  const r = await query<User>(
    `INSERT INTO neville_users (email, password_hash, name, timezone) VALUES ($1,$2,$3,$4) RETURNING ${PUBLIC}`,
    [email.trim(), hash, name?.trim() || null, tz]
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

// keepToken spares the caller's own session: every *other* session is revoked,
// so a token stolen before the change stops working, without signing the user
// out of the device they just typed their password on.
export async function changePassword(
  id: number,
  current: string,
  next: string,
  keepToken?: string
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
  log.info("auth", "password changed", { userId: id });
  const revoked = await bestEffort(
    "auth",
    "revoke other sessions",
    deleteUserSessions(id, keepToken),
    0
  );
  if (revoked) log.info("auth", "revoked other sessions after password change", { userId: id, revoked });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// Expired rows are never read but would accumulate forever. Sweep them at most
// hourly per process, off the request's clock — deliberately not awaited, and
// bestEffort so it can neither throw nor block a sign-in.
const PRUNE_EVERY_MS = 3600_000;
let lastPrune = 0;

function prunePeriodically(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  void bestEffort(
    "auth",
    "expired session prune",
    pruneExpiredSessions().then((n) => {
      if (n) log.info("auth", "pruned expired sessions", { count: n });
      return n;
    }),
    0
  );
}

// Every login mints a fresh token, so tokens already rotate per sign-in. Other
// devices' sessions are intentionally left alone — revoking them here would sign
// the Expo app out whenever the user logged in on the web.
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(
    "INSERT INTO neville_sessions (token, user_id, expires_at) VALUES ($1,$2,$3)",
    [token, userId, expires]
  );
  prunePeriodically();
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query("DELETE FROM neville_sessions WHERE token = $1", [token]);
}

export async function userForToken(token: string): Promise<User | undefined> {
  if (!token) return undefined;
  const r = await query<User>(
    `SELECT u.id, u.email, u.name, u.avatar, u.timezone, u.created_at
       FROM neville_sessions s JOIN neville_users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return r[0];
}

// ---------------------------------------------------------------------------
// Request → user (cookie OR bearer)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Cookie header builders
// ---------------------------------------------------------------------------
// `Secure` is opt-in: on plain-HTTP localhost the browser drops a Secure cookie
// and sign-in silently fails, so it stays off until COOKIE_SECURE=1 says the app
// is served over TLS. The attributes must match between set and clear or the
// browser won't replace the cookie.
function cookieAttrs(maxAge: number): string {
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${envFlag("COOKIE_SECURE") ? "; Secure" : ""}`;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttrs(SESSION_DAYS * 86400)}`;
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttrs(0)}`;
}
