import { config as loadEnv } from "dotenv";

import {
  assertTestDatabaseTarget,
  databaseNameOf,
  OPERATIONAL_DATABASE_NAME,
} from "../src/domain/infra/databaseTarget";

/**
 * Test-process bootstrap (ADR-0029).
 *
 * Runs before any test module is imported, and therefore before any Prisma client can
 * be constructed. Its job is to make it impossible for this process to reach the
 * operational development database.
 *
 * Automated tests previously ran against `axis_ccp_dev`, which holds mirrored Monday
 * CRM, real AXIS staff accounts, consent decisions and the QA send ledger — and a
 * fixture cleanup deleted live records from it. Two changes prevent a repeat:
 *
 *  1. `DATABASE_URL` is REMOVED from this process's environment. Not overwritten,
 *     removed. Any code that reaches for it — existing or written later, in the app or
 *     in a fixture — finds nothing rather than finding the operational database.
 *  2. The database is selected from `TEST_DATABASE_URL` and guarded. A missing or
 *     unsafe value fails the run; it never falls back.
 */

loadEnv({ path: ".env.local" });

const testUrl = process.env.TEST_DATABASE_URL;
const verdict = assertTestDatabaseTarget(testUrl);

// The operational URL is removed from the test process regardless of the outcome
// below, so even a diagnostic path cannot reach it.
const operationalName = databaseNameOf(process.env.DATABASE_URL);
delete process.env.DATABASE_URL;

if (!verdict.ok) {
  // Fail the whole run, loudly, before a single fixture exists.
  throw new Error(
    [
      "",
      "  AUTOMATED TESTS CANNOT START",
      "",
      `  ${verdict.message}`,
      "",
      "  Automated tests are not allowed to use the AXIS operational development database.",
      operationalName
        ? `  (DATABASE_URL points at "${operationalName}" and has been removed from this process.)`
        : "",
      "",
      `  Expected a test database — "${"axis_ccp_test"}" or a name ending in "_test".`,
      "  See docs/testing.md.",
      "",
    ].join("\n"),
  );
}

if (operationalName === OPERATIONAL_DATABASE_NAME) {
  // Expected and correct: the developer's .env.local names the operational database
  // for the application. Recorded as a diagnostic so the swap is visible, not silent.
  process.env.__AXIS_TEST_DB_SWAPPED = "true";
}

// The application resolves its connection through `resolveDatabaseUrl()`, which reads
// TEST_DATABASE_URL under the runner. This assignment keeps any third-party tooling
// that insists on DATABASE_URL pointed at the TEST database, never the operational one.
process.env.DATABASE_URL = testUrl;

// Safe diagnostics only — reconstructed from parts, so it cannot contain a password.
// Printed once per worker, which is what makes a misconfiguration obvious.
console.info(
  [
    "AXIS test environment",
    `  Test database: ${verdict.databaseName}`,
    `  Host:          ${verdict.host}:${verdict.port}`,
    "  Environment:   TEST",
    "  Live email:    DISABLED (Gmail, QA and Resend adapters are unavailable)",
  ].join("\n"),
);
