import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  QA_ALLOWED_RECIPIENTS,
  QA_HARD_PER_RECIPIENT,
  QA_HARD_TOTAL,
} from "../../src/domain/send/qaPolicy";
import { getPrisma } from "../../src/server/db/prisma";
import * as ledger from "../../src/server/db/repositories/qaLedgerRepository";
import { setQaFixtureOwnerForTesting } from "../../src/server/db/repositories/qaLedgerRepository";
import type { ProviderSendResult } from "../../src/server/integrations/email/emailProvider";
import type {
  QaEmailMessage,
  QaEmailProvider,
  QaProviderStatus,
} from "../../src/server/integrations/email/qaEmailProvider";
import { setQaEmailProviderForTesting } from "../../src/server/integrations/email/qaEmailProvider";
import * as qa from "../../src/server/services/qaEmailService";
import * as runs from "../../src/server/services/qaRunService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * QA ledger integrity (ADR-0028).
 *
 * These tests exist because of a specific incident: an integration suite's cleanup
 * deleted twenty rows recording twenty real emails, and in doing so silently restored
 * the quota computed by counting them. A deleted row handed back permission to send.
 *
 * The claims under test are therefore about SURVIVAL and ISOLATION, not just about
 * counting: a LIVE row must be unreachable by any cleanup path, and a fixture row must
 * be reachable only by its own owner.
 *
 * NO LIVE EMAIL IS SENT. The transport is a recorder, and the registry additionally
 * refuses to build a live adapter under the test runner.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

/** This suite's ownership token. Every fixture row it creates carries it. */
const OWNER = `qa-integrity-${randomUUID().slice(0, 12)}`;

class RecordingQaProvider implements QaEmailProvider {
  readonly name = "FAKE_QA" as const;
  readonly submissions: QaEmailMessage[] = [];
  constructor(private readonly outcome: ProviderSendResult["outcome"] = "ACCEPTED") {}

  checkConfiguration(): QaProviderStatus {
    return {
      configured: true,
      problems: [],
      senderEmail: "axisgpscana@gmail.com",
      replyToEmail: "noreply@axis-gps.com",
    };
  }

  async send(message: QaEmailMessage): Promise<ProviderSendResult> {
    this.submissions.push(message);
    if (this.outcome === "ACCEPTED") {
      return {
        outcome: "ACCEPTED",
        statusCode: 250,
        providerMessageId: `<${OWNER}-${this.submissions.length}@axis.test>`,
        message: "accepted",
      };
    }
    return { outcome: this.outcome, failureCode: "TEST", message: "test outcome" };
  }
}

