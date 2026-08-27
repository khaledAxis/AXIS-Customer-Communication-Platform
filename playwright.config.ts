import { config as loadEnv } from "dotenv";

import { defineConfig, devices } from "@playwright/test";

// The config process does not inherit .env.local, and an empty value here would
// OVERRIDE what Next.js loads for itself — which is exactly why the credential
// blanking below works, and exactly why this must be loaded first.
loadEnv({ path: ".env.local" });

/**
 * Authenticated browser E2E (ADR-0031).
 *
 * Runs against a DEDICATED Next.js server on port 3100 whose `DATABASE_URL` points at
 * `axis_ccp_test`. Two things follow from that:
 *
 *  - destructive UI actions touch synthetic fixtures only, never operational data;
 *  - the developer's own dev server on :3000 is left alone.
 *
 * `webServer` starts that process fresh for every run, which is also the fix for the
 * stale-Prisma incident: a long-running server can hold a client generated before a
 * migration, and E2E must never inherit one.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

if (!TEST_DATABASE_URL.endsWith("_test") && !TEST_DATABASE_URL.includes("_test?")) {
  throw new Error(
    "E2E refuses to start: TEST_DATABASE_URL must name a test database. " +
      "Automated tests are not allowed to use the AXIS operational development database.",
  );
}

export default defineConfig({
  testDir: "./e2e/specs",
  // Deterministic fixtures: preflight + re-seed before every run.
  globalSetup: "./e2e/global-setup.ts",
  // Serial: suites share one database and one application instance, and several
  // assert on counts that a parallel worker would move underneath them.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // No arbitrary sleeps anywhere in the suite; every wait is condition-based.
    actionTimeout: 15_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  webServer: {
    // A PRODUCTION BUILD, not `next dev` (requirement §45).
    //
    // Two reasons. It is what actually ships, so the smoke is meaningful; and a dev
    // server compiles chunks on demand, which makes the browser observe transient
    // 403s on assets that are being written — noise indistinguishable from a real
    // authorization defect. A built server has no on-demand compilation and no HMR.
    command: "npx next build && npx next start --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 420_000,
    env: {
      // The application resolves DATABASE_URL normally; pointing it at the test
      // database is what keeps this run away from operational data.
      DATABASE_URL: TEST_DATABASE_URL,
      // Auth.js builds callback URLs from this. `.env.local` names port 3000, so
      // without an override the session cookie is issued for the wrong origin and
      // sign-in silently fails.
      AUTH_URL: "http://127.0.0.1:3100",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
      AUTH_TRUST_HOST: "true",
      PUBLIC_APP_URL: "http://127.0.0.1:3100",
      NEXT_TELEMETRY_DISABLED: "1",
      QA_EMAIL_ENABLED: "true",
      PRODUCTION_DELIVERY_ENABLED: "false",
      PROVIDER_PILOT_ENABLED: "false",

      // NO LIVE EMAIL IS POSSIBLE FROM THIS PROCESS.
      //
      // This server runs outside the test runner, so the registry's "no live adapter
      // under vitest" guard does not apply here. Instead the CREDENTIALS are removed:
      // every transport reports itself unconfigured and refuses to send, so a browser
      // click on a send button exercises the refusal path rather than a mail server.
      // Blanking secrets is a stronger guarantee than a flag somebody could flip.
      GMAIL_SMTP_USER: "",
      GMAIL_APP_PASSWORD: "",
      RESEND_API_KEY: "",
      RESEND_WEBHOOK_SECRET: "",
      // Monday stays unreachable too, so no CRM sync can leave this process.
      MONDAY_API_TOKEN: "",
    },
  },
});
