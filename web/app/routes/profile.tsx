import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { requireUser, updateProfile, changePassword } from "../lib/auth.server";

export function meta() {
  return [{ title: "Your profile — The Law" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return { user };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "profile") {
    const name = String(fd.get("name") ?? "").trim();
    const avatar = String(fd.get("avatar") ?? "").trim();
    await updateProfile(user.id, { name: name || null, avatar: avatar || null });
    return { ok: true, scope: "profile", message: "Profile saved." };
  }

  if (intent === "password") {
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (next.length < 8)
      return { ok: false, scope: "password", error: "New password must be at least 8 characters." };
    if (next !== confirm)
      return { ok: false, scope: "password", error: "New passwords do not match." };
    const res = await changePassword(user.id, current, next);
    if (!res.ok) return { ok: false, scope: "password", error: res.error };
    return { ok: true, scope: "password", message: "Password changed." };
  }

  return { ok: false, error: "Unknown action." };
}

const field =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-4 py-2.5 outline-none focus:border-[var(--color-gold-dim)]";
const button =
  "rounded-lg bg-[var(--color-gold)] px-5 py-2.5 font-medium text-black transition hover:bg-[var(--color-gold-dim)] disabled:opacity-50";

type ActionResult =
  | { ok: boolean; scope?: string; message?: string; error?: string }
  | undefined;

export default function Profile() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult;
  const nav = useNavigation();
  const intent = nav.formData?.get("intent");
  const savingProfile = nav.state !== "idle" && intent === "profile";
  const savingPassword = nav.state !== "idle" && intent === "password";

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="serif text-4xl text-[var(--color-gold)] tracking-wide">Your profile</h1>
        <Form method="post" action="/logout">
          <button className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:border-[var(--color-gold-dim)] hover:text-[var(--color-gold)]">
            Sign out
          </button>
        </Form>
      </header>

      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <h2 className="serif text-xl mb-4">Details</h2>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="profile" />
          <div>
            <label className="mb-1 block text-xs text-[var(--color-muted)]">Email</label>
            <input
              value={user.email}
              readOnly
              disabled
              className={`${field} cursor-not-allowed text-[var(--color-muted)]`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-muted)]">Name</label>
            <input name="name" type="text" defaultValue={user.name ?? ""} placeholder="Your name" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-muted)]">Avatar URL</label>
            <input
              name="avatar"
              type="url"
              defaultValue={user.avatar ?? ""}
              placeholder="https://…"
              className={field}
            />
          </div>
          {actionData?.scope === "profile" && actionData.ok && (
            <p className="text-sm text-[var(--color-accent)]">{actionData.message}</p>
          )}
          {actionData?.scope === "profile" && actionData.error && (
            <p className="text-sm text-red-400">{actionData.error}</p>
          )}
          <button disabled={savingProfile} className={button}>
            {savingProfile ? "Saving…" : "Save"}
          </button>
        </Form>
      </section>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <h2 className="serif text-xl mb-4">Change password</h2>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="password" />
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            className={field}
          />
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="New password (min 8 characters)"
            className={field}
          />
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="Confirm new password"
            className={field}
          />
          {actionData?.scope === "password" && actionData.ok && (
            <p className="text-sm text-[var(--color-accent)]">{actionData.message}</p>
          )}
          {actionData?.scope === "password" && actionData.error && (
            <p className="text-sm text-red-400">{actionData.error}</p>
          )}
          <button disabled={savingPassword} className={button}>
            {savingPassword ? "Saving…" : "Change password"}
          </button>
        </Form>
      </section>
    </main>
  );
}
