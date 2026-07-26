// POST /api/profile/password  (Bearer) { current, next } → { ok: true }
import type { ActionFunctionArgs } from "react-router";
import { requireUser, changePassword, tokenFromRequest } from "../../lib/auth.server";
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
  if (next.length < 8) return json({ error: "Password too short" }, 400, request);
  // Keeps this device's Bearer token alive and revokes the user's other sessions.
  const r = await changePassword(user.id, current, next, tokenFromRequest(request) ?? undefined);
  if (!r.ok) return json({ error: r.error }, 400, request);
  return json({ ok: true }, 200, request);
}
