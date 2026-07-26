// POST /api/auth/login  { email, password } → { user, token }
import type { ActionFunctionArgs } from "react-router";
import {
  getUserByEmail,
  verifyAndUpgrade,
  createSession,
  clientIp,
  retryAfterMessage,
} from "../../lib/auth.server";
import { loginBackoff, recordLoginAttempt, clearLoginAttempts } from "../../lib/db.server";
import { bestEffort, log } from "../../lib/logger.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  const email = (body.email || "").trim();
  const password = body.password || "";

  // Same gate as the web form, and before any password work.
  const ip = clientIp(request);
  const gate = await loginBackoff(email, ip);
  if (gate.blocked) {
    log.warn("auth", "api login blocked by backoff", {
      email,
      ip,
      failures: gate.failures,
      retryAfterSec: gate.retryAfterSec,
    });
    return json(
      { error: retryAfterMessage(gate.retryAfterSec), retryAfterSec: gate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
      request
    );
  }

  const found = await getUserByEmail(email);
  // verifyAndUpgrade rehashes a legacy/low-cost hash in passing. One message for
  // both "no such user" and "wrong password" — no account enumeration.
  const ok = found ? await verifyAndUpgrade(found, password) : false;
  await bestEffort("auth", "record login attempt", recordLoginAttempt(email, ip, ok), undefined);
  if (!found || !ok) return json({ error: "Invalid email or password" }, 401, request);

  await bestEffort("auth", "clear login attempts", clearLoginAttempts(email, ip), undefined);
  const token = await createSession(found.id);
  const user = {
    id: found.id,
    email: found.email,
    name: found.name,
    avatar: found.avatar,
    timezone: found.timezone,
    created_at: found.created_at,
  };
  return json({ user, token }, 200, request);
}
