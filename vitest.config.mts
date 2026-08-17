import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Loads .env.local before tests so DB integration suites run when DATABASE_URL
    // is configured; they self-skip (reported BLOCKED) when it is absent.
    setupFiles: ["tests/setup.env.ts"],
  },
});
