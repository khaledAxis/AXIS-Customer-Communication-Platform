import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  OPERATIONAL_DATABASE_NAME,
  TEST_DATABASE_NAME,
  assertTestDatabaseTarget,
  databaseNameOf,
  describeDatabaseTarget,
  isTestDatabaseName,
} from "../../src/domain/infra/databaseTarget";
import {
  QA_HARD_PER_RECIPIENT,
  QA_HARD_TOTAL,
} from "../../src/domain/send/qaPolicy";
import { getPrisma, resolveDatabaseUrl } from "../../src/server/db/prisma";
import * as ledger from "../../src/server/db/repositories/qaLedgerRepository";

/**
 * Meta-safety: the test infrastructure itself (ADR-0029).
 *
 * Automated tests previously ran against `axis_ccp_dev` — mirrored Monday CRM, real
 * AXIS staff accounts, consent decisions, the QA send ledger — and a fixture cleanup
 * deleted live records from it.
 *
 * These tests do not check product behaviour. They check that the arrangement which
 * made that possible no longer exists: that a test process resolves to the test
 * database, that it CANNOT resolve to the operational one, and that the operational
 * database is genuinely untouched by a full run.
 *
 * The dev-database checks below open a SEPARATE, READ-ONLY connection. That is
 * deliberate and is the only place in the suite that looks at `axis_ccp_dev` — it
 * counts rows and never writes.
 */

const HAS_TEST_DB = !!process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!HAS_TEST_DB);

/** Read-only peek at the operational database, for preservation checks. */
async function devCounts(): Promise<Record<string, number> | null> {
  const devUrl = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("DATABASE_URL="))
    ?.slice("DATABASE_URL=".length)
    .replace(/^"|"$/g, "");
  if (!devUrl) return null;

  const client = new Client({ connectionString: devUrl });
  await client.connect();
  try {
    const rows: Record<string, number> = {};
    for (const table of [
      "Company",
      "Contact",
      "CommunicationAddress",
      "ContentSource",
      "ContentItem",
      "Campaign",
      "QaEmailRun",
      "QaEmailSend",
      "User",
    ]) {
      const result = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
      rows[table] = result.rows[0].n as number;
    }
    const qa = await client.query(
      `SELECT recipient, count(*)::int AS n FROM "QaEmailSend"
       WHERE origin = 'LIVE' AND state IN ('SENDING','ACCEPTED','UNCERTAIN')
       GROUP BY recipient`,
    );
    for (const row of qa.rows) rows[`QA:${row.recipient}`] = row.n as number;
    return rows;
  } finally {
    await client.end();
  }
}

