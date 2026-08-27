/**
 * Resets the AXIS TEST database (ADR-0029).
 *
 * Developer convenience only. It exists because a test database sometimes needs to go
 * back to a known-empty state — and because doing that by hand is exactly when
 * somebody pastes the wrong connection string.
 *
 * IT ASSERTS ITS TARGET BEFORE IT DOES ANYTHING. The database name must be
 * `axis_ccp_test` or end in `_test`; `axis_ccp_dev` is refused by name with a specific
 * message. This is deliberately NOT a "reset any URL" command — there is no flag that
 * disables the check, and passing an operational URL prints a refusal and exits
 * non-zero rather than asking for confirmation.
 *
 *   npm run test:db:reset
 *   node scripts/reset-test-db.mjs --dry-run
 *   node scripts/reset-test-db.mjs --url "postgresql://…/something_test" --dry-run
 */

import { execSync } from "node:child_process";

import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlIndex = args.indexOf("--url");
const target =
  urlIndex !== -1 && args[urlIndex + 1] ? args[urlIndex + 1] : process.env.TEST_DATABASE_URL;

// ---------------------------------------------------------------------------
// The guard. Mirrors `domain/infra/databaseTarget.ts`; kept dependency-free here
// so the script runs without a build step.
// ---------------------------------------------------------------------------

const TEST_DATABASE_NAME = "axis_ccp_test";
const OPERATIONAL_DATABASE_NAME = "axis_ccp_dev";

function judge(connectionString) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return { ok: false, reason: "TEST_DATABASE_URL is not set." };
  }
  let url;
  try {
    url = new URL(connectionString.trim());
  } catch {
    return { ok: false, reason: "That is not a valid PostgreSQL connection string." };
  }
  if (!url.protocol.startsWith("postgres")) {
    return { ok: false, reason: "That is not a PostgreSQL connection string." };
  }
  const name = url.pathname.replace(/^\//, "").trim();
  if (name === "") return { ok: false, reason: "That URL does not name a database." };

  if (name.toLowerCase() === OPERATIONAL_DATABASE_NAME) {
    return {
      ok: false,
      reason:
        "That is the AXIS operational development database. This tool will never reset it.",
    };
  }
  if (name.toLowerCase() !== TEST_DATABASE_NAME && !name.toLowerCase().endsWith("_test")) {
    return {
      ok: false,
      reason: `Only a test database may be reset — "${TEST_DATABASE_NAME}" or a name ending in "_test".`,
    };
  }
  return { ok: true, name, host: url.hostname, port: url.port || "5432" };
}

const verdict = judge(target);

if (!verdict.ok) {
  console.error("");
  console.error("  REFUSED — the reset target is not a test database.");
  console.error("");
  console.error(`  ${verdict.reason}`);
  console.error("");
  console.error("  Automated tests are not allowed to use the AXIS operational");
  console.error("  development database, and neither is this tool.");
  console.error("");
  process.exit(1);
}

console.log("");
console.log(`  Target: ${verdict.name} @ ${verdict.host}:${verdict.port}`);

if (dryRun) {
  // Named explicitly so the meta-safety test can assert on it.
  console.log(`  DRY RUN — would reset ${verdict.name} and re-apply all migrations.`);
  console.log("");
  process.exit(0);
}

console.log("  Dropping the schema and re-applying every committed migration…");
console.log("");

try {
  // `migrate reset` re-runs the real committed migrations — never `db push`, so the
  // test database keeps proving that production migrations apply from zero.
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: target },
  });
  console.log("");
  console.log(`  ${verdict.name} reset and migrated.`);
  console.log("");
} catch (error) {
  console.error("  Reset failed.");
  process.exit(typeof error?.status === "number" ? error.status : 1);
}
