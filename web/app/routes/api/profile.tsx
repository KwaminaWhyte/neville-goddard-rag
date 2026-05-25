// PATCH/POST /api/profile  (Bearer) { name?, avatar? } → { user }
import type { ActionFunctionArgs } from "react-router";
import { requireUser, updateProfile } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string | null;
    avatar?: string | null;
  };
  const updated = await updateProfile(user.id, { name: body.name, avatar: body.avatar });
  return json({ user: updated });
}
