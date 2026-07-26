// Shared helpers for the JSON API consumed by the Expo mobile app.
//
// Native React Native fetch ignores CORS and sends no Origin, so these headers
// exist for browsers: the Expo *web* target during development, plus curl-style
// pokes. There is deliberately no Access-Control-Allow-Credentials — the cookie
// session must never be reachable cross-origin; the mobile flow uses a Bearer
// token, which a browser cannot attach on its own.
//
// Default policy (no CORS_ALLOWED_ORIGINS set): echo back loopback and private
// LAN origins, which is what Expo dev uses (localhost:8081, or the dev machine's
// LAN IP when a phone is on the network). Any other browser origin gets no
// Access-Control-Allow-Origin at all, so the browser blocks the read.
// Set CORS_ALLOWED_ORIGINS to a comma-separated list to pin it down in
// production; then only exact matches are echoed.
import "dotenv/config";

const BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "600",
  // The allowed origin varies per request, so caches must key on it.
  Vary: "Origin",
};

function allowlist(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

// Loopback, RFC1918 and *.local — i.e. "somewhere on this dev machine's network".
function isLocalOrigin(origin: string): boolean {
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

// Headers for one request. Omits Allow-Origin when the origin isn't allowed;
// falls back to `*` only when there is no Origin at all (non-browser callers —
// the native app, curl — where there is no same-origin policy to satisfy).
export function corsFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return { ...BASE, "Access-Control-Allow-Origin": "*" };
  const list = allowlist();
  const allowed = list.length
    ? list.includes(origin.replace(/\/$/, ""))
    : isLocalOrigin(origin);
  return allowed ? { ...BASE, "Access-Control-Allow-Origin": origin } : { ...BASE };
}

// Static header set for callers with no Request in scope. Prefer corsFor().
// Keeps today's permissive default when no allowlist is configured; once one is,
// it carries no Allow-Origin, because a fixed object cannot echo an origin.
export const corsHeaders: Record<string, string> = allowlist().length
  ? { ...BASE }
  : { ...BASE, "Access-Control-Allow-Origin": "*" };

// `request` is optional purely for backwards compatibility: without it the
// static default applies (`*` unless an allowlist is configured), which is
// exactly today's behaviour. Pass it to get a specific origin echoed back.
export function json(
  data: unknown,
  init: number | ResponseInit = 200,
  request?: Request
): Response {
  const base: ResponseInit = typeof init === "number" ? { status: init } : init;
  const cors = request ? corsFor(request) : corsHeaders;
  return new Response(JSON.stringify(data), {
    ...base,
    headers: { "Content-Type": "application/json", ...cors, ...(base.headers || {}) },
  });
}

// Request-bound `json`. Handlers do `const j = jsonFor(request)` once and then
// call `j(...)`, so the origin is echoed correctly without threading `request`
// through every return. Without this, routes silently fall back to the static
// header set and CORS_ALLOWED_ORIGINS has no effect on them.
export function jsonFor(request: Request) {
  return (data: unknown, init: number | ResponseInit = 200): Response =>
    json(data, init, request);
}

// Answer CORS preflight; return null if not an OPTIONS request.
export function preflight(request: Request): Response | null {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsFor(request) });
  return null;
}
