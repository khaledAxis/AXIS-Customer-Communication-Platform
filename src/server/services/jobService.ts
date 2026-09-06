import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { claimJob, finishJob, heartbeatJob, recoverExpiredJobs } from "../db/repositories/jobRepository";
import { withinClaimedJob, currentJob } from "../jobs/context";
import { nextOccurrence, type Cadence } from "../../domain/content/automationSchedule";
import { JOB_MAX_ATTEMPTS } from "../../domain/jobs/policy";

export function schedulerAuthorized(authorization: string | null): boolean {
  const secret = process.env.SCHEDULER_TRIGGER_SECRET ?? "";
  if (process.env.SCHEDULER_ENABLED !== "true" || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(secret), digest(authorization.slice(7)));
}

export async function configureCrmSchedule(isEnabled: boolean, intervalMinutes: number) {
  const actor = await requireCapability(Capability.RUN_CRM_SYNC);
  if (currentJob()) throw new Error("Schedules require a signed-in staff action.");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 1440)
    throw new Error("Choose a sync interval between 15 and 1440 minutes.");
  return getPrisma().$transaction(async tx => {
    const schedule = await tx.jobSchedule.upsert({ where: { key: "CRM_RECONCILIATION" },
      create: { key: "CRM_RECONCILIATION", isEnabled, intervalMinutes, actorUserId: actor.id, nextRunAt: new Date() },
      update: { isEnabled, intervalMinutes, actorUserId: actor.id, nextRunAt: new Date() },
    });
    await tx.auditLog.create({ data: { action: "CRM_SYNC", actorUserId: actor.id, entityType: "JobSchedule",
      entityId: schedule.key, toState: isEnabled ? "ENABLED" : "PAUSED", metadata: { intervalMinutes, backgroundDelegation: true } } });
    return schedule;
  });
}

export async function getJobOperations() {
  await requireCapability(Capability.RUN_CRM_SYNC);
  const [schedule, jobs, webhookCounts, heartbeat] = await Promise.all([
    getPrisma().jobSchedule.findUnique({ where: { key: "CRM_RECONCILIATION" } }),
    getPrisma().backgroundJob.findMany({ orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, kind: true, state: true, resourceId: true, scheduledFor: true, attempts: true, errorCode: true, updatedAt: true } }),
    getPrisma().mondayWebhookEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    getPrisma().schedulerHeartbeat.findUnique({ where: { id: "scheduler" } }),
  ]);
  return { schedule, jobs, webhookCounts, heartbeat, schedulerEnabled: process.env.SCHEDULER_ENABLED === "true",
    schedulerActive: process.env.SCHEDULER_ENABLED === "true" && !!heartbeat && Date.now() - heartbeat.lastTickAt.getTime() < 120000,
    mondayWebhookEnabled: process.env.MONDAY_WEBHOOK_ENABLED === "true" };
}

/** Public caller supplies no actor, schedule, job id or payload. Only persisted intent is materialized. */
export async function enqueueDueJobs(now = new Date()) {
  const prisma = getPrisma();
  const [crm, automations] = await Promise.all([
    prisma.jobSchedule.findFirst({ where: { key: "CRM_RECONCILIATION", isEnabled: true, nextRunAt: { lte: now } } }),
    prisma.newsletterAutomation.findMany({ where: { isEnabled: true, nextScheduledAt: { lte: now } }, take: 100 }),
  ]);
  if (crm) await prisma.$transaction(async tx => {
    await tx.backgroundJob.createMany({ data: [{ uniqueKey: `crm:${crm.nextRunAt.toISOString()}`, kind: "CRM_SYNC",
      actorUserId: crm.actorUserId, scheduledFor: crm.nextRunAt, availableAt: now }], skipDuplicates: true });
    await tx.jobSchedule.updateMany({ where: { key: crm.key, nextRunAt: crm.nextRunAt, isEnabled: true },
      data: { nextRunAt: new Date(now.getTime() + crm.intervalMinutes * 60000) } });
  });
  for (const automation of automations) {
    if (!automation.createdById || !automation.nextScheduledAt) continue;
    const recurrence = automation.recurrence as { hour?: number } | null;
    await prisma.$transaction(async tx => {
      await tx.backgroundJob.createMany({ data: [{ uniqueKey: `automation:${automation.id}:${automation.nextScheduledAt!.toISOString()}`,
        kind: "AUTOMATION", resourceId: automation.id, actorUserId: automation.createdById!,
        scheduledFor: automation.nextScheduledAt!, availableAt: now }], skipDuplicates: true });
      await tx.newsletterAutomation.updateMany({ where: { id: automation.id, isEnabled: true, nextScheduledAt: automation.nextScheduledAt },
        data: { nextScheduledAt: nextOccurrence({ cadence: automation.cadence as Cadence, interval: automation.interval,
          dayOfWeek: automation.dayOfWeek, dayOfMonth: automation.dayOfMonth, hour: recurrence?.hour ?? 8 }, now) } });
    });
  }
}

