// POST /api/auth/signup  { email, password, name? } → { user, token } (201)
// First account adopts any pre-auth (orphan) goals.
import type { ActionFunctionArgs } from "react-router";
import { createUser, createSession } from "../../lib/auth.server";
import { claimOrphanGoals } from "../../lib/db.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };
  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email) return json({ error: "Email is required" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

  let user;
  try {
    user = await createUser(email, password, body.name);
  } catch {
    return json({ error: "Email already registered" }, 409);
  }
  await claimOrphanGoals(user.id);
  const token = await createSession(user.id);
  return json({ user, token }, 201);
}
