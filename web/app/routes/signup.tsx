import { useEffect, useRef } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  getUser,
  createUser,
  createSession,
  sessionCookie,
} from "../lib/auth.server";
import { log } from "../lib/logger.server";

export function meta() {
  return [{ title: "Create account — The Law" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) throw redirect("/");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  // Best-effort initial zone from the browser (hidden field, no round trip).
  // createUser validates it and falls back to DEFAULT_TZ — never trusted as-is.
  const timezone = String(fd.get("timezone") ?? "").trim();

  if (!email || !/.+@.+\..+/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  let user;
  try {
    user = await createUser(email, password, name || undefined, timezone || undefined);
  } catch (err: any) {
    if (err?.code === "23505") return { error: "That email is already registered." };
    log.error("signup", "createUser failed", { error: err?.message ?? String(err) });
    return { error: "Could not create your account. Please try again." };
  }

  const token = await createSession(user.id);
  throw redirect("/", { headers: { "Set-Cookie": sessionCookie(token) } });
}

const field =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-4 py-2.5 outline-none focus:border-[var(--color-gold-dim)]";

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const pending = nav.state !== "idle";
  // Filled after hydration rather than at render: on the server this would
  // resolve to the *server's* zone and mismatch on hydration.
  const tzRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tzRef.current) tzRef.current.value = tz;
    } catch {
      // No Intl data — the server falls back to UTC and /profile can fix it.
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <img
        src="/illustrations/auth.png"
        alt="Celestial illustration"
        className="mb-6 h-48 w-full rounded-xl border border-[var(--color-line)] object-cover"
      />
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8">
        <h1 className="serif text-3xl text-[var(--color-gold)] tracking-wide">Begin your practice</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Name a desire and be guided until it is realised.
        </p>
        <Form method="post" className="mt-6 space-y-3">
          <input ref={tzRef} type="hidden" name="timezone" />
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Name (optional)"
            className={field}
          />
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Email"
            className={field}
          />
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Password (min 8 characters)"
            className={field}
          />
          {actionData?.error && <p className="text-sm text-red-400">{actionData.error}</p>}
          <button
            disabled={pending}
            className="w-full rounded-lg bg-[var(--color-gold)] px-5 py-2.5 font-medium text-black transition hover:bg-[var(--color-gold-dim)] disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create account"}
          </button>
        </Form>
        <p className="mt-5 text-sm text-[var(--color-muted)]">
          <Link to="/login" className="underline hover:text-[var(--color-gold)]">
            Already have an account? Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