export async function runJobTick() {
  if (process.env.SCHEDULER_ENABLED !== "true") return { status: "disabled" };
  await getPrisma().schedulerHeartbeat.upsert({ where: { id: "scheduler" },
    create: { id: "scheduler", lastTickAt: new Date() }, update: { lastTickAt: new Date() } });
  await recoverExpiredJobs();
  const { reconcileProviderReceipts } = await import("./providerEventService");
  await reconcileProviderReceipts();
  await enqueueDueJobs();
  const job = await claimJob();
  if (!job) return { status: "idle" };
  const heartbeat = setInterval(() => {
    void heartbeatJob(job).then(async valid => {
      if (valid) await getPrisma().schedulerHeartbeat.update({ where: { id: "scheduler" }, data: { lastTickAt: new Date() } });
    }).catch(() => undefined);
  }, 20000);
  try {
    await withinClaimedJob(job.id, job.leaseToken!, async () => {
      if (job.kind === "CRM_SYNC") {
        const schedule = await getPrisma().jobSchedule.findUnique({ where: { key: "CRM_RECONCILIATION" } });
        if (!schedule?.isEnabled || schedule.actorUserId !== job.actorUserId) {
          await finishJob(job, "ATTENTION", undefined, "SCHEDULE_PAUSED_OR_CHANGED"); return;
        }
        const { syncCrmFromMonday } = await import("./crmSyncService");
        const result = await syncCrmFromMonday();
        if (!result.ok) throw new Error("CRM_SYNC_FAILED");
        await finishJob(job, "SUCCEEDED", { companies: result.companies, contacts: result.contacts });
        await getPrisma().mondayWebhookEvent.updateMany({ where: { status: "QUEUED", receivedAt: { lte: job.scheduledFor } },
          data: { status: "PROCESSED", processedAt: new Date() } });
      } else if (job.kind === "AUTOMATION") {
        const { runAutomation } = await import("./automationService");
        const result = await runAutomation(job.resourceId!, { scheduledFor: job.scheduledFor });
        await finishJob(job, result.status === "FAILED" ? "ATTENTION" : "SUCCEEDED",
          { status: result.status, campaignId: result.campaignId, itemsUsed: result.itemsUsed });
      } else {
        const { dispatchCampaign } = await import("./deliveryService");
        const result = await dispatchCampaign(job.resourceId!);
        if (!result.ok) await finishJob(job, "ATTENTION", undefined, result.reason);
        else {
          const uncertain = await getPrisma().campaignRecipient.count({ where: { campaignId: job.resourceId!, state: "UNCERTAIN" } });
          await finishJob(job, result.remaining ? "PENDING" : uncertain ? "ATTENTION" : "SUCCEEDED",
            { submitted: result.submitted, vetoed: result.vetoed, uncertain }, uncertain && !result.remaining ? "UNCERTAIN_SUBMISSION" : undefined, 1000);
        }
      }
    });
  } catch {
    if (job.kind === "DISPATCH" && job.resourceId) {
      await getPrisma().campaignRecipient.updateMany({ where: { campaignId: job.resourceId, state: "SENDING" },
        data: { state: "UNCERTAIN", failureReason: "Execution interrupted; provider reconciliation required." } });
    }
    await finishJob(job, job.kind === "CRM_SYNC" && job.attempts < JOB_MAX_ATTEMPTS ? "PENDING" : "ATTENTION",
      undefined, "EXECUTION_FAILED");
  } finally { clearInterval(heartbeat); }
  return { status: "processed" };
}

export async function retryCrmJob(id: string) {
  const actor = await requireCapability(Capability.RUN_CRM_SYNC);
  const job = await getPrisma().backgroundJob.findUnique({ where: { id } });
  if (!job || job.kind !== "CRM_SYNC" || !["FAILED", "ATTENTION"].includes(job.state))
    throw new Error("Only failed CRM reconciliation jobs can be retried here.");
  await getPrisma().$transaction(async tx => {
    const changed = await tx.backgroundJob.updateMany({ where: { id, state: job.state }, data: {
      state: "PENDING", attempts: 0, actorUserId: actor.id, errorCode: null, availableAt: new Date(),
    } });
    if (!changed.count) throw new Error("This job changed. Reload its current status.");
    await tx.auditLog.create({ data: { action: "JOB_CHANGED", actorUserId: actor.id, entityType: "BackgroundJob", entityId: id,
      fromState: job.state, toState: "PENDING", metadata: { operation: "RETRY_CRM" } } });
  });
}