d("test database isolation", () => {
  let baseline: Record<string, number> | null = null;

  beforeAll(async () => {
    baseline = await devCounts();
  });

  afterAll(async () => {
    await getPrisma().$disconnect();
  });

  // ------------------------------------------------ 1-3 which names are allowed

  it("1. accepts axis_ccp_test", () => {
    const verdict = assertTestDatabaseTarget(
      "postgresql://user:pw@localhost:5432/axis_ccp_test",
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.databaseName).toBe(TEST_DATABASE_NAME);
    expect(isTestDatabaseName("axis_ccp_test")).toBe(true);
    // Any *_test name is acceptable, so a CI runner can supply its own.
    expect(isTestDatabaseName("axis_ci_7f21_test")).toBe(true);
  });

  it("2. REJECTS axis_ccp_dev, by name, with a specific message", () => {
    const verdict = assertTestDatabaseTarget(
      "postgresql://user:pw@localhost:5432/axis_ccp_dev",
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problem).toBe("OPERATIONAL_DATABASE");
      expect(verdict.message).toMatch(/operational development database/i);
    }
    expect(isTestDatabaseName(OPERATIONAL_DATABASE_NAME)).toBe(false);
  });

  it("3. rejects arbitrary and production-looking databases", () => {
    for (const name of [
      "axis_ccp_prod",
      "axis_production",
      "postgres",
      "template1",
      "axis_ccp",
      "testing", // does not end in _test
      "test", // nor this
    ]) {
      const verdict = assertTestDatabaseTarget(
        `postgresql://u:p@db.internal:5432/${name}`,
      );
      expect(verdict.ok, `${name} must be refused`).toBe(false);
    }
  });

  it("4. fails closed on a missing or malformed configuration", () => {
    for (const value of [undefined, null, "", "   ", "not-a-url", "mysql://h/x_test"]) {
      const verdict = assertTestDatabaseTarget(value);
      expect(verdict.ok).toBe(false);
    }
    // A URL with no database name is refused rather than defaulted.
    const noName = assertTestDatabaseTarget("postgresql://u:p@localhost:5432/");
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.problem).toBe("NO_DATABASE_NAME");
  });

  // ------------------------------------------------ 5-6 which URL is used

  it("5. the test client resolves to TEST_DATABASE_URL", () => {
    const resolved = resolveDatabaseUrl();
    expect(resolved).toBe(process.env.TEST_DATABASE_URL);
    expect(databaseNameOf(resolved)).toBe(TEST_DATABASE_NAME);
  });

  it("5b. the live connection really is the test database", async () => {
    const result = await getPrisma().$queryRawUnsafe<{ db: string }[]>(
      "SELECT current_database() AS db",
    );
    expect(result[0].db).toBe(TEST_DATABASE_NAME);
    expect(result[0].db).not.toBe(OPERATIONAL_DATABASE_NAME);
  });

  it("6. the app path still uses DATABASE_URL outside the test runner", () => {
    // The resolution function branches on the runner, and the non-test branch reads
    // DATABASE_URL. Asserted against the source, since this process is a test.
    const source = readFileSync("src/server/db/prisma.ts", "utf8");
    expect(source).toMatch(/if \(inTestRunner\(\)\)/);
    expect(source).toMatch(/process\.env\.TEST_DATABASE_URL/);
    expect(source).toMatch(/const connectionString = process\.env\.DATABASE_URL/);
    // And there is no silent fallback from the test branch to DATABASE_URL.
    const testBranch = source.slice(
      source.indexOf("if (inTestRunner())"),
      source.indexOf("const connectionString = process.env.DATABASE_URL"),
    );
    // A bare `process.env.DATABASE_URL` — the fallback that must not exist. The
    // branch legitimately mentions TEST_DATABASE_URL, which contains that substring.
    expect(testBranch).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  it("6b. the operational URL is removed from the test process entirely", () => {
    // Not merely overridden: any code reaching for the operational database finds the
    // test one, never axis_ccp_dev.
    expect(databaseNameOf(process.env.DATABASE_URL)).not.toBe(
      OPERATIONAL_DATABASE_NAME,
    );
  });

  // ------------------------------------------------ 7 cleanup stays in test

  it("7. fixture cleanup touches the test database only", async () => {
    const owner = `iso-${randomUUID().slice(0, 10)}`;
    const run = await ledger.createRun({
      label: "isolation fixture",
      origin: "TEST_FIXTURE",
      fixtureOwner: owner,
    });
    await ledger.createSend({
      runId: run.id,
      origin: "TEST_FIXTURE",
      fixtureOwner: owner,
      recipient: "khaled-s@axis-gps.com",
      subject: "[AXIS Newsletter Platform TEST] iso",
      scenarioId: "QA-BASIC-EN",
      purpose: "isolation",
      provider: "FAKE_QA",
    });

    const removed = await ledger.deleteFixtures(owner);
    expect(removed.sends).toBe(1);
    expect(removed.runs).toBe(1);

    // The dev database never saw any of it.
    const dev = await devCounts();
    if (dev && baseline) expect(dev.QaEmailSend).toBe(baseline.QaEmailSend);
  });

  // ------------------------------------------------ 8-12 dev data preservation

  it("8. the development QA ledger is untouched by this test run", async () => {
    const dev = await devCounts();
    if (!dev || !baseline) return;

    // Measured against the baseline taken at the start of THIS run, not against a
    // hard-coded total. The claim is invariance — "a test run never moves the
    // operational ledger" — and a fixed number would make a legitimate live QA send
    // look like an isolation breach while proving nothing extra.
    expect(dev.QaEmailSend).toBe(baseline.QaEmailSend);
    for (const recipient of [
      "khaled-s@axis-gps.com",
      "moaawya@axis-gps.com",
      "info@axis-gps.com",
      "saja@axis-gps.com",
    ]) {
      expect(dev[`QA:${recipient}`], recipient).toBe(baseline[`QA:${recipient}`]);
    }

    // The caps still mean something: the operational ledger holds only live rows, and
    // every one of them is inside the hard limits.
    expect(dev.QaEmailSend).toBeLessThanOrEqual(QA_HARD_TOTAL);
    for (const recipient of [
      "khaled-s@axis-gps.com",
      "moaawya@axis-gps.com",
      "info@axis-gps.com",
      "saja@axis-gps.com",
    ]) {
      expect(dev[`QA:${recipient}`], recipient).toBeLessThanOrEqual(
        QA_HARD_PER_RECIPIENT,
      );
    }
  });

  it("9+10+11. development CRM, content and campaign counts are unchanged", async () => {
    const dev = await devCounts();
    if (!dev || !baseline) return;

    for (const table of [
      "Company",
      "Contact",
      "CommunicationAddress",
      "ContentSource",
      "ContentItem",
      "Campaign",
      "QaEmailRun",
      "User",
    ]) {
      expect(dev[table], `${table} must be unchanged in axis_ccp_dev`).toBe(
        baseline[table],
      );
    }
  });

  it("11b. a fixture created here never appears in the development database", async () => {
    const owner = `leak-${randomUUID().slice(0, 10)}`;
    const marker = `leak-check-${randomUUID().slice(0, 8)}@axis-gps.com`;

    const run = await ledger.createRun({
      label: `leak check ${owner}`,
      origin: "TEST_FIXTURE",
      fixtureOwner: owner,
    });

    // The dev database has no row with this run's label.
    const devUrl = readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith("DATABASE_URL="))
      ?.slice("DATABASE_URL=".length)
      .replace(/^"|"$/g, "");

    if (devUrl) {
      const client = new Client({ connectionString: devUrl });
      await client.connect();
      try {
        const found = await client.query(
          `SELECT count(*)::int AS n FROM "QaEmailRun" WHERE label = $1`,
          [`leak check ${owner}`],
        );
        expect(found.rows[0].n).toBe(0);
      } finally {
        await client.end();
      }
    }

    void marker;
    await ledger.deleteFixtures(owner);
    void run;
  });

  it("12. no operational data was copied into the test database", async () => {
    const prisma = getPrisma();

    // The operational database holds three named content sources and a recovered QA
    // ledger. Neither was cloned — the test database gets schema and migrations only,
    // never customer or QA data (ADR-0029). Fixtures created BY tests are expected and
    // are not what this checks.
    const operationalSources = await prisma.contentSource.count({
      where: { name: { in: ["Trimble Mediaroom", "NavVis", "Spectra Geospatial"] } },
    });
    expect(operationalSources).toBe(0);

    // Matched on the recovery note the real script writes — a synthetic row seeded by
    // another suite carries none, so the two cannot be confused.
    const recoveredLedger = await prisma.qaEmailSend.count({
      where: { recoveryNote: { contains: "Reconstructed from the recorded output" } },
    });
    expect(recoveredLedger).toBe(0);

    // No real AXIS staff account was copied across.
    const realStaff = await prisma.user.count({
      where: { email: { endsWith: "@axis-gps.com" } },
    });
    expect(realStaff).toBe(0);
  });

  // ------------------------------------------------ 13-14 reset tool

  it("13. the reset tool refuses the operational database", () => {
    let combined = "";
    let exitCode = 0;
    try {
      combined = execSync(
        `node scripts/reset-test-db.mjs --url "postgresql://u:p@localhost:5432/axis_ccp_dev" --dry-run 2>&1`,
        { encoding: "utf8" },
      );
    } catch (error) {
      // Refusal exits non-zero, which is the point.
      const failure = error as { status?: number; stdout?: string };
      exitCode = failure.status ?? 1;
      combined = failure.stdout ?? "";
    }
    expect(exitCode).not.toBe(0);
    expect(combined).toMatch(/REFUSED/);
    expect(combined).toMatch(/operational development database/i);
  });

  it("14. the reset tool accepts the test database", () => {
    const output = execSync(
      `node scripts/reset-test-db.mjs --url "postgresql://u:p@localhost:5432/axis_ccp_test" --dry-run`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(output).toMatch(/would reset/i);
    expect(output).toMatch(/axis_ccp_test/);
  });

  // ------------------------------------------------ 15-17 no live providers

  it("15+16+17. no live email adapter can be constructed under the test runner", async () => {
    const email = await import("../../src/server/integrations/email");
    const qaProvider = await import(
      "../../src/server/integrations/email/qaEmailProvider"
    );

    email.setEmailProviderForTesting(undefined);
    email.setProductionEmailProviderForTesting(undefined);
    qaProvider.setQaEmailProviderForTesting(undefined);

    // Gmail SAFE TEST
    expect(email.liveProvidersPermitted()).toBe(false);
    expect(email.getEmailProvider().checkConfiguration().configured).toBe(false);
    // Resend production
    expect(email.getProductionEmailProvider().name).toBe("DISABLED");
    // QA Gmail
    expect(qaProvider.getQaEmailProvider().name).toBe("FAKE_QA");
    await expect(
      qaProvider.getQaEmailProvider().send({
        to: "khaled-s@axis-gps.com",
        subject: "[AXIS Newsletter Platform TEST] x",
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/attempted to send a real QA email/i);
  });

  it("17b. Monday needs no credentials and stays read-only in tests", () => {
    // A test never needs an operational secret; the CRM port is query-only.
    const source = readFileSync(
      "src/server/integrations/crm/mondayCrmSource.ts",
      "utf8",
    );
    expect(source).not.toMatch(/mutation\s+\w*\s*\{/i);
    expect(source).not.toMatch(/change_column_value|create_item|delete_item/i);
  });

  // ------------------------------------------------ 18-20 QA protections intact

  it("18. fixture cleanup is still scoped, even in a test database", async () => {
    await expect(ledger.deleteFixtures("")).rejects.toThrow(/non-empty fixture owner/i);

    const source = readFileSync(
      "src/server/db/repositories/qaLedgerRepository.ts",
      "utf8",
    );
    // Defence in depth survives the move to a dedicated database.
    expect(source).toContain('origin: "TEST_FIXTURE"');
    expect(source).not.toMatch(/deleteMany\(\s*\{\s*\}\s*\)/);
  });

  it("19. automated tests cannot create a QA LIVE record", async () => {
    await expect(
      ledger.createRun({ label: "illegal", origin: "LIVE" }),
    ).rejects.toThrow(/may not create LIVE QA records/i);
  });

  it("20. a TEST_FIXTURE record cannot become LIVE by accident", async () => {
    const owner = `promote-${randomUUID().slice(0, 8)}`;
    const run = await ledger.createRun({
      label: "promotion check",
      origin: "TEST_FIXTURE",
      fixtureOwner: owner,
    });
    const send = await ledger.createSend({
      runId: run.id,
      origin: "TEST_FIXTURE",
      fixtureOwner: owner,
      recipient: "info@axis-gps.com",
      subject: "[AXIS Newsletter Platform TEST] x",
      scenarioId: "QA-BASIC-EN",
      purpose: "x",
      provider: "FAKE_QA",
    });

    // The repository exposes no promotion path at all: `recordResult` writes only
    // state and provider fields, and there is no `setOrigin`.
    const source = readFileSync(
      "src/server/db/repositories/qaLedgerRepository.ts",
      "utf8",
    );
    expect(source).not.toMatch(/origin:\s*input\.newOrigin|setOrigin|promoteTo/);

    const after = await getPrisma().qaEmailSend.findUniqueOrThrow({
      where: { id: send.id },
    });
    expect(after.origin).toBe("TEST_FIXTURE");
    expect(after.fixtureOwner).toBe(owner);

    await ledger.deleteFixtures(owner);
  });

  it("reports a credential-free description of the target", () => {
    const description = describeDatabaseTarget(process.env.TEST_DATABASE_URL);
    expect(description).toContain(TEST_DATABASE_NAME);
    // Built from host/port/name only, so it cannot carry a credential. The "@" in
    // "name @ host:port" is formatting, not a userinfo separator.
    expect(description).not.toMatch(/postgres(ql)?:\/\//i);
    expect(description).not.toMatch(/password|:[^\s]*@[^\s]*:/i);
  });
});
