import "server-only";
import { randomUUID } from "node:crypto";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { JOB_LEASE_MS, JOB_MAX_ATTEMPTS, retryDelayMs } from "../../../domain/jobs/policy";
import { getPrisma } from "../prisma";

export async function claimJob(): Promise<BackgroundJob | null> {
  const token = randomUUID();
  return getPrisma().$transaction(async tx => {
  // Acquire the short claim mutex in its own statement. The following READ COMMITTED
  // snapshot must see the previous claimant's RUNNING row, even for different jobs
  // targeting the same resource. A lock inside that SELECT would retain its old snapshot.
  const [mutex] = await tx.$queryRaw<{ claimed: boolean }[]>`SELECT pg_try_advisory_xact_lock(41827319) AS claimed`;
  if (!mutex.claimed) return null;
  const rows = await tx.$queryRaw<BackgroundJob[]>`
    WITH candidate AS (
      SELECT id FROM "BackgroundJob" p WHERE state = 'PENDING' AND "availableAt" <= NOW()
      AND NOT EXISTS (SELECT 1 FROM "BackgroundJob" running WHERE running.state = 'RUNNING'
        AND running.kind = p.kind AND (p.kind = 'CRM_SYNC' OR running."resourceId" = p."resourceId"))
      ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "BackgroundJob" j SET state = 'RUNNING', "leaseToken" = ${token},
      "leaseExpiresAt" = NOW() + ${JOB_LEASE_MS} * INTERVAL '1 millisecond',
      attempts = attempts + 1, "updatedAt" = NOW()
    FROM candidate WHERE j.id = candidate.id RETURNING j.*`;
  return rows[0] ?? null;
  });
}

export async function heartbeatJob(job: Pick<BackgroundJob, "id" | "leaseToken">) {
  const result = await getPrisma().backgroundJob.updateMany({
    where: { id: job.id, state: "RUNNING", leaseToken: job.leaseToken, leaseExpiresAt: { gt: new Date() } },
    data: { leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) },
  });
  return result.count === 1;
}

export async function finishJob(job: BackgroundJob, state: "SUCCEEDED" | "FAILED" | "ATTENTION" | "PENDING",
  result?: Prisma.InputJsonValue, errorCode?: string, continueAfterMs?: number) {
  return getPrisma().backgroundJob.updateMany({
    where: { id: job.id, state: "RUNNING", leaseToken: job.leaseToken, leaseExpiresAt: { gt: new Date() } },
    data: { state, result, errorCode: errorCode ?? null, leaseToken: null, leaseExpiresAt: null,
      ...(state === "PENDING" ? { availableAt: new Date(Date.now() + (continueAfterMs ?? retryDelayMs(job.attempts))) } : {}) },
  });
}

/** Side-effect uncertainty is visible; an abandoned automation is never blindly recreated. */
export async function recoverExpiredJobs() {
  const expired = await getPrisma().backgroundJob.findMany({
    where: { state: "RUNNING", leaseExpiresAt: { lte: new Date() } }, take: 100,
  });
  for (const job of expired) {
    await getPrisma().$transaction(async tx => {
      const reclaimed = await tx.backgroundJob.updateMany({
        where: { id: job.id, state: "RUNNING", leaseToken: job.leaseToken, leaseExpiresAt: { lte: new Date() } },
        data: { state: job.kind === "CRM_SYNC" && job.attempts < JOB_MAX_ATTEMPTS ? "PENDING" : "ATTENTION",
          errorCode: "WORKER_INTERRUPTED", leaseToken: null, leaseExpiresAt: null,
          availableAt: new Date(Date.now() + retryDelayMs(job.attempts)) },
      });
      if (reclaimed.count && job.kind === "DISPATCH" && job.resourceId) {
        // A request could have reached the provider before the process disappeared.
        await tx.campaignRecipient.updateMany({ where: { campaignId: job.resourceId, state: "SENDING" },
          data: { state: "UNCERTAIN", failureReason: "Worker interrupted; provider reconciliation required." } });
      }
      if (reclaimed.count && job.kind === "AUTOMATION" && job.resourceId) {
        await tx.newsletterAutomationRun.updateMany({
          where: { automationId: job.resourceId, scheduledFor: job.scheduledFor, status: "PREPARING" },
          data: { status: "FAILED", completedAt: new Date(), errorMessage: "Worker interrupted; review the existing draft before running again." },
        });
      }
    });
  }
  return expired.length;
}
