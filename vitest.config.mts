import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Loads .env.local before tests so DB integration suites run when DATABASE_URL
    // is configured; they self-skip (reported BLOCKED) when it is absent.
    setupFiles: ["tests/setup.env.ts"],
  },
  resolve: {
    /**
     * `server-only` is a marker package: under the `react-server` condition it
     * resolves to an empty module, and under any other condition it throws on import
     * to stop server code reaching a browser bundle.
     *
     * Integration tests run server code directly in Node, which is exactly the
     * context the marker is protecting — so the tests resolve it the same way the
     * Next.js server build does. This does NOT weaken the guard in the application:
     * Next still applies the browser condition to client bundles, so importing a
     * server-only module from a client component is still a build error.
     */
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
});
