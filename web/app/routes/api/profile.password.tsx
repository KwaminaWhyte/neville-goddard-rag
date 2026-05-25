// POST /api/profile/password  (Bearer) { current, next } → { ok: true }
import type { ActionFunctionArgs } from "react-router";
import { requireUser, changePassword } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const body = (await request.json().catch(() => ({}))) as {
    current?: string;
    next?: string;
  };
  const current = body.current || "";
  const next = body.next || "";
  if (next.length < 8) return json({ error: "Password too short" }, 400);
  const r = await changePassword(user.id, current, next);
  if (!r.ok) return json({ error: r.error }, 400);
  return json({ ok: true });
}
