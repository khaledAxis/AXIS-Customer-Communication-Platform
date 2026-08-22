import "server-only";

import {
  SCHEDULE_PROBLEM_MESSAGE,
  describeSchedule,
  isDue,
  nextOccurrence,
  validateSchedule,
  type Cadence,
} from "../../domain/content/automationSchedule";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { runIngestion } from "./contentIngestionService";
import { createDraftFromContent } from "./newsletterDraftService";

/**
 * Assisted newsletter automation (ADR-0026, implementing ADR-0010's ASSISTED mode).
 *
 * "Assisted" is the entire contract. An automation collects from approved sources on a
 * schedule and, if there is APPROVED content waiting, prepares a DRAFT. It cannot
 * approve an article, cannot choose an audience, and cannot send.
 *
 * There is no import in this file — directly or transitively — that reaches an email
 * provider, `dispatchCampaign`, or `CampaignRecipient`. A test asserts that against
 * the source, because "we would never do that" is not a control.
 *
 * Two failure modes it takes seriously:
 *
 *  - **Nothing new is not an error.** A quiet week produces `NO_CONTENT`, reported as
 *    a plain sentence. Showing it as a failure trains people to ignore failures.
 *  - **An occurrence happens once.** `@@unique([automationId, scheduledFor])` means a
 *    double-click, a retry or two workers produce ONE run, decided by the database.
 */

export interface AutomationInput {
  name: string;
  cadence: string;
  interval?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour?: number | null;
  language: string;
  maxItems?: number;
  category?: string | null;
  sourceIds?: string[];
  isEnabled?: boolean;
}

export interface FieldError {
  field: string;
  message: string;
}

export type AutomationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

function validate(input: AutomationInput): AutomationResult<{
  name: string;
  cadence: Cadence;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  language: "HE" | "AR" | "UNKNOWN";
  maxItems: number;
  category: string | null;
}> {
  const errors: FieldError[] = [];

  const name = input.name?.trim();
  if (!name) errors.push({ field: "name", message: "Give this automation a name." });

  const language = input.language as "HE" | "AR" | "UNKNOWN";
  if (!["HE", "AR", "UNKNOWN"].includes(language)) {
    errors.push({ field: "language", message: "Choose the newsletter language." });
  }

  const maxItems = input.maxItems ?? 5;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    errors.push({ field: "maxItems", message: "Choose between 1 and 20 articles." });
  }

  const schedule = validateSchedule({
    cadence: input.cadence as Cadence,
    interval: input.interval ?? 1,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    hour: input.hour,
  });
  if (!schedule.ok) {
    for (const problem of schedule.problems) {
      // The friendly sentence, not the code — staff never see an enum name.
      errors.push({ field: "schedule", message: SCHEDULE_PROBLEM_MESSAGE[problem] });
    }
  }

  if (errors.length > 0 || !schedule.ok) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: name as string,
      cadence: schedule.definition.cadence,
      interval: schedule.definition.interval,
      dayOfWeek: schedule.definition.dayOfWeek ?? null,
      dayOfMonth: schedule.definition.dayOfMonth ?? null,
      hour: schedule.definition.hour ?? 8,
      language,
      maxItems,
      category: input.category?.trim().toLowerCase() || null,
    },
  };
}

/** The hour is stored inside `recurrence` — the model has no dedicated column. */
function recurrenceOf(hour: number): { hour: number } {
  return { hour };
}

function hourOf(recurrence: unknown): number {
  if (typeof recurrence === "object" && recurrence !== null && "hour" in recurrence) {
    const value = (recurrence as { hour?: unknown }).hour;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23) {
      return value;
    }
  }
  return 8;
}

