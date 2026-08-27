import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPrisma } from "../../src/server/db/prisma";
import * as ledger from "../../src/server/db/repositories/qaLedgerRepository";
import { setQaFixtureOwnerForTesting } from "../../src/server/db/repositories/qaLedgerRepository";
import * as review from "../../src/server/services/qaReviewService";
import { actAs, actAsNobody, clearTestActor, createTestUser, type TestUser } from "../support/actor";

/**
 * Manual rendering review (ADR-0030).
 *
 * The point of these tests is what reviewing CANNOT do: it cannot send, cannot resend,
 * cannot alter the send ledger, and cannot change the quota computed from it. A review
 * is somebody writing down what they saw in an inbox.
 *
 * `NOT_CHECKED` must also stay honest — a checklist nobody filled in must never read
 * as a pass.
 */

const HAS_DB = !!process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const OWNER = `qa-review-${randomUUID().slice(0, 12)}`;

d("QA rendering review", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let reviewer: TestUser;
  const syntheticRunIds: string[] = [];

  /**
   * A synthetic LIVE row, seeded through SQL because the repository refuses LIVE
   * writes under the test runner (ADR-0029). Reviews attach to LIVE messages.
   */
  const seedLiveMessage = async (recipient: string, scenarioId: string) => {
    const runId = `review-run-${randomUUID()}`;
    const sendId = `review-send-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QaEmailRun" ("id","label","status","origin","plannedCount","createdAt","updatedAt")
       VALUES ($1,$2,'CLOSED','LIVE',1,NOW(),NOW())`,
      runId,
      `synthetic review ${OWNER}`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QaEmailSend"
         ("id","runId","origin","recipient","subject","scenarioId","purpose","provider",
          "providerMessageId","state","requestedAt","acceptedAt","ledgerRecovered","createdAt")
       VALUES ($1,$2,'LIVE',$3,$4,$5,'synthetic','SYNTHETIC_TEST',$6,'ACCEPTED',NOW(),NOW(),false,NOW())`,
      sendId,
      runId,
      recipient,
      "[AXIS Newsletter Platform TEST] synthetic review",
      scenarioId,
      `<review-${sendId}@axis.test>`,
    );
    syntheticRunIds.push(runId);
    return sendId;
  };

  beforeAll(async () => {
    reviewer = await createTestUser({ prefix: "qarev", role: "MANAGER" });
    prisma = getPrisma();
    await prisma.$connect();
    setQaFixtureOwnerForTesting(OWNER);
  });

  beforeEach(() => {
    actAs(reviewer);
  });

  afterAll(async () => {
    clearTestActor();
    setQaFixtureOwnerForTesting(undefined);
    try {
      await prisma.qaReviewCheck.deleteMany({
        where: { send: { runId: { in: syntheticRunIds } } },
      });
      await prisma.qaEmailSend.deleteMany({ where: { runId: { in: syntheticRunIds } } });
      await prisma.qaEmailRun.deleteMany({ where: { id: { in: syntheticRunIds } } });
      await prisma.user.deleteMany({ where: { id: reviewer.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("builds a checklist from the scenario's own inspection list", async () => {
    const sendId = await seedLiveMessage("khaled-s@axis-gps.com", "QA-HE-RTL");
    const board = await review.getReviewBoard();

    const message = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId);

    expect(message).toBeDefined();
    expect(message!.checks.length).toBeGreaterThan(0);
    // The words written when the scenario was designed.
    expect(message!.checks.map((check) => check.label).join(" ")).toMatch(
      /right-aligned|mirrored/i,
    );
  });

  it("defaults every check to NOT_CHECKED, never to a pass", async () => {
    const sendId = await seedLiveMessage("saja@axis-gps.com", "QA-CTA");
    const board = await review.getReviewBoard();
    const message = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!;

    expect(message.checks.every((check) => check.status === "NOT_CHECKED")).toBe(true);
    expect(message.summary.passed).toBe(0);
    expect(message.summary.notChecked).toBe(message.summary.total);
  });

  it("records a PASS and a FAIL with severity and note", async () => {
    const sendId = await seedLiveMessage("info@axis-gps.com", "QA-FOOTER");
    const board = await review.getReviewBoard();
    const message = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!;

    await review.recordReviewCheck({
      sendId,
      checkKey: message.checks[0].checkKey,
      status: "PASS",
    });
    await review.recordReviewCheck({
      sendId,
      checkKey: message.checks[1].checkKey,
      status: "FAIL",
      severity: "HIGH",
      note: "Second unsubscribe link visible in Outlook.",
    });

    const after = (await review.getReviewBoard()).byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!;

    expect(after.summary.passed).toBe(1);
    expect(after.summary.failed).toBe(1);
    expect(after.worstSeverity).toBe("HIGH");
    expect(after.checks[1].note).toMatch(/Outlook/);
    expect(after.checks[1].reviewedByEmail).toBe(reviewer.email);
  });

  it("clears severity when a check stops failing", async () => {
    const sendId = await seedLiveMessage("moaawya@axis-gps.com", "QA-AR-RTL");
    const board = await review.getReviewBoard();
    const key = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!.checks[0].checkKey;

    await review.recordReviewCheck({ sendId, checkKey: key, status: "FAIL", severity: "CRITICAL" });
    await review.recordReviewCheck({ sendId, checkKey: key, status: "PASS", severity: "CRITICAL" });

    const after = (await review.getReviewBoard()).byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!;

    // A stale CRITICAL attached to a passing check would misreport the closure state.
    expect(after.checks[0].status).toBe("PASS");
    expect(after.checks[0].severity).toBeNull();
    expect(after.worstSeverity).toBeNull();
  });

  it("re-reviewing updates the verdict instead of stacking rows", async () => {
    const sendId = await seedLiveMessage("khaled-s@axis-gps.com", "QA-BASIC-EN");
    const board = await review.getReviewBoard();
    const key = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!.checks[0].checkKey;

    await review.recordReviewCheck({ sendId, checkKey: key, status: "PASS" });
    await review.recordReviewCheck({ sendId, checkKey: key, status: "FAIL", severity: "LOW" });

    const rows = await prisma.qaReviewCheck.count({ where: { sendId, checkKey: key } });
    expect(rows).toBe(1);
  });

  it("refuses a check that does not belong to the message", async () => {
    const sendId = await seedLiveMessage("info@axis-gps.com", "QA-BASIC-EN");
    const result = await review.recordReviewCheck({
      sendId,
      checkKey: "QA-AR-RTL#0",
      status: "PASS",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an invalid status", async () => {
    const sendId = await seedLiveMessage("saja@axis-gps.com", "QA-BASIC-EN");
    const board = await review.getReviewBoard();
    const key = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!.checks[0].checkKey;

    const result = await review.recordReviewCheck({ sendId, checkKey: key, status: "MAYBE" });
    expect(result.ok).toBe(false);
  });

  it("NEVER alters the send ledger or the quota", async () => {
    const sendId = await seedLiveMessage("khaled-s@axis-gps.com", "QA-IMAGES");
    // Scoped to the run this test seeded — a GLOBAL count races with parallel workers.
    const runId = syntheticRunIds[syntheticRunIds.length - 1];
    const afterSeed = await ledger.countLiveSends(runId);

    const board = await review.getReviewBoard();
    const message = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!;

    const snapshot = await prisma.qaEmailSend.findUniqueOrThrow({ where: { id: sendId } });

    for (const check of message.checks) {
      await review.recordReviewCheck({ sendId, checkKey: check.checkKey, status: "PASS" });
    }

    const after = await prisma.qaEmailSend.findUniqueOrThrow({ where: { id: sendId } });

    // Reviewing changed nothing about what was sent.
    expect(after.state).toBe(snapshot.state);
    expect(after.providerMessageId).toBe(snapshot.providerMessageId);
    expect(after.acceptedAt?.toISOString()).toBe(snapshot.acceptedAt?.toISOString());
    expect(after.recipient).toBe(snapshot.recipient);
    // And nothing about the quota beyond the row this test seeded.
    expect((await ledger.countLiveSends(runId)).total).toBe(afterSeed.total);
    expect(afterSeed.total).toBe(1);
  });

  it("requires an authenticated actor", async () => {
    actAsNobody();
    await expect(review.getReviewBoard()).rejects.toThrow();
    await expect(
      review.recordReviewCheck({ sendId: "x", checkKey: "y", status: "PASS" }),
    ).rejects.toThrow();
  });

  it("the review service cannot send anything", () => {
    const source = readFileSync("src/server/services/qaReviewService.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const forbidden of [
      "getQaEmailProvider",
      "getEmailProvider",
      "getProductionEmailProvider",
      "sendQaEmail",
      "nodemailer",
      "resend",
      "assertSafeQaEnvelope",
    ]) {
      expect(source.toLowerCase(), `must not reference ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
    // It writes to the review table only — never to the ledger.
    expect(source).not.toContain("qaEmailSend.update");
    expect(source).not.toContain("qaEmailSend.create");
    expect(source).not.toContain("qaEmailSend.delete");
  });

  it("the review page offers no send control", () => {
    const page = readFileSync("src/app/admin/qa-email/review/page.tsx", "utf8");
    expect(page).not.toContain("sendQaEmailAction");
    expect(page).not.toContain('name="recipient"');
    expect(page).not.toContain('name="scenarioId"');
  });

  it("lists defects worst-first", async () => {
    const sendId = await seedLiveMessage("moaawya@axis-gps.com", "QA-MULTI-AR");
    const board = await review.getReviewBoard();
    const checks = board.byRecipient
      .flatMap((group) => group.messages)
      .find((candidate) => candidate.sendId === sendId)!.checks;

    await review.recordReviewCheck({
      sendId,
      checkKey: checks[0].checkKey,
      status: "FAIL",
      severity: "LOW",
    });
    await review.recordReviewCheck({
      sendId,
      checkKey: checks[1].checkKey,
      status: "FAIL",
      severity: "CRITICAL",
    });

    const defects = (await review.listDefects()).filter(
      (defect) => defect.sendId === sendId,
    );
    expect(defects[0].severity).toBe("CRITICAL");
    expect(defects[1].severity).toBe("LOW");
  });
});
