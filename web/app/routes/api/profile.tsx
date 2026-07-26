// PATCH/POST /api/profile  (Bearer) { name?, avatar?, timezone? } → { user }
import type { ActionFunctionArgs } from "react-router";
import { requireUser, updateProfile } from "../../lib/auth.server";
import { isValidTimezone, setUserTimezone } from "../../lib/db.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request }: ActionFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string | null;
    avatar?: string | null;
    timezone?: string | null;
  };
  // Validated before the write: the goal's day counter and the streak both
  // bucket calendar days in this zone, so junk here corrupts both.
  const tz = (body.timezone ?? "").trim();
  if (tz && !isValidTimezone(tz)) return json({ error: `Invalid time zone: ${tz}` }, 400, request);
  if (tz) await setUserTimezone(user.id, tz);
  const updated = await updateProfile(user.id, { name: body.name, avatar: body.avatar });
  return json({ user: updated }, 200, request);
}
