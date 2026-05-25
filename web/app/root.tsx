import {
  isRouteErrorResponse,
  Form,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { getUser } from "./lib/auth.server";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./app.css";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  return { user: user ?? null };
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <>
      {user && (
        <nav className="border-b border-[var(--color-line)] bg-[var(--color-panel)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
            <Link to="/" className="serif text-lg text-[var(--color-gold)] tracking-wide">
              The Law
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link
                to="/profile"
                className="text-[var(--color-muted)] transition hover:text-[var(--color-gold)]"
              >
                {user.name || user.email}
              </Link>
              <Form method="post" action="/logout">
                <button className="text-[var(--color-muted)] transition hover:text-[var(--color-gold)]">
                  Sign out
                </button>
              </Form>
            </div>
          </div>
        </nav>
      )}
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
