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
  getUserByEmail,
  verifyAndUpgrade,
  createSession,
  sessionCookie,
  clientIp,
  retryAfterMessage,
} from "../lib/auth.server";
import { loginBackoff, recordLoginAttempt, clearLoginAttempts } from "../lib/db.server";
import { bestEffort, log } from "../lib/logger.server";

export function meta() {
  return [{ title: "Sign in — The Law" }];
}

// Exported for tests: this is the open-redirect guard on ?next=.
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) throw redirect("/");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const fd = await request.formData();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");

  if (!email || !password) return { error: "Invalid email or password." };

  // Throttle before touching the password: an unlimited-attempt form is a free
  // offline-speed oracle. Checked per-email OR per-IP, whichever is worse.
  const ip = clientIp(request);
  const gate = await loginBackoff(email, ip);
  if (gate.blocked) {
    log.warn("auth", "login blocked by backoff", {
      email,
      ip,
      failures: gate.failures,
      retryAfterSec: gate.retryAfterSec,
    });
    return { error: retryAfterMessage(gate.retryAfterSec) };
  }

  const user = await getUserByEmail(email);
  // verifyAndUpgrade rehashes a legacy/low-cost hash in passing. The message
  // stays identical for "no such user" and "wrong password" — no enumeration.
  const ok = user ? await verifyAndUpgrade(user, password) : false;
  await bestEffort("auth", "record login attempt", recordLoginAttempt(email, ip, ok), undefined);
  if (!user || !ok) return { error: "Invalid email or password." };

  await bestEffort("auth", "clear login attempts", clearLoginAttempts(email, ip), undefined);
  const token = await createSession(user.id);
  throw redirect(next, { headers: { "Set-Cookie": sessionCookie(token) } });
}

const field =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-4 py-2.5 outline-none focus:border-[var(--color-gold-dim)]";

export default function Login() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const pending = nav.state !== "idle";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <img
        src="/illustrations/auth.png"
        alt="Celestial illustration"
        className="mb-6 h-48 w-full rounded-xl border border-[var(--color-line)] object-cover"
      />
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8">
        <h1 className="serif text-3xl text-[var(--color-gold)] tracking-wide">Welcome back</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Return to your practice.
        </p>
        <Form method="post" className="mt-6 space-y-3">
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
            autoComplete="current-password"
            placeholder="Password"
            className={field}
          />
          {actionData?.error && <p className="text-sm text-red-400">{actionData.error}</p>}
          <button
            disabled={pending}
            className="w-full rounded-lg bg-[var(--color-gold)] px-5 py-2.5 font-medium text-black transition hover:bg-[var(--color-gold-dim)] disabled:opacity-50"
          >
            {pending ? "Entering…" : "Sign in"}
          </button>
        </Form>
        <p className="mt-5 text-sm text-[var(--color-muted)]">
          <Link to="/signup" className="underline hover:text-[var(--color-gold)]">
            New here? Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