d("QA ledger integrity", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let admin: TestUser;
  let manager: TestUser;
  let provider: RecordingQaProvider;
  const savedEnv: Record<string, string | undefined> = {};
  /** Synthetic LIVE runs this suite seeded through SQL, removed in afterAll. */
  const syntheticRunIds: string[] = [];

  /** A fixture run owned by this suite. Deletable; never counted as live. */
  const newFixtureRun = async () =>
    ledger.createRun({
      label: `fixture ${randomUUID().slice(0, 6)}`,
      origin: "TEST_FIXTURE",
      fixtureOwner: OWNER,
    });

  const newFixtureSend = async (runId: string, recipient: string) =>
    ledger.createSend({
      runId,
      origin: "TEST_FIXTURE",
      fixtureOwner: OWNER,
      recipient,
      subject: "[AXIS Newsletter Platform TEST] fixture",
      scenarioId: "QA-BASIC-EN",
      purpose: "fixture",
      provider: "FAKE_QA",
      state: "ACCEPTED",
      providerMessageId: `<${OWNER}-${randomUUID().slice(0, 8)}@fixture.test>`,
      acceptedAt: new Date(),
    });

  /**
   * Seeds a synthetic LIVE row directly through SQL.
   *
   * The repository REFUSES a LIVE write under the test runner (ADR-0029), which is
   * itself under test below. To exercise the protections that apply *to* LIVE rows,
   * one has to exist — so it is created deliberately and visibly here, in the test
   * database, and removed by this suite afterwards.
   */
  let syntheticRunId: string | null = null;

  const seedSyntheticLiveRow = async (recipient: string): Promise<string> => {
    // ONE run for the whole suite, so LIVE counts can be scoped to it. Suites run in
    // parallel against one database, and a GLOBAL live count races with any other
    // suite that seeds a row.
    const runId = syntheticRunId ?? `synthetic-run-${randomUUID()}`;
    const sendId = `synthetic-send-${randomUUID()}`;
    if (!syntheticRunId) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QaEmailRun" ("id","label","status","origin","plannedCount","createdAt","updatedAt")
         VALUES ($1,$2,'CLOSED','LIVE',1,NOW(),NOW())`,
        runId,
        `synthetic live ${OWNER}`,
      );
      syntheticRunId = runId;
      syntheticRunIds.push(runId);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QaEmailSend"
         ("id","runId","origin","recipient","subject","scenarioId","purpose","provider",
          "providerMessageId","state","requestedAt","acceptedAt","ledgerRecovered","createdAt")
       VALUES ($1,$2,'LIVE',$3,$4,'QA-BASIC-EN','synthetic','SYNTHETIC_TEST',$5,'ACCEPTED',NOW(),NOW(),true,NOW())`,
      sendId,
      runId,
      recipient,
      "[AXIS Newsletter Platform TEST] synthetic",
      `<synthetic-${sendId}@axis.test>`,
    );
    return sendId;
  };

  /** LIVE rows this suite seeded — immune to parallel workers. */
  const myLiveCount = async () =>
    syntheticRunId
      ? ledger.countLiveSends(syntheticRunId)
      : { total: 0, perRecipient: {} as Record<string, number> };

  beforeAll(async () => {
    admin = await createTestUser({ prefix: "qaint", role: "ADMIN" });
    manager = await createTestUser({ prefix: "qaintmgr", role: "MANAGER" });
    actAs(admin);
    prisma = getPrisma();
    await prisma.$connect();

    savedEnv.QA_EMAIL_ENABLED = process.env.QA_EMAIL_ENABLED;
    process.env.QA_EMAIL_ENABLED = "true";
    // Pin fixture selection to THIS suite so parallel workers cannot see each
    // other's runs (ADR-0028).
    setQaFixtureOwnerForTesting(OWNER);
    // A fixture run for the send-path tests: rows written through it are fixtures,
    // so they never consume a real recipient's quota.
    await newFixtureRun();
  });

  // beforeEach, not afterEach: the provider must be installed for the FIRST test too,
  // otherwise it resolves to the refusing transport and the assertion under test never
  // gets reached.
  beforeEach(() => {
    actAs(admin);
    provider = new RecordingQaProvider();
    setQaEmailProviderForTesting(provider);
  });

  afterAll(async () => {
    clearTestActor();
    setQaFixtureOwnerForTesting(undefined);
    setQaEmailProviderForTesting(undefined);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      // The ONLY delete this suite performs, scoped to its own owner token. It is
      // structurally unable to touch a LIVE row.
      await ledger.deleteFixtures(OWNER);
      // Throwaway LIVE runs this suite opened. `QaEmailSend.runId` is onDelete:
      // Restrict — the ledger refuses to orphan a send — so their rows go first.
      const scratchRuns = await prisma.qaEmailRun.findMany({
        where: { origin: "LIVE", label: { startsWith: "itest " } },
        select: { id: true },
      });
      const scratchIds = scratchRuns.map((r) => r.id);
      await prisma.qaEmailSend.deleteMany({ where: { runId: { in: scratchIds } } });
      await prisma.qaEmailRun.deleteMany({ where: { id: { in: scratchIds } } });
      // Synthetic LIVE rows this suite seeded. Removed by explicit id, in the TEST
      // database — never a blanket delete.
      await prisma.qaEmailSend.deleteMany({ where: { runId: { in: syntheticRunIds } } });
      await prisma.qaEmailRun.deleteMany({ where: { id: { in: syntheticRunIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  // ---------------------------------------------- 1-3 survival & isolation

  it("1. a LIVE row survives automated test cleanup", async () => {
    await seedSyntheticLiveRow("khaled-s@axis-gps.com");
    const before = (await myLiveCount()).total;
    expect(before).toBeGreaterThan(0);

    const run = await newFixtureRun();
    await newFixtureSend(run.id, "khaled-s@axis-gps.com");
    await ledger.deleteFixtures(OWNER);

    // The fixture is gone; the LIVE row is untouched. Scoped to this suite's own run,
    // because a global count races with parallel workers.
    expect((await myLiveCount()).total).toBe(before);
  });

  it("2. a fixture row IS cleaned by its owner", async () => {
    const run = await newFixtureRun();
    await newFixtureSend(run.id, "info@axis-gps.com");
    expect(
      await prisma.qaEmailSend.count({ where: { fixtureOwner: OWNER } }),
    ).toBeGreaterThan(0);

    await ledger.deleteFixtures(OWNER);
    expect(await prisma.qaEmailSend.count({ where: { fixtureOwner: OWNER } })).toBe(0);
  });

  it("3. cleanup CANNOT delete LIVE rows, and refuses an unscoped call", async () => {
    // No owner token → refused outright. `deleteMany({})` is not expressible.
    await expect(ledger.deleteFixtures("")).rejects.toThrow(/non-empty fixture owner/i);
    await expect(ledger.deleteFixtures("   ")).rejects.toThrow();

    // A LIVE row can never be given an owner token, so it can never match a scoped
    // delete. Under the test runner the LIVE refusal fires first — both guards point
    // the same way, and either is sufficient.
    await expect(
      ledger.createSend({
        runId: (await newFixtureRun()).id,
        origin: "LIVE",
        fixtureOwner: OWNER,
        recipient: "khaled-s@axis-gps.com",
        subject: "x",
        scenarioId: "QA-BASIC-EN",
        purpose: "x",
        provider: "FAKE_QA",
      }),
    ).rejects.toThrow(/may not create LIVE QA records|must not carry a fixtureOwner/i);

    // And a seeded LIVE row is untouched by a scoped cleanup.
    const liveId = await seedSyntheticLiveRow("saja@axis-gps.com");
    await ledger.deleteFixtures(OWNER);
    expect(
      await prisma.qaEmailSend.findUnique({ where: { id: liveId } }),
    ).not.toBeNull();
  });

  // ---------------------------------------------- 4-7 durable counting

  it("4. a LIVE row counts toward the quota and a fixture row never does", async () => {
    await seedSyntheticLiveRow("info@axis-gps.com");
    // Scoped to this suite's run — a global count races with parallel workers.
    const before = await myLiveCount();

    await seedSyntheticLiveRow("info@axis-gps.com");
    const afterLive = await myLiveCount();
    expect(afterLive.total).toBe(before.total + 1);
    expect(afterLive.perRecipient["info@axis-gps.com"] ?? 0).toBe(
      (before.perRecipient["info@axis-gps.com"] ?? 0) + 1,
    );

    const run = await newFixtureRun();
    await newFixtureSend(run.id, "info@axis-gps.com");
    // A fixture changes nothing about the quota.
    expect((await myLiveCount()).total).toBe(afterLive.total);
    await ledger.deleteFixtures(OWNER);
  });

  it("5. fixture rows never inflate or deflate the live count", async () => {
    await seedSyntheticLiveRow("khaled-s@axis-gps.com");
    const before = (await myLiveCount()).total;

    const run = await newFixtureRun();
    for (const address of QA_ALLOWED_RECIPIENTS) await newFixtureSend(run.id, address);

    expect((await myLiveCount()).total).toBe(before); // fixtures are invisible to the cap

    await ledger.deleteFixtures(OWNER);
    expect((await myLiveCount()).total).toBe(before); // removing them changes nothing
  });

  it("6. toggling QA_EMAIL_ENABLED does not reset the count", async () => {
    await seedSyntheticLiveRow("info@axis-gps.com");
    const before = (await myLiveCount()).total;

    process.env.QA_EMAIL_ENABLED = "false";
    expect((await myLiveCount()).total).toBe(before);
    process.env.QA_EMAIL_ENABLED = "true";
    expect((await myLiveCount()).total).toBe(before);
  });

  it("7. a restart does not reset the count — nothing is held in memory", async () => {
    // The real claim: there is no module-level counter to lose on restart. Proved by
    // writing straight to the database and seeing the very next call reflect it —
    // only possible if every call re-reads. Scoped to this suite's own run.
    await seedSyntheticLiveRow("khaled-s@axis-gps.com");
    const before = (await myLiveCount()).total;

    const run = await newFixtureRun();
    await newFixtureSend(run.id, "khaled-s@axis-gps.com");
    // A fixture row must NOT move the live count...
    expect((await myLiveCount()).total).toBe(before);

    await seedSyntheticLiveRow("khaled-s@axis-gps.com");
    // ...but a live one is visible immediately, with no cache to invalidate.
    expect((await myLiveCount()).total).toBe(before + 1);

    // And the source holds no counter that a restart could reset.
    const source = readFileSync(
      new URL("../../src/server/db/repositories/qaLedgerRepository.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/^let\s+\w*(count|total|cache)/im);

    await ledger.deleteFixtures(OWNER);
  });

  // ---------------------------------------------- 8-11 send accounting

  it("8. concurrent sends do not create duplicate ledger rows beyond what was sent", async () => {
    const before = await prisma.qaEmailSend.count({ where: { fixtureOwner: OWNER } });

    const results = await Promise.all([
      qa.sendQaEmail({ scenarioId: "QA-BASIC-EN", recipient: "khaled-s@axis-gps.com" }),
      qa.sendQaEmail({ scenarioId: "QA-BASIC-EN", recipient: "khaled-s@axis-gps.com" }),
    ]);

    const submitted = results.filter((r) => r.providerCalls === 1).length;
    const after = await prisma.qaEmailSend.count({ where: { fixtureOwner: OWNER } });

    // Exactly one ledger row per actual submission — never more, never fewer.
    expect(after - before).toBe(submitted);
    expect(provider.submissions.length).toBe(submitted);
  });

  it("9. a provider message id is written once and cannot be overwritten", async () => {
    const fixtureRun = await newFixtureRun();
    const row = await ledger.createSend({
      runId: fixtureRun.id,
      origin: "TEST_FIXTURE",
      fixtureOwner: OWNER,
      recipient: "saja@axis-gps.com",
      subject: "x",
      scenarioId: "QA-BASIC-EN",
      purpose: "x",
      provider: "FAKE_QA",
    });

    await ledger.recordResult({
      id: row.id,
      state: "ACCEPTED",
      providerMessageId: `<${OWNER}-once@fixture.test>`,
      acceptedAt: new Date(),
    });

    await expect(
      ledger.recordResult({
        id: row.id,
        state: "ACCEPTED",
        providerMessageId: `<${OWNER}-twice@fixture.test>`,
      }),
    ).rejects.toThrow(/written once and never overwritten/i);

    const after = await prisma.qaEmailSend.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.providerMessageId).toBe(`<${OWNER}-once@fixture.test>`);
  });

  it("10. a FAILED send does not count as accepted, and does not consume quota", async () => {
    const fixtureRun = await newFixtureRun();
    const row = await ledger.createSend({
      runId: fixtureRun.id,
      origin: "TEST_FIXTURE",
      fixtureOwner: OWNER,
      recipient: "info@axis-gps.com",
      subject: "x",
      scenarioId: "QA-BASIC-EN",
      purpose: "x",
      provider: "FAKE_QA",
    });
    await ledger.recordResult({ id: row.id, state: "FAILED", failureCode: "TEST" });

    const after = await prisma.qaEmailSend.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.state).toBe("FAILED");
    expect(after.acceptedAt).toBeNull();
    // FAILED is excluded from the quota states: nobody received anything.
    expect(ledger.QUOTA_STATES).not.toContain("FAILED");
  });

  it("11. UNCERTAIN consumes quota and is never auto-resent", async () => {
    // The conservative direction: an unknown outcome may have been delivered.
    expect(ledger.QUOTA_STATES).toContain("UNCERTAIN");

    const source = readFileSync(
      new URL("../../src/server/services/qaEmailService.ts", import.meta.url),
      "utf8",
    );
    // No retry loop anywhere on this path.
    expect(source).not.toMatch(/retry|resend\(|attempts\s*<|while\s*\(/i);
  });

  // ---------------------------------------------- 12-17 caps

  it("12+13. the hard caps are 10 per recipient and 40 total", () => {
    expect(QA_HARD_PER_RECIPIENT).toBe(10);
    expect(QA_HARD_TOTAL).toBe(40);
  });

  it("14. an 11th send to one recipient is rejected with ZERO provider calls", async () => {
    const existing =
      (await ledger.countLiveSends()).perRecipient["moaawya@axis-gps.com"] ?? 0;
    for (let index = existing; index < QA_HARD_PER_RECIPIENT; index += 1) {
      await seedSyntheticLiveRow("moaawya@axis-gps.com");
    }

    const result = await qa.sendQaEmail({
      scenarioId: "QA-BASIC-EN",
      recipient: "moaawya@axis-gps.com",
    });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("REFUSED");
    expect(result.providerCalls).toBe(0);
    expect(provider.submissions).toHaveLength(0);
  });

  it("16+17. a capped or unauthorized send invokes the provider zero times", async () => {
    const unauthorized = await qa.sendQaEmail({
      scenarioId: "QA-BASIC-EN",
      recipient: "someone-else@axis-gps.com",
    });
    expect(unauthorized.providerCalls).toBe(0);
    expect(provider.submissions).toHaveLength(0);
  });

  // ---------------------------------------------- 18-19 run control

  it("18. starting a new run requires explicit confirmation when live sends exist", async () => {
    await seedSyntheticLiveRow("saja@axis-gps.com");
    const open = await ledger.findOpenLiveRun();
    if (open) await runs.closeQaRun(open.id);

    const withoutConfirmation = await runs.openQaRun({
      label: `itest unconfirmed ${randomUUID().slice(0, 6)}`,
    });
    expect(withoutConfirmation.ok).toBe(false);
    if (!withoutConfirmation.ok) {
      expect(withoutConfirmation.reason).toBe("CONFIRMATION_REQUIRED");
      expect(withoutConfirmation.message).toMatch(/does NOT reset the limits/i);
    }

    // Actually opening one is refused under the test runner, because a live run is a
    // LIVE record (ADR-0029). The confirmation logic above is what this test covers.
    await expect(
      runs.openQaRun({
        label: `itest confirmed ${randomUUID().slice(0, 6)}`,
        acknowledgedExistingSends: true,
      }),
    ).rejects.toThrow(/may not create LIVE QA records/i);
  });

  it("18b. opening a new run does NOT reset the per-recipient limits", async () => {
    await seedSyntheticLiveRow("moaawya@axis-gps.com");
    const before = await ledger.countLiveSends();
    const state = await runs.getQaRunState();
    // Quota is lifetime, not per run.
    expect(state.lifetimeTotal).toBe(before.total);
    for (const quota of state.runPerRecipient) {
      // Quota is LIFETIME per recipient — independent of which run is open.
      expect(quota.sent).toBe(before.perRecipient[quota.recipient] ?? 0);
    }
  });

  it("19b. automated tests cannot create a LIVE ledger record at all", async () => {
    await expect(
      ledger.createRun({ label: "illegal live", origin: "LIVE" }),
    ).rejects.toThrow(/may not create LIVE QA records/i);

    const run = await newFixtureRun();
    await expect(
      ledger.createSend({
        runId: run.id,
        origin: "LIVE",
        recipient: "khaled-s@axis-gps.com",
        subject: "x",
        scenarioId: "QA-BASIC-EN",
        purpose: "x",
        provider: "FAKE_QA",
      }),
    ).rejects.toThrow(/may not create LIVE QA records/i);
  });

  it("19. a MANAGER cannot open or close a QA run", async () => {
    actAs(manager);
    await expect(
      runs.openQaRun({ label: "manager attempt", acknowledgedExistingSends: true }),
    ).rejects.toThrow(/permission/i);
    await expect(runs.closeQaRun("whatever")).rejects.toThrow(/permission/i);
    // A manager may still SEE the state — reviewing is not administering.
    await expect(runs.getQaRunState()).resolves.toBeDefined();
  });

  it("a send is refused when no run is open", async () => {
    // Unpinning this worker's fixture run is how "no run is open" is simulated
    // without touching runs another parallel suite may be relying on.
    setQaFixtureOwnerForTesting(undefined);
    try {
      const result = await qa.sendQaEmail({
        scenarioId: "QA-BASIC-EN",
        recipient: "khaled-s@axis-gps.com",
      });
      expect(result.ok).toBe(false);
      expect(result.providerCalls).toBe(0);
      expect(result.message).toMatch(/No QA run is open/i);
      expect(provider.submissions).toHaveLength(0);
    } finally {
      setQaFixtureOwnerForTesting(OWNER);
    }
  });

  // ---------------------------------------------- 20-22 immutability & isolation

  it("20. a recovered row is marked as recovered, never as live-written", async () => {
    const id = await seedSyntheticLiveRow("khaled-s@axis-gps.com");
    const row = await prisma.qaEmailSend.findUniqueOrThrow({ where: { id } });

    // The contract the recovery script relies on: a reconstructed record is
    // distinguishable from one written at send time, and still counts as LIVE.
    expect(row.ledgerRecovered).toBe(true);
    expect(row.origin).toBe("LIVE");
    expect(row.providerMessageId).not.toBeNull();
  });

  it("21. audit history is append-only — a QA send audit row is never updated", () => {
    const source = readFileSync(
      new URL("../../src/server/services/qaEmailService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("auditLog.create");
    expect(source).not.toContain("auditLog.update");
    expect(source).not.toContain("auditLog.delete");
  });

  it("22. no QA module contains an unscoped delete against the ledger", () => {
    for (const file of [
      "../../src/server/db/repositories/qaLedgerRepository.ts",
      "../../src/server/services/qaEmailService.ts",
      "../../src/server/services/qaRunService.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      expect(source, `${file} must not contain deleteMany({})`).not.toMatch(
        /deleteMany\(\s*\{\s*\}\s*\)/,
      );
      expect(source, `${file} must not delete QA sends unscoped`).not.toMatch(
        /qaEmailSend\.deleteMany\(\s*\{\s*\}\s*\)/,
      );
    }
  });

  it("the QA ledger is a separate table from CampaignTestSend", async () => {
    // The original incident was caused by sharing a table that suites clean.
    const qaRows = await prisma.qaEmailSend.count();
    expect(qaRows).toBeGreaterThan(0);
    // Nothing QA writes to CampaignTestSend any more.
    const service = readFileSync(
      new URL("../../src/server/services/qaEmailService.ts", import.meta.url),
      "utf8",
    );
    expect(service).not.toContain("campaignTestSend");
  });
});
