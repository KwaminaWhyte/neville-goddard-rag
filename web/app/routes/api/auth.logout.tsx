// POST /api/auth/logout  (Bearer) → { ok: true }
import type { ActionFunctionArgs } from "react-router";
import { tokenFromRequest, deleteSession } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const token = tokenFromRequest(request);
  if (token) await deleteSession(token);
  return json({ ok: true }, 200, request);
}
