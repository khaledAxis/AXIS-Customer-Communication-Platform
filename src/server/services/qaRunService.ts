import "server-only";

import {
  QA_ALLOWED_RECIPIENTS,
  QA_HARD_PER_RECIPIENT,
  QA_HARD_TOTAL,
  QA_RECOMMENDED_TOTAL,
} from "../../domain/send/qaPolicy";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import * as ledger from "../db/repositories/qaLedgerRepository";

/**
 * QA run lifecycle (ADR-0028).
 *
 * A "run" is one deliberate QA campaign. It exists so the caps mean something over
 * time: without it, "how many have we sent?" would be answered by whatever happened to
 * be in a table, and anything that emptied the table would hand back permission.
 *
 * A run is opened ONLY by an explicit ADMIN action. It is never opened because the
 * application restarted, because a test ran, because the ledger changed, or because an
 * environment variable was toggled — there is no code path that creates one implicitly,
 * and `getQaRunState` returns `null` rather than creating one when none is open.
 */

export interface QaRecipientQuota {
  recipient: string;
  sent: number;
  hardLimit: number;
  remaining: number;
  atLimit: boolean;
}

export interface QaRunState {
  run: {
    id: string;
    label: string;
    status: string;
    createdAt: Date;
    createdByEmail: string | null;
    note: string | null;
  } | null;
  /** Totals for the OPEN run. */
  runTotal: number;
  runPerRecipient: QaRecipientQuota[];
  /** Totals across ALL live runs ever — the number a human should trust. */
  lifetimeTotal: number;
  lifetimePerRecipient: Record<string, number>;
  hardTotal: number;
  hardPerRecipient: number;
  recommendedTotal: number;
  /** True when live sends exist but no run is open — a new run must be confirmed. */
  requiresNewRunConfirmation: boolean;
}

export async function getQaRunState(): Promise<QaRunState> {
  await requireCapability(Capability.SEND_TEST_EMAIL);

  const run = await ledger.findOpenLiveRun();
  const lifetime = await ledger.countLiveSends();
  const current = run ? await ledger.countLiveSends(run.id) : { total: 0, perRecipient: {} };

  const createdByEmail = run?.createdById
    ? ((
        await getPrisma().user.findUnique({
          where: { id: run.createdById },
          select: { email: true },
        })
      )?.email ?? null)
    : null;

  const runPerRecipient: QaRecipientQuota[] = QA_ALLOWED_RECIPIENTS.map((recipient) => {
    // The cap is enforced on LIFETIME sends per recipient, not per run. Opening a new
    // run must not hand back quota — that is the whole point of the incident this
    // design exists to prevent.
    const sent = lifetime.perRecipient[recipient] ?? 0;
    return {
      recipient,
      sent,
      hardLimit: QA_HARD_PER_RECIPIENT,
      remaining: Math.max(0, QA_HARD_PER_RECIPIENT - sent),
      atLimit: sent >= QA_HARD_PER_RECIPIENT,
    };
  });

  return {
    run: run
      ? {
          id: run.id,
          label: run.label,
          status: run.status,
          createdAt: run.createdAt,
          createdByEmail,
          note: run.note,
        }
      : null,
    runTotal: current.total,
    runPerRecipient,
    lifetimeTotal: lifetime.total,
    lifetimePerRecipient: lifetime.perRecipient,
    hardTotal: QA_HARD_TOTAL,
    hardPerRecipient: QA_HARD_PER_RECIPIENT,
    recommendedTotal: QA_RECOMMENDED_TOTAL,
    // Live history exists and nothing is open: starting again is a deliberate act.
    requiresNewRunConfirmation: run === null && lifetime.total > 0,
  };
}

export type QaRunResult =
  | { ok: true; runId: string; message: string }
  | { ok: false; reason: string; message: string };

/**
 * Opens a new live QA run.
 *
 * ADMIN only, and requires an explicit acknowledgement when live sends already exist,
 * so nobody starts a second campaign believing the counters are fresh. They are not:
 * the per-recipient cap counts every live send ever made.
 */
export async function openQaRun(input: {
  label: string;
  plannedCount?: number;
  acknowledgedExistingSends?: boolean;
}): Promise<QaRunResult> {
  const actor = await requireCapability(Capability.MANAGE_USERS);

  const existing = await ledger.findOpenLiveRun();
  if (existing) {
    return {
      ok: false,
      reason: "ALREADY_OPEN",
      message: `A QA run is already open ("${existing.label}"). Close it before starting another.`,
    };
  }

  const lifetime = await ledger.countLiveSends();
  if (lifetime.total > 0 && input.acknowledgedExistingSends !== true) {
    return {
      ok: false,
      reason: "CONFIRMATION_REQUIRED",
      message:
        `${lifetime.total} live QA email${lifetime.total === 1 ? "" : "s"} have already been sent. ` +
        "Starting a new run does NOT reset the limits. Confirm that you understand before continuing.",
    };
  }

  const label = input.label?.trim();
  if (!label) {
    return { ok: false, reason: "NO_LABEL", message: "Give this QA run a name." };
  }

  const run = await ledger.createRun({
    label,
    origin: "LIVE",
    plannedCount: input.plannedCount ?? 0,
    createdById: actor.id,
  });

  await getPrisma().auditLog.create({
    data: {
      action: "QA_RUN_OPENED",
      actorUserId: actor.id,
      entityType: "QaEmailRun",
      entityId: run.id,
      toState: "OPEN",
      metadata: {
        label,
        priorLiveSends: lifetime.total,
        // Recorded so it is provable that the operator was told.
        acknowledgedExistingSends: input.acknowledgedExistingSends === true,
      },
    },
  });

  return {
    ok: true,
    runId: run.id,
    message: `QA run "${label}" opened. ${lifetime.total} live QA emails already count against the limits.`,
  };
}

export async function closeQaRun(runId: string): Promise<QaRunResult> {
  const actor = await requireCapability(Capability.MANAGE_USERS);

  const run = await getPrisma().qaEmailRun.findUnique({ where: { id: runId } });
  if (!run || run.origin !== "LIVE") {
    return { ok: false, reason: "NOT_FOUND", message: "That QA run does not exist." };
  }
  if (run.status === "CLOSED") {
    return { ok: false, reason: "ALREADY_CLOSED", message: "That run is already closed." };
  }

  await ledger.closeRun(runId);
  await getPrisma().auditLog.create({
    data: {
      action: "QA_RUN_CLOSED",
      actorUserId: actor.id,
      entityType: "QaEmailRun",
      entityId: runId,
      fromState: "OPEN",
      toState: "CLOSED",
      metadata: { label: run.label },
    },
  });

  return { ok: true, runId, message: `QA run "${run.label}" closed.` };
}

export const listQaRuns = ledger.listRuns;
export const listQaSends = ledger.listSends;
