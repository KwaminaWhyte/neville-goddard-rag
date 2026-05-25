// GET /api/auth/me  (Bearer) → { user } | 401
import type { LoaderFunctionArgs } from "react-router";
import { getUser } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await getUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  return json({ user });
}
