// POST /api/auth/signup  { email, password, name? } → { user, token } (201)
// First account adopts any pre-auth (orphan) goals.
import type { ActionFunctionArgs } from "react-router";
import { createUser, createSession } from "../../lib/auth.server";
import { claimOrphanGoals, isValidTimezone } from "../../lib/db.server";
import { json, preflight } from "../../lib/api.server";
import { log } from "../../lib/logger.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    timezone?: string;
  };
  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email) return json({ error: "Email is required" }, 400, request);
  if (password.length < 8)
    return json({ error: "Password must be at least 8 characters" }, 400, request);
  // A client-supplied zone is validated inside createUser and falls back to UTC.
  const timezone = (body.timezone || "").trim();
  if (timezone && !isValidTimezone(timezone))
    return json({ error: `Invalid time zone: ${timezone}` }, 400, request);

  let user;
  try {
    user = await createUser(email, password, body.name, timezone || undefined);
  } catch (e) {
    // Assumed to be the unique-email constraint (the common case), but logged
    // regardless — a genuine DB failure would otherwise look identical to a
    // duplicate signup and go unnoticed.
    log.warn("auth/signup", "createUser failed", { error: (e as Error).message });
    return json({ error: "Email already registered" }, 409, request);
  }
  await claimOrphanGoals(user.id);
  const token = await createSession(user.id);
  return json({ user, token }, 201, request);
}
