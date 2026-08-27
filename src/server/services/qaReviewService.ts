import "server-only";

import { QA_ALLOWED_RECIPIENTS } from "../../domain/send/qaPolicy";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { QA_SCENARIOS } from "./qaScenarios";

/**
 * Recording human rendering observations about ALREADY-SENT QA messages (ADR-0030).
 *
 * This service has no transport. It imports no provider, holds no recipient field, and
 * cannot cause a message to be sent or resent — reviewing is reading an inbox and
 * writing down what you saw. A test asserts that against the source.
 *
 * It also never writes to `QaEmailSend`. The ledger is the record of what was sent;
 * this is a record of what a person thought of it, and the two are kept apart so a
 * review can never alter send history or the quota computed from it.
 *
 * `NOT_CHECKED` is the default and is never inferred to be a pass. A checklist nobody
 * has filled in must read as unreviewed, not as clean.
 */

export type QaCheckStatus = "NOT_CHECKED" | "PASS" | "FAIL";
export type QaDefectSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "COSMETIC";

export interface QaReviewCheckView {
  checkKey: string;
  label: string;
  status: QaCheckStatus;
  severity: QaDefectSeverity | null;
  note: string | null;
  reviewedByEmail: string | null;
  reviewedAt: Date | null;
}

export interface QaMessageReview {
  sendId: string;
  recipient: string;
  subject: string;
  scenarioId: string;
  scenarioTitle: string;
  purpose: string;
  providerMessageId: string | null;
  acceptedAt: Date | null;
  ledgerRecovered: boolean;
  checks: QaReviewCheckView[];
  /** Rolled up from the checks. */
  summary: { passed: number; failed: number; notChecked: number; total: number };
  /** The worst severity among failed checks, or null. */
  worstSeverity: QaDefectSeverity | null;
}

export interface QaReviewBoard {
  byRecipient: { recipient: string; messages: QaMessageReview[] }[];
  totals: { messages: number; passed: number; failed: number; notChecked: number };
}

const SEVERITY_ORDER: QaDefectSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "COSMETIC",
];

/** A stable key for a check, derived from its position in the scenario's list. */
function checkKeyFor(scenarioId: string, index: number): string {
  return `${scenarioId}#${index}`;
}

/**
 * The checklist for a message.
 *
 * Reuses the `inspect` list already written for each scenario — the same words that
 * described what to look at when the message was designed, so the reviewer is answering
 * the question the test was built to ask.
 */
function checklistFor(scenarioId: string): { checkKey: string; label: string }[] {
  const scenario = QA_SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!scenario) return [];
  return scenario.inspect.map((label, index) => ({
    checkKey: checkKeyFor(scenarioId, index),
    label,
  }));
}