export async function listAutomations() {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const automations = await getPrisma().newsletterAutomation.findMany({
    orderBy: [{ isEnabled: "desc" }, { name: "asc" }],
    include: {
      sources: { include: { source: { select: { id: true, name: true } } } },
      runs: {
        orderBy: [{ scheduledFor: "desc" }],
        take: 5,
        include: { generatedCampaign: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  return automations.map((automation) => ({
    ...automation,
    description: describeSchedule({
      cadence: automation.cadence as Cadence,
      interval: automation.interval,
      dayOfWeek: automation.dayOfWeek,
      dayOfMonth: automation.dayOfMonth,
      hour: hourOf(automation.recurrence),
    }),
  }));
}

export async function createAutomation(
  input: AutomationInput,
  now: Date = new Date(),
): Promise<AutomationResult<{ id: string }>> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const validated = validate(input);
  if (!validated.ok) return validated;

  const prisma = getPrisma();
  const schedule = {
    cadence: validated.data.cadence,
    interval: validated.data.interval,
    dayOfWeek: validated.data.dayOfWeek,
    dayOfMonth: validated.data.dayOfMonth,
    hour: validated.data.hour,
  };

  const automation = await prisma.$transaction(async (tx) => {
    const created = await tx.newsletterAutomation.create({
      data: {
        name: validated.data.name,
        cadence: validated.data.cadence,
        interval: validated.data.interval,
        dayOfWeek: validated.data.dayOfWeek,
        dayOfMonth: validated.data.dayOfMonth,
        recurrence: recurrenceOf(validated.data.hour),
        language: validated.data.language,
        maxItems: validated.data.maxItems,
        category: validated.data.category,
        isEnabled: input.isEnabled !== false,
        // ASSISTED is the only mode. There is no AUTOMATIC value to set.
        mode: "ASSISTED",
        // Deliberately null: an automation never picks who receives a newsletter.
        segmentId: null,
        nextScheduledAt: nextOccurrence(schedule, now),
        createdById: actor.id,
      },
    });

    const sourceIds = Array.from(new Set(input.sourceIds ?? []));
    if (sourceIds.length > 0) {
      // Only ALREADY-APPROVED sources can be attached; this cannot introduce a URL.
      const known = await tx.contentSource.findMany({
        where: { id: { in: sourceIds }, kind: { not: "INTERNAL" } },
        select: { id: true },
      });
      await tx.newsletterAutomationSource.createMany({
        data: known.map((source) => ({
          automationId: created.id,
          sourceId: source.id,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        action: "AUTOMATION_CREATED",
        actorUserId: actor.id,
        entityType: "NewsletterAutomation",
        entityId: created.id,
        toState: created.isEnabled ? "ENABLED" : "PAUSED",
        metadata: {
          name: created.name,
          cadence: created.cadence,
          language: created.language,
          maxItems: created.maxItems,
          sourceCount: sourceIds.length,
          producesDraftsOnly: true,
        },
      },
    });

    return created;
  });

  return { ok: true, data: { id: automation.id } };
}

export async function updateAutomation(
  id: string,
  input: AutomationInput,
  now: Date = new Date(),
): Promise<AutomationResult<{ id: string }>> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const validated = validate(input);
  if (!validated.ok) return validated;

  const prisma = getPrisma();
  const existing = await prisma.newsletterAutomation.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That automation no longer exists." }] };
  }

  await prisma.$transaction(async (tx) => {
    await tx.newsletterAutomation.update({
      where: { id },
      data: {
        name: validated.data.name,
        cadence: validated.data.cadence,
        interval: validated.data.interval,
        dayOfWeek: validated.data.dayOfWeek,
        dayOfMonth: validated.data.dayOfMonth,
        recurrence: recurrenceOf(validated.data.hour),
        language: validated.data.language,
        maxItems: validated.data.maxItems,
        category: validated.data.category,
        nextScheduledAt: nextOccurrence(
          {
            cadence: validated.data.cadence,
            interval: validated.data.interval,
            dayOfWeek: validated.data.dayOfWeek,
            dayOfMonth: validated.data.dayOfMonth,
            hour: validated.data.hour,
          },
          now,
        ),
      },
    });

    const sourceIds = Array.from(new Set(input.sourceIds ?? []));
    await tx.newsletterAutomationSource.deleteMany({ where: { automationId: id } });
    if (sourceIds.length > 0) {
      const known = await tx.contentSource.findMany({
        where: { id: { in: sourceIds }, kind: { not: "INTERNAL" } },
        select: { id: true },
      });
      await tx.newsletterAutomationSource.createMany({
        data: known.map((source) => ({ automationId: id, sourceId: source.id })),
      });
    }

    await tx.auditLog.create({
      data: {
        action: "AUTOMATION_UPDATED",
        actorUserId: actor.id,
        entityType: "NewsletterAutomation",
        entityId: id,
        metadata: { name: validated.data.name, cadence: validated.data.cadence },
      },
    });
  });

  return { ok: true, data: { id } };
}

/** Pause / resume. A paused automation is skipped entirely, not merely quietened. */
export async function setAutomationEnabled(
  id: string,
  isEnabled: boolean,
  now: Date = new Date(),
): Promise<AutomationResult<{ id: string; isEnabled: boolean }>> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();

  const existing = await prisma.newsletterAutomation.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That automation no longer exists." }] };
  }

  await prisma.$transaction(async (tx) => {
    await tx.newsletterAutomation.update({
      where: { id },
      data: {
        isEnabled,
        nextScheduledAt: isEnabled
          ? nextOccurrence(
              {
                cadence: existing.cadence as Cadence,
                interval: existing.interval,
                dayOfWeek: existing.dayOfWeek,
                dayOfMonth: existing.dayOfMonth,
                hour: hourOf(existing.recurrence),
              },
              now,
            )
          : // A paused automation has no next occurrence. Leaving a date on a paused
            // row is how "why did that run?" starts.
            null,
      },
    });

    await tx.auditLog.create({
      data: {
        action: isEnabled ? "AUTOMATION_ENABLED" : "AUTOMATION_PAUSED",
        actorUserId: actor.id,
        entityType: "NewsletterAutomation",
        entityId: id,
        fromState: existing.isEnabled ? "ENABLED" : "PAUSED",
        toState: isEnabled ? "ENABLED" : "PAUSED",
        metadata: { name: existing.name },
      },
    });
  });

  return { ok: true, data: { id, isEnabled } };
}

// ---------------------------------------------------------------------------
// Running an occurrence
// ---------------------------------------------------------------------------

export interface AutomationRunResult {
  automationId: string;
  runId: string | null;
  status: "PREPARED" | "PARTIAL" | "NO_CONTENT" | "FAILED" | "SKIPPED";
  campaignId: string | null;
  itemsFound: number;
  itemsNew: number;
  itemsUsed: number;
  message: string;
}

/**
 * Runs ONE occurrence of an automation.
 *
 * Order matters: collect first, then draft from what a person has ALREADY approved.
 * Articles ingested by this very run are `PENDING_REVIEW` and therefore cannot appear
 * in the draft it produces — the first run of a brand-new automation legitimately
 * reports `NO_CONTENT`, and that is the safe behaviour, not a bug.
 */
export async function runAutomation(
  automationId: string,
  options?: { scheduledFor?: Date; now?: Date },
): Promise<AutomationRunResult> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();
  const now = options?.now ?? new Date();

  const automation = await prisma.newsletterAutomation.findUnique({
    where: { id: automationId },
    include: { sources: { select: { sourceId: true } } },
  });

  if (!automation) {
    return {
      automationId,
      runId: null,
      status: "FAILED",
      campaignId: null,
      itemsFound: 0,
      itemsNew: 0,
      itemsUsed: 0,
      message: "That automation no longer exists.",
    };
  }

  if (!automation.isEnabled) {
    // Paused means paused. No fetch, no draft, and no run row — a paused automation
    // must leave no trace of having "almost" run.
    return {
      automationId,
      runId: null,
      status: "SKIPPED",
      campaignId: null,
      itemsFound: 0,
      itemsNew: 0,
      itemsUsed: 0,
      message: "This automation is paused, so nothing was collected or created.",
    };
  }

  const scheduledFor =
    options?.scheduledFor ??
    automation.nextScheduledAt ??
    // Occurrences are minute-aligned so a manual run and a scheduled one for the same
    // moment collide at the unique index rather than producing two drafts.
    new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  // Claim the occurrence. The UNIQUE (automationId, scheduledFor) decides the winner;
  // a second caller for the same occurrence loses here, before anything is fetched.
  let run;
  try {
    run = await prisma.newsletterAutomationRun.create({
      data: {
        automationId,
        scheduledFor,
        status: "PREPARING",
        startedAt: new Date(),
      },
    });
  } catch {
    return {
      automationId,
      runId: null,
      status: "SKIPPED",
      campaignId: null,
      itemsFound: 0,
      itemsNew: 0,
      itemsUsed: 0,
      message: "That run has already been prepared.",
    };
  }

  const sourceIds = automation.sources.map((link) => link.sourceId);

  // 1. Collect. Populates the review inbox; approves nothing.
  const ingestion = await runIngestion({
    sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
  });
  const sourcesFailed = ingestion.sources.filter((s) => s.status === "FAILED").length;

  // 2. Draft from content a PERSON has already approved. Never from what arrived above.
  const candidates = await prisma.contentItem.findMany({
    where: {
      reviewState: "APPROVED",
      origin: "INGESTED",
      language: automation.language,
      ...(sourceIds.length > 0 ? { sourceId: { in: sourceIds } } : {}),
      ...(automation.category
        ? { source: { categories: { has: automation.category } } }
        : {}),
      // Not already in a newsletter: an automation must not keep re-sending the same
      // article every week because nobody removed it.
      campaignLinks: { none: {} },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: automation.maxItems,
    select: { id: true },
  });

  const complete = async (
    status: "PREPARED" | "PARTIAL" | "NO_CONTENT" | "FAILED",
    campaignId: string | null,
    itemsUsed: number,
    message: string | null,
  ) => {
    await prisma.$transaction(async (tx) => {
      await tx.newsletterAutomationRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          generatedCampaignId: campaignId,
          itemsFound: candidates.length,
          itemsNew: ingestion.totalCreated,
          itemsUsed,
          sourcesFailed,
          errorMessage: message,
        },
      });
      await tx.newsletterAutomation.update({
        where: { id: automationId },
        data: {
          lastRunAt: new Date(),
          nextScheduledAt: nextOccurrence(
            {
              cadence: automation.cadence as Cadence,
              interval: automation.interval,
              dayOfWeek: automation.dayOfWeek,
              dayOfMonth: automation.dayOfMonth,
              hour: hourOf(automation.recurrence),
            },
            now,
          ),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "AUTOMATION_RUN",
          actorUserId: actor.id,
          entityType: "NewsletterAutomation",
          entityId: automationId,
          toState: status,
          metadata: {
            runId: run.id,
            campaignId,
            itemsNew: ingestion.totalCreated,
            itemsUsed,
            sourcesFailed,
            // Recorded on every run so the invariant is provable from the audit trail.
            sentAnything: false,
          },
        },
      });
    });
  };

  if (candidates.length === 0) {
    // NOT an error. Nothing approved was waiting, so there is nothing to draft.
    await complete("NO_CONTENT", null, 0, null);
    return {
      automationId,
      runId: run.id,
      status: "NO_CONTENT",
      campaignId: null,
      itemsFound: 0,
      itemsNew: ingestion.totalCreated,
      itemsUsed: 0,
      message:
        ingestion.totalCreated > 0
          ? `${ingestion.totalCreated} new article${ingestion.totalCreated === 1 ? "" : "s"} are waiting in the review inbox. Approve the ones you want, and the next run will put them in a draft.`
          : "No approved articles were waiting, so no draft was created.",
    };
  }

  const draft = await createDraftFromContent({
    contentItemIds: candidates.map((item) => item.id),
    name: `${automation.name} — ${now.toISOString().slice(0, 10)}`,
    language: automation.language,
  });

  if (!draft.ok) {
    await complete("FAILED", null, 0, draft.message);
    return {
      automationId,
      runId: run.id,
      status: "FAILED",
      campaignId: null,
      itemsFound: candidates.length,
      itemsNew: ingestion.totalCreated,
      itemsUsed: 0,
      message: draft.message,
    };
  }

  const status = sourcesFailed > 0 ? "PARTIAL" : "PREPARED";
  await complete(status, draft.campaignId, draft.attached, null);

  return {
    automationId,
    runId: run.id,
    status,
    campaignId: draft.campaignId,
    itemsFound: candidates.length,
    itemsNew: ingestion.totalCreated,
    itemsUsed: draft.attached,
    message:
      status === "PARTIAL"
        ? `Draft created with ${draft.attached} article${draft.attached === 1 ? "" : "s"}, but ${sourcesFailed} source${sourcesFailed === 1 ? "" : "s"} could not be checked. Nothing has been sent.`
        : `Draft created with ${draft.attached} article${draft.attached === 1 ? "" : "s"}. Nothing has been sent, and no recipients have been chosen.`,
  };
}

/** Automations whose next occurrence has arrived. Used by a future scheduler. */
export async function listDueAutomations(now: Date = new Date()) {
  const prisma = getPrisma();
  const automations = await prisma.newsletterAutomation.findMany({
    where: { isEnabled: true, nextScheduledAt: { not: null } },
    select: { id: true, name: true, nextScheduledAt: true },
  });
  return automations.filter(
    (automation) => automation.nextScheduledAt && isDue(automation.nextScheduledAt, now),
  );
}

export async function listRuns(automationId: string, limit = 25) {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  return getPrisma().newsletterAutomationRun.findMany({
    where: { automationId },
    orderBy: [{ scheduledFor: "desc" }],
    take: limit,
    include: { generatedCampaign: { select: { id: true, name: true, status: true } } },
  });
}
