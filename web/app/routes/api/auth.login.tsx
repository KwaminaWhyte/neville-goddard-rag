// POST /api/auth/login  { email, password } → { user, token }
import type { ActionFunctionArgs } from "react-router";
import { getUserByEmail, verifyPassword, createSession } from "../../lib/auth.server";
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

  const found = await getUserByEmail(email);
  if (!found || !(await verifyPassword(password, found.password_hash)))
    return json({ error: "Invalid email or password" }, 401);

  const token = await createSession(found.id);
  const user = {
    id: found.id,
    email: found.email,
    name: found.name,
    avatar: found.avatar,
    created_at: found.created_at,
  };
  return json({ user, token });
}
