// Shared helpers for the JSON API consumed by the Expo mobile app.
// Native React Native fetch ignores CORS, but permissive headers also let the
// Expo *web* target and browsers hit these routes during development.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const base: ResponseInit = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(data), {
    ...base,
    headers: { "Content-Type": "application/json", ...CORS, ...(base.headers || {}) },
  });
}

// Answer CORS preflight; return null if not an OPTIONS request.
export function preflight(request: Request): Response | null {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return null;
}

export const corsHeaders = CORS;
