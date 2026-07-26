// Standalone Vitest config — deliberately does NOT reuse vite.config.ts.
//
// vite.config.ts loads the React Router and Tailwind plugins. Those exist to
// build the app (route typegen, CSS pipeline, SSR entry generation) and give a
// unit test of a pure function nothing, while making every run depend on the
// build graph. Vitest resolves the `~/*` alias itself instead.
//
// Hermetic by construction: the modules under test import `dotenv/config` and
// construct a `pg.Pool` at load, but neither touches the network — dotenv
// no-ops when .env is absent, and pg.Pool opens sockets lazily on first query
// (verified: zero active handles after construction). So there is no Postgres,
// Ollama or LightRAG dependency, and nothing to mock.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Pin the host clock's zone so a run in Accra and a run in Berlin agree.
    // Timezone-sensitive tests still pass their zone explicitly; this only stops
    // an accidental reliance on the machine's TZ from passing locally.
    env: { TZ: "UTC" },
  },
});
