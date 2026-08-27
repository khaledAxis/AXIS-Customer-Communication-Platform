/**
 * Applies every committed migration to the AXIS TEST database (ADR-0029).
 *
 * Uses `prisma migrate deploy` — the deterministic path — never `db push`, so the test
 * database keeps proving that the real production migrations apply from zero. Refuses
 * any target that is not a test database, exactly like the reset tool.
 */
import { execSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const target = process.env.TEST_DATABASE_URL;
const name = (() => {
  try {
    return new URL(target ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!name || (name !== "axis_ccp_test" && !name.endsWith("_test"))) {
  console.error("");
  console.error("  REFUSED — TEST_DATABASE_URL must name a test database.");
  console.error("  Automated tests are not allowed to use the AXIS operational development database.");
  console.error("");
  process.exit(1);
}

console.log(`  Applying committed migrations to ${name}…`);
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: target },
});