export async function getReviewBoard(): Promise<QaReviewBoard> {
  await requireCapability(Capability.SEND_TEST_EMAIL);
  const prisma = getPrisma();

  const sends = await prisma.qaEmailSend.findMany({
    where: { origin: "LIVE" },
    orderBy: [{ acceptedAt: "asc" }],
    include: {
      reviews: { include: { reviewedBy: { select: { email: true } } } },
    },
  });

  const messages: QaMessageReview[] = sends.map((send) => {
    const scenario = QA_SCENARIOS.find((candidate) => candidate.id === send.scenarioId);
    const recorded = new Map(send.reviews.map((review) => [review.checkKey, review]));

    const checks: QaReviewCheckView[] = checklistFor(send.scenarioId).map((item) => {
      const review = recorded.get(item.checkKey);
      return {
        checkKey: item.checkKey,
        // The snapshotted label when one exists, so an edited catalogue cannot
        // retroactively change what a reviewer approved.
        label: review?.label ?? item.label,
        status: (review?.status ?? "NOT_CHECKED") as QaCheckStatus,
        severity: (review?.severity ?? null) as QaDefectSeverity | null,
        note: review?.note ?? null,
        reviewedByEmail: review?.reviewedBy?.email ?? null,
        reviewedAt: review?.reviewedAt ?? null,
      };
    });

    const passed = checks.filter((check) => check.status === "PASS").length;
    const failed = checks.filter((check) => check.status === "FAIL").length;

    const worstSeverity =
      SEVERITY_ORDER.find((severity) =>
        checks.some((check) => check.status === "FAIL" && check.severity === severity),
      ) ?? null;

    return {
      sendId: send.id,
      recipient: send.recipient,
      subject: send.subject,
      scenarioId: send.scenarioId,
      scenarioTitle: scenario?.title ?? send.scenarioId,
      purpose: scenario?.purpose ?? send.purpose,
      providerMessageId: send.providerMessageId,
      acceptedAt: send.acceptedAt,
      ledgerRecovered: send.ledgerRecovered,
      checks,
      summary: {
        passed,
        failed,
        notChecked: checks.length - passed - failed,
        total: checks.length,
      },
      worstSeverity,
    };
  });

  const byRecipient = QA_ALLOWED_RECIPIENTS.map((recipient) => ({
    recipient,
    messages: messages.filter((message) => message.recipient === recipient),
  })).filter((group) => group.messages.length > 0);

  return {
    byRecipient,
    totals: {
      messages: messages.length,
      passed: messages.reduce((sum, message) => sum + message.summary.passed, 0),
      failed: messages.reduce((sum, message) => sum + message.summary.failed, 0),
      notChecked: messages.reduce((sum, message) => sum + message.summary.notChecked, 0),
    },
  };
}

export type RecordReviewResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Records ONE reviewer verdict.
 *
 * Writes only to `QaReviewCheck`. The payload contains no recipient, no provider and no
 * send state, so this function physically cannot alter what was sent or the quota
 * derived from it — the same shape that keeps language and consent apart (ADR-0020/21).
 */
export async function recordReviewCheck(input: {
  sendId: string;
  checkKey: string;
  status: string;
  severity?: string | null;
  note?: string | null;
}): Promise<RecordReviewResult> {
  const actor = await requireCapability(Capability.SEND_TEST_EMAIL);
  const prisma = getPrisma();

  if (!["NOT_CHECKED", "PASS", "FAIL"].includes(input.status)) {
    return { ok: false, message: "That is not a valid review status." };
  }
  const status = input.status as QaCheckStatus;

  const severity =
    status === "FAIL" && input.severity && SEVERITY_ORDER.includes(input.severity as QaDefectSeverity)
      ? (input.severity as QaDefectSeverity)
      : // Severity describes a defect. Cleared whenever the check is not failing, so a
        // later PASS cannot leave a stale "CRITICAL" attached to it.
        null;

  const send = await prisma.qaEmailSend.findUnique({
    where: { id: input.sendId },
    select: { id: true, scenarioId: true },
  });
  if (!send) return { ok: false, message: "That QA message no longer exists." };

  const item = checklistFor(send.scenarioId).find(
    (candidate) => candidate.checkKey === input.checkKey,
  );
  if (!item) return { ok: false, message: "That check does not belong to this message." };

  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;

  await prisma.qaReviewCheck.upsert({
    where: { sendId_checkKey: { sendId: send.id, checkKey: item.checkKey } },
    create: {
      sendId: send.id,
      checkKey: item.checkKey,
      label: item.label,
      status,
      severity,
      note,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
    update: {
      status,
      severity,
      note,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
  });

  return { ok: true, message: "Review saved." };
}

/** Every failed check, worst first — the defect list for a closure report. */
export async function listDefects() {
  await requireCapability(Capability.SEND_TEST_EMAIL);
  const rows = await getPrisma().qaReviewCheck.findMany({
    where: { status: "FAIL" },
    include: {
      send: { select: { recipient: true, subject: true, scenarioId: true } },
      reviewedBy: { select: { email: true } },
    },
  });

  return rows.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf((a.severity ?? "COSMETIC") as QaDefectSeverity) -
      SEVERITY_ORDER.indexOf((b.severity ?? "COSMETIC") as QaDefectSeverity),
  );
}
